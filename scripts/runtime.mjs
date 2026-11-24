import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import paths from './paths.cjs';
import {packageOptions} from './package-options.mjs';
import {homedir} from 'node:os';

export const runtimeCache=process.env.NOTCH_RUNTIME_CACHE||path.join(process.env.XDG_CACHE_HOME||path.join(homedir(),process.platform==='darwin'?'Library/Caches':'.cache'),'notchdesk','runtimes');
export async function sha256(file){
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export async function inspectRuntime(file,platform,arch){
  const handle=await fs.open(file,'r');
  try{
    const header=Buffer.alloc(64);await handle.read(header,0,64,0);
    if(platform==='mac'){
      if(header.readUInt32LE(0)!==0xfeedfacf||header.readUInt32LE(4)!==(arch==='arm64'?0x0100000c:0x01000007))throw Error('Node Mach-O 架构不匹配：'+arch);
      return {format:'Mach-O',arch};
    }
    if(header.toString('ascii',0,2)!=='MZ')throw Error('Node 不是 Windows PE 文件。');
    const pe=Buffer.alloc(6);await handle.read(pe,0,6,header.readUInt32LE(0x3c));
    if(pe.toString('ascii',0,4)!=='PE\0\0'||pe.readUInt16LE(4)!==(arch==='arm64'?0xaa64:0x8664))throw Error('Node PE 架构不匹配：'+arch);
    return {format:'PE',arch};
  }finally{await handle.close();}
}

export async function ensureRuntime(platform,arch,version){
  if(!['mac','win'].includes(platform)||!['arm64','x64'].includes(arch)||!/^24\.(?:1[3-9]|[2-9]\d|\d{3,})\.\d+$/.test(version))throw Error('打包运行时必须使用 Node 24.13+ 的明确版本和 x64/arm64 架构。');
  const folder=path.join(runtimeCache,`node-v${version}-${platform}-${arch}`),file=path.join(folder,platform==='mac'?'node':'node.exe');
  try{
    const meta=JSON.parse(await fs.readFile(path.join(folder,'runtime.json'),'utf8'));
    if(meta.version===version&&meta.platform===platform&&meta.arch===arch&&meta.sha256===await sha256(file)&&meta.licenseSha256===await sha256(path.join(folder,'LICENSE'))){
      await inspectRuntime(file,platform,arch);await fs.chmod(file,0o755);return {...meta,file};
    }
  }catch{}
  await fs.mkdir(runtimeCache,{recursive:true});
  const asset=platform==='mac'?`node-v${version}-darwin-${arch}.tar.gz`:`win-${arch}/node.exe`;
  const official=`https://nodejs.org/dist/v${version}/`;
  const mirror=process.env.NOTCH_NODE_MIRROR;
  if(mirror&&new URL(mirror).protocol!=='https:')throw Error('NOTCH_NODE_MIRROR 必须使用 HTTPS。');
  const stage=await fs.mkdtemp(path.join(runtimeCache,'download-'));
  try{
    const sums=await fetch(official+'SHASUMS256.txt',{signal:AbortSignal.timeout(60000)});
    if(!sums.ok)throw Error(`无法读取 Node ${version} 官方校验清单：HTTP ${sums.status}`);
    const line=(await sums.text()).split(/\r?\n/).find(line=>line.trim().split(/\s+/)[1]===asset);
    const archiveSha256=line?.trim().split(/\s+/)[0];
    if(!archiveSha256||!/^[a-f\d]{64}$/.test(archiveSha256))throw Error('官方校验清单没有目标运行时：'+asset);
    console.log(`Downloading Node ${version} ${platform}/${arch}`);
    const response=await fetch((mirror?mirror.replace(/\/?$/,'/')+`v${version}/`:official)+asset,{signal:AbortSignal.timeout(300000)});
    if(!response.ok||!response.body)throw Error('运行时下载失败：HTTP '+response.status);
    const archive=path.join(stage,platform==='mac'?'node.tar.gz':'node.exe');
    await pipeline(Readable.fromWeb(response.body),createWriteStream(archive,{flags:'wx'}));
    if(await sha256(archive)!==archiveSha256)throw Error('Node 官方 SHA-256 校验不匹配。');
    const extracted=path.join(stage,platform==='mac'?'node':'node.exe');
    if(platform==='mac'){
      const extractedResult=spawnSync('tar',['-xzf',archive,'-C',stage,'--strip-components=2',`node-v${version}-darwin-${arch}/bin/node`],{stdio:'pipe',windowsHide:true});
      if(extractedResult.error)throw extractedResult.error;
      if(extractedResult.status!==0)throw Error('tar 解包 Node 失败：'+extractedResult.stderr.toString().slice(0,500));
      const licenseResult=spawnSync('tar',['-xzf',archive,'-C',stage,'--strip-components=1',`node-v${version}-darwin-${arch}/LICENSE`],{stdio:'pipe',windowsHide:true});
      if(licenseResult.error)throw licenseResult.error;
      if(licenseResult.status!==0)throw Error('无法提取 Node LICENSE。');
    }else{
      const license=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`,{signal:AbortSignal.timeout(60000)});
      if(!license.ok)throw Error('无法取得 Node 官方 LICENSE。');
      await fs.writeFile(path.join(stage,'LICENSE'),await license.text());
    }
    await inspectRuntime(extracted,platform,arch);
    await fs.mkdir(folder,{recursive:true});
    const temporary=path.join(folder,'node-'+randomUUID());await fs.copyFile(extracted,temporary);await fs.chmod(temporary,0o755);await fs.rename(temporary,file);
    await fs.copyFile(path.join(stage,'LICENSE'),path.join(folder,'LICENSE'));
    const meta={version,platform,arch,asset,archiveSha256,sha256:await sha256(file),licenseSha256:await sha256(path.join(folder,'LICENSE'))};
    await fs.writeFile(path.join(folder,'runtime.json'),JSON.stringify(meta,null,2)+'\n');
    return {...meta,file};
  }finally{
    const relative=path.relative(path.resolve(runtimeCache),path.resolve(stage));
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('运行时临时目录超出缓存范围。');
    await fs.rm(stage,{recursive:true,force:true,maxRetries:3});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=packageOptions(process.argv.slice(2));const pkg=JSON.parse(await fs.readFile(path.join(paths.root,'package.json'),'utf8'));
  for(const arch of options.architectures){const info=await ensureRuntime(options.platform,arch,pkg.notchdesk.runtimeNodeVersion);console.log(JSON.stringify({arch,file:info.file,sha256:info.sha256}));}
}
