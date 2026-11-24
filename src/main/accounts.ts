import { shell,safeStorage } from 'electron'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { randomBytes,createHash } from 'node:crypto'

type Provider='github'|'gitlab'
type Account={provider:Provider,host:string,token:string}
const providers=['github','gitlab']
export function accountBroker(dir:string,update:()=>void){
 const vault=path.join(dir,'accounts.enc')
 const oauthVault=path.join(dir,'oauth-apps.enc')
 type OAuthApp={clientId:string;clientSecret?:string}
 const oauthApps=():Record<string,OAuthApp>=>fs.existsSync(oauthVault)?JSON.parse(safeStorage.decryptString(fs.readFileSync(oauthVault))):{}
 const options=()=>Object.fromEntries(providers.map(provider=>{
  const app=oauthApps()[provider]
  return [provider,{clientId:app?.clientId||process.env['NOTCH_'+provider.toUpperCase()+'_CLIENT_ID']||'',hasSecret:!!(app?.clientSecret||process.env['NOTCH_'+provider.toUpperCase()+'_CLIENT_SECRET'])}]
 }))
 let connecting=false
 const load=():Account[]=>fs.existsSync(vault)?JSON.parse(safeStorage.decryptString(fs.readFileSync(vault))):[]
 function store(list:Account[]){if(!safeStorage.isEncryptionAvailable())throw Error('系统凭据加密服务不可用');fs.writeFileSync(vault+'.tmp',safeStorage.encryptString(JSON.stringify(list)),{mode:0o600});fs.renameSync(vault+'.tmp',vault);update()}
 function host(p:Provider,input?:string){if(!providers.includes(p))throw Error('账号类型无效');const uri=new URL(p==='github'?'https://github.com':input||'https://gitlab.com');if(uri.protocol!=='https:'||uri.username||uri.password)throw Error('请输入受信任的 HTTPS 实例地址');return uri.origin}
 const list=()=>load().map(({provider,host})=>({provider,host,connected:true}))
 async function api(a:Account,route:string,query?:Record<string,string>){
   if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\\\r\n]/.test(route))throw Error('无效的 API 路径')
   const base=a.provider==='github'?'https://api.github.com':a.host+'/api/v4'
   const u=new URL(base+route);if(u.origin!==new URL(base).origin)throw Error('无效的来源')
   for(const [k,v] of Object.entries(query||{}))u.searchParams.set(k,String(v))
   const r=await fetch(u,{headers:{authorization:'Bearer '+a.token,'user-agent':'NotchDesk/0.1','accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(14000)})
   if(!r.ok)throw Error(a.provider+' API '+r.status)
   return r.json()
 }
 async function save(p:any){const a:Account={provider:p.provider,host:host(p.provider,p.host),token:String(p.token||'').trim()};if(!a.token)throw Error('请输入访问令牌');await api(a,'/user');store([...load().filter(e=>e.provider!==a.provider),a]);return list()}
 async function connectOAuth(p:any){
   const provider:Provider=p.provider, origin=host(provider,p.host)
   const saved=oauthApps()[provider]
   const clientId=p.clientId||saved?.clientId||process.env['NOTCH_'+provider.toUpperCase()+'_CLIENT_ID']
   const clientSecret=p.clientSecret||saved?.clientSecret||process.env['NOTCH_'+provider.toUpperCase()+'_CLIENT_SECRET']
   if(!clientId)throw Error('请配置 OAuth Client ID，或使用只读访问令牌连接')
   if(provider==='github'&&!clientSecret)throw Error('GitHub OAuth requires the app Client Secret')
   if(!safeStorage.isEncryptionAvailable())throw Error('系统凭据加密服务不可用')
   fs.writeFileSync(oauthVault+'.tmp',safeStorage.encryptString(JSON.stringify({...oauthApps(),[provider]:{clientId,clientSecret}})),{mode:0o600});fs.renameSync(oauthVault+'.tmp',oauthVault)
   const state=randomBytes(24).toString('hex'), verifier=randomBytes(48).toString('base64url'), challenge=createHash('sha256').update(verifier).digest('base64url')
   const callback=http.createServer();await new Promise<void>((res,rej)=>{callback.once('error',rej);callback.listen(Number(process.env.NOTCH_OAUTH_PORT||49317),'127.0.0.1',res)})
   const addr=callback.address() as {port:number};const redirect='http://127.0.0.1:'+addr.port+'/callback'
   let timer:ReturnType<typeof setTimeout>|undefined
   try{
    const result=new Promise<string>((res,rej)=>{
      timer=setTimeout(()=>rej(Error('账号授权已超时')),180000)
      callback.on('request',(req,reply)=>{const url=new URL(req.url||'/',redirect)
       if(url.pathname!=='/callback'||url.searchParams.get('state')!==state){reply.writeHead(400).end();return}
       const code=url.searchParams.get('code');reply.writeHead(200,{'content-type':'text/plain;charset=utf-8'}).end('可以返回悬屿。');if(code)res(code);else rej(Error('授权已取消'))
      })
    })
    const login=new URL(provider==='github'?'/login/oauth/authorize':'/oauth/authorize',origin)
    login.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:provider==='github'?'read:user':'read_api',state,code_challenge:challenge,code_challenge_method:'S256'}).toString()
    await shell.openExternal(login.href);const code=await result
    const form=new URLSearchParams({client_id:clientId,code,redirect_uri:redirect,code_verifier:verifier,grant_type:'authorization_code'})
    if(clientSecret)form.set('client_secret',clientSecret)
    const response=await fetch(new URL(provider==='github'?'/login/oauth/access_token':'/oauth/token',origin),{method:'POST',headers:{accept:'application/json'},body:form,signal:AbortSignal.timeout(20000)})
    const data=await response.json() as any;if(!response.ok||!data.access_token)throw Error('平台授权未完成，请检查 OAuth 注册的回调地址与客户端类型')
    return await save({provider,host:origin,token:data.access_token})
   }finally{clearTimeout(timer);callback.close()}
 }
 async function connect(p:any){if(connecting)throw Error('Authorization is already in progress');connecting=true;try{return await connectOAuth(p)}finally{connecting=false}}
 return {list,save,connect,options,disconnect:(provider:string)=>{store(load().filter(a=>a.provider!==provider));return list()},fetch:(p:any)=>{const a=load().find(x=>x.provider===p.provider);if(!a)throw Error('此账号尚未连接');return api(a,p.path,p.query)}}
}

