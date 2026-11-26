// Real HTTP MCP, SQLite and timed captures, with isolated public-source fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import paths from './paths.cjs';
const require = createRequire(import.meta.url);
const { localDay } = require('../plugins/shared.cjs');
process.env.TZ = 'Asia/Shanghai';
const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true });
const scratch = await fs.mkdtemp(path.join(base, 'trends-archive-'));
const data = path.join(scratch, 'data'), plugins = path.join(scratch, 'plugins'), controlFile = path.join(scratch, 'control.json');
await fs.mkdir(data); await fs.cp(path.join(paths.root, 'plugins'), plugins, { recursive: true });
await build({ entryPoints: [path.join(paths.root, 'plugins/trends/index.cjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(plugins, 'trends/index.cjs'), logLevel: 'warning' });
const timestamp = new Date(2026, 10, 26, 9, 59).getTime(), first = localDay(timestamp), second = localDay(timestamp + 86400000);
let control = { now: timestamp, failGithub: false };
async function configure(patch) { control = { ...control, ...patch }; await fs.writeFile(controlFile, JSON.stringify(control)); }
await configure({});
const preload = path.join(scratch, 'public-fixtures.cjs');
await fs.writeFile(preload, `const fs=require('node:fs');const originalFetch=globalThis.fetch;const clock=()=>JSON.parse(fs.readFileSync(${JSON.stringify(controlFile)},'utf8'));Date.now=()=>clock().now;
globalThis.fetch=async(input,options)=>{const url=String(input);if(!/^https:\\/\\/(github.com|huggingface.co|claude.dev)\\//.test(url))return originalFetch(input,options);
fs.appendFileSync(${JSON.stringify(path.join(scratch, 'requests.txt'))},url+'\\n');
if(url.startsWith('https://github.com/trending')){if(clock().failGithub)throw Error('fixture offline');return new Response('<article class="Box-row"><h2><a href="/public/agent">agent</a></h2><p>A public developer agent with source-linked execution traces.</p><span itemprop="programmingLanguage">TypeScript</span><a href="/public/agent/stargazers">123</a></article>');}
if(url.startsWith('https://huggingface.co/api/models'))return Response.json(Array.from({length:10},(_,index)=>({id:'public/model-'+index,pipeline_tag:'text-generation',library_name:'transformers',likes:5,downloads:100})));
if(url.includes('/raw/main/README.md'))return new Response('---\\nlicense: apache-2.0\\n---\\n# Public model\\n\\nThis model supports developer workflows through structured generation and reliable tool calls.');
if(url==='https://claude.dev/')return new Response(Array.from({length:10},(_,index)=>'<a class="post" href="/blog/article-'+index+'/"><div class="p-title">Developer article '+index+'</div><div class="p-date">Nov 25, 2026</div></a>').join(''));
return new Response('<meta name="description" content="A practical guide to building reliable agents with observable execution and clear verification.">');};`);
let child, client, transport, previousToken, errors = '';
const checks = [];
function pass(message) { checks.push(message); console.log('PASS', message); }
async function start(online = false, directory = data) {
    child = spawn(process.execPath, [...(online ? [] : ['--require', preload]), path.join(paths.buildDir, 'server.cjs')], { env: { ...process.env, TZ: 'Asia/Shanghai', NOTCH_DATA: directory, NOTCH_LOGS: path.join(scratch, 'logs'), NOTCH_PLUGINS: plugins, NOTCH_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', value => { errors = (errors + value).slice(-2000); });
    let descriptor;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode != null) throw Error('Service failed: ' + errors);
        try { const next = JSON.parse(await fs.readFile(path.join(directory, 'connection.json'), 'utf8')); if (next.token !== previousToken) { descriptor = next; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.ok(descriptor, 'service startup timeout'); previousToken = descriptor.token;
    client = new Client({ name: 'trends-archive-verification', version: '1' });
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer ' + descriptor.mcpToken } } });
    await client.connect(transport);
}
async function stop() {
    await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); client = transport = undefined;
    if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } child = undefined;
}
async function call(name, args = {}) { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result.content)); return JSON.parse(result.content[0].text); }
async function waitFor(check) { for (let i = 0; i < 60; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error('Timed capture did not finish'); }
async function requestCount() { return (await fs.readFile(path.join(scratch, 'requests.txt'), 'utf8')).trim().split('\n').length; }
try {
    await start();
    const tools = (await client.listTools()).tools;
    for (const name of ['trends_archive_save', 'trends_archive_list', 'trends_archive_get', 'trends_archive_open']) assert.ok(tools.some(tool => tool.name === name));
    for (const date of ['2026-02-30', '../../escape']) assert.equal((await client.callTool({ name: 'trends_archive_get', arguments: { date } })).isError, true);
    await call('trends_source_add', { provider: 'github', owner: 'private-fixture', repo: 'should-never-export' });
    await new Promise(resolve => setTimeout(resolve, 5200));
    assert.equal((await call('trends_archive_list')).days.length, 0);
    await configure({ now: timestamp + 60000 });
    const saved = await waitFor(async () => { const report = await call('trends_archive_get', { date: first }); return report.found && report; });
    assert.equal(saved.document.partial, false); assert.deepEqual(saved.document.sections.map(section => section.items.length), [1, 10, 10]);
    assert.equal(saved.document.sections[1].items[0].descriptionKind, 'model-card'); assert.equal(saved.document.sections[2].items[0].descriptionKind, 'page-meta');
    const md = await fs.readFile(saved.files.markdown, 'utf8'), json = JSON.parse(await fs.readFile(saved.files.json, 'utf8'));
    assert.equal(json.revision, saved.document.revision); assert.match(md, /\[(?:查看详情|Details)\]/); assert.ok(md.includes('reliable tool calls')); assert.ok(!md.includes('private-fixture'));
    const manifest = JSON.parse(await fs.readFile(saved.files.manifest, 'utf8')); assert.equal(manifest.days[0].date, first);
    pass('daily scheduling, public-only introductions, detail links and Markdown/JSON/index exports work');
    const count = await requestCount();
    const [same, duplicate] = await Promise.all([call('trends_archive_save'), call('trends_archive_save')]);
    assert.equal(same.document.revision, duplicate.document.revision); assert.equal(same.document.revision, saved.document.revision); assert.equal(await requestCount(), count);
    const unknown = await call('trends_archive_get', { date: '2026-11-24' }); assert.equal(unknown.found, false);
    pass('duplicate saves reuse today’s document without network fetches and absent dates stay absent');
    await stop(); await fs.rm(saved.files.markdown);
    const damagedIndex = new DatabaseSync(path.join(data, 'island.sqlite'));
    damagedIndex.prepare('UPDATE kv SET value=? WHERE namespace=? AND key=?').run('[]', 'plugin:trends', 'archiveIndex');
    damagedIndex.prepare('UPDATE kv SET value=? WHERE namespace=? AND key=?').run(JSON.stringify({ revision: 'old', error: 'interrupted export' }), 'plugin:trends', 'archiveExport:' + first);
    damagedIndex.close(); await start();
    const restored = await call('trends_archive_get', { date: first, format: 'markdown' }); assert.equal(restored.content, md); assert.equal(await fs.readFile(saved.files.markdown, 'utf8'), md);
    assert.equal((await call('trends_archive_list')).days[0].date, first);
    pass('SQLite archives survive a service restart and restore missing exported files');
    await configure({ now: timestamp + 86400000 + 120000, failGithub: true });
    const next = await waitFor(async () => { const report = await call('trends_archive_get', { date: second }); return report.found && report; });
    assert.equal(next.document.partial, true); assert.equal(next.document.sections[0].status, 'stale');
    assert.equal(localDay(next.document.sections[0].fetchedAt), first); assert.equal(await fs.readFile(saved.files.markdown, 'utf8'), md);
    const beforeRetry = await requestCount(); await new Promise(resolve => setTimeout(resolve, 5200)); assert.equal(await requestCount(), beforeRetry);
    await configure({ now: control.now + 31 * 60000, failGithub: false });
    const repaired = await waitFor(async () => { const report = await call('trends_archive_get', { date: second }); return report.found && !report.document.partial && report; });
    assert.ok(repaired.document.sections.every(section => section.status === 'fresh')); assert.equal((await call('trends_archive_list')).days.length, 2);
    await configure({ failGithub: true });
    const failure = await call('trends_archive_save', { force: true }); assert.equal(failure.document.sections[0].status, 'retained'); assert.deepEqual(failure.document.sections[0].items, repaired.document.sections[0].items);
    pass('new days preserve old documents, mark stale dates, throttle failures and retain successful sections');
    const { validDay, markdown } = require('../plugins/trends/archive.cjs'); assert.throws(() => validDay('2026-04-31'));
    const escaped = markdown({ ...saved.document, sections: [{ ...saved.document.sections[0], items: [{ title: '<script>Bad</script>', description: '![tracking](https://bad.invalid/x.png)', url: 'javascript:alert(1)' }] }] });
    assert.ok(!escaped.includes('<script>')); assert.ok(!escaped.includes('](javascript:')); assert.ok(escaped.includes('\\!\\['));
    pass('exported documents escape active markup and reject invalid dates or unsafe detail links');
    if (process.argv.includes('--online')) {
        await stop();
        const onlineData = path.join(scratch, 'online-data'); await fs.mkdir(onlineData);
        const manifestFile = path.join(plugins, 'trends/manifest.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.settings.archiveEnabled.default = false; await fs.writeFile(manifestFile, JSON.stringify(manifest));
        await start(true, onlineData);
        const actual = await call('trends_archive_save', { force: true });
        assert.equal(actual.document.partial, false, JSON.stringify(actual.document.sections.map(section => ({ source: section.source, error: section.error }))));
        assert.ok(actual.document.sections.every(section => section.items.length > 0));
        console.log('Live daily document:', actual.files.markdown);
        pass('real public sources produce a daily document with descriptions and detail links');
    }
} finally { await stop(); await fs.writeFile(path.join(scratch, 'verification.json'), JSON.stringify({ checks, passed: checks.length >= 5 }, null, 2)); console.log('Verification files:', scratch); }
