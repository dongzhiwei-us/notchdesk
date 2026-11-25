import {app,globalShortcut,BrowserWindow,dialog,ipcMain,Menu,powerMonitor,protocol,screen,shell,Tray,nativeImage,session,nativeTheme} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {promises as fsp} from 'node:fs'
import {spawn} from 'node:child_process'
import {connectService,dataHome,rpc,watch,type Connection} from '../shared/connection'
import {permissions,setPermissions} from '../shared/access'
import {registerProtocols} from './assets'
import {capture,writeClip} from './clipboard'
import {accountBroker} from './accounts'
import {clotheslineWindow} from '../../plugins/clipline/window'

const data=dataHome(), packed=app.isPackaged
const profile=process.env.NOTCH_DATA || !process.env.XDG_DATA_HOME || process.platform!=='win32' ? path.join(data,'desktop') : path.resolve(process.env.XDG_DATA_HOME,'../state/notchdesk/desktop')
fs.mkdirSync(profile,{recursive:true})
app.setPath('userData',profile)
const plugins=process.env.NOTCH_PLUGINS || (packed?path.join(data,'plugins'):path.join(app.getAppPath(),'plugins'))
const serviceDir=packed?path.join(process.resourcesPath,'service'):__dirname
const nativeDir=packed?path.join(process.resourcesPath,'native'):__dirname
const node=process.env.NOTCH_NODE || (packed?path.join(process.resourcesPath,'runtime',process.platform==='win32'?'node.exe':'node'):(process.platform==='win32'?'node.exe':'node'))
const startUrl='notch://app/index.html'
protocol.registerSchemesAsPrivileged(['notch','notch-asset','notch-plugin'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}})))
let main:BrowserWindow|null=null,settings:BrowserWindow|null=null,tray:Tray|null=null,c:Connection|undefined,quitting=false
let rope:ReturnType<typeof clotheslineWindow>|undefined
let view:any={view:'closed'},locked=false,hitRects=[{x:206,y:0,width:88,height:12}],inside=false,ignoring=true
const stop=new AbortController()
function emit(type:string,payload:any,to?:BrowserWindow|null){for(const win of to?[to]:[main,settings])if(win&&!win.isDestroyed())win.webContents.send('notch:event',{type,payload});if(!to)rope?.send(type,payload)}
const account=accountBroker(data,()=>emit('changed',{}))
const call=async(method:string,params:any={})=>{if(!c)throw Error('服务连接中');return rpc(c,method,params)}
let savedPosition:{x:number;y:number}|undefined
let floating = false
let windowDrag:{cursor:Electron.Point;bounds:Electron.Rectangle;timer:ReturnType<typeof setInterval>;moved:boolean}|undefined
let captureShortcut = ""
let materialTheme:any = {}
let focusTimer:ReturnType<typeof setTimeout>|undefined
let groupEngaged=false,focusGrace=0,focusWatcher:ReturnType<typeof spawn>|undefined
let outsideInputReady=false
let nativeDragFinish:(()=>void)|undefined
let nativeDialogDepth=0
const shellExpanded=()=>view.view!=='closed'||!!(rope?.visible()&&!rope.isPinned())
const focusProtected=()=>!!settings?.isVisible()||!!windowDrag||nativeDialogDepth>0||!!nativeDragFinish||!!rope?.busy()
function groupFocus(){groupEngaged=true;clearTimeout(focusTimer)}
function groupBlur(){
 clearTimeout(focusTimer);focusTimer=setTimeout(()=>{
  if(!main||!shellExpanded()||focusProtected())return
  if(Date.now()<focusGrace){groupBlur();return}
  const focused=BrowserWindow.getFocusedWindow()
  if(focused===main||rope?.owns(focused))return
  if(!groupEngaged)return
  groupEngaged=false
  emit('shell.blur',{reason:'focus-loss'},main)
 },Math.max(90,focusGrace-Date.now()+20))
}
function watchOutsideInput(){
 if(process.platform!=='win32')return
 focusWatcher=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(nativeDir,'windows-focus.ps1'),String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','ignore']})
 let buffer=''
 focusWatcher.stdout?.on('data',data=>{
  buffer+=String(data);let boundary:number
  while((boundary=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1)
   try{
    const event=JSON.parse(line)
    if(event.type==='ready'){outsideInputReady=true;continue}
    if(event.type==='release'){nativeDragFinish?.();continue}
    if(!shellExpanded()||focusProtected())continue
    if(event.type==='click'){
     if(event.processId===process.pid)continue
     const cursor=Number.isFinite(event.x)&&Number.isFinite(event.y)?screen.screenToDipPoint({x:event.x,y:event.y}):screen.getCursorScreenPoint(),b=main?.getBounds(),mainHit=b&&hitRects.some(r=>cursor.x>=b.x+r.x&&cursor.x<b.x+r.x+r.width&&cursor.y>=b.y+r.y&&cursor.y<b.y+r.y+r.height)
     if(!mainHit&&!rope?.hit(cursor))emit('shell.blur',{reason:'outside-click'},main)
    }else if(event.type==='focus'){
     if(event.handle==='0')continue
     const owns=event.processId===process.pid||rope?.ownsHandle(event.handle)||[main,settings].some(w=>w&&!w.isDestroyed()&&(w.getNativeWindowHandle().length===8?w.getNativeWindowHandle().readBigUInt64LE().toString():String(w.getNativeWindowHandle().readUInt32LE()))===event.handle)
     const focused=BrowserWindow.getFocusedWindow()
     if(owns)groupFocus()
     else if(!rope?.owns(focused))emit('shell.blur',{reason:'foreground-change'},main)
    }
   }catch{}
  }
  if(buffer.length>4096)buffer=''
 })
 focusWatcher.on('error',()=>{})
 focusWatcher.on('exit',()=>{outsideInputReady=false})
}
function overlayBackdrop(window:BrowserWindow){
 // Native vibrancy fills the entire macOS window, including the empty space
 // around the notch (or the full-screen rope). macOS has no setShape clipping.
 // Keep these overlays transparent; visible components provide their own material.
 if(process.platform==='darwin')window.setVibrancy(null)
 window.setBackgroundColor('#00000000')
}
function backdrop(theme:any=materialTheme){
 materialTheme=theme
 if(!main)return
 nativeTheme.themeSource=['dark','light'].includes(theme.mode)?theme.mode:'system'
 overlayBackdrop(main)
}
function anchor(){
 const display=savedPosition?screen.getDisplayNearestPoint(savedPosition):screen.getPrimaryDisplay()
 const a=display.workArea, width=Math.min(500,a.width), offset=floating?48:0
 const x=savedPosition?.x ?? Math.round(a.x+(a.width-width)/2)
 const y=floating ? savedPosition?.y ?? a.y+offset : a.y
 return {x:Math.round(Math.max(a.x,Math.min(x,a.x+a.width-width))),y:Math.round(Math.max(a.y,Math.min(y,a.y+a.height-120))),width,height:Math.min(floating?680:620,a.height-Math.max(0,y-a.y))}
}
function place(theme:any){
 backdrop(theme)
 const previous=JSON.stringify([floating,savedPosition])
 floating=theme?.wheelPlacement==='floating'
 savedPosition=theme?.position && Number.isFinite(theme.position.x)&&Number.isFinite(theme.position.y)?theme.position:undefined
 if(main && previous!==JSON.stringify([floating,savedPosition])){main.setBounds(anchor());rope?.send('rope.context',rope.info());pointer()}
 rope?.material()
}
function beginMove(){
 if(!main||windowDrag)return
 const bounds=main.getBounds(),cursor=screen.getCursorScreenPoint()
 const timer=setInterval(()=>{
  if(!main||!windowDrag)return
  const point=screen.getCursorScreenPoint(),dx=point.x-cursor.x,dy=point.y-cursor.y
  if(Math.abs(dx)+Math.abs(dy)>4)windowDrag.moved=true
  if(windowDrag.moved)main.setPosition(bounds.x+dx,bounds.y+dy,false)
 },16)
 windowDrag={cursor,bounds,timer,moved:false}
 emit('shell.dragging',true,main)
}
async function endMove(){
 if(!windowDrag||!main)return {moved:false}
 const {timer,moved}=windowDrag;clearInterval(timer);windowDrag=undefined
 if(moved){const bounds=main.getBounds(),a=screen.getDisplayMatching(bounds).workArea
  const edge=bounds.y<=a.y+18
  await call('theme.set',{wheelPlacement:edge?'edge':'floating',position:{x:bounds.x,y:edge?a.y:bounds.y}})
 }
 emit('shell.dragging',false,main)
 return {moved}
}
async function captureToLine(){
 if(settings?.isVisible())return
 try{await call('clip_capture');emit('clip.captured',{});main?.show();main?.focus()}
 catch(error){emit('shell.error',String((error as Error).message),main)}
}
async function syncShortcut(){
 const state=await call('state.get')
 const enabled=state.plugins.some((plugin:any)=>plugin.id==='clipline'&&plugin.enabled)
 if(!enabled)rope?.hide()
 const next=enabled?String(state.settings.clipline?.values.captureShortcut||'CommandOrControl+Alt+V'):''
 if(next===captureShortcut)return
 if(captureShortcut)globalShortcut.unregister(captureShortcut)
 captureShortcut=''
 if(next){try{if(globalShortcut.register(next,()=>void captureToLine()))captureShortcut=next;else emit('shell.error','Clipboard shortcut is already in use',main)}catch{emit('shell.error','Invalid clipboard shortcut',main)}}
}
function pointer(){if(!main||main.isDestroyed()||windowDrag)return;const bounds=main.getBounds(),cursor=screen.getCursorScreenPoint(),x=cursor.x-bounds.x,y=cursor.y-bounds.y
 const ropeHit=rope?.hit(cursor)||false
 const mainHit=!settings?.isVisible()&&hitRects.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height)
 const next=!settings?.isVisible()&&(mainHit||(ropeHit&&!rope?.isPinned()))
 if(process.platform!=='win32'&&ignoring===mainHit){main.setIgnoreMouseEvents(!mainHit,{forward:true});ignoring=!mainHit}
 if(inside!==next){inside=next;emit('hover',next,main)}}
function applyRects(rects:any){if(!Array.isArray(rects)||!main)return
 const bounds=main.getBounds()
 const clean=rects.slice(0,640).filter(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0).map(r=>({x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.min(bounds.width,Math.ceil(r.width)+1),height:Math.min(bounds.height,Math.ceil(r.height)+1)}))
 if(!clean.length)return
 if(JSON.stringify(clean)!==JSON.stringify(hitRects)){hitRects=clean;if(process.platform==='win32')main.setShape(clean)}
 pointer()
}
const prefs={additionalArguments:['--notch-system-locale='+app.getPreferredSystemLanguages()[0]],preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,spellcheck:false,plugins:true}
function protect(w:BrowserWindow){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(startUrl))event.preventDefault()})}
rope=clotheslineWindow({url:startUrl,prefs,call,anchor:()=>main?.getBounds()||anchor(),emit,protect,front:()=>main?.moveTop(),context:()=>({notch:main?.getBounds()||anchor(),wheelHeight:floating?312:156}),blur:groupBlur,focus:groupFocus,backdrop:overlayBackdrop,pin:pinned=>emit('clipline.pin',{pinned})})
async function openSettings(section?:string){if(!settings||settings.isDestroyed()){
 settings=new BrowserWindow({title:'悬屿设置',width:710,height:600,minWidth:470,minHeight:390,show:false,autoHideMenuBar:true,backgroundColor:'#232624',webPreferences:prefs})
 protect(settings);settings.on('closed',()=>{settings=null;main?.setAlwaysOnTop(true,'floating');emit('settings.visibility',false,main)});await settings.loadURL(startUrl+'#settings'+(section?'/'+encodeURIComponent(section):''))}
 if(!rope?.isPinned())rope?.hide();emit('open',{view:'closed'},main);main?.setAlwaysOnTop(false);
 settings.setAlwaysOnTop(true,'floating');settings.show();settings.focus();emit('settings.visibility',true,main);if(section)emit('open',{view:'settings',section},settings);return true
}
async function createShell(){
 main=new BrowserWindow({...anchor(),show:false,title:'悬屿',frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,skipTaskbar:true,alwaysOnTop:true,fullscreenable:false,webPreferences:prefs})
 main.setAlwaysOnTop(true,'floating');if(process.platform==='darwin')main.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})
 if(process.platform==='win32')main.setShape(hitRects);else main.setIgnoreMouseEvents(true,{forward:true});protect(main)
 main.on('blur',groupBlur);
 main.on('focus',groupFocus);
 main.on('close',e=>{if(!quitting){e.preventDefault();emit('open',{view:'closed'},main)}})
 backdrop(materialTheme);nativeTheme.on('updated',()=>backdrop())
 await main.loadURL(startUrl);main.showInactive()
 inside=false
 setInterval(pointer,16).unref()
 for(const event of ['display-added','display-removed','display-metrics-changed'] as const)screen.on(event as any,()=>{main?.setBounds(anchor());if(rope?.visible())void rope.show(view.view==='clipline'?view.itemId:undefined).catch(()=>{})})
}
function safeUrl(value:string){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('仅支持 HTTP(S) 链接');return url.href}
async function files(){
 nativeDialogDepth++
 try{
  const focused=BrowserWindow.getFocusedWindow(),owner=rope?.owns(focused)?focused:main
  const options:Electron.OpenDialogOptions={properties:['openFile','multiSelections']}
  return (await (owner?dialog.showOpenDialog(owner,options):dialog.showOpenDialog(options))).filePaths
 }finally{nativeDialogDepth--;focusGrace=Date.now()+180;groupBlur()}
}
const dragFiles=new Map<string,{file:string;icon:Electron.NativeImage;at:number;revision:number}>(),dragPreparing=new Map<string,Promise<void>>()
async function prepareDrag(id:string,revision=0){
 const cached=dragFiles.get(id)
 if(cached&&Date.now()-cached.at<30000&&(!revision||cached.revision===revision))return
 if(dragPreparing.has(id)){await dragPreparing.get(id);if(revision&&dragFiles.get(id)?.revision!==revision)await prepareDrag(id,revision);return}
 const ready=(async()=>{
  const clip=await call('clip_resolve',{id})
  if(clip.kind==='text'||!clip.path)throw Error('此挂件没有可拖出的文件')
  const file=fs.realpathSync(clip.path);if(!fs.statSync(file).isFile())throw Error('原文件已移动')
  const item={file,icon:nativeImage.createFromPath(path.join(__dirname,'icon.png')),at:Date.now(),revision:Number(clip.updatedAt)||0}
  dragFiles.set(id,item)
  void nativeImage.createThumbnailFromPath(file,{width:80,height:80}).then(icon=>{if(!icon.isEmpty())item.icon=icon}).catch(()=>{})
  for(const [key,value]of dragFiles)if(Date.now()-value.at>30000)dragFiles.delete(key)
  while(dragFiles.size>128)dragFiles.delete(dragFiles.keys().next().value!)
 })()
 dragPreparing.set(id,ready)
 try{await ready}finally{dragPreparing.delete(id)}
}
async function dragClip(sender:Electron.WebContents,id:string){
 if(sender!==main?.webContents&&!rope?.accepts(sender.id))throw Error('仅允许悬屿挂件发起拖出')
 if(nativeDragFinish)throw Error('已有文件正在拖出')
 let started=false
 rope?.setDragging(true);emit('shell.dragging',true,main)
 try{
  if(!dragFiles.has(id))await prepareDrag(id)
  const item=dragFiles.get(id)!
  if(!fs.statSync(item.file).isFile())throw Error('原文件已移动')
  let timer:ReturnType<typeof setTimeout>|undefined
  const released=process.platform==='win32'?new Promise<void>(resolve=>{nativeDragFinish=resolve;timer=setTimeout(resolve,45000)}):undefined
  try{sender.startDrag({file:item.file,icon:item.icon});started=true;if(released)await released}
  finally{clearTimeout(timer);nativeDragFinish=undefined}
  return {dragged:true}
 }finally{rope?.setDragging(false);emit('shell.dragging',false,main);if(started)emit('open',{view:'closed'},main)}
}
const adapterPath=path.join(data,'session-adapters.json')
function adapters():Record<string,string>{try{return JSON.parse(fs.readFileSync(adapterPath,'utf8'))}catch{return {}}}
async function nativeCall(method:string,p:any={}):Promise<any>{
 switch(method){
 case 'ui.clipline_pin':rope?.setPinned(p.pinned===true);if(p.pinned===true)emit('shell.editing',false,main);else if(view.view!=='clipline')rope?.hide();return {pinned:p.pinned===true}
 case 'ui.clipline_hide':rope?.hide();if(view.view==='clipline')emit('open',{view:'closed'},main);return {hidden:true}
 case 'clipboard.capture':return capture()
 case 'clipboard.write':{const result=await writeClip(p);emit('action.completed',{method},main);return result}
 case 'accounts.fetch':return account.fetch(p)
 case 'accounts.list':return account.list()
 case 'files.pick':return files()
 case 'file.open':{const file=p.path;if(!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('文件已移动');if(!/\.(pdf|txt|md|png|jpg|jpeg|gif|webp|mp4|webm|mov|html?)$/i.test(file))throw Error('此文件类型请从文件管理器打开');const result=await shell.openPath(file);if(result)throw Error(result);emit('action.completed',{method},main);return{ok:true}}
 case 'ui.open':if(p.view==='settings')return openSettings(p.section);else{if(p.view!=='closed'){focusGrace=Date.now()+500;const focused=BrowserWindow.getFocusedWindow();groupEngaged=focused===main||!!rope?.owns(focused)}if(p.view!=='closed'&&settings?.isVisible()){settings.hide();main?.setAlwaysOnTop(true,'floating');emit('settings.visibility',false,main)}main?.showInactive();if(p.activationId)emit('plugin.activated',p);emit('open',p,main);return{dispatched:true}}
 case 'ui.snapshot':return {...view,bounds:main?.getBounds(),settingsOpen:!!settings,rope:rope?.info(),outsideInputReady:process.platform!=='win32'||outsideInputReady}
 case 'session.adapters':return {codex:true,hermes:true,...adapters()}
 case 'session.register':{const t=String(p.template||'');if(p.provider!=='vanish'||!t.includes('{sessionId}')||(!/^vanish:\/\//.test(t)&&!/^https:\/\//.test(t)))throw Error('需要含 {sessionId} 的 HTTPS 或 vanish 链接');new URL(t.replace('{sessionId}','id'));await fsp.writeFile(adapterPath,JSON.stringify({...adapters(),vanish:t}));return{registered:true}}
 case 'session.open':{
  const id=String(p.sessionId||'');if(!/^[a-zA-Z0-9_-]{1,150}$/.test(id))throw Error('会话标识无效')
  if(p.provider==='codex'){await shell.openExternal('codex://threads/'+encodeURIComponent(id));emit('action.completed',{method},main);return{dispatched:true}}
  if(p.provider==='vanish'){const t=adapters().vanish;if(!t)throw Error('请先通过 session_register 登记 Vanish 会话链接');await shell.openExternal(t.replace('{sessionId}',encodeURIComponent(id)));emit('action.completed',{method},main);return{dispatched:true}}
  if(p.provider==='hermes'){if(process.platform==='win32'){await new Promise<void>((resolve,reject)=>{const child=spawn('cmd.exe',['/d','/c','start','','cmd.exe','/d','/k','hermes','--resume',id],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('终端启动失败')))})}
   else {await new Promise<void>((resolve,reject)=>{const child=spawn('osascript',['-e','tell application "Terminal" to do script "hermes --resume '+id+'"','-e','tell application "Terminal" to activate'],{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Terminal 无法打开会话')))})}
   return{dispatched:true}}
  throw Error('当前来源没有会话适配器')}
 default:throw Error('未知桌面能力 '+method)
 }}
function bindIPC(){
 const allowed=(e:Electron.IpcMainInvokeEvent|Electron.IpcMainEvent)=>e.senderFrame?.url.startsWith(startUrl)&&e.senderFrame===e.sender.mainFrame
 const api:Record<string,(...p:any[])=>any>={
 ropeMoving:(active:boolean)=>rope?.setMoving(!!active),
 rpc:(method,p)=>{if(typeof method!=='string'||/^(host\.|native\.|clip_resolve$)/.test(method))throw Error('专用宿主接口');if(!c)throw Error('服务连接中');return rpc({...c,token:c.rendererToken||c.token},method,p,'ui')},
 captureClip:captureToLine,beginMove,endMove,prepareClipDrag:prepareDrag,ropeInfo:()=>rope?.info(),ropeReposition:()=>(view.view==='clipline'||rope?.visible())&&!settings?.isVisible()?rope?.show(view.view==='clipline'?view.itemId:undefined):undefined,ropeEditing:(active:boolean)=>{rope?.setEditing(!!active);emit('shell.editing',!!active&&!rope?.isPinned(),main)},settings:openSettings,pick:files,external:async(url)=>{settings?.setAlwaysOnTop(false);await shell.openExternal(safeUrl(url));emit('action.completed',{method:'external'},main)},folder:()=>plugins,openFolder:()=>shell.openPath(plugins),
 accounts:account.list,saveAccount:account.save,disconnectAccount:account.disconnect,connectAccount:async(p)=>{settings?.setAlwaysOnTop(false);try{return await account.connect(p)}finally{if(settings&&!settings.isDestroyed()){settings.setAlwaysOnTop(true,'floating');settings.show();settings.focus()}}},oauthOptions:account.options,
 mcpAccess:()=>permissions(data),setMcpAccess:(groups)=>{const value=setPermissions(data,groups);emit('changed',{});return value},
 mcp:()=>{if(!c?.mcpToken)throw Error('MCP server is connecting');return {url:'http://127.0.0.1:'+c.port+'/mcp',headers:{Authorization:'Bearer '+c.mcpToken}}}
 }
 for(const [name,fn] of Object.entries(api))ipcMain.handle('notch:'+name,(e,...p)=>{if(!allowed(e))throw Error('仅允许悬屿应用发起此操作');return fn(...p)})
 ipcMain.on('notch:dragClip',(e,id,requestId)=>{if(!allowed(e)||typeof id!=='string'||!Number.isSafeInteger(requestId))return;void dragClip(e.sender,id).then(result=>{if(!e.sender.isDestroyed())e.sender.send('notch:dragDone',{...result,requestId})},error=>{if(!e.sender.isDestroyed())e.sender.send('notch:dragDone',{error:String(error.message),requestId})})})
 ipcMain.on('notch:hit',(e,rects)=>{if(!allowed(e))return;if(e.sender===main?.webContents)applyRects(rects);else if(rope?.accepts(e.sender.id))rope.shape(rects)})
 ipcMain.on('notch:state',(e,state)=>{if(allowed(e)&&e.sender===main?.webContents){const reopen=state.view!==view.view||state.itemId!==view.itemId||!rope?.visible();view=state;if(state.view==='clipline'&&!settings?.isVisible()){if(reopen)void rope?.show(state.itemId).catch(error=>emit('shell.error',String(error.message),main));}else if(!rope?.isPinned())rope?.hide()}})
}
async function stream(){
 while(!quitting){try{
  c=await connectService(data,plugins,node,path.join(serviceDir,'server.cjs'))
  await watch(c,event=>{
   if(event.type==='connected'){void call('host.online',{connectionId:event.payload.id,idleSeconds:powerMonitor.getSystemIdleTime(),locked,systemLocale:app.getPreferredSystemLanguages()[0]}).then(()=>call('state.get')).then(s=>{place(s.theme);emit('server.ready',{})}).catch(()=>{});return}
   if(event.type==='changed')void syncShortcut().catch(()=>{})
   if(event.type==='theme.changed')place(event.payload)
   if(event.type==='native'){const {id,method,params}=event.payload;void nativeCall(method,params).then(result=>call('native.reply',{id,result}),error=>call('native.reply',{id,error:String(error.message)})).catch(()=>{});return}
   emit(event.type,event.payload)
  },stop.signal)
 }catch(e){if(!quitting)console.error('桌面服务连接',String((e as Error).message))}if(!quitting)await new Promise(r=>setTimeout(r,1000))}
}
async function seed(){
 await fsp.mkdir(plugins,{recursive:true});if(!packed||process.env.NOTCH_PLUGINS)return
 const source=path.join(process.resourcesPath,'plugins'), marker=path.join(data,'bundled-plugins.json')
 let seeded:Record<string,string>={};try{seeded=JSON.parse(await fsp.readFile(marker,'utf8'))}catch{}
 for(const name of await fsp.readdir(source)){
  if(name.startsWith('.'))continue
  const to=path.join(plugins,name),from=path.join(source,name)
  if(!seeded[name]&&!fs.existsSync(to)){await fsp.cp(from,to,{recursive:true});seeded[name]=app.getVersion();continue}
  if(seeded[name]&&seeded[name]!==app.getVersion()&&fs.existsSync(to)){
   let manifest:any;try{manifest=JSON.parse(await fsp.readFile(path.join(to,'manifest.json'),'utf8'))}catch{continue}
   const stockVersion=manifest.version===seeded[name] || (seeded[name]==='0.1.0'&&manifest.version==='1.0.0')
   if(manifest.id!==name||!stockVersion||manifest.ui)continue
   const backup=path.join(data,'plugin-backups',Date.now()+'-'+name)
   await fsp.cp(to,backup,{recursive:true});await fsp.cp(from,to,{recursive:true});seeded[name]=app.getVersion()
  }
 }
 await fsp.writeFile(marker,JSON.stringify(seeded))
}
async function boot(){
 await seed();bindIPC()
 c=await connectService(data,plugins,node,path.join(serviceDir,'server.cjs'))
 place((await call('state.get')).theme)
 registerProtocols(path.join(__dirname,'ui'),call,async(id,file)=>{
  if(!c||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('无效插件')
  const manifest=(await call('state.get')).plugins.find((p:any)=>p.id===id&&p.enabled!==false)
  if(!manifest?.ui)throw Error('插件视图未启用')
  const relative=file==='entry.js'?manifest.ui:file
  if(relative!==manifest.ui)throw Error('请将插件面板打包为独立 ES 模块')
  const {source}=await call('plugins.ui',{id})
  return new Response(source,{headers:{'content-type':'text/javascript','access-control-allow-origin':'notch://app','cache-control':'no-store'}})
 })
 Menu.setApplicationMenu(null)
 session.defaultSession.setPermissionRequestHandler((_wc,_perm,cb)=>cb(false))
 await createShell();watchOutsideInput();await syncShortcut();void stream()
 const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png')).resize({width:20,height:20})
 tray=new Tray(icon);tray.setToolTip('悬屿 · 顶部桌面工作台');tray.setContextMenu(Menu.buildFromTemplate([
  {label:'展开悬屿',click:()=>nativeCall('ui.open',{view:'menu'})},{label:'设置',click:()=>openSettings()},{label:'打开插件目录',click:()=>shell.openPath(plugins)},{type:'separator'},{label:'退出桌面',click:()=>app.quit()}]))
 tray.on('click',()=>nativeCall('ui.open',{view:'menu'}))
 const ping=()=>{if(c&&!quitting)call('host.activity',{idleSeconds:powerMonitor.getSystemIdleTime(),locked,at:Date.now()}).catch(()=>{})}
 const pause=()=>{locked=true;ping()},resume=()=>{locked=false;ping()}
 powerMonitor.on('lock-screen',pause);powerMonitor.on('suspend',pause)
 powerMonitor.on('unlock-screen',resume);powerMonitor.on('resume',resume)
 ping();setInterval(ping,3000).unref()
}
if(!app.requestSingleInstanceLock())app.quit()
else{
 app.on('second-instance',()=>nativeCall('ui.open',{view:'menu'}));app.whenReady().then(boot).catch(err=>{console.error(err);dialog.showErrorBox('悬屿启动失败',err.message);app.quit()})
 app.on('before-quit',()=>{quitting=true;focusWatcher?.kill();clearTimeout(focusTimer);globalShortcut.unregisterAll();if(windowDrag)clearInterval(windowDrag.timer);stop.abort();if(c)void call('host.offline').catch(()=>{})})
 app.on('window-all-closed',()=>{})
}

