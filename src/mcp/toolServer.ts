import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {version} from '../../package.json';

export interface McpActions {
  list():Promise<any[]>;
  invoke(method:string,params:Record<string,unknown>):Promise<unknown>;
}

export function createToolServer(actions:McpActions){
  const server=new Server({name:'notchdesk',version},{capabilities:{tools:{listChanged:true}}});
  let signature:string|undefined;
  async function tools(){
    return (await actions.list()).map(tool=>({
      name:tool.name.replaceAll('.','_'),rpcName:tool.name,
      description:tool.description,
      inputSchema:tool.inputSchema||{type:'object',properties:{}}
    }));
  }
  const fingerprint=(list:Awaited<ReturnType<typeof tools>>)=>JSON.stringify([...list].sort((a,b)=>a.name.localeCompare(b.name)));
  server.setRequestHandler(ListToolsRequestSchema,async()=>{
    const list=await tools();signature=fingerprint(list);
    return {tools:list.map(({rpcName,...tool})=>tool)};
  });
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try{
      const tool=(await tools()).find(tool=>tool.name===request.params.name);
      if(!tool)throw Error('工具不可用或未授权');
      const result=await actions.invoke(tool.rpcName,request.params.arguments||{});
      return {content:[{type:'text' as const,text:JSON.stringify(result??null)}]};
    }catch(error){
      return {isError:true,content:[{type:'text' as const,text:(error as Error).message}]};
    }
  });
  async function changed(){
    const next=fingerprint(await tools());
    const notify=signature!==undefined&&signature!==next;
    signature=next;
    if(notify)await server.sendToolListChanged();
  }
  return {server,changed};
}
