import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import paths from './paths.cjs';

const base=process.platform==='win32'&&process.env.XDG_DATA_HOME?path.resolve(process.env.XDG_DATA_HOME,'../temp/notchdesk'):os.tmpdir();
await fs.mkdir(base,{recursive:true});
const temp=await fs.mkdtemp(path.join(base,'http-mcp-')),data=path.join(temp,'data'),plugins=path.join(temp,'plugins');
await fs.cp(path.join(paths.root,'plugins'),plugins,{recursive:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){try{const value=await check();if(value)return value;}catch{}await wait(70);}throw Error('HTTP MCP verification timed out');}
let processHandle;
const clients=[];
const results={checks:[],passed:false};
function pass(check){results.checks.push(check);console.log('PASS',check);}
async function start(port=0,previousToken){
  processHandle=spawn(process.execPath,[path.join(paths.buildDir,'server.cjs')],{env:{...process.env,NOTCH_DATA:data,NOTCH_PLUGINS:plugins,NOTCH_PORT:String(port)},windowsHide:true,stdio:'ignore'});
  return until(async()=>{const descriptor=JSON.parse(await fs.readFile(path.join(data,'connection.json'),'utf8'));return descriptor.token!==previousToken&&descriptor;});
}
async function stop(){if(processHandle?.exitCode===null){const exited=once(processHandle,'exit');processHandle.kill();await exited;}processHandle=undefined;}
async function connect(url,headers){
  const client=new Client({name:'http-smoke',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers}});
  await client.connect(transport);clients.push({client,transport});return {client,transport};
}
try{
  let descriptor=await start();
  const url=`http://127.0.0.1:${descriptor.port}/mcp`,headers={Authorization:'Bearer '+descriptor.mcpToken,Origin:'http://localhost:6274'};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
  const invalidHost=await new Promise((resolve,reject)=>{const request=httpRequest(url,{headers:{...headers,Host:'untrusted.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});
  assert.equal(invalidHost,403);
  const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:'http://localhost:6274','Access-Control-Request-Headers':'authorization,mcp-session-id'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:6274');
  pass('authentication, Origin and Host validation, and local browser CORS');
  const first=await connect(url,headers),second=await connect(url,headers);
  assert.notEqual(first.transport.sessionId,second.transport.sessionId);
  const listed=await first.client.listTools();assert.ok(listed.tools.some(tool=>tool.name==='todo_add'));
  assert.ok(!listed.tools.some(tool=>tool.name==='locale_set'||tool.name.startsWith('host_')));
  const add=await first.client.callTool({name:'todo_add',arguments:{title:'HTTP shared task'}});assert.ok(!add.isError);
  const task=JSON.parse(add.content[0].text);
  const update=await second.client.callTool({name:'todo_update',arguments:{id:task.id,status:'completed'}});assert.ok(!update.isError);
  const items=JSON.parse((await first.client.callTool({name:'todo_list',arguments:{}})).content[0].text);assert.equal(items.find(item=>item.id===task.id).status,'completed');
  const forged=await first.client.callTool({name:'host_activity',arguments:{idleSeconds:0}});assert.ok(forged.isError);
  pass('SDK initialization, independent sessions, shared todo state and host isolation');
  let notifications=0;first.client.setNotificationHandler(ToolListChangedNotificationSchema,()=>{notifications++;});
  const folder=path.join(plugins,'qa_http');await fs.mkdir(folder);
  await fs.writeFile(path.join(folder,'index.cjs'),"exports.activate=ctx=>ctx.action('qa_http_probe','HTTP probe',{type:'object',properties:{}},()=>({ok:true}))");
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({id:'qa_http',name:'HTTP probe',version:'1',entry:'index.cjs',settings:{}}));
  await until(()=>notifications>0);assert.ok((await first.client.listTools()).tools.some(tool=>tool.name==='qa_http_probe'));
  const before=notifications;await fs.writeFile(path.join(data,'mcp-grants.json'),JSON.stringify(['workspace','desktop','administration','files']));
  await until(()=>notifications>before);assert.ok((await first.client.listTools()).tools.some(tool=>tool.name==='locale_set'));
  const locale=await first.client.callTool({name:'locale_set',arguments:{locale:'en-US'}});assert.ok(!locale.isError);
  await fs.writeFile(path.join(data,'mcp-grants.json'),JSON.stringify(['workspace','desktop']));
  const denied=await first.client.callTool({name:'locale_set',arguments:{locale:'zh-CN'}});assert.ok(denied.isError);
  pass('SSE tools/list_changed for hot plugins and permission changes');
  const oldSession=second.transport.sessionId;await second.transport.terminateSession();
  assert.equal((await fetch(url,{headers:{...headers,Accept:'text/event-stream','Mcp-Session-Id':oldSession}})).status,404);
  await first.transport.terminateSession();await Promise.all(clients.map(({client})=>client.close()));clients.length=0;
  pass('DELETE session termination');
  const original=descriptor;await stop();await wait(150);descriptor=await start(original.port,original.token);
  assert.equal(descriptor.mcpToken,original.mcpToken);
  const restarted=await connect(url,headers);const retained=await restarted.client.callTool({name:'todo_list',arguments:{}});assert.ok(!retained.isError);assert.ok(JSON.parse(retained.content[0].text).some(item=>item.id===task.id));
  pass('stable URL and credential survive backend restart with persisted todo data');
  results.passed=true;
}finally{
  for(const {client,transport} of clients){await transport.terminateSession().catch(()=>{});await client.close().catch(()=>{});}
  await stop();
  const report=process.env.NOTCH_MCP_REPORT||path.join(temp,'verification.json');await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(results,null,2));console.log('Report',report);
}
