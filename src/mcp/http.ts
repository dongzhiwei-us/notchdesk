import {randomUUID,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createToolServer,type McpActions} from './toolServer';

type Session={
  transport:StreamableHTTPServerTransport;
  endpoint:ReturnType<typeof createToolServer>;
  touched:number;
  active:number;
};
function error(response:ServerResponse,status:number,message:string){
  response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  response.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message},id:null}));
}

export class HttpMcp {
  private sessions=new Map<string,Session>();
  private timer:ReturnType<typeof setInterval>;
  constructor(private actions:McpActions,private token:string){
    this.timer=setInterval(()=>{
      for(const session of this.sessions.values()){
        if(session.active===0&&Date.now()-session.touched>30*60*1000)void session.endpoint.server.close().catch(()=>{});
      }
    },60000);
    this.timer.unref();
  }
  async handle(request:IncomingMessage,response:ServerResponse){
    const authority=request.headers.host;
    const port=request.socket.localPort;
    if(authority!==`127.0.0.1:${port}`&&authority!==`localhost:${port}`){error(response,403,'Invalid host');return;}
    const origin=request.headers.origin;
    if(origin){
      let trusted=origin==='notch://app';
      try{const parsed=new URL(origin);trusted ||= ['http:','https:'].includes(parsed.protocol)&&['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.origin===origin;}catch{}
      if(!trusted){error(response,403,'Invalid origin');return;}
      response.setHeader('Access-Control-Allow-Origin',origin);
      response.setHeader('Vary','Origin');
      response.setHeader('Access-Control-Expose-Headers','Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate');
    }
    if(request.method==='OPTIONS'){
      response.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID','Access-Control-Max-Age':'600'});
      response.end();return;
    }
    const supplied=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';
    if(Buffer.byteLength(supplied)!==Buffer.byteLength(this.token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(this.token))){
      response.setHeader('WWW-Authenticate','Bearer realm="notchdesk"');
      error(response,401,'Authentication required');return;
    }
    const id=request.headers['mcp-session-id'];
    if(id!==undefined&&typeof id!=='string'){error(response,400,'Invalid session header');return;}
    let session=id?this.sessions.get(id):undefined;
    if(id&&!session){error(response,404,'Session expired');return;}
    if(!session){
      if(request.method!=='POST'){error(response,400,'Initialize a session first');return;}
      const endpoint=createToolServer(this.actions);
      const transport=new StreamableHTTPServerTransport({
        sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true,
        maxRequestBodySize:64*1024*1024,
        onsessioninitialized:sessionId=>{this.sessions.set(sessionId,session!);}
      });
      session={endpoint,transport,touched:Date.now(),active:0};
      endpoint.server.onclose=()=>{if(transport.sessionId)this.sessions.delete(transport.sessionId);};
      await endpoint.server.connect(transport);
    }
    const current=session;
    current.touched=Date.now();current.active++;
    response.once('close',()=>{
      current.active--;current.touched=Date.now();
      if(!current.transport.sessionId)void current.endpoint.server.close().catch(()=>{});
    });
    try{await current.transport.handleRequest(request,response);}
    catch{
      if(!response.headersSent)error(response,500,'MCP request failed');
      else if(!response.writableEnded)response.end();
    }
  }
  async changed(){
    await Promise.allSettled([...this.sessions.values()].map(session=>session.endpoint.changed()));
  }
  async close(){
    clearInterval(this.timer);
    await Promise.allSettled([...this.sessions.values()].map(session=>session.endpoint.server.close()));
    this.sessions.clear();
  }
}
