const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const temp = process.env.NOTCH_PLUGIN_SMOKE_ROOT ||
  (process.platform === 'win32' && fs.existsSync('D:\\environments\\temp')
    ? 'D:\\environments\\temp\\notchdesk' : path.join(os.tmpdir(), 'notchdesk'));
fs.mkdirSync(temp, { recursive: true });
const scratch = fs.mkdtempSync(path.join(temp, 'plugins-smoke-'));
const date = new Date(2026, 10, 20, 10, 5).getTime();
const clock = { now: date };
const originalNow = Date.now;
const actions = new Map();
const ticks = new Map();
const notices = new Map();
const state = new Map();
const config = new Map();
const queue = [];
let written;
let target;
let opened;
let accounts = [];
let fetchCalls = 0;
const sessionId = '01937eab-7ab1-7c9f-8043-2b5a1e7fdaa1';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXv0AAAAASUVORK5CYII=';
const clone = (value) => value == null ? value : structuredClone(value);

function action(method, fields = {}) {
  const registration = actions.get(method);
  assert.ok(registration, 'missing action: ' + method);
  return registration(fields);
}

function event(now = clock.now, activeSeconds = 5, idleSeconds = 0, locked = false) {
  return { now, activeSeconds, idleSeconds, locked };
}

function tick(id, timing = event()) {
  return ticks.get(id)(timing);
}

function perPlugin(id) {
  return Array.from(notices.values()).filter((notice) => notice.plugin === id);
}

function native(method, params) {
  switch (method) {
    case 'clipboard.capture': return queue.shift();
    case 'clipboard.write': written = params; return { ok: true };
    case 'session.open': target = params; return { opened: true };
    case 'ui.open': opened = params; return { dispatched: true };
    case 'file.open': opened = params; return { opened: true };
    case 'accounts.list': return accounts;
    case 'accounts.fetch': {
      fetchCalls++;
      if (params.path === '/user') return params.provider === 'github' ? { login: 'example' } : { username: 'example' };
      if (params.path.startsWith('/repos/')) return { name: 'alpha', full_name: 'example/alpha', html_url: 'https://github.com/example/alpha' };
      if (params.path.startsWith('/projects/')) return { name: 'beta', path_with_namespace: 'example/team/beta', web_url: 'https://gitlab.com/example/team/beta' };
      if (params.path === '/search/issues' && params.query.q.includes('review-requested')) {
        return { items: [{ id: 21, title: 'Review this change', html_url: 'https://github.com/example/alpha/pull/1' }] };
      }
      if (params.path === '/search/issues') return { items: [{ id: 28, title: 'Investigate a failure' }] };
      if (params.path === '/merge_requests') return [{ id: 15, title: 'GitLab merge request' }];
      if (params.path === '/issues') return [];
      if (params.path === '/events' || params.path.includes('/events')) return [];
      throw new Error('Unexpected account route: ' + params.path);
    }
    default: throw new Error('Unexpected native action: ' + method);
  }
}

function install(id) {
  const pluginPath = path.join(project, 'plugins', id);
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, id);
  config.set(id, Object.fromEntries(Object.entries(manifest.settings).map(([key, item]) => [key, item.default])));
  const assetDir = path.join(scratch, id);
  const activate = require(path.join(pluginPath, manifest.entry)).activate;
  activate({
    action(method, description, schema, handle) {
      assert.equal(typeof description, 'string');
      assert.equal(schema.type, 'object');
      assert.ok(!actions.has(method), 'duplicate action: ' + method);
      actions.set(method, handle);
    },
    assetDir,
    config: () => config.get(id),
    locale: () => 'zh-CN',
    t: (key, values={}) => key.replace(/\{\{(\w+)\}\}/g, (_m,name)=>String(values[name]??'')),
    store: {
      get(key, fallback) { return clone(state.get(id + ':' + key) ?? fallback); },
      set(key, value) { state.set(id + ':' + key, clone(value)); },
    },
    onTick(callback) { ticks.set(id, callback); },
    notify(notice) {
      const key = id + ':' + notice.key;
      if (!notices.has(key)) notices.set(key, { ...notice, id: key, plugin: id });
      return notices.get(key);
    },
    log() {},
    native,
    invoke(method, params) {
      if (method === 'notifications.dismiss') {
        const notice = notices.get(params.id);
        if (notice) notice.dismissed = true;
        return notice;
      }
      return action(method, params);
    },
  });
}

async function main() {
  Date.now = () => clock.now;
  const plugins = ['todo', 'clipline', 'snippets', 'vocabulary', 'trends', 'morning', 'attention', 'wellness'];
  plugins.forEach(install);

  const overdue = action('todo_add', { title: 'Ship NotchDesk', notes: 'Review the product', dueAt: clock.now - 1000 });
  tick('todo');
  tick('todo');
  assert.equal(perPlugin('todo').length, 1);
  assert.equal(perPlugin('todo')[0].actions[0].method, 'todo_update');
  await action('todo_snooze', { id: overdue.id, minutes: 5 });
  assert.equal(perPlugin('todo')[0].dismissed, true);
  tick('todo');
  assert.equal(perPlugin('todo').length, 1);
  clock.now += 5 * 60000 + 1;
  tick('todo');
  assert.equal(perPlugin('todo').length, 2);
  await action('todo_update', { id: overdue.id, status: 'completed' });
  assert.equal(perPlugin('todo')[1].dismissed, true);
  tick('todo');
  assert.equal(action('todo_list')[0].status, 'completed');
  assert.equal(perPlugin('todo').length, 2);
  await action('todo_remove', { id: overdue.id });
  assert.equal(action('todo_list').length, 0);

  const text = action('clip_import', { kind: 'text', text: 'A portable note' });
  assert.equal(action('clip_import', { kind: 'text', text: 'A portable note' }).id, text.id);
  await action('clip_copy', { id: text.id });
  assert.deepEqual(written, { kind: 'text', text: 'A portable note' });
  queue.push({ kind: 'image', base64: image, mime: 'image/png' });
  const picture = await action('clip_capture');
  assert.equal(picture.preview, 'image');
  assert.equal(picture.assetId, picture.id);
  assert.equal(action('clip_pin', { id: text.id }).pinned, true);
  assert.equal(action('clip_list')[0].id, text.id);
  assert.equal(action('clip_pin', { id: text.id, pinned: false }).pinned, false);
  const asset = action('clip_resolve', { id: picture.id });
  assert.equal(fs.readFileSync(asset.path, 'base64'), image);
  await action('clip_copy', { id: picture.id });
  assert.equal(written.kind, 'image');
  await action('clip_open', { id: picture.id });
  assert.equal(opened.assetId, picture.id);
  action('clip_remove', { id: picture.id });
  assert.equal(fs.existsSync(asset.path), false);
  for (const [ext, preview] of [['md', 'markdown'], ['html', 'html'], ['pdf', 'pdf'], ['mp4', 'video']]) {
    const file = path.join(scratch, 'example.' + ext);
    fs.writeFileSync(file, 'preview content');
    const row = action('clip_import', { kind: 'file', path: file, storage: ext === 'mp4' ? 'reference' : 'copy' });
    assert.equal(row.preview, preview);
    assert.equal(row.assetId, row.id);
    assert.equal(fs.readFileSync(action('clip_resolve', { id: row.id }).path, 'utf8'), 'preview content');
    if (ext === 'mp4') {
      assert.equal(action('clip_resolve', { id: row.id }).path, file);
      const moved = path.join(scratch, 'renamed.mp4');
      fs.renameSync(file, moved);
      assert.equal(action('clip_list').find((item) => item.id === row.id).missing, true);
      assert.equal(action('clip_relink', { id: row.id, path: moved }).name, 'renamed.mp4');
      assert.equal(action('clip_resolve', { id: row.id }).path, moved);
      await action('clip_copy_path', { id: row.id });
      assert.deepEqual(written, { kind: 'text', text: moved });
    }
  }

  const snippet = action('snippets_add', { title: 'Ask for edge cases', text: 'Review these test cases.' });
  action('snippets_update', { id: snippet.id, text: 'Review the failing cases.' });
  await action('snippets_copy', { id: snippet.id });
  assert.equal(written.text, 'Review the failing cases.');
  action('snippets_remove', { id: snippet.id });
  assert.equal(action('snippets_list').length, 0);

  config.get('vocabulary').reviewTime = '10:00';
  assert.ok(action('vocabulary_list').words.length >= 4);
  const word = action('vocabulary_add', { word: 'idempotent', meaning: '幂等' });
  assert.equal(action('vocabulary_add', { word: 'Idempotent', meaning: '幂等操作' }).id, word.id);
  tick('vocabulary');
  tick('vocabulary');
  assert.equal(perPlugin('vocabulary').length, 1);
  assert.equal(perPlugin('vocabulary')[0].priority, 'activity');
  action('vocabulary_snooze', { minutes: 1 });
  clock.now += 60001;
  tick('vocabulary');
  assert.equal(perPlugin('vocabulary').length, 2);
  action('vocabulary_review', { id: word.id, result: 'good' });
  assert.equal(action('vocabulary_list').due.some((item) => item.id === word.id), false);
  assert.equal(action('vocabulary_list').reviewed, 1);

  const safeRequest = { provider: 'codex', sessionId, title: 'A build needs review', eventId: 'build-001' };
  assert.throws(() => action('attention_request', { ...safeRequest, uri: 'codex://threads/00000000-0000-0000-0000-000000000000' }), /匹配/);
  const attention = action('attention_request', safeRequest);
  assert.equal(action('attention_request', safeRequest).id, attention.id);
  assert.equal(perPlugin('attention').length, 1);
  await action('attention_open', { id: attention.id });
  assert.equal(target.uri, 'codex://threads/' + sessionId);
  const hermes = action('attention_request', { provider: 'hermes', sessionId: 'test-2026-01', title: 'Hermes ready' });
  await action('attention_open', { id: hermes.id });
  assert.equal(target.sessionId, 'test-2026-01');
  await action('attention_snooze', { id: hermes.id, minutes: 1 });
  assert.equal(action('attention_list').find((item) => item.id === hermes.id).status, 'snoozed');
  tick('attention');
  assert.equal(perPlugin('attention').length, 2);
  clock.now += 60001;
  tick('attention');
  assert.equal(perPlugin('attention').length, 3);
  await action('attention_resolve', { id: hermes.id });
  assert.equal(perPlugin('attention')[2].dismissed, true);
  assert.equal(action('attention_list').find((item) => item.id === hermes.id).status, 'resolved');

  config.get('wellness').workStart = '00:00';
  config.get('wellness').workEnd = '00:00';
  assert.equal(config.get('wellness').waterMinutes, 60);
  assert.equal(config.get('wellness').walkMinutes, 120);
  tick('wellness', event(clock.now, 5, 300));
  tick('wellness', event(clock.now, 5, 0, true));
  assert.equal(action('wellness_status').activeSeconds, 0);
  tick('wellness', { ...event(clock.now, 0, 90), elapsedSeconds: 5 });
  assert.equal(action('wellness_status').activeSeconds, 5);
  for (let i = 1; i < 720; i++) tick('wellness', event(clock.now + i * 5000));
  clock.now += 3600000;
  assert.equal(action('wellness_status').activeSeconds, 3600);
  assert.equal(perPlugin('wellness').length, 1);
  assert.equal(perPlugin('wellness')[0].origin.kind, 'water');
  action('wellness_handle', { kind: 'water', decision: 'done' });
  for (let i = 0; i < 720; i++) tick('wellness', event(clock.now + i * 5000));
  clock.now += 3600000;
  assert.equal(action('wellness_status').activeSeconds, 7200);
  assert.equal(perPlugin('wellness')[1].origin.kind, 'both');
  action('wellness_handle', { kind: 'both', decision: 'snooze', minutes: 1 });
  tick('wellness');
  assert.equal(perPlugin('wellness').length, 2);
  clock.now += 60001;
  tick('wellness');
  assert.equal(perPlugin('wellness').length, 3);
  action('wellness_pause', { paused: true });
  const activeSeconds = action('wellness_status').activeSeconds;
  tick('wellness');
  assert.equal(action('wellness_status').activeSeconds, activeSeconds);

  accounts = [{ provider: 'github', host: 'https://github.com', connected: true }, { provider: 'gitlab', host: 'https://gitlab.com', connected: true }];
  const restoreAt = clock.now;
  clock.now = new Date(2026, 10, 19, 14, 0).getTime();
  const yesterday = action('todo_add', { title: 'Completed yesterday' });
  await action('todo_update', { id: yesterday.id, status: 'completed' });
  clock.now = restoreAt;
  action('todo_add', { title: 'Review the morning report', dueAt: clock.now });
  const digest = await action('morning_get');
  assert.equal(digest.sections.find((section) => section.id === 'todo').total, 1);
  assert.equal(digest.sections.find((section) => section.id === 'reviews').total, 2);
  assert.equal(digest.sections.find((section) => section.id === 'completed').items[0].id, yesterday.id);
  assert.equal(digest.suggestions.length, 3);
  const suggestion = digest.suggestions.find((item) => item.method === 'morning_adopt');
  const first = await action('morning_adopt', suggestion.params);
  const duplicate = await action('morning_adopt', suggestion.params);
  assert.equal(first.id, duplicate.id);
  const callsBefore = fetchCalls;
  await tick('morning');
  await tick('morning');
  assert.equal(perPlugin('morning').length, 1);
  assert.equal(perPlugin('morning')[0].priority, 'activity');
  assert.equal(fetchCalls, callsBefore);
  clock.now = new Date(2026, 10, 21, 9, 59).getTime();
  await tick('morning');
  assert.equal(perPlugin('morning').length, 1);
  clock.now += 60000;
  await tick('morning', event(clock.now, 0, 0, true));
  assert.equal(perPlugin('morning').length, 1);
  await tick('morning');
  assert.equal(perPlugin('morning')[1].priority, 'scheduled');

  action('trends_source_add', { provider: 'github', owner: 'example', repo: 'alpha' });
  action('trends_source_add', { provider: 'gitlab', owner: 'example/team', repo: 'beta' });
  if (process.argv.includes('--online')) {
    Date.now = originalNow;
    const trend = await action('trends_list', { force: true, period: 'daily' });
    assert.equal(trend.error, undefined, trend.error);
    assert.ok(trend.items.length >= 1, 'No repositories found on the public GitHub Trending page');
    assert.ok(trend.items[0].rank === 1 && trend.items[0].url.startsWith('https://github.com/'));
    assert.equal(trend.personalized.length, 2);
    console.log('GitHub Trending live parse: ' + trend.items.length + ' repositories.');
  } else {
    const originalFetch = globalThis.fetch;
    const html = '<title>Trending repositories on GitHub</title><article class="Box-row"><h2><a href="/example/sample">example / sample</a></h2><p>Sample</p><span itemprop="programmingLanguage">TypeScript</span><a href="/example/sample/stargazers">1,023</a><a href="/example/sample/forks">42</a><span class="float-sm-right">7 stars today</span></article>';
    try {
      globalThis.fetch = async () => new Response(html);
      const trend = await action('trends_list', { force: true, period: 'daily' });
      assert.equal(trend.items[0].stars, 1023);
      assert.equal(trend.items[0].starsInPeriod, 7);
      assert.equal(trend.personalized.length, 2);
      globalThis.fetch = async () => { throw new Error('simulated network failure'); };
      const fallback = await action('trends_list', { force: true, period: 'daily' });
      assert.equal(fallback.error, 'simulated network failure');
      assert.equal(fallback.stale, true);
      assert.deepEqual(fallback.items, trend.items);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  console.log('Plugin smoke passed: ' + plugins.join(', ') + '.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow;
  if (path.dirname(path.resolve(scratch)) === path.resolve(temp) && path.basename(scratch).startsWith('plugins-smoke-')) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
