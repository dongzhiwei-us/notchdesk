import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
async function run(command,args,env=process.env){return new Promise((res,rej)=>{const c=spawn(command,args,{stdio:'inherit',env});c.on('error',rej);c.on('exit',code=>code===0?res():rej(Error('Process exited '+code)))})}
if(!existsSync('node_modules/electron/path.txt'))await run(process.execPath,[require.resolve('electron/install.js')])
await run(process.execPath,['scripts/build.mjs'])
const env={...process.env,NOTCH_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE
await run(require('electron'),['.'],env)

