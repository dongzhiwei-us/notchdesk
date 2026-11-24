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
let app,backend,client,page,rope,electronProcess,targetProcess,targetInfo;
const result={timestamp:new Date().toISOString(),packaged:!!exe,checks:[],passed:false};
function pass(name){result.checks.push(name);console.log('PASS',name);}
async function until(check){let error;for(let i=0;i<100;i++){try{const value=await check();if(value)return value;}catch(e){error=e;}await wait(100);}throw Error('Timed out '+String(error||check).slice(0,200));}
async function shutdown(){
 if(client){await client.close().catch(()=>{});client=undefined;}
 if(app){const instance=app,proc=electronProcess;app=undefined;await Promise.race([instance.evaluate(({app})=>{setTimeout(()=>app.exit(0),20);}).catch(()=>{}),wait(1000)]);await Promise.race([instance.close().catch(()=>{}),wait(1600)]);if(proc.exitCode===null)await run('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});}
 if(backend){const proc=backend;backend=undefined;const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await Promise.race([exited,wait(1500)]);}
}
async function start(){
 const previous=await fs.readFile(path.join(data,'connection.json'),'utf8').catch(()=>'');
 backend=spawn(exe?path.join(path.dirname(exe),'resources/runtime/node.exe'):process.execPath,[exe?path.join(path.dirname(exe),'resources/service/server.cjs'):path.join(paths.buildDir,'server.cjs')],{env,cwd:paths.root,stdio:'ignore',windowsHide:true});
 await until(async()=>{const now=await fs.readFile(path.join(data,'connection.json'),'utf8');return now!==previous;});
 app=await _electron.launch({executablePath:exe||require('electron'),args:exe?[]:[paths.root],cwd:paths.root,env,timeout:45000});
 electronProcess=app.process();page=await app.firstWindow();page.setDefaultTimeout(7000);
 await until(async()=>(await rpc('state.get')).host.online);
 await rpc('theme.set',{locale:'zh-CN'});
}
const rpc=(method,params={})=>page.evaluate(([method,params])=>window.notch.rpc(method,params),[method,params]);
async function openRope(){await rpc('ui.open',{view:'clipline'});rope=await until(()=>app.windows().find(p=>p.url().endsWith('#rope')));rope.setDefaultTimeout(7000);await until(async()=>await rope.locator('.rope-page').getAttribute('data-visible')==='true');await rope.locator('.rope-board').waitFor();await wait(350);}
const ps=async code=>(await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:18000})).stdout.trim();
const mouseType="Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport(\"user32.dll\")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int x,int y);[DllImport(\"user32.dll\")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int s,uint f);[DllImport(\"user32.dll\")]public static extern IntPtr WindowFromPoint(long p);[DllImport(\"user32.dll\")]public static extern IntPtr GetAncestor(IntPtr w,uint f);[DllImport(\"user32.dll\")]public static extern int GetSystemMetrics(int n);public static void Move(int x,int y){mouse_event(0xC001,(uint)((x-GetSystemMetrics(76))*65535L/(GetSystemMetrics(78)-1)),(uint)((y-GetSystemMetrics(77))*65535L/(GetSystemMetrics(79)-1)),0,UIntPtr.Zero);}[DllImport(\"user32.dll\")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}';[void][M]::SetThreadDpiAwarenessContext([IntPtr](-4));";
let cursor;
async function physicalPoint(local,which){return app.evaluate(({screen,BrowserWindow},{local,which})=>{const w=which==='target'?globalThis.qaDropTarget:BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#rope'));const b=w.getBounds();return screen.dipToScreenPoint({x:Math.round(b.x+local.x),y:Math.round(b.y+local.y)});},{local,which});}
async function received(){return JSON.parse(await fs.readFile(path.join(temp,'received.json'),'utf8').catch(()=>'[]'));}
async function nativeDrop(id){
 await openRope();const button=rope.locator('[data-clip-id="'+id+'"] .clip-thumbnail');await button.waitFor();await rope.evaluate(()=>{globalThis.dragTrace=[];for(const type of ['pointerdown','dragstart','dragend'])document.addEventListener(type,e=>globalThis.dragTrace.push({type,target:e.target.className}),{once:true,capture:true});});await rope.evaluate(id=>window.notch.prepareClipDrag(id),id);const b=await button.boundingBox();const source=await physicalPoint({x:b.x+b.width/2,y:b.y+b.height/2},'rope');const target=targetInfo;
 const mouseResult=await ps(mouseType+'try{[M]::Move('+source.x+','+source.y+');Start-Sleep -Milliseconds 160;[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 100;[M]::Move('+(source.x+18)+','+(source.y+5)+');Start-Sleep -Milliseconds 420;for($step=1;$step -le 24;$step++){[M]::Move([int]('+source.x+'+('+target.x+'-'+source.x+')*$step/24),[int]('+source.y+'+('+target.y+'-'+source.y+')*$step/24));Start-Sleep -Milliseconds 18};Start-Sleep -Milliseconds 180;[M]::GetAncestor([M]::WindowFromPoint(([long]'+target.y+' -shl 32) -bor [long]'+target.x+'),2).ToInt64();}finally{[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero);}');
 result.lastDrag={id,events:await rope.evaluate(()=>globalThis.dragTrace),feedback:await rope.locator('.rope-feedback').allTextContents()};assert.equal(mouseResult,String(target.handle));assert.ok((await fs.readFile(path.join(temp,'received.json.events'),'utf8')).includes('FileDrop'));
}

try{
 await start();cursor=await app.evaluate(({screen})=>screen.dipToScreenPoint(screen.getCursorScreenPoint()));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const file=path.join(temp,'拖出 验证.md');await fs.writeFile(file,'# Native file export');const card=await rpc('clip_import',{kind:'file',path:file});
 const png=await fs.readFile(path.join(paths.root,'assets/icon.png'));const photo=await rpc('clip_import',{kind:'image',name:'Drag photo.png',base64:png.toString('base64')});await openRope();rope.on('pageerror',error=>errors.push(error.message));
 const geometry=await rope.evaluate(()=>window.notch.ropeInfo());const y=await rope.locator('.rope-page').evaluate(node=>parseFloat(node.style.getPropertyValue('--rope-y')));assert.equal((await rpc('clip_layout_get')).anchor,'notch');assert.ok(Math.abs(y-(geometry.notch.y-geometry.bounds.y+geometry.wheelHeight+48))<2);pass('default shelf follows just below the wheel instead of vertical center');
 assert.equal(await rope.locator('.rope-backdrop').count(),0);pass('rope and hanging objects have no enclosing panel');
 const thumb=rope.locator('[data-clip-id="'+photo.id+'"] .clip-thumbnail'),thumbBox=await thumb.boundingBox(),hoverPoint=await physicalPoint({x:thumbBox.x+thumbBox.width/2,y:thumbBox.y+thumbBox.height/2},'rope');await ps(mouseType+`[M]::Move(${hoverPoint.x},${hoverPoint.y});`);await rope.locator('.clip-hover-preview').waitFor();await until(()=>rope.locator('.hover-preview-canvas img').evaluate(img=>img.complete&&img.naturalWidth>0));const small=await rope.locator('.clip-hover-preview').boundingBox();pass('hover reveals a rendered image quick look');
 await thumb.click();await rope.locator('.clip-preview').waitFor();const large=await rope.locator('.clip-preview').boundingBox();assert.ok(large.width>small.width*2);assert.ok((await rope.locator('.preview-canvas').boundingBox()).height>400);pass('click opens a substantially larger image preview');
 await fs.mkdir(path.join(base,'screenshots'),{recursive:true});await rope.screenshot({path:path.join(base,'screenshots','glass-shelf-preview.png'),omitBackground:true});
 await rope.getByRole('button',{name:'关闭预览',exact:true}).click();
 const width=await rope.evaluate(()=>innerWidth);
 const grid=await rope.locator('.clip-grid').evaluate(node=>({width:node.getBoundingClientRect().width,overflow:getComputedStyle(node).overflow}));assert.equal(grid.width,width);assert.equal(grid.overflow,'visible');
 async function place(id,x){
   await rope.evaluate(()=>{globalThis.positionTrace=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','dragstart'])document.addEventListener(type,e=>globalThis.positionTrace.push({type,target:e.target.className,x:e.clientX,y:e.clientY}),{once:true,capture:true});});
   const pin=rope.locator('[data-clip-id="'+id+'"] .clothespin'),b=await pin.boundingBox();
   const from=await physicalPoint({x:b.x+b.width/2,y:b.y+b.height/2},'rope'),to=await physicalPoint({x,y:b.y+b.height/2+15},'rope');
   await ps(mouseType+`try{[M]::Move(${from.x},${from.y});Start-Sleep -Milliseconds 140;[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 80;for($step=1;$step -le 30;$step++){[M]::Move([int](${from.x}+(${to.x}-${from.x})*$step/30),[int](${from.y}+(${to.y}-${from.y})*$step/30));Start-Sleep -Milliseconds 16};Start-Sleep -Milliseconds 100;}finally{[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero);}`);
   let saved;try{saved=await until(async()=>{const v=(await rpc('clip_list')).find(v=>v.id===id);return Math.abs(v.hangX-x/width)<.01&&v;});}catch(error){console.log('Position failure',JSON.stringify({id,x,width,trace:await rope.evaluate(()=>globalThis.positionTrace),cards:await rpc('clip_list'),feedback:await rope.locator('.rope-feedback').allTextContents(),ui:await rpc('ui.snapshot')}));throw error;}
   await wait(450);const box=await rope.locator('[data-clip-id="'+id+'"]').locator('..').boundingBox();assert.ok(Math.abs(box.x+box.width/2-x)<2);return saved;
 }
 await place(photo.id,70);await place(card.id,width-70);pass('images and files move from the center to both ends of the full screen rope');
 await place(photo.id,width*.72);await place(photo.id,70);pass('release over empty rope saves the position and supports repeated long drags');
 await rope.screenshot({path:path.join(base,'screenshots','full-width-clip-positions.png'),omitBackground:true});
 await page.evaluate(()=>window.notch.setMcpAccess(['workspace','desktop','files']));const connection=JSON.parse(await fs.readFile(path.join(data,'connection.json'),'utf8'));client=new Client({name:'rope-position-qa',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+connection.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.mcpToken}}}));await until(async()=>(await client.listTools()).tools.some(v=>v.name==='clip_move'));
 const moved=await client.callTool({name:'clip_move',arguments:{id:photo.id,x:.2}});assert.ok(!moved.isError);await until(async()=>{const b=await rope.locator('[data-clip-id="'+photo.id+'"]').locator('..').boundingBox();return Math.abs(b.x+b.width/2-width*.2)<2;});pass('HTTP MCP can place an individual hanging object at a screen fraction');
 const rejected=await client.callTool({name:'clip_move',arguments:{id:photo.id,x:1.2}});assert.ok(rejected.isError);assert.equal((await rpc('clip_list')).find(v=>v.id===photo.id).hangX,.2);pass('invalid positions are rejected without changing stored placement');
 const keyboardPin=rope.locator('[data-clip-id="'+photo.id+'"] .clothespin');await keyboardPin.focus();await keyboardPin.press('ArrowRight');await until(async()=>Math.abs((await rpc('clip_list')).find(v=>v.id===photo.id).hangX-(.2+8/width))<.001);await keyboardPin.press('Home');await until(async()=>(await rpc('clip_list')).find(v=>v.id===photo.id).hangX===null);await client.callTool({name:'clip_move',arguments:{id:photo.id,x:.2}});pass('keyboard arrows adjust a hanging object and Home restores automatic placement');
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#rope')).focus();});await wait(180);assert.equal((await rpc('ui.snapshot')).view,'clipline');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#rope')).focus());await wait(180);assert.equal((await rpc('ui.snapshot')).view,'clipline');pass('focus can move between wheel and shelf without dismissal');
 await until(async()=>(await rpc('ui.snapshot')).outsideInputReady);
 const location=await app.evaluate(({screen})=>{const a=screen.getPrimaryDisplay().workArea;return screen.dipToScreenPoint({x:a.x+a.width-600,y:a.y+Math.min(500,a.height-300)});});
 targetProcess=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(paths.root,'scripts/windows-drop-receiver.ps1'),'-OutputPath',path.join(temp,'received.json'),'-ReadyPath',path.join(temp,'receiver.json'),'-Left',String(location.x),'-Top',String(location.y),'-ParentProcessId',String(process.pid)],{windowsHide:true,stdio:'ignore'});
 targetInfo=await until(async()=>JSON.parse(await fs.readFile(path.join(temp,'receiver.json'),'utf8')));await ps(mouseType+'[void][M]::SetWindowPos([IntPtr]'+targetInfo.handle+',[IntPtr](-1),'+location.x+','+location.y+',620,320,64);');targetInfo.x=location.x+310;targetInfo.y=location.y+160;

 await until(async()=>(await rpc('ui.snapshot')).view==='closed'&&!(await rpc('ui.snapshot')).rope.visible);pass('moving focus to an outside window closes the plugin and preview');
 await openRope();await until(async()=>(await rpc('ui.snapshot')).outsideInputReady);const click=targetInfo;await ps(mouseType+`[M]::Move(${click.x},${click.y});[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 50;[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero);`);await until(async()=>(await rpc('ui.snapshot')).view==='closed');pass('real Windows click outside dismisses the shelf');
 await nativeDrop(card.id);await until(async()=>(await received()).some(item=>item.name==='拖出 验证.md'));await until(async()=>(await rpc('ui.snapshot')).view==='closed');pass('real Windows native drag delivers a local file into another window file input');
 await nativeDrop(photo.id);await until(async()=>(await received()).some(item=>item.type==='image/png'&&item.size===png.length));await until(async()=>(await rpc('ui.snapshot')).view==='closed');assert.equal((await rpc('clip_list')).length,2);pass('real Windows native drag delivers the stored clipboard PNG without removing its card');
 await openRope();const beforeShift=(await rpc('clip_list')).find(v=>v.id===photo.id).hangX,handle=await rope.locator('.rope-drag-handle').boundingBox();await rope.mouse.move(100,handle.y+8);await rope.mouse.down();await rope.mouse.move(190,handle.y+80,{steps:12});await rope.mouse.up();const saved=await until(async()=>{const v=await rpc('clip_layout_get');return v.anchor==='screen'&&v.displayId&&v;});const positions=await until(async()=>{const v=await rpc('clip_list');return Math.abs(v.find(v=>v.id===photo.id).hangX-beforeShift-90/width)<.001&&v;});await shutdown();await start();await openRope();assert.deepEqual(await rpc('clip_layout_get'),saved);assert.deepEqual((await rpc('clip_list')).map(v=>[v.id,v.hangX]),positions.map(v=>[v.id,v.hangX]));const restored=await rope.locator('[data-clip-id="'+photo.id+'"]').locator('..').boundingBox();assert.ok(Math.abs(restored.x+restored.width/2-positions.find(v=>v.id===photo.id).hangX*width)<2);pass('rope and individual object placements persist across a complete restart');
 await rope.getByRole('button',{name:'恢复默认位置',exact:true}).click();await until(async()=>(await rpc('clip_layout_get')).anchor==='notch');pass('reset restores placement below the wheel');
 assert.deepEqual(errors,[]);result.passed=true;
}finally{
 if(targetProcess)targetProcess.kill();
 if(cursor)await ps(mouseType+`[M]::Move(${cursor.x},${cursor.y});[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero);`).catch(()=>{});
 await shutdown();const report=process.env.NOTCH_QA_REPORT||path.join(temp,'verification.json');await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(result,null,2));console.log('Report',report);
}
