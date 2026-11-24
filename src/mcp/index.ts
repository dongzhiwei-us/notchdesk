import path from 'node:path';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {connectService,dataHome,rpc,watch} from '../shared/connection';
import {permissions,groupFor} from '../shared/access';
import {createToolServer} from './toolServer';

async function main(){
  const directory=dataHome(),plugins=process.env.NOTCH_PLUGINS||path.resolve(__dirname,'../plugins');
  async function connect(){
    const connection=await connectService(directory,plugins,process.execPath,path.join(__dirname,'server.cjs'));
    if(!connection.mcpToken)throw Error('服务需要更新');
    return {...connection,token:connection.mcpToken};
  }
  let connection=await connect();
  const endpoint=createToolServer({
    list:async()=>{
      let definitions:any[];
      try{definitions=await rpc(connection,'tools.list');}
      catch{connection=await connect();definitions=await rpc(connection,'tools.list');}
      const granted=permissions(directory);
      return definitions.filter(tool=>granted.includes(groupFor(tool.name))&&!['clip_resolve','native.reply'].includes(tool.name)&&!tool.name.startsWith('host.'));
    },
    invoke:(method,params)=>rpc(connection,method,params,'mcp')
  });
  const abort=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  endpoint.server.onclose=()=>{abort.abort();clearTimeout(timer);};
  await endpoint.server.connect(new StdioServerTransport());
  void watch(connection,event=>{
    if(event.type!=='changed'&&event.type!=='plugins.changed')return;
    clearTimeout(timer);
    timer=setTimeout(()=>{void endpoint.changed().catch(()=>{});},160);
  },abort.signal).catch(()=>{});
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
