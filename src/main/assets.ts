import {net,nativeImage,protocol} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {promises as fsp} from 'node:fs'
import {Readable} from 'node:stream'
import {pathToFileURL} from 'node:url'
import sanitize from 'sanitize-html'
import {marked} from 'marked'
const mime:Record<string,string>={'.md':'text/markdown','.html':'text/html','.htm':'text/html','.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.txt':'text/plain'}
const docHeaders={'Content-Type':'text/html;charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"}
const missing=(message:string,status=404)=>new Response(message,{status,headers:{'content-type':'text/plain;charset=utf-8'}})
export function registerProtocols(uiDir:string,call:(m:string,p?:any)=>Promise<any>,pluginCode:(id:string,file?:string)=>Promise<Response>){
 protocol.handle('notch',req=>{const u=new URL(req.url);if(u.host!=='app')return missing('Not found')
  const file=path.resolve(uiDir,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(uiDir+path.sep))return missing('Forbidden',403)
  return net.fetch(pathToFileURL(file).href)})
 protocol.handle('notch-plugin',async req=>{try{const parts=new URL(req.url).pathname.split('/').filter(Boolean);if(parts.length<2)return missing('Invalid module')
  return await pluginCode(parts[0],parts.slice(1).join('/'))}catch{return missing('Plugin failed to load')}})
 protocol.handle('notch-asset',async req=>{
  try{const u=new URL(req.url),id=decodeURIComponent(u.pathname.slice(1));if(!id||u.host!=='local')return missing('Invalid asset')
   const a=await call('clip_resolve',{id});if(a.kind==='text')return new Response(a.text||'',{headers:{'content-type':'text/plain;charset=utf-8'}})
   const file=a.path,info=await fsp.stat(file);if(!info.isFile())return missing('File unavailable')
   const ext=path.extname(a.name||file).toLowerCase(),type=mime[ext]||a.mime||'application/octet-stream'
   if(u.searchParams.get('mode')==='thumb'&&type.startsWith('image/')&&type!=='image/svg+xml'){
    const img=await nativeImage.createThumbnailFromPath(file,{width:300,height:180});if(!img.isEmpty())return new Response(new Uint8Array(img.toPNG()),{headers:{'content-type':'image/png'}})
   }
   if(['text/html','text/markdown'].includes(type)){
    if(info.size>8*1024*1024)return missing('文档过大，请在外部程序查看',413)
    const raw=await fsp.readFile(file,'utf8');const html=sanitize(type==='text/markdown'?String(marked.parse(raw,{async:false})):raw,{allowedTags:[...sanitize.defaults.allowedTags,'img','h1','h2','details','summary'],allowedAttributes:{img:['alt','src'],td:['colspan','rowspan']},allowedSchemes:['data'],allowedSchemesByTag:{img:['data']}})
    return new Response('<meta charset="utf-8"><style>:root{color-scheme:light dark}body{font:15px/1.65 system-ui;margin:18px;overflow-wrap:anywhere}img{max-width:100%}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #8888;padding:4px}</style>'+html,{headers:docHeaders})
   }
   let start=0,end=info.size-1,status=200;const headers:Record<string,string>={'Content-Type':type,'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'notch://app','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}
   const range=req.headers.get('range')
   if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return missing('Invalid range',416)
    if(!m[1])start=Math.max(0,info.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]))}
    if(start>end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+info.size}})
    status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+info.size}
   headers['Content-Length']=String(Math.max(0,end-start+1));return new Response(info.size&&req.method!=='HEAD'?Readable.toWeb(fs.createReadStream(file,{start,end})) as any:null,{status,headers})
  }catch{return missing('文件已移动或素材已移除') }
 })
}

