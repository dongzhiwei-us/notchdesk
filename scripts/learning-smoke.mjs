// Uses an isolated service/database. Never opens Electron or production data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import paths from './paths.cjs';
const require = createRequire(import.meta.url);
const { parseModels, parseBlogs, loadFeed } = require('../plugins/trends/feeds.cjs');
const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true });
const scratch = await fs.mkdtemp(path.join(base, 'learning-'));
const data = path.join(scratch, 'data'), plugins = path.join(scratch, 'plugins');
await fs.mkdir(data); await fs.cp(path.join(paths.root, 'plugins'), plugins, { recursive: true });
// Match the package script: built-in plugins must run outside the source tree,
// with their dependencies bundled rather than relying on a nearby node_modules.
for (const plugin of ['trends', 'vocabulary']) await build({ entryPoints: [path.join(paths.root, 'plugins', plugin, 'index.cjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(plugins, plugin, 'index.cjs'), logLevel: 'warning' });
const legacy = { id: 'legacy-word', word: 'idempotent', meaning: '幂等', example: 'A custom sentence must survive this upgrade.', reviewAt: 0, reviewCount: 3, intervalDays: 2, createdAt: 1, updatedAt: 1 };
const seed = new DatabaseSync(path.join(data, 'island.sqlite'));
seed.exec('CREATE TABLE kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)) STRICT');
seed.prepare('INSERT INTO kv VALUES (?,?,?)').run('plugin:vocabulary', 'rows', JSON.stringify([legacy])); seed.close();
let child, client, transport, previousToken, errors = '';
const checks = [];
function pass(message) { checks.push(message); console.log('PASS', message); }
async function start() {
    child = spawn(process.execPath, [path.join(paths.buildDir, 'server.cjs')], { env: { ...process.env, NOTCH_DATA: data, NOTCH_LOGS: path.join(scratch, 'logs'), NOTCH_PLUGINS: plugins, NOTCH_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', value => { errors = (errors + value).slice(-2000); });
    let descriptor;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode != null) throw Error('Isolated service failed: ' + errors);
        try { const next = JSON.parse(await fs.readFile(path.join(data, 'connection.json'), 'utf8')); if (next.token !== previousToken) { descriptor = next; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.ok(descriptor, 'service startup timed out'); previousToken = descriptor.token;
    client = new Client({ name: 'learning-verification', version: '1' });
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer ' + descriptor.mcpToken } } });
    await client.connect(transport);
}
async function stop() {
    await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); client = transport = undefined;
    if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } child = undefined;
}
async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result.content)); return JSON.parse(result.content[0].text);
}
try {
    await start();
    const tools = (await client.listTools()).tools;
    for (const name of ['vocabulary_explore', 'vocabulary_favorite', 'trends_feed_list']) assert.ok(tools.some(tool => tool.name === name));
    const old = (await call('vocabulary_list')).favorites.find(word => word.id === legacy.id);
    assert.equal(old.reviewCount, 3); assert.equal(old.examples[0].text, legacy.example); assert.ok(old.phonetic); assert.ok(old.examples.length >= 2);
    pass('legacy words retain IDs, custom examples and review history, with enriched phonetics');
    const explored = new Set();
    for (let i = 0; i < 19; i++) {
        const { item } = await call('vocabulary_explore', { next: true });
        assert.ok(item.phonetic && item.meaning && item.examples.length >= 2); assert.equal(item.favorite, false); assert.ok(!explored.has(item.id)); explored.add(item.id);
    }
    const current = (await call('vocabulary_explore')).item;
    assert.equal((await call('vocabulary_explore')).item.id, current.id);
    await call('vocabulary_favorite', { id: current.id, favorite: true });
    assert.notEqual((await call('vocabulary_explore')).item.id, current.id);
    assert.equal((await call('vocabulary_review', { id: current.id, result: 'good' })).reviewCount, 1);
    assert.ok(!(await call('vocabulary_list')).due.some(word => word.id === current.id));
    assert.equal((await client.callTool({ name: 'vocabulary_add', arguments: { word: 'incomplete', meaning: 'missing details' } })).isError, true);
    const custom = await call('vocabulary_add', { word: 'resilience', phonetic: '/rɪˈzɪliəns/', meaning: '韧性', examples: [{ text: 'Retries improve resilience.' }, { text: 'We test resilience under load.' }] });
    pass('exploration excludes favorites and repeats; MCP validates complete entries and grades favorites');
    await stop(); await start();
    const restored = await call('vocabulary_list');
    assert.ok(restored.favorites.some(word => word.id === custom.id));
    assert.equal(restored.favorites.find(word => word.id === current.id).reviewCount, 1);
    await call('vocabulary_favorite', { id: current.id, favorite: false });
    assert.ok(!(await call('vocabulary_list')).favorites.some(word => word.id === current.id));
    pass('favorites, new word content and review progress survive a real SQLite/service restart');
    const models = Array.from({ length: 12 }, (_, index) => ({ id: 'org/model-' + index, likes: index, downloads: 100, trendingScore: 20 - index, pipeline_tag: 'text-generation' }));
    assert.equal(parseModels(models).length, 10);
    assert.throws(() => parseModels([{ id: 'javascript:bad' }]), /Hugging Face/);
    const html = Array.from({ length: 12 }, (_, index) => `<a class="post" href="/blog/article-${index}/"><div class="p-title">Article ${index} &amp; AI</div><div class="p-date">Nov ${index + 1}, 2026</div><div class="p-time">5 min</div></a>`).join('') + '<a href="https://attacker.invalid/blog/escape/"><h2>Ignore this</h2></a>';
    const parsed = parseBlogs(html); assert.equal(parsed.length, 10); assert.equal(parsed[0].date, '2026-11-12'); assert.equal(parsed[0].title, 'Article 11 & AI');
    const actions = new Map(), cache = new Map();
    require('../plugins/trends/index.cjs').activate({ action: (name, description, schema, run) => actions.set(name, run), store: { get: (key, fallback) => cache.get(key) ?? fallback, set: (key, value) => cache.set(key, value) }, config: () => ({}), log() {} });
    const originalFetch = globalThis.fetch; let requests = 0;
    try {
        globalThis.fetch = async url => { requests++; return new Response(String(url).includes('huggingface') ? JSON.stringify(models) : html); };
        const feed = actions.get('trends_feed_list');
        const [hf, shared] = await Promise.all([feed({ source: 'huggingface' }), feed({ source: 'huggingface' })]);
        assert.equal(requests, 1); assert.deepEqual(hf, shared); assert.equal(hf.items.length, 10);
        await feed({ source: 'huggingface' }); assert.equal(requests, 1);
        const blog = await feed({ source: 'claude' }); assert.equal(blog.items.length, 10); assert.equal(requests, 2);
        globalThis.fetch = async () => { throw Error('offline'); };
        const stale = await feed({ source: 'huggingface', force: true }); assert.equal(stale.stale, true); assert.deepEqual(stale.items, hf.items);
        assert.equal((await feed({ source: 'claude', force: true })).items[0].date, '2026-11-12');
    } finally { globalThis.fetch = originalFetch; }
    pass('source parsing, top-ten limits, concurrent request sharing and independent stale caches work');
    if (process.argv.includes('--online')) {
        const feeds = await Promise.all(['huggingface', 'claude'].map(loadFeed));
        for (const feed of feeds) { assert.equal(feed.items.length, 10); assert.ok(feed.items.every(item => item.url.startsWith('https://'))); }
        await fs.writeFile(path.join(scratch, 'online-sources.json'), JSON.stringify(feeds, null, 2));
        pass('live Hugging Face and claude.dev each return ten entries');
    }
} finally {
    await stop(); await fs.writeFile(path.join(scratch, 'verification.json'), JSON.stringify({ checks, passed: checks.length >= 4 }, null, 2)); console.log('Verification files:', scratch);
}
