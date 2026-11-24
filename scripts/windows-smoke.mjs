import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createRequire} from 'node:module'
import {_electron} from 'playwright-core'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import paths from './paths.cjs'

const run=promisify(execFile),require=createRequire(import.meta.url),wait=ms=>new Promise(r=>setTimeout(r,ms))
const base=process.env.NOTCH_TEST_ROOT || (process.platform==='win32'&&process.env.XDG_DATA_HOME?path.resolve(process.env.XDG_DATA_HOME,'../temp/notchdesk'):os.tmpdir())
await fs.mkdir(base,{recursive:true})
const temp=await fs.mkdtemp(path.join(base,'win-e2e-')),data=path.join(temp,'data'),plugins=path.join(temp,'plugins')
const exe=process.env.NOTCH_TEST_EXE
await fs.cp(exe?path.join(path.dirname(exe),'resources/plugins'):path.join(paths.root,'plugins'),plugins,{recursive:true})
const env={...process.env,NOTCH_PORT:'0',NOTCH_PLUGINS:plugins,NOTCH_DATA:data,NOTCH_LOGS:path.join(temp,'logs'),NOTCH_NODE:process.execPath,NODE_PATH:path.join(paths.root,'node_modules')}
delete env.ELECTRON_RUN_AS_NODE
if(exe){delete env.NOTCH_NODE;delete env.NODE_PATH}
const results={timestamp:new Date().toISOString(),platform:process.platform,arch:process.arch,packaged:!!exe,checks:[]}
function pass(name){results.checks.push(name);console.log('PASS',name)}
async function until(f,ms=14000){let last;for(const end=Date.now()+ms;Date.now()<end;){try{const v=await f();if(v)return v}catch(e){last=e}await wait(160)}throw Error('Timed out: '+String(last||f).slice(0,260))}
const ps=async s=>(await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(s,'utf16le').toString('base64')],{windowsHide:true,timeout:10000})).stdout.trim()
const move=(x,y)=>ps("Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y); [DllImport(\"user32.dll\")] public static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr c);' -Name Mouse -Namespace N; [void][N.Mouse]::SetThreadDpiAwarenessContext([IntPtr](-4)); [void][N.Mouse]::SetCursorPos("+Math.round(x)+','+Math.round(y)+')')
let app,client,cursor,startedServer
try{
 const nodeExe=exe?path.join(path.dirname(exe),'resources/runtime/node.exe'):process.execPath
 const serviceFile=exe?path.join(path.dirname(exe),'resources/service/server.cjs'):path.join(paths.buildDir,'server.cjs')
 startedServer=spawn(nodeExe,[serviceFile],{env,cwd:paths.root,stdio:'ignore',windowsHide:true})
 await until(()=>fs.access(path.join(data,'connection.json')).then(()=>true))
 app=await _electron.launch({executablePath:exe||require('electron'),args:[...(exe?[]:[paths.root])],cwd:paths.root,env,timeout:45000})
 const page=await app.firstWindow();page.setDefaultTimeout(7000)
 const consoleErrors=[];page.on('pageerror',error=>consoleErrors.push(error.message))
 const rpc=(name,params={})=>page.evaluate(([m,p])=>window.notch.rpc(m,p),[name,params])
 await until(async()=>{const s=await rpc('state.get');return s.host.online&&s.plugins.length>=8})
 await rpc('theme.set',{locale:'zh-CN'});await wait(200)
 cursor=await app.evaluate(({screen})=>screen.dipToScreenPoint(screen.getCursorScreenPoint()))
 const initial=await app.evaluate(({screen,BrowserWindow,powerMonitor})=>{const b=BrowserWindow.getAllWindows()[0].getBounds(),a=screen.getPrimaryDisplay().workArea
 return {b,a,idle:powerMonitor.getSystemIdleTime(),top:screen.dipToScreenPoint({x:Math.round(b.x+b.width/2),y:b.y+6}),away:screen.dipToScreenPoint({x:b.x-35,y:b.y+60})}})
 assert.equal(initial.b.y,initial.a.y);assert.ok(Math.abs(initial.b.x+initial.b.width/2-initial.a.x-initial.a.width/2)<=1)
 const island=page.locator('main.island');assert.equal(await island.getAttribute('data-view'),'closed');pass('initially collapsed at native top center')
 await move(initial.away.x,initial.away.y);await wait(240);await move(initial.top.x,initial.top.y)
 await until(async()=>await island.getAttribute('data-view')==='menu');await move(initial.away.x,initial.away.y);await until(async()=>await island.getAttribute('data-view')==='closed');pass('real Windows pointer hover and leave')
 await page.evaluate(()=>{globalThis.hoverRegression=[];new MutationObserver(()=>globalThis.hoverRegression.push(document.querySelector('main.island').getAttribute('data-view'))).observe(document.querySelector('main.island'),{attributes:true,attributeFilter:['data-view']});});
 for(const offset of [-40,40]){
  await move(initial.away.x,initial.away.y);await wait(350);await page.evaluate(()=>globalThis.hoverRegression=[]);
  const edge=await app.evaluate(({screen},p)=>screen.dipToScreenPoint(p),{x:initial.b.x+initial.b.width/2+offset,y:initial.b.y+1});
  await move(edge.x,edge.y);await wait(850);assert.deepEqual(await page.evaluate(()=>globalThis.hoverRegression),['menu']);
 }
 await move(initial.away.x,initial.away.y);await until(async()=>await island.getAttribute('data-view')==='closed');pass('stationary pointer at both launcher edges stays expanded without flicker');
 const op=(pluginId,itemId)=>rpc('ui.open',{view:pluginId,pluginId,assetId:itemId})
 await rpc('ui.open',{view:'menu'});const wheel=page.locator('.wheel');await wheel.waitFor();assert.equal(await wheel.getAttribute('data-wheel-mode'),'half');
 const wb=await wheel.boundingBox();await page.mouse.move(wb.x+wb.width/2,wb.y+118);await page.mouse.wheel(0,190);await until(async()=>await wheel.getAttribute('data-wheel-active')==='clipline');
 await wheel.waitFor({state:'visible'});const ropePage=await until(()=>app.windows().find(p=>p.url().endsWith('#rope')));ropePage.setDefaultTimeout(7000);ropePage.on('pageerror',error=>consoleErrors.push(error.message));await ropePage.locator('.rope-board').waitFor();assert.ok((await wheel.boundingBox()).height>100);pass('screen-wide clothesline keeps docked wheel visible');
 await wheel.focus();await page.keyboard.press('ArrowRight');await wait(300);assert.equal(await wheel.getAttribute('data-wheel-active'),'clipline');
 const todoButton=page.locator('button.wheel-button[data-plugin="todo"]');await todoButton.hover();await wait(350);assert.equal(await wheel.getAttribute('data-wheel-active'),'clipline');
 await todoButton.click();await until(async()=>await island.getAttribute('data-plugin')==='todo');await page.getByRole('button',{name:'新增待办',exact:true}).waitFor();assert.equal(await todoButton.getAttribute('aria-pressed'),'true');
 await page.locator('button.wheel-button[data-plugin="clipline"]').click();await until(async()=>await wheel.getAttribute('data-wheel-active')==='clipline'&&(await rpc('ui.snapshot')).rope.visible);await ropePage.locator('.rope-board').waitFor();pass('plugin icons respond to clicks in both directions while hover preserves selection');
 await page.mouse.move(wb.x+wb.width/2,wb.y+118);await page.mouse.down();await page.mouse.move(wb.x+wb.width/2+70,wb.y+118,{steps:12});await page.mouse.up();await wait(250);assert.equal(await wheel.getAttribute('data-wheel-active'),'clipline');
 await page.mouse.move(wb.x+wb.width/2,wb.y+118);for(let i=0;i<5;i++)await page.mouse.wheel(-36,0);await until(async()=>await wheel.getAttribute('data-wheel-active')==='todo');pass('wheel and trackpad rotation still work while dragging and arrow keys do not rotate');
 await rpc('ui.open',{view:'menu'});await rpc('theme.set',{wheelPlacement:'floating'});await until(async()=>await wheel.getAttribute('data-wheel-mode')==='full');const floating=await rpc('ui.snapshot');assert.ok(floating.bounds.y>initial.a.y);
 await fs.mkdir(path.join(base,'screenshots'),{recursive:true});await page.screenshot({path:path.join(base,'screenshots','wheel-full.png'),omitBackground:true});
 await rpc('theme.set',{wheelPlacement:'edge'});await until(async()=>await wheel.getAttribute('data-wheel-mode')==='half');await rpc('ui.open',{view:'menu'});await wait(500);await page.screenshot({path:path.join(base,'screenshots','wheel-half.png'),omitBackground:true});pass('semicircle at top edge and full circle in floating placement');

 await op('todo');await page.getByRole('button',{name:'新增待办'}).click();await page.getByPlaceholder('下一步要做什么？').fill('Windows 验收');await page.locator('form.editor button[type=submit],form.editor button.primary').last().click()
 const todo=await until(async()=>(await rpc('todo_list')).find(t=>t.title==='Windows 验收'));pass('todo created through the Electron UI')
 const conf=await page.evaluate(()=>window.notch.mcpConfig())
 client=new Client({name:'notchdesk-smoke',version:'1'})
 const descriptor=JSON.parse(await fs.readFile(path.join(data,'connection.json'),'utf8'))
 const servicePid=await rpc('ui.snapshot');assert.ok(servicePid)
 await client.connect(new StreamableHTTPClientTransport(new URL(conf.url),{requestInit:{headers:conf.headers}}))
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='todo_add'))
 const res=await client.callTool({name:'todo_update',arguments:{id:todo.id,status:'in-progress'}});assert.ok(!res.isError,JSON.stringify(res))
 assert.equal((await rpc('todo_list')).find(t=>t.id===todo.id).status,'in-progress');pass('MCP SDK Streamable HTTP handshake and UI/MCP shared state')
 const forged=await fetch('http://127.0.0.1:'+descriptor.port+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+descriptor.mcpToken,'content-type':'application/json'},body:JSON.stringify({method:'host.activity',params:{idleSeconds:0}})});assert.ok((await forged.json()).error);pass('host-only operations denied with MCP credential')
 const id='qa_panel',folder=path.join(plugins,id);await fs.mkdir(folder)
 const fixture={locales:{'zh-CN':'zh-CN.json','en-US':'en-US.json'},id,name:'验证插件',icon:'box',version:'1.0.0',entry:'index.cjs',ui:'panel.js',settings:{label:{type:'string',label:'测试标签',default:'一'},blockActivation:{type:'boolean',label:'拦截激活',default:false}}}
 await fs.writeFile(path.join(folder,'index.cjs'),"exports.activate=ctx=>{ctx.action('qa_panel_read','Current label',{type:'object',properties:{}},()=>ctx.config().label);ctx.action('qa_panel_receive','Receive interaction',{type:'object',properties:{fail:{type:'boolean'}}},p=>{if(p.fail)throw Error('Rejected fixture');return {handled:true}},{activate:true});ctx.action('qa_panel_show','Explicit activation',{type:'object',properties:{}},()=>ctx.ui.activate({itemId:'response-target',reason:'qa-response'}));ctx.hook('before:ui.activate',({params})=>params.pluginId==='qa_panel'&&ctx.config().blockActivation?{allowed:false,reason:'Fixture blocked'}:undefined);}")
 await fs.writeFile(path.join(folder,'panel.js'),"export function mount(el,ctx){const label=document.createElement('span');label.textContent='热加载 '+ctx.settings.label;const button=document.createElement('button');button.textContent='定位响应';button.onclick=()=>ctx.activate({itemId:'panel-target'});el.append(label,button);return ()=>el.replaceChildren()}")
 await fs.writeFile(path.join(folder,'zh-CN.json'),JSON.stringify({hello:'你好'}));await fs.writeFile(path.join(folder,'en-US.json'),JSON.stringify({hello:'Hello'}));
 await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(fixture))
 await until(async()=>(await client.listTools()).tools.some(t=>t.name==='qa_panel_read'))
 await op('todo');await until(async()=>await wheel.getAttribute('data-wheel-active')==='todo');
 await client.callTool({name:'qa_panel_read',arguments:{}});assert.equal(await wheel.getAttribute('data-wheel-active'),'todo');
 const failedReceive=await client.callTool({name:'qa_panel_receive',arguments:{fail:true}});assert.equal(failedReceive.isError,true);assert.equal(await wheel.getAttribute('data-wheel-active'),'todo');pass('read-only and failed plugin actions preserve the current selection');
 const received=await client.callTool({name:'qa_panel_receive',arguments:{}});assert.ok(!received.isError);await until(async()=>await wheel.getAttribute('data-wheel-active')===id&&await island.getAttribute('data-plugin')===id);await page.getByText('热加载 一',{exact:true}).waitFor();pass('successful third-party plugin response synchronizes wheel, selection and UI through HTTP MCP');
 await op('todo');await client.callTool({name:'qa_panel_show',arguments:{}});await until(async()=>(await rpc('ui.snapshot')).itemId==='response-target'&&await wheel.getAttribute('data-wheel-active')===id);pass('plugin ctx.ui.activate opens its own UI with a target item');
 await page.getByRole('button',{name:'定位响应',exact:true}).click();await until(async()=>(await rpc('ui.snapshot')).itemId==='panel-target');await page.getByText('热加载 一',{exact:true}).waitFor();pass('runtime UI ctx.activate retargets and refreshes the plugin UI');
 await op('todo');await rpc('settings.patch',{pluginId:id,values:{blockActivation:true}});const blockedReceive=await client.callTool({name:'qa_panel_receive',arguments:{}});assert.ok(!blockedReceive.isError);await wait(200);assert.equal(await wheel.getAttribute('data-wheel-active'),'todo');await rpc('settings.patch',{pluginId:id,values:{blockActivation:false}});pass('activation hooks can veto UI takeover while preserving successful action results');
 await op(id);await page.getByText('热加载 一',{exact:true}).waitFor()
 await page.evaluate(()=>window.notch.openSettings('plugins'));let prefs=await until(()=>app.windows().find(p=>p.url().includes('#settings')))
 await until(async()=>await island.getAttribute('data-view')==='closed');pass('settings foreground collapses shell and suppresses overlap');
 await prefs.getByRole('button',{name:'MCP 连接',exact:true}).click();
 await until(async()=>await prefs.getByLabel('服务地址',{exact:true}).inputValue()===conf.url);
 assert.deepEqual(JSON.parse(await prefs.locator('.mcp-config').textContent()),conf);
 assert.equal(await prefs.getByRole('button',{name:'复制链接',exact:true}).isEnabled(),true);
 assert.equal(await prefs.getByRole('button',{name:'复制配置',exact:true}).isEnabled(),true);
 pass('settings exposes matching HTTP URL and authenticated client configuration');
 await prefs.getByRole('button',{name:'插件',exact:true}).click();
 await prefs.getByRole('button',{name:'配置验证插件'}).click();await prefs.getByLabel('测试标签').fill('二');await prefs.getByRole('button',{name:'保存设置'}).click();await op(id);
 await page.getByText('热加载 二',{exact:true}).waitFor();
 fixture.settings.extra={type:'boolean',default:false,label:'新增开关'};await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(fixture));
 await page.evaluate(()=>window.notch.openSettings('plugins'));await prefs.getByText('新增开关',{exact:true}).waitFor();await op(id);
 await fs.writeFile(path.join(folder,'panel.js'),"export function mount(el,ctx){el.textContent='新版 '+ctx.settings.label}");await page.getByText('新版 二',{exact:true}).waitFor();
 await fs.writeFile(path.join(folder,'panel.js'),"export function mount(el,ctx){el.textContent=ctx.t('hello')+'/'+ctx.locale}");await page.getByText('你好/zh-CN',{exact:true}).waitFor();
 await page.evaluate(()=>window.notch.setMcpAccess(['workspace','desktop','administration']));const language=await client.callTool({name:'locale_set',arguments:{locale:'en-US'}});assert.ok(!language.isError,JSON.stringify(language));await page.getByText('Hello/en-US',{exact:true}).waitFor();
 await fs.writeFile(path.join(folder,'en-US.json'),JSON.stringify({hello:'Welcome'}));await page.getByText('Welcome/en-US',{exact:true}).waitFor();
 await page.evaluate(()=>window.notch.openSettings('appearance'));await prefs.getByLabel('Interface language',{exact:true}).selectOption('zh-CN');await op(id);await page.getByText('你好/zh-CN',{exact:true}).waitFor();assert.equal((await rpc('state.get')).theme.locale,'zh-CN');pass('settings and MCP locale switch plus plugin resource hot reload');
 await fs.rename(folder,path.join(temp,'removed-plugin'));await until(async()=>!(await client.listTools()).tools.some(t=>t.name==='qa_panel_read'));pass('live folder install, UI, config edit, schema reload, UI replacement and uninstall');
 const injected=await rpc('attention_request',{provider:'codex',sessionId:'b0267dea-325c-4824-b591-5900fbbcc01c',title:'请选择方案',eventId:'qa:1'})
 const repeated=await rpc('attention_request',{provider:'codex',sessionId:'b0267dea-325c-4824-b591-5900fbbcc01c',title:'请选择方案',eventId:'qa:1'});assert.equal(injected.id,repeated.id)
 const history=await rpc('notifications.explain',{id:injected.notificationId});assert.ok(history.history.length);pass('attention deduplication and notification provenance')
 await rpc('todo_update',{id:todo.id,dueAt:Date.now()+500})
 const due=await until(async()=>(await rpc('notifications.list')).find(n=>n.pluginId==='todo'&&n.title==='Windows 验收'))
 await rpc('notifications.action',{id:due.id,index:0});assert.equal((await rpc('todo_list')).find(t=>t.id===todo.id).status,'completed');pass('due reminder and completion via notification')
 const md=path.join(temp,'review.md');await fs.writeFile(md,'# Windows preview\n\nA local Markdown document.')
 const clip=await rpc('clip_import',{kind:'file',path:md});await op('clipline',clip.id)
 await until(async()=>{const frame=ropePage.frames().find(f=>f.url().startsWith('notch-asset:'));return frame&&await frame.locator('h1').textContent()==='Windows preview'})
 const html=path.join(temp,'sample.html');await fs.writeFile(html,'<h1>HTML preview</h1><script>document.title="active"</script>');const hc=await rpc('clip_import',{kind:'file',path:html});await op('clipline',hc.id)
 await until(async()=>{const frame=ropePage.frames().find(f=>f.url().includes(hc.id));return frame&&await frame.locator('h1').textContent()==='HTML preview'&&await frame.locator('script').count()===0});pass('Markdown and sanitized HTML preview in real renderer')

 const pdfBytes=await app.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true}});try{await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<h1>PDF Windows preview</h1><p>First page</p><h1 style="break-before:page">Second page</h1>'));return (await w.webContents.printToPDF({})).toString('base64');}finally{w.destroy();}});
 const pdf=path.join(temp,'sample.pdf');await fs.writeFile(pdf,Buffer.from(pdfBytes,'base64'));const pc=await rpc('clip_import',{kind:'file',path:pdf});await op('clipline',pc.id);
 await until(()=>ropePage.locator('canvas[aria-label="PDF 第 1 页"]').evaluate(n=>n.width>100&&n.height>100));await ropePage.getByRole('button',{name:'下一页',exact:true}).click();await until(()=>ropePage.locator('canvas[aria-label="PDF 第 2 页"]').evaluate(n=>n.width>100));pass('real PDF worker rendering and page navigation');
 const videoBytes=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d');const stream=canvas.captureStream(12);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#577ad1':'#94d1de';context.fillRect(0,0,160,90);},65);await new Promise(resolve=>setTimeout(resolve,600));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());const data=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(Array.from(data,b=>String.fromCharCode(b)).join(''));});
 const video=path.join(temp,'sample.webm');await fs.writeFile(video,Buffer.from(videoBytes,'base64'));const vc=await rpc('clip_import',{kind:'file',path:video});await op('clipline',vc.id);await until(()=>ropePage.locator('.preview-canvas video').evaluate(n=>n.readyState>=1&&n.videoWidth===160));pass('real WebM metadata and native video preview');
 const imageFile=path.join(paths.root,'assets/icon.png'), bytes=await fs.readFile(imageFile);const pic=await rpc('clip_import',{kind:'image',base64:bytes.toString('base64'),mime:'image/png',name:'QA image.png'})
 await op('clipline',pic.id);await until(()=>ropePage.locator('.preview-canvas img').evaluate(n=>n.complete&&n.naturalWidth>0));pass('image capture model and preview')
 await ropePage.getByRole('button',{name:'关闭预览',exact:true}).click();const hanging=await rpc('clip_list');
 const pulled=ropePage.locator('[data-clip-id="'+hanging[1].id+'"]'),target=ropePage.locator('[data-clip-id="'+hanging[0].id+'"]');const pb=await pulled.locator('.clothespin').boundingBox(),tb=await target.boundingBox();
 await ropePage.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await ropePage.mouse.down();await ropePage.mouse.move(tb.x+tb.width/2,tb.y+18,{steps:12});
 assert.equal(await pulled.getAttribute('data-pulling'),'true');assert.notEqual(await ropePage.locator('.rope-line path').getAttribute('d'),'M 0 20 Q 180 23 360 20');await ropePage.mouse.up();
 await until(async()=>(await rpc('clip_list'))[0].id===hanging[1].id);pass('horizontal clothesline drag reorder persisted through service');
 const formats=await ps('Add-Type -AssemblyName System.Windows.Forms; $c=[Windows.Forms.Clipboard]::GetDataObject(); if ($c) {$c.GetFormats($false)}')
 if(formats.split(/\r?\n/).every(s=>['','Text','UnicodeText','OEMText','Locale','System.String'].includes(s))){
  const original=await app.evaluate(({clipboard})=>clipboard.readText());try{
   await rpc('clip_copy',{id:pic.id});const read=await rpc('clip_capture');assert.equal(read.kind,'image')
   const txt=await rpc('clip_import',{kind:'text',text:'notchdesk-roundtrip'});await rpc('clip_copy',{id:txt.id});assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'notchdesk-roundtrip');pass('real Windows image and text clipboard round trip')
  }finally{await app.evaluate(async({clipboard},original)=>{if(original)await clipboard.writeText(original);else clipboard.clear()},original)}
 }else{console.log('SKIP clipboard replacement: pre-existing multi-format user clipboard preserved')}
 assert.ok(Number.isInteger(initial.idle));const status=await rpc('wellness_status');assert.ok(Number.isFinite(status.activeSeconds));pass('real OS input idle counter and wellness state')

 await rpc('ui.open',{view:'closed'});await until(async()=>await island.getAttribute('data-view')==='closed');const collapsed=await page.locator('.notch').boundingBox();assert.ok(collapsed.height<=12);pass('collapsed notch is 12 logical pixels high');
 await rpc('ui.open',{view:'menu'});await wait(450);const grip=page.locator('.wheel-hub .shell-grip'),gb=await grip.boundingBox();
 const dragPoints=await app.evaluate(({screen,BrowserWindow},g)=>{const b=BrowserWindow.getAllWindows()[0].getBounds();return {start:screen.dipToScreenPoint({x:b.x+Math.round(g.x+g.width/2),y:b.y+Math.round(g.y+g.height/2)}),end:screen.dipToScreenPoint({x:b.x+Math.round(g.x+g.width/2)+45,y:b.y+Math.round(g.y+g.height/2)+35})}},gb);
 await move(dragPoints.start.x,dragPoints.start.y);await page.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2);await page.mouse.down();await move(dragPoints.end.x,dragPoints.end.y);await wait(120);await page.mouse.up();
 await until(async()=>!!(await rpc('state.get')).theme.position);const moved=await rpc('ui.snapshot');assert.ok(moved.bounds.x!==initial.b.x||moved.bounds.y!==initial.b.y);pass('native pointer drag persists notch position');
 await rpc('theme.set',{wheelPlacement:'edge',position:{x:initial.b.x,y:initial.b.y}});await wait(250);
 assert.equal(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('CommandOrControl+Alt+V')),true);
 await app.evaluate(({clipboard})=>{globalThis.qaClipboard={read:clipboard.read,readText:clipboard.readText};clipboard.read=async()=>[];clipboard.readText=()=> 'shortcut-clothesline-fixture';});
 try{await rpc('ui.open',{view:'closed'});await ps('Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait("^%v")');await until(async()=>(await rpc('clip_list')).some(item=>item.text==='shortcut-clothesline-fixture'));await until(async()=>await island.getAttribute('data-plugin')==='clipline');pass('native global paste shortcut captures directly to rope');}
 finally{await app.evaluate(({clipboard})=>{clipboard.read=globalThis.qaClipboard.read;clipboard.readText=globalThis.qaClipboard.readText;delete globalThis.qaClipboard;});}
 await ropePage.screenshot({path:path.join(base,'screenshots','compact-rope.png'),omitBackground:true});
 results.rendering=await page.evaluate(async()=>{const gaps=[];let previous=performance.now();for(let i=0;i<60;i++){const now=await new Promise(requestAnimationFrame);gaps.push(now-previous);previous=now;}gaps.sort((a,b)=>a-b);return {medianFrameMs:gaps[30],p95FrameMs:gaps[57]};});
 await page.evaluate(()=>window.notch.openSettings('accounts'));prefs=app.windows().find(p=>p.url().includes('#settings'));
 await app.evaluate(({shell})=>{globalThis.qaOAuthOriginal={fetch:globalThis.fetch,open:shell.openExternal};globalThis.qaOAuth={};
 globalThis.fetch=async(url,options)=>{const address=String(url);if(address==='https://github.com/login/oauth/access_token'){const body=options.body;globalThis.qaOAuth.exchange=body.get('client_id')==='qa-client'&&body.get('client_secret')==='qa-secret'&&!!body.get('code_verifier');return new Response(JSON.stringify({access_token:'qa-fixture-token'}),{headers:{'content-type':'application/json'}});}if(address==='https://api.github.com/user')return new Response(JSON.stringify({login:'qa-user'}),{headers:{'content-type':'application/json'}});return globalThis.qaOAuthOriginal.fetch(url,options);};
 shell.openExternal=async(address)=>{const url=new URL(address);globalThis.qaOAuth.pkce=!!url.searchParams.get('code_challenge')&&url.searchParams.get('code_challenge_method')==='S256';const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('code','qa-code');callback.searchParams.set('state','invalid');globalThis.qaOAuth.badState=(await globalThis.qaOAuthOriginal.fetch(callback)).status;callback.searchParams.set('state',url.searchParams.get('state'));await globalThis.qaOAuthOriginal.fetch(callback);};});
 try{await prefs.getByRole('button',{name:'浏览器登录',exact:true}).first().click();await prefs.getByLabel('Client ID',{exact:true}).fill('qa-client');await prefs.getByLabel('Client Secret',{exact:true}).fill('qa-secret');await prefs.getByRole('button',{name:'保存并浏览器授权',exact:true}).click();await until(async()=>(await page.evaluate(()=>window.notch.accounts())).some(item=>item.provider==='github'));
 const auth=await app.evaluate(()=>globalThis.qaOAuth);assert.equal(auth.badState,400);assert.ok(auth.pkce&&auth.exchange);assert.ok(!(await fs.readFile(path.join(data,'oauth-apps.enc'))).includes(Buffer.from('qa-secret')));pass('browser OAuth entry, PKCE, callback state, exchange and encrypted app settings with simulated platform');}
 finally{await app.evaluate(({shell})=>{globalThis.fetch=globalThis.qaOAuthOriginal.fetch;shell.openExternal=globalThis.qaOAuthOriginal.open;delete globalThis.qaOAuthOriginal;delete globalThis.qaOAuth;});}
 const droppedFile=path.join(temp,'拖入 文件.md');await fs.writeFile(droppedFile,'# Dropped directly onto the notch');await rpc('ui.open',{view:'closed'});await wait(100);
 const dropCdp=await page.context().newCDPSession(page),dropData={items:[],files:[droppedFile],dragOperationsMask:1};
 await dropCdp.send('Input.dispatchDragEvent',{type:'dragEnter',x:250,y:6,data:dropData});
 await until(async()=>await island.getAttribute('data-file-drag')==='true');await page.locator('.wheel').waitFor({state:'visible'});await wait(280);
 await dropCdp.send('Input.dispatchDragEvent',{type:'dragOver',x:250,y:150,data:dropData});await dropCdp.send('Input.dispatchDragEvent',{type:'drop',x:250,y:150,data:dropData});
 await until(async()=>(await rpc('clip_list')).some(item=>item.name==='拖入 文件.md'));await ropePage.locator('.rope-board').waitFor();await page.locator('.wheel').waitFor({state:'visible'});pass('native-backed file drop on collapsed notch automatically hangs on rope');
 await until(async()=>await wheel.getAttribute('data-wheel-active')==='clipline'&&await island.getAttribute('data-plugin')==='clipline'&&(await rpc('ui.snapshot')).rope.visible);
 await op('todo');await until(async()=>await wheel.getAttribute('data-wheel-active')==='todo');
 const anotherFile=path.join(temp,'接管响应.md');await fs.writeFile(anotherFile,'# Routed to clipboard plugin');const secondDrop={items:[],files:[anotherFile],dragOperationsMask:1};
 await dropCdp.send('Input.dispatchDragEvent',{type:'dragEnter',x:250,y:6,data:secondDrop});await until(async()=>await island.getAttribute('data-file-drag')==='true');await dropCdp.send('Input.dispatchDragEvent',{type:'dragOver',x:250,y:140,data:secondDrop});await dropCdp.send('Input.dispatchDragEvent',{type:'drop',x:250,y:140,data:secondDrop});
 await until(async()=>await wheel.getAttribute('data-wheel-active')==='clipline'&&await island.getAttribute('data-plugin')==='clipline'&&(await rpc('clip_list')).some(item=>item.name==='接管响应.md'));assert.equal(await page.locator('.wheel-button[data-plugin="clipline"]').getAttribute('aria-pressed'),'true');await until(async()=>(await rpc('ui.snapshot')).rope.visible);pass('dropping a file while todo is selected activates the clothesline and its selected wheel item');
 await page.evaluate(()=>document.querySelector('.wheel').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})));await rpc('clip_import',{kind:'text',text:'activation beats pending scroll'});await wait(350);assert.equal(await wheel.getAttribute('data-wheel-active'),'clipline');assert.equal(await island.getAttribute('data-plugin'),'clipline');pass('a response from the selected plugin cancels stale pending scroll selection');
 assert.deepEqual(consoleErrors,[]);results.passed=true
}finally{
 if(cursor)await move(cursor.x,cursor.y).catch(()=>{})
 if(client)await Promise.race([client.close().catch(()=>{}),wait(1500)])
 if(app){const appProcess=app.process();await app.evaluate(({app})=>{setTimeout(()=>app.exit(0),20)}).catch(()=>{});await Promise.race([app.close().catch(()=>{}),wait(2000)]);if(appProcess.exitCode===null)await run('taskkill.exe',['/PID',String(appProcess.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});}
 if(startedServer)startedServer.kill()
 const out=process.env.NOTCH_QA_REPORT||path.join(temp,'verification.json');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(results,null,2));console.log('Report',out)
}


if(results.passed)process.exit(0)
