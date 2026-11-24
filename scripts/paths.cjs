const path=require('node:path')
const root=path.resolve(__dirname,'..')
const managed=process.platform==='win32' && process.env.XDG_DATA_HOME
const buildDir=process.env.NOTCH_BUILD_DIR || (managed && process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME,'notchdesk','dist') : path.join(root,'dist'))
const artifacts=process.env.NOTCH_ARTIFACTS || (managed ? path.join(managed,'artifacts','notchdesk') : path.join(root,'release'))
module.exports={root,buildDir,artifacts,stageDir:path.join(path.dirname(buildDir),managed?'stage':'out')}

