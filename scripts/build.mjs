import {build} from 'esbuild'
import {build as vite} from 'vite'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import paths from './paths.cjs'
const {root,buildDir}=paths;process.chdir(root)
await fs.mkdir(buildDir,{recursive:true})
const targets={'main':'src/main/index.ts','preload':'src/main/preload.ts','server':'src/server/index.ts','mcp':'src/mcp/index.ts'}
await Promise.all(Object.entries(targets).map(([name,input])=>build({entryPoints:[input],outfile:path.join(buildDir,name+'.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],logLevel:'warning'})))
await vite({configFile:false,root,base:'./',esbuild:{jsx:'automatic'},build:{outDir:path.join(buildDir,'ui'),emptyOutDir:true,reportCompressedSize:false}})
await fs.copyFile('assets/icon.png',path.join(buildDir,'icon.png'))


for (const directory of ['cmaps', 'standard_fonts', 'wasm']) await fs.cp(path.join(root,'node_modules/pdfjs-dist',directory),path.join(buildDir,'ui/pdf-data',directory),{recursive:true})

await fs.copyFile('src/main/windows-blur.ps1',path.join(buildDir,'windows-blur.ps1'))
await fs.copyFile('src/main/windows-focus.ps1',path.join(buildDir,'windows-focus.ps1'))
