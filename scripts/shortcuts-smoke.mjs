import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import paths from './paths.cjs';
const require = createRequire(import.meta.url);
const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true });
const scratch = await fs.mkdtemp(path.join(base, 'shortcuts-')), data = path.join(scratch, 'data'), plugins = path.join(scratch, 'plugins');
await fs.mkdir(data); await fs.cp(path.join(paths.root, 'plugins'), plugins, { recursive: true });
await fs.writeFile(path.join(data, 'mcp-grants.json'), JSON.stringify(['workspace', 'desktop', 'administration', 'files', 'clipboard']));
await build({ stdin: { contents: "export * from './src/shared/shortcuts';export * from './src/main/shortcuts';", resolveDir: paths.root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(scratch, 'registry.cjs') });
const { normalizeShortcut, resolveShortcut, displayShortcut, shortcutFromEvent, shortcutBindings, ShortcutRegistry } = require(path.join(scratch, 'registry.cjs'));
for (const id of ['todo','clipline','snippets','vocabulary','trends','morning','attention','wellness']) {
    await build({ entryPoints: [path.join(paths.root, 'plugins', id, 'index.cjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(plugins, id, 'index.cjs'), logLevel: 'warning' });
}
const manifestPath = path.join(plugins, 'trends/manifest.json'), manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); manifest.settings.archiveEnabled.default = false; await fs.writeFile(manifestPath, JSON.stringify(manifest));
const checks = [];
function pass(message) { checks.push(message); console.log('PASS', message); }
assert.equal(normalizeShortcut('ctrl,option,command + p'), 'Control+Alt+Super+P');
assert.equal(resolveShortcut('CommandOrControl+Alt+V', 'darwin'), 'Alt+Super+V');
assert.equal(resolveShortcut('CommandOrControl+Alt+V', 'win32'), 'Control+Alt+V');
assert.equal(displayShortcut('Control+Alt+Super+P', 'darwin'), '⌃⌥⌘P'); assert.equal(displayShortcut('Control+Alt+Super+P', 'win32'), 'Ctrl+Alt+Win+P');
assert.equal(normalizeShortcut(''), ''); assert.throws(() => normalizeShortcut('P')); assert.throws(() => normalizeShortcut('Control+P+Q'));
assert.equal(shortcutFromEvent({ code: 'KeyP', key: 'π', ctrlKey: true, altKey: true, metaKey: true, shiftKey: false }), 'Control+Alt+Super+P');
const osBindings = new Map(), statuses = [], invoked = [];
let registrations = 0;
const registry = new ShortcutRegistry({ register(key, callback) { registrations++; if (key === 'Control+Alt+Super+Q') return false; osBindings.set(key, callback); return true; }, unregister: key => osBindings.delete(key) }, 'win32', async binding => { invoked.push(binding.action); }, value => statuses.push(value));
const pin = { id: 'clipline:shortcut', pluginId: 'clipline', field: 'shortcut', shortcut: 'Control+Alt+Super+P', action: 'pin' };
registry.sync([pin]); registry.sync([pin]); assert.equal(registrations, 1);
osBindings.get('Control+Alt+Super+P')(); await new Promise(resolve => setTimeout(resolve, 0)); assert.deepEqual(invoked, ['pin']);
registry.sync([{ ...pin, shortcut: 'Control+Alt+Super+Q' }]); assert.equal(osBindings.size, 0); assert.equal(registry.snapshot()[0].reason, 'in-use');
registry.sync([pin]); registry.sync([]); assert.equal(osBindings.size, 0); registry.dispose();
pass('portable modifiers, recorder key codes, differential OS registration and failure status work');
const pinStore = new Map(), actions = new Map(), nativeCalls = [];
require('../plugins/clipline/index.cjs').activate({ action: (name, description, schema, run) => actions.set(name, run), store: { get: (key, fallback) => pinStore.get(key) ?? fallback, set: (key, value) => pinStore.set(key, value) }, assetDir: path.join(scratch, 'pin-assets'), native: async (method, params) => { nativeCalls.push({ method, params }); }, config: () => ({}), onTick() {}, log() {} });
assert.equal((await actions.get('clip_window_toggle')({ reveal: true })).pinned, true); assert.equal((await actions.get('clip_window_toggle')({ reveal: true })).pinned, false);
assert.deepEqual(nativeCalls.map(item => item.method), ['ui.clipline_pin','ui.clipline_pin']); assert.equal(nativeCalls[0].params.reveal, true);
pass('pin toggles use the persisted rope state and never open or pin the wheel');
let child, client, transport, previousToken, errors = '';
async function start() {
    child = spawn(process.execPath, [path.join(paths.buildDir, 'server.cjs')], { env: { ...process.env, NOTCH_DATA: data, NOTCH_LOGS: path.join(scratch, 'logs'), NOTCH_PLUGINS: plugins, NOTCH_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', value => { errors = (errors + value).slice(-2000); });
    let descriptor;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode != null) throw Error('Service failed: ' + errors);
        try { const next = JSON.parse(await fs.readFile(path.join(data, 'connection.json'), 'utf8')); if (next.token !== previousToken) { descriptor = next; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.ok(descriptor, 'startup timeout'); previousToken = descriptor.token;
    client = new Client({ name: 'shortcut-verification', version: '1' });
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer ' + descriptor.mcpToken } } }); await client.connect(transport);
}
async function stop() { await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); client = transport = undefined; if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } child = undefined; }
async function call(name, args = {}) { const result = await client.callTool({ name: name.replaceAll('.', '_'), arguments: args }); assert.ok(!result.isError, JSON.stringify(result.content)); return JSON.parse(result.content[0].text); }
async function reject(name, args) { assert.equal((await client.callTool({ name: name.replaceAll('.', '_'), arguments: args })).isError, true); }
try {
    await start(); let state = await call('state.get');
    assert.equal(state.plugins.length, 8);
    for (const plugin of state.plugins) { assert.equal(plugin.settings.shortcut.format, 'accelerator'); assert.equal(state.settings[plugin.id].values.shortcut, plugin.id === 'clipline' ? 'Control+Alt+Super+P' : ''); }
    await reject('settings.patch', { pluginId: 'clipline', values: { shortcut: 'CommandOrControl+Alt+V' } });
    await call('settings.patch', { pluginId: 'todo', values: { shortcut: 'ctrl,option,command + t' } });
    await reject('settings.patch', { pluginId: 'snippets', values: { shortcut: 'Control+Alt+Meta+T' } });
    await reject('settings.patch', { pluginId: 'todo', values: { shortcut: 'Control+BadKey' } });
    await call('plugins.enable', { id: 'todo', enabled: false });
    await call('settings.patch', { pluginId: 'snippets', values: { shortcut: 'Control+Alt+Super+T' } });
    await reject('plugins.enable', { id: 'todo', enabled: true });
    await call('settings.patch', { pluginId: 'snippets', values: { shortcut: '' } }); await call('plugins.enable', { id: 'todo', enabled: true });
    await call('settings.patch', { pluginId: 'clipline', values: { captureShortcut: '' } });
    state = await call('state.get'); assert.ok(!shortcutBindings(state).some(binding => binding.action === 'capture'));
    assert.equal((await call('shortcuts.status')).online, false);
    assert.equal((await call('clip_window_toggle', { reveal: true })).pinned, true);
    await stop(); await start();
    state = await call('state.get'); assert.equal(state.settings.todo.values.shortcut, 'Control+Alt+Super+T'); assert.equal(state.settings.clipline.values.captureShortcut, ''); assert.equal((await call('clip_window_get')).pinned, true);
    pass('MCP defaults, conflict validation, disable/enable and cleared keys survive a SQLite restart');
    const dynamic = path.join(plugins, 'keyboard-fixture'); await fs.mkdir(dynamic);
    await fs.writeFile(path.join(dynamic, 'index.cjs'), 'module.exports.activate=()=>{};'); await fs.writeFile(path.join(dynamic, 'manifest.json'), JSON.stringify({ id: 'keyboard-fixture', name: 'Keyboard fixture', version: '1', entry: 'index.cjs', settings: {} }));
    async function waitFor(check) { for (let i = 0; i < 60; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Hot reload timeout'); }
    const dynamicState = await waitFor(async () => { const next = await call('state.get'); return next.plugins.some(plugin => plugin.id === 'keyboard-fixture') && next; });
    assert.equal(dynamicState.settings['keyboard-fixture'].values.shortcut, '');
    await call('settings.patch', { pluginId: 'keyboard-fixture', values: { shortcut: 'F13' } });
    registry.sync(shortcutBindings(await call('state.get'))); assert.ok(osBindings.has('F13'));
    assert.equal(path.dirname(path.resolve(dynamic)), path.resolve(plugins)); assert.equal(path.basename(dynamic), 'keyboard-fixture'); await fs.rm(dynamic, { recursive: true });
    const removedState = await waitFor(async () => { const next = await call('state.get'); return !next.plugins.some(plugin => plugin.id === 'keyboard-fixture') && next; });
    registry.sync(shortcutBindings(removedState)); assert.ok(!osBindings.has('F13')); registry.dispose();
    pass('copied plugins gain an empty shortcut setting and removed plugins release their binding');
    if (process.argv.includes('--native')) {
        const helper = path.join(scratch, 'native.cjs'), report = path.join(scratch, 'native.json'), profile = path.join(scratch, 'native-profile'); await fs.mkdir(profile);
        await fs.writeFile(helper, `const{app,globalShortcut}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(profile)});app.disableHardwareAcceleration();app.whenReady().then(()=>{const key='Control+Alt+Super+P';const registered=globalShortcut.register(key,()=>{});const confirmed=globalShortcut.isRegistered(key);globalShortcut.setSuspended(true);const suspended=globalShortcut.isSuspended();globalShortcut.setSuspended(false);globalShortcut.unregister(key);fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({registered,confirmed,suspended,released:!globalShortcut.isRegistered(key),platform:process.platform,electron:process.versions.electron}));app.quit();});app.on('will-quit',()=>globalShortcut.unregisterAll());`);
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const native = spawn(require('electron'), [helper], { env, windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(20000) }); const [code] = await once(native, 'exit'); assert.equal(code, 0);
        const result = JSON.parse(await fs.readFile(report, 'utf8')); for (const key of ['registered','confirmed','suspended','released']) assert.equal(result[key], true, key);
        pass('real Electron registers, suspends and releases Ctrl+Alt+Super+P without opening a window');
    }
} finally { await stop(); registry.dispose(); await fs.writeFile(path.join(scratch, 'verification.json'), JSON.stringify({ checks, passed: checks.length >= 4 }, null, 2)); console.log('Verification files:', scratch); }
