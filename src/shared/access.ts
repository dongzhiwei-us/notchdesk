import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
export const groups=['workspace','clipboard','files','desktop','administration']
export function groupFor(name:string){
 if(/^(clip_capture|clip_copy|clip_copy_path|clip_copy_text|snippets_copy)$/.test(name))return 'clipboard'
 if(/^(clip_|files\.)/.test(name))return 'files'
 if(/^(ui\.|attention_open|session\.)/.test(name))return 'desktop'
 if(/^(settings\.|locale\.|theme\.|plugins\.|logs\.|accounts\.|shared\.)/.test(name))return 'administration'
 return 'workspace'
}
export function permissions(dir:string):string[]{
 const file=path.join(dir,'mcp-grants.json')
 if(!existsSync(file))return ['workspace','desktop']
 try{return JSON.parse(readFileSync(file,'utf8')).filter((g:string)=>groups.includes(g))}catch{return []}
}
export function setPermissions(dir:string,perms:string[]){
 if(!Array.isArray(perms)||!perms.every(g=>groups.includes(g)))throw Error('无效权限')
 const f=path.join(dir,'mcp-grants.json');writeFileSync(f+'.tmp',JSON.stringify([...new Set(perms)]),{mode:0o600});renameSync(f+'.tmp',f)
 return permissions(dir)
}

