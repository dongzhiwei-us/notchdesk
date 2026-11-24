import path from 'node:path';

export function packageOptions(args,host=process.platform,env=process.env){
  const positional=args.filter(arg=>!arg.startsWith('--'));
  const known=new Set(['--dir','--plan','--signed','--notarize']);
  for(const arg of args.filter(arg=>arg.startsWith('--')))if(!known.has(arg))throw Error('未知打包选项：'+arg);
  if(positional.length>2)throw Error('用法：node scripts/package.mjs <mac|win|dir> <arm64|x64|all> [--dir] [--plan] [--signed] [--notarize]');
  const requested=positional[0]||'dir';
  const platform=requested==='dir'?(host==='darwin'?'mac':'win'):requested==='darwin'?'mac':requested;
  if(!['mac','win'].includes(platform))throw Error('目标平台必须是 mac 或 win。');
  const alias={x86:'x64',intel:'x64',aarch64:'arm64',both:'all'};
  const raw=positional[1]||(requested==='dir'?process.arch:platform==='mac'?'all':process.arch),arch=alias[raw]||raw;
  if(!['arm64','x64','all'].includes(arch))throw Error('目标架构必须是 arm64、x64（Intel 64 位）或 all。');
  const directory=requested==='dir'||args.includes('--dir');
  const signed=args.includes('--signed')||env.NOTCH_MAC_SIGNED==='1';
  const notarize=args.includes('--notarize')||env.NOTCH_MAC_NOTARIZE==='1';
  if(notarize&&!signed)throw Error('公证必须同时开启 --signed 或 NOTCH_MAC_SIGNED=1。');
  if(platform!=='mac'&&(signed||notarize))throw Error('--signed/--notarize 是 macOS 打包选项。');
  return {platform,architectures:arch==='all'?['arm64','x64']:[arch],directory,signed,notarize,plan:args.includes('--plan')};
}

export function requireBuildHost(options,host=process.platform){
  if(options.platform==='mac'&&host!=='darwin')throw Error('macOS DMG/应用签名依赖 macOS 的 hdiutil/codesign，不能在 Windows/Linux 直接制作。请在任意 Mac 运行 npm run dist:mac，或触发 .github/workflows/package.yml 的 mac 构建。Windows 可运行 npm run dist:mac:plan 查看构建计划、npm run prepare:mac 缓存双架构运行时。');
  if(options.platform==='win'&&host!=='win32')throw Error('Windows 安装包请使用 Windows 构建机或 Desktop packages CI 工作流。');
}

export function requireSigning(options,env=process.env){
  if(options.signed&&!env.CSC_LINK&&!env.CSC_NAME&&!env.NOTCH_MAC_IDENTITY)throw Error('签名构建需要 CSC_LINK（证书文件/内容）或 CSC_NAME / NOTCH_MAC_IDENTITY（已安装 Developer ID 身份）。');
  if(options.notarize){
    const appleId=env.APPLE_ID&&env.APPLE_APP_SPECIFIC_PASSWORD&&env.APPLE_TEAM_ID;
    const apiKey=env.APPLE_API_KEY&&env.APPLE_API_KEY_ID&&env.APPLE_API_ISSUER;
    if(!appleId&&!apiKey&&!env.APPLE_KEYCHAIN_PROFILE)throw Error('公证需要完整的 Apple ID、应用专用密码和 Team ID，或 App Store Connect API 凭据，或 APPLE_KEYCHAIN_PROFILE。');
  }
}

export function packagingPlan(options,pkg,artifacts){
  return {host:process.platform,platform:options.platform,signing:options.platform==='mac'?(options.signed?'developer-id':'ad-hoc'):'unsigned',notarize:options.notarize,
    jobs:options.architectures.map(arch=>({arch,nodeVersion:pkg.notchdesk.runtimeNodeVersion,
      nodeAsset:options.platform==='mac'?`node-v${pkg.notchdesk.runtimeNodeVersion}-darwin-${arch}.tar.gz`:`win-${arch}/node.exe`,
      output:path.join(artifacts,`${options.platform}-${arch}`),
      targets:options.directory?['dir']:options.platform==='mac'?['dmg','zip']:['nsis'],
      artifacts:options.directory?[]:(options.platform==='mac'?['dmg','zip']:['exe']).map(ext=>`NotchDesk-${pkg.version}-${options.platform}-${arch}.${ext}`)}))};
}
