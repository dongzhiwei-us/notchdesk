import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { dayDate, dayKey, shiftDay, todoSpan } from '../plugins/todo/calendar.ts';
import paths from './paths.cjs';

const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true });
const scratch = await fs.mkdtemp(path.join(base, 'todo-schedule-'));
const data = path.join(scratch, 'data'), plugins = path.join(scratch, 'plugins');
await fs.mkdir(data); await fs.cp(path.join(paths.root, 'plugins'), plugins, { recursive: true });
const later = Date.now() + 7 * 86400000;
const markdown = '# Release notes\n\n- Keep **local data**\n- Review `todo_add`\n\n```ts\nconst ready = true;\n```\n';
const legacy = { id: 'legacy-due-only', title: 'Legacy deadline', notes: 'Keep this note', dueAt: later, status: 'pending', createdAt: 1, updatedAt: 1 };
const seed = new DatabaseSync(path.join(data, 'island.sqlite'));
seed.exec('CREATE TABLE kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)) STRICT');
seed.prepare('INSERT INTO kv VALUES (?,?,?)').run('plugin:todo', 'rows', JSON.stringify([legacy])); seed.prepare('INSERT INTO kv VALUES (?,?,?)').run('settings', 'trends', JSON.stringify({ archiveEnabled: false })); seed.close();
let child, client, transport, previousToken, errors = '';
const checks = [];
function pass(message) { checks.push(message); console.log('PASS', message); }
async function start() {
    child = spawn(process.execPath, [path.join(paths.buildDir, 'server.cjs')], { env: { ...process.env, NOTCH_DATA: data, NOTCH_LOGS: path.join(scratch, 'logs'), NOTCH_PLUGINS: plugins, NOTCH_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', value => { errors = (errors + value).slice(-2000); });
    let descriptor;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode != null) throw Error('Isolated service failed: ' + errors);
        try {
            const next = JSON.parse(await fs.readFile(path.join(data, 'connection.json'), 'utf8'));
            if (next.token !== previousToken) { descriptor = next; break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.ok(descriptor, 'service startup timed out');
    previousToken = descriptor.token;
    client = new Client({ name: 'todo-schedule-verification', version: '1' });
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer ' + descriptor.mcpToken } } });
    await client.connect(transport);
}
async function stop() {
    await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); client = transport = undefined;
    if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    child = undefined;
}
async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
}
async function reject(name, args) { assert.equal((await client.callTool({ name, arguments: args })).isError, true); }
try {
    await start();
    const tools = await client.listTools();
    for (const name of ['todo_add', 'todo_update']) for (const field of ['startAt', 'endAt', 'dueAt']) assert.ok(tools.tools.find(tool => tool.name === name).inputSchema.properties[field]);
    assert.equal((await call('todo_list')).find(item => item.id === legacy.id).endAt, legacy.dueAt);
    pass('legacy deadline records remain readable and MCP advertises both schedule fields');
    const item = await call('todo_add', { title: 'A scheduled task', notes: markdown, startAt: later, endAt: later + 3600000, sourceKey: 'schedule-roundtrip' });
    assert.equal(item.endAt, item.dueAt); assert.equal(item.notes, markdown);
    assert.equal((await call('todo_add', { title: 'Duplicate', sourceKey: 'schedule-roundtrip' })).id, item.id);
    await reject('todo_add', { title: 'Invalid range', startAt: later, endAt: later - 1 });
    await reject('todo_add', { title: 'Conflicting alias', endAt: later, dueAt: later + 1 });
    await reject('todo_update', { id: item.id, startAt: later + 7200000 });
    assert.equal((await call('todo_list')).find(row => row.id === item.id).startAt, later);
    pass('schedule validation is atomic, duplicate source events are idempotent, and Markdown stays unchanged');
    const adjusted = await call('todo_update', { id: item.id, dueAt: later + 7200000, status: 'in-progress' });
    assert.equal(adjusted.endAt, later + 7200000); assert.equal(adjusted.dueAt, adjusted.endAt);
    const cleared = await call('todo_update', { id: item.id, startAt: null, endAt: null });
    assert.equal(cleared.startAt, null); assert.equal(cleared.dueAt, null);
    const completed = await call('todo_update', { id: item.id, startAt: later, endAt: later + 3600000, status: 'completed' });
    const snippet = await call('snippets_add', { title: 'Markdown snippet', text: markdown });
    pass('legacy dueAt updates, clearing schedules, and completing tasks retain compatible semantics');
    await stop(); await start();
    const restored = (await call('todo_list')).find(row => row.id === item.id);
    for (const key of ['id', 'title', 'notes', 'startAt', 'endAt', 'dueAt', 'status', 'completedAt']) assert.deepEqual(restored[key], completed[key], key);
    assert.equal((await call('todo_list')).find(row => row.id === legacy.id).notes, legacy.notes);
    assert.equal((await call('snippets_list')).find(row => row.id === snippet.id).text, markdown);
    pass('real SQLite records, Markdown, dates, IDs and completion state survive a backend process restart');
    const week = '2026-11-23';
    const span = todoSpan({ ...completed, startAt: dayDate('2026-11-24').getTime(), endAt: dayDate('2026-11-27').getTime() }, week);
    assert.deepEqual(span, { from: 1, until: 3, before: false, after: false });
    assert.equal(todoSpan({ ...completed, startAt: dayDate('2026-12-01').getTime(), endAt: null, dueAt: null }, week), null);
    assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
    assert.equal(dayKey(dayDate('2026-03-08')), '2026-03-08');
    pass('calendar spans handle midnight ends, unscheduled ends and month/year boundaries');
} finally {
    await stop();
    await fs.writeFile(path.join(scratch, 'verification.json'), JSON.stringify({ checks, passed: checks.length === 5 }, null, 2));
    console.log('Verification files:', scratch);
}
