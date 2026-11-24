import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import paths from './paths.cjs';
const run=promisify(execFile),require=createRequire(import.meta.url),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const base=process.platform==='win32'&&process.env.XDG_DATA_HOME?path.resolve(process.env.XDG_DATA_HOME,'../temp/notchdesk'):os.tmpdir();await fs.mkdir(base,{recursive:true});
const temp=await fs.mkdtemp(path.join(base,'rope-e2e-')),data=path.join(temp,'data'),plugins=path.join(temp,'plugins');
const exe=process.env.NOTCH_TEST_EXE;
await fs.cp(exe?path.join(path.dirname(exe),'resources/plugins'):path.join(paths.root,'plugins'),plugins,{recursive:true});
const env={...process.env,NOTCH_DATA:data,NOTCH_PLUGINS:plugins,NOTCH_PORT:'0',NOTCH_LOGS:path.join(temp,'logs'),NOTCH_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;if(exe)delete env.NOTCH_NODE;
let app,backend,client,page,rope;
const result={timestamp:new Date().toISOString(),packaged:!!exe,checks:[],passed:false};
function pass(name){result.checks.push(name);console.log('PASS',name);}
async function until(check){let error;for(let i=0;i<100;i++){try{const value=await check();if(value)return value;}catch(e){error=e;}await wait(100);}throw Error('Timed out '+String(error||check).slice(0,200));}
async function shutdown(){
 if(client){await client.close().catch(()=>{});client=undefined;}
 if(app){const instance=app,proc=instance.process();app=undefined;await instance.evaluate(({app})=>{setTimeout(()=>app.exit(0),20);}).catch(()=>{});await Promise.race([instance.close().catch(()=>{}),wait(1600)]);if(proc.exitCode===null)await run('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});}
 if(backend){const proc=backend;backend=undefined;const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await Promise.race([exited,wait(1500)]);}
}
async function start(){
 const previous=await fs.readFile(path.join(data,'connection.json'),'utf8').catch(()=>'');
 backend=spawn(exe?path.join(path.dirname(exe),'resources/runtime/node.exe'):process.execPath,[exe?path.join(path.dirname(exe),'resources/service/server.cjs'):path.join(paths.buildDir,'server.cjs')],{env,cwd:paths.root,stdio:'ignore',windowsHide:true});
 await until(async()=>{const now=await fs.readFile(path.join(data,'connection.json'),'utf8');return now!==previous;});
 app=await _electron.launch({executablePath:exe||require('electron'),args:exe?[]:[paths.root],cwd:paths.root,env,timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(7000);
 await until(async()=>(await rpc('state.get')).host.online);
 await rpc('theme.set',{locale:'zh-CN'});
}
const rpc=(method,params={})=>page.evaluate(([method,params])=>window.notch.rpc(method,params),[method,params]);
async function openRope(){await rpc('ui.open',{view:'clipline'});rope=await until(()=>app.windows().find(p=>p.url().endsWith('#rope')));rope.setDefaultTimeout(7000);await until(async()=>await rope.locator('.rope-page').getAttribute('data-visible')==='true');await rope.locator('.rope-board').waitFor();await wait(350);}
try{
 await start();await rpc('ui.open',{view:'menu'});await until(async()=>await page.locator('main.island').getAttribute('data-view')==='menu');await until(async()=>await page.locator('.wheel').getAttribute('data-wheel-mode')==='half');await wait(300);assert.ok(Math.abs((await page.locator('.wheel').boundingBox()).height-156)<2);pass('top edge defaults to a 156px semicircle');
 await rpc('theme.set',{wheelPlacement:'floating'});await until(async()=>await page.locator('.wheel').getAttribute('data-wheel-mode')==='full');assert.equal(Math.round((await page.locator('.wheel').boundingBox()).height),312);await rpc('theme.set',{wheelPlacement:'edge'});pass('floating placement keeps full circle and docking restores semicircle');
 for(const text of ['First hanging card','Second hanging card','Third hanging card'])await rpc('clip_import',{kind:'text',text});
 await openRope();
 const info=await rpc('ui.snapshot'),metrics=await rope.evaluate(()=>{const path=document.querySelector('.rope-line').getBoundingClientRect(),grid=document.querySelector('.clip-grid').getBoundingClientRect();return {width:innerWidth,height:innerHeight,rope:path.toJSON(),grid:grid.toJSON()};});
 const display=await app.evaluate(({screen},b)=>screen.getDisplayMatching(b).workArea,info.rope.bounds);
 assert.equal(info.rope.bounds.width,display.width);assert.equal(metrics.rope.width,metrics.width);assert.ok(Math.abs(metrics.rope.y+20-(info.rope.notch.y-info.rope.bounds.y+info.rope.wheelHeight+48))<2);assert.ok(Math.abs(metrics.grid.x+metrics.grid.width/2-metrics.width/2)<2);await page.locator('.wheel').waitFor({state:'visible'});pass('rope spans the display with centered hanging cards and wheel retained');
 const before=await rpc('ui.snapshot');const handle=rope.locator('.rope-drag-handle'),box=await handle.boundingBox();
 await rope.mouse.move(metrics.width*.25,box.y+8);await rope.mouse.down();await rope.mouse.move(metrics.width*.33,box.y+8+metrics.height*.08,{steps:16});await rope.mouse.up();
 const saved=await until(async()=>{const value=await rpc('clip_layout_get');return value.x>.57&&value.anchor==='screen'&&value;});
 assert.ok(Math.abs(saved.x-.58)<.02&&Math.abs(saved.y-((metrics.rope.y+20)/metrics.height+.08))<.02);assert.equal(saved.displayId,String((await rope.evaluate(()=>window.notch.ropeInfo())).displayId));assert.deepEqual((await rpc('ui.snapshot')).bounds,before.bounds);pass('dragging the cord stores relative coordinates without moving the notch');
 const native=await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#rope'));const buffer=w.getNativeWindowHandle(),b=w.getBounds(),d=screen.getDisplayMatching(b);return {hwnd:buffer.length===8?buffer.readBigUInt64LE().toString():String(buffer.readUInt32LE()),scale:d.scaleFactor};});
 const line=await rope.locator('.rope-drag-handle').boundingBox();
 const ps=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Rgn{[DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);[DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);[DllImport("user32.dll")]public static extern int GetWindowRgn(IntPtr h,IntPtr r);[DllImport("gdi32.dll")]public static extern bool PtInRegion(IntPtr r,int x,int y);[DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr r);}'; [void][Rgn]::SetThreadDpiAwarenessContext([IntPtr](-4));$r=[Rgn]::CreateRectRgn(0,0,0,0);[void][Rgn]::GetWindowRgn([IntPtr](${native.hwnd}),$r);[Rgn]::PtInRegion($r,20,20);[Rgn]::PtInRegion($r,20,${Math.round((line.y+8)*native.scale)});[Rgn]::PtInRegion($r,20,${Math.round(line.y+8)});[void][Rgn]::DeleteObject($r);`;
 const shape=(await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true})).stdout.trim().split(/\r?\n/);console.log('Native shape',JSON.stringify({shape,scale:native.scale,line}));assert.deepEqual(shape.slice(0,2),['False','True']);pass('native Windows region passes through empty space and accepts input on the cord');
 await rpc('ui.open',{view:'closed'});await until(async()=>!(await rpc('ui.snapshot')).rope.visible);await openRope();assert.deepEqual(await rpc('clip_layout_get'),saved);pass('closing and reopening restores the hanging position');
 await page.evaluate(()=>window.notch.setMcpAccess(['workspace','desktop','files']));const config=await page.evaluate(()=>window.notch.mcpConfig());client=new Client({name:'rope-qa',version:'1'});const transport=new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}});await client.connect(transport);
 const response=await client.callTool({name:'clip_layout_set',arguments:{x:.62,y:.42}});assert.ok(!response.isError);const expected=JSON.parse(response.content[0].text);await until(async()=>await rope.locator('.rope-page').evaluate(node=>Math.abs(parseFloat(node.style.getPropertyValue('--rope-y'))-innerHeight*.42)<2));pass('HTTP MCP adjusts the live rope position');
 await fs.mkdir(path.join(base,'screenshots'),{recursive:true});await rope.screenshot({path:path.join(base,'screenshots','screen-wide-rope.png'),omitBackground:true});await page.screenshot({path:path.join(base,'screenshots','docked-semicircle.png'),omitBackground:true});
 await transport.terminateSession();await client.close();client=undefined;await shutdown();await start();await openRope();assert.deepEqual(await rpc('clip_layout_get'),expected);await until(async()=>await rope.locator('.rope-page').evaluate(node=>Math.abs(parseFloat(node.style.getPropertyValue('--rope-y'))-innerHeight*.42)<2));pass('position survives a complete UI and backend restart');
 await rope.getByRole('button',{name:'恢复默认位置',exact:true}).click();await until(async()=>{const p=await rpc('clip_layout_get');return p.anchor==='notch';});pass('reset restores placement below the wheel');
 result.passed=true;
}finally{
 await shutdown();const report=process.env.NOTCH_QA_REPORT||path.join(temp,'verification.json');await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(result,null,2));console.log('Report',report);
}
