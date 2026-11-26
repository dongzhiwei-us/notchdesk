import { contextBridge, ipcRenderer, webUtils } from 'electron'
const call=(method:string,...args:any[])=>ipcRenderer.invoke('notch:'+method,...args)
let dragRequest=0
contextBridge.exposeInMainWorld('notch',{
 systemLocale:process.argv.find(arg=>arg.startsWith('--notch-system-locale='))?.split('=')[1] || 'en-US',
 platform:process.platform,
 shortcutRecording:(active:boolean,token?:string)=>call('shortcutRecording',active,token),shortcutStatus:()=>call('shortcutStatus'),retryShortcuts:()=>call('retryShortcuts'),
 rpc:(method:string,params:any={})=>call('rpc',method,params),
 onEvent:(fn:(event:any)=>void)=>{const listener=(_:unknown,event:any)=>fn(event);ipcRenderer.on('notch:event',listener);return ()=>ipcRenderer.removeListener('notch:event',listener)},
 captureClip:()=>call('captureClip'),
 beginMove:()=>call('beginMove'),endMove:()=>call('endMove'),oauthOptions:()=>call('oauthOptions'),
 ropeInfo:()=>call('ropeInfo'),ropeReposition:()=>call('ropeReposition'),ropeEditing:(active:boolean)=>call('ropeEditing',active),
 ropeMoving:(active:boolean)=>call('ropeMoving',active),
 startClipDrag:(id:string)=>new Promise((resolve,reject)=>{const requestId=++dragRequest;const complete=(_event:unknown,result:any)=>{if(result.requestId!==requestId)return;ipcRenderer.removeListener('notch:dragDone',complete);if(result.error)reject(Error(result.error));else resolve(result)};ipcRenderer.on('notch:dragDone',complete);ipcRenderer.send('notch:dragClip',id,requestId)}),
 prepareClipDrag:(id:string,revision?:number)=>call('prepareClipDrag',id,revision),
 openSettings:(section?:string)=>call('settings',section),setHitAreas:(rects:any[])=>ipcRenderer.send('notch:hit',rects),
 uiState:(view:any)=>ipcRenderer.send('notch:state',view),
 assetUrl:(id:string,mode='preview')=>'notch-asset://local/'+encodeURIComponent(id)+'?mode='+encodeURIComponent(mode),
 pluginUrl:(id:string,rev:any)=>'notch-plugin://local/'+encodeURIComponent(id)+'/entry.js?v='+encodeURIComponent(rev??0),
 filePath:(file:File)=>webUtils.getPathForFile(file),pickFile:()=>call('pick'),
 openExternal:(url:string)=>call('external',url),pluginsFolder:()=>call('folder'),openPluginsFolder:()=>call('openFolder'),
 mcpConfig:()=>call('mcp'),accounts:()=>call('accounts'),saveAccount:(a:any)=>call('saveAccount',a),disconnectAccount:(provider:string)=>call('disconnectAccount',provider),
 connectAccount:(params:any)=>call('connectAccount',params),
 mcpAccess:()=>call('mcpAccess'),setMcpAccess:(groups:string[])=>call('setMcpAccess',groups)
})

