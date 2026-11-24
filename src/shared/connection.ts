import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'

export const DEFAULT_SERVICE_PORT=49318

export function dataHome() {
  return process.env.NOTCH_DATA || path.join(process.platform === 'win32' ? (process.env.XDG_DATA_HOME || process.env.APPDATA || os.homedir()) : path.join(os.homedir(), 'Library/Application Support'), 'NotchDesk')
}
export type Connection = { port: number; token: string; mcpToken?:string; rendererToken?:string }
export async function descriptor(data: string): Promise<Connection> {
  const value = JSON.parse(await fs.readFile(path.join(data, 'connection.json'), 'utf8'))
  if (!Number.isInteger(value.port) || !value.token) throw Error('Invalid service descriptor')
  return value
}
export async function rpc(c: Connection, method: string, params: any = {}, origin='desktop') {
  const res = await fetch('http://127.0.0.1:'+c.port+'/rpc', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.token},body:JSON.stringify({method,params,origin}),signal:AbortSignal.timeout(60000)})
  const packet = await res.json() as any
  if (!res.ok || packet.error) throw Object.assign(Error(packet.error?.message || ('Service error '+res.status)),{code:packet.error?.code})
  return packet.result
}
const wait = (n:number)=>new Promise(r=>setTimeout(r,n))
export async function connectService(data:string, plugins:string, executable:string, entry:string) {
  async function probe() {const c=await descriptor(data);await rpc(c,'tools.list');return c}
  try {return await probe()} catch {}
  await fs.mkdir(data,{recursive:true})
  const child=spawn(executable,[entry],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,NOTCH_DATA:data,NOTCH_PLUGINS:plugins,NOTCH_LOGS:process.env.NOTCH_LOGS || (!process.env.NOTCH_DATA && process.platform==='win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME,'../logs/notchdesk') : path.join(data,'logs'))}})
  let failure:Error|undefined;child.on('error',e=>failure=e); child.unref()
  for(let i=0;i<100;i++){if(failure)throw failure;await wait(100);try{return await probe()}catch{}}
  throw Error('悬屿服务未能启动，请查看数据目录中的日志。')
}
export async function watch(c:Connection, receive:(event:{type:string,payload:any})=>void, signal:AbortSignal) {
  const response=await fetch('http://127.0.0.1:'+c.port+'/events',{headers:{authorization:'Bearer '+c.token},signal})
  if (!response.ok || !response.body)throw Error('Event stream is offline')
  const decoder=new TextDecoder();let buffer=''
  for await(const chunk of response.body as any){
    buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'')
    let end:number
    while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data)receive(JSON.parse(data))}
  }
}

