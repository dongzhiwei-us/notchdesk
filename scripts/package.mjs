import path from 'node:path'
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {build as bundle} from 'esbuild'
import {packageOptions,requireBuildHost,requireSigning,packagingPlan} from './package-options.mjs'
import {ensureRuntime,inspectRuntime,sha256} from './runtime.mjs'
import paths from './paths.cjs'

const require=createRequire(import.meta.url)
const options=packageOptions(process.argv.slice(2)),isMac=options.platform==='mac'
const pkg=JSON.parse(await fs.readFile(path.join(paths.root,'package.json'),'utf8'))
const plan=packagingPlan(options,pkg,paths.artifacts)
if(options.plan){console.log(JSON.stringify(plan,null,2));process.exit(0)}
requireBuildHost(options);requireSigning(options)
process.chdir(paths.root)
if(process.platform==='win32'&&process.env.XDG_CACHE_HOME){
  const temp=path.join(path.dirname(process.env.XDG_CACHE_HOME),'temp','notchdesk-build')
  await fs.mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp
  process.env.ELECTRON_BUILDER_CACHE??=path.join(process.env.XDG_CACHE_HOME,'electron-builder')
  if(process.env.ELECTRON_MIRROR?.startsWith('https://npmmirror.com/'))process.env.ELECTRON_BUILDER_BINARIES_MIRROR??='https://npmmirror.com/mirrors/electron-builder-binaries/'
}
const {build,Platform,Arch}=await import('electron-builder')
function run(script){const r=spawnSync(process.execPath,[script],{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error(`构建脚本失败：${script} (${r.status})`)}
// Reuse an installed Electron only for a native Windows target. Mac targets are
// downloaded by electron-builder for the requested CPU, not the host CPU.
const nativeWindows=!isMac&&options.architectures.includes(process.arch)
if(nativeWindows)run(require.resolve('electron/install.js'))
run('scripts/build.mjs')
await fs.mkdir(paths.stageDir,{recursive:true})
const stage=await fs.mkdtemp(path.join(paths.stageDir,`stage-${options.platform}-`))
try{
  const appDir=path.join(stage,'app'),pluginDir=path.join(stage,'plugins')
  await fs.mkdir(path.join(appDir,'dist'),{recursive:true})
  await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,author:pkg.author,main:'dist/main.cjs'}))
  for(const file of ['main.cjs','preload.cjs','icon.png','ui'])await fs.cp(path.join(paths.buildDir,file),path.join(appDir,'dist',file),{recursive:true})
  for(const dirent of await fs.readdir('plugins',{withFileTypes:true})){
    if(!dirent.isDirectory()||dirent.name.startsWith('.')||dirent.name==='node_modules')continue
    const folder=path.join('plugins',dirent.name)
    let manifest
    try{manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'))}catch(error){if(error.code==='ENOENT')continue;throw error}
    const entry=manifest.entry||'index.cjs',resolvedEntry=path.resolve(folder,entry)
    if(!resolvedEntry.startsWith(path.resolve(folder)+path.sep))throw Error('插件入口超出目录 '+dirent.name)
    const output=path.join(pluginDir,dirent.name);await fs.cp(folder,output,{recursive:true})
    await bundle({entryPoints:[resolvedEntry],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:path.join(output,entry),logLevel:'warning'})
  }
  const winIcon=path.join(paths.root,'assets/icon.ico'),macIcon=path.join(paths.root,'assets/icon.png')
  for(const arch of options.architectures){
    const runtime=await ensureRuntime(options.platform,arch,pkg.notchdesk.runtimeNodeVersion)
    const output=path.join(paths.artifacts,`${options.platform}-${arch}`)
    const targets=options.directory?['dir']:isMac?['dmg','zip']:['nsis']
    const mac={category:'public.app-category.productivity',icon:macIcon,type:'distribution',
      identity:options.signed?(process.env.NOTCH_MAC_IDENTITY||process.env.CSC_NAME):'-',
      hardenedRuntime:options.signed,notarize:options.notarize,
      entitlements:path.join(paths.root,'assets/entitlements.mac.plist'),entitlementsInherit:path.join(paths.root,'assets/entitlements.mac.plist'),
      binaries:['Contents/Resources/runtime/node']}
    const artifacts=await build({projectDir:appDir,targets:(isMac?Platform.MAC:Platform.WINDOWS).createTarget(targets,arch==='arm64'?Arch.arm64:Arch.x64),publish:'never',config:{
      appId:'dev.notchdesk.desktop',productName:'NotchDesk',electronVersion:pkg.devDependencies.electron,
      ...(!isMac&&arch===process.arch?{electronDist:path.join(paths.root,'node_modules/electron/dist')}:{}),
      directories:{output},npmRebuild:false,asar:true,files:['dist/**','package.json'],
      ...(isMac?{forceCodeSigning:options.signed}:{}),
      extraResources:[
        {from:runtime.file,to:`runtime/${isMac?'node':'node.exe'}`},
        {from:path.join(path.dirname(runtime.file),'LICENSE'),to:'runtime/LICENSE'},
        {from:path.join(path.dirname(runtime.file),'runtime.json'),to:'runtime/runtime.json'},
        {from:pluginDir,to:'plugins'},
        ...(!isMac?['windows-blur.ps1','windows-focus.ps1'].map(file=>({from:path.join(paths.buildDir,file),to:`native/${file}`})):[]),
        ...['server','mcp'].map(name=>({from:path.join(paths.buildDir,`${name}.cjs`),to:`service/${name}.cjs`}))
      ],
      artifactName:'NotchDesk-${version}-${os}-${arch}.${ext}',
      win:{icon:winIcon,signExecutable:false},nsis:{oneClick:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,installerIcon:winIcon},
      mac,dmg:{title:`NotchDesk ${pkg.version} ${arch}`},
      afterPack:async context=>{
        const root=isMac?path.join(context.appOutDir,'NotchDesk.app','Contents'):context.appOutDir
        const bundledNode=path.join(root,isMac?'Resources':'resources','runtime',isMac?'node':'node.exe')
        if(isMac)await fs.chmod(bundledNode,0o755)
        await inspectRuntime(bundledNode,options.platform,arch)
        await inspectRuntime(path.join(root,isMac?'MacOS/NotchDesk':'NotchDesk.exe'),options.platform,arch)
      }
    }})
    const files=[]
    for(const file of [...new Set(artifacts)]){const stat=await fs.stat(file);if(stat.isFile())files.push({name:path.basename(file),size:stat.size,sha256:await sha256(file)})}
    const metadata={version:pkg.version,platform:options.platform,arch,electronVersion:pkg.devDependencies.electron,nodeVersion:runtime.version,nodeAsset:runtime.asset,nodeArchiveSha256:runtime.archiveSha256,signing:isMac?(options.signed?'developer-id':'ad-hoc'):'unsigned',notarizeRequested:options.notarize,files}
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(metadata,null,2)+'\n')
    await fs.writeFile(path.join(output,'SHA256SUMS.txt'),files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n')
    console.log(`Packaged ${options.platform}/${arch}: ${output}`)
  }
}finally{
  const relative=path.relative(path.resolve(paths.stageDir),path.resolve(stage))
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('构建临时目录超出工作范围。')
  await fs.rm(stage,{recursive:true,force:true,maxRetries:3,retryDelay:100})
}
