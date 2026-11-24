const path=require('node:path')
const {root,buildDir}=require('./paths.cjs')
const mode=process.argv[2]
if(!['server','mcp'].includes(mode))throw Error('Unknown entry point')
process.env.NOTCH_PLUGINS ||= path.join(root,'plugins')
require(path.join(buildDir,mode+'.cjs'))
