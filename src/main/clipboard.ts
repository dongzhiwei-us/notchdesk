import { clipboard,ClipboardItem,nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL,fileURLToPath } from 'node:url'
const run=promisify(execFile)
// Windows exposes file drops as CF_HDROP. WinForms preserves the Explorer file payload.
async function windowsFiles(file?:string){
 const cmd=file
  ? "Add-Type -AssemblyName System.Windows.Forms; $items=New-Object System.Collections.Specialized.StringCollection; [void]$items.Add($env:NOTCH_CLIP_FILE); [Windows.Forms.Clipboard]::SetFileDropList($items)"
  : "Add-Type -AssemblyName System.Windows.Forms; if([Windows.Forms.Clipboard]::ContainsFileDropList()){[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write([Windows.Forms.Clipboard]::GetFileDropList()[0])}"
 return (await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(cmd,'utf16le').toString('base64')],{windowsHide:true,timeout:6000,env:{...process.env,NOTCH_CLIP_FILE:file||''}})).stdout.trim()
}
export async function capture(){
 const items=await clipboard.read()
 for(const item of items){if(item.types.includes('image/png')){const blob=await item.getType('image/png');if(blob.size>32*1024*1024)throw Error('截图过大，请以文件方式挂载');return {kind:'image',mime:'image/png',base64:Buffer.from(await blob.arrayBuffer()).toString('base64')}}}
 const text=await clipboard.readText()
 if(process.platform==='darwin'){for(const item of items){if(item.types.includes('text/uri-list')){const uri=await(await item.getType('text/uri-list')).text();if(uri.startsWith('file:'))return{kind:'file',path:fileURLToPath(uri.trim())}}}}
 if(process.platform==='win32'&&!text){const file=await windowsFiles();if(file)return {kind:'file',path:file}}
 if(text)return{kind:'text',text};throw Error('剪贴板中没有可收录的图片、文本或文件')
}
export async function writeClip(p:any){
 if(p.kind==='text'){await clipboard.writeText(String(p.text||''));return {ok:true}}
 if(p.kind==='image'){const data=p.path?await fs.readFile(p.path):Buffer.from(String(p.base64||''),'base64');const png=nativeImage.createFromBuffer(data).toPNG()
  if(!png.length)throw Error('图片读取失败');await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(png)],{type:'image/png'})})]);return{ok:true}}
 if(p.kind==='file'&&path.isAbsolute(p.path)){await fs.access(p.path)
  if(process.platform==='win32')await windowsFiles(p.path)
  else await clipboard.write([new ClipboardItem({'electron application/osclipboard;format="public.file-url"':new Blob([pathToFileURL(p.path).href])})])
  return{ok:true}}
 throw Error('不支持的剪贴内容')
}

