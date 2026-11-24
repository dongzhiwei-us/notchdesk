const { createHash } = require('node:crypto');
const { action, text, integer, choice, idSchema, rows, save, getRow, change, record, requiredText } = require('../shared.cjs');

const providers = choice('codex', 'hermes', 'vanish');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const externalId = /^[A-Za-z0-9_-]{1,150}$/;
const names = { codex: 'Codex', hermes: 'Hermes', vanish: 'Vanish' };

function targetFor({ provider, sessionId, uri, workspace }) {
  if (provider === 'codex') {
    if (!uuid.test(sessionId)) throw new Error('Codex 会话需要 UUID');
    const canonical = 'codex://threads/' + sessionId.toLowerCase();
    if (uri && uri.toLowerCase() !== canonical) throw new Error('Codex 跳转地址与会话 ID 不匹配');
    return { provider, sessionId: sessionId.toLowerCase(), uri: canonical, ...(workspace ? { workspace } : {}) };
  }
  if (!externalId.test(sessionId)) throw new Error('会话 ID 包含无效字符');
  if (uri) throw new Error(names[provider] + ' 会话由应用中已配置的适配器定位');
  return { provider, sessionId, ...(workspace ? { workspace } : {}) };
}

module.exports.activate = (ctx) => {
  async function retire(id) {
    if (!id) return;
    try {
      await ctx.invoke('notifications.dismiss', { id });
    } catch {
      ctx.log('warn', 'attention.notice_dismiss_failed');
    }
  }

  function publish(row) {
    const key = row.key + ':' + (row.revision ?? 0);
    const notification = ctx.notify({
      key, title: row.title, body: row.body || ctx.t('{{provider}} 会话请求了你的注意',{provider:names[row.provider]}),
      priority: row.priority, origin: { type: 'attention', provider: row.provider, sessionId: row.sessionId, id: row.id },
      actions: [
        { label: ctx.t('跳转到 {{provider}}',{provider:names[row.provider]}), method: 'attention_open', params: { id: row.id } },
        { label: ctx.t('稍后 10 分钟'), method: 'attention_snooze', params: { id: row.id, minutes: 10 } },
        { label: ctx.t('标记已处理'), method: 'attention_resolve', params: { id: row.id } },
      ],
    });
    return change(ctx, row.id, { status: 'pending', snoozedUntil: null, notificationId: notification?.id ?? null });
  }

  action(ctx, 'attention_list', '查看会话通知及其处理状态', {}, [], () => rows(ctx));
  action(ctx, 'attention_request', '发出可定位到 Agent 会话的注意请求', {
    provider: providers, sessionId: text(160), title: text(200), body: text(2000, 0), workspace: text(500),
    uri: text(1000), eventId: text(200), priority: choice('activity', 'gentle', 'scheduled', 'urgent'),
  }, ['provider', 'sessionId', 'title'], (input, context) => {
    if (ctx.config().enabled === false) return { accepted: false, reason: 'paused' };
    const target = targetFor(input);
    const title = requiredText(input.title);
    const body = input.body ?? '';
    const priority = input.priority ?? 'scheduled';
    const eventId = input.eventId ?? createHash('sha256').update(JSON.stringify([title, body, priority])).digest('hex');
    const key = target.provider + ':' + target.sessionId + ':' + eventId;
    const current = rows(ctx);
    const existing = current.find((item) => item.key === key);
    if (existing && (existing.notificationId || existing.status !== 'pending')) {
      return { accepted: true, id: existing.id, duplicate: true, status: existing.status };
    }
    const row = existing ?? record({
      ...target, key, title, body, priority, status: 'pending', openedAt: null, resolvedAt: null,
      requestedBy: context?.actor?.kind ?? null,
    });
    if (!existing) save(ctx, [row, ...current].slice(0, 200));
    const published = publish(row);
    return { accepted: true, id: row.id, duplicate: !!existing, status: 'pending', notificationId: published.notificationId };
  });
  action(ctx, 'attention_open', '在对应应用打开指定 Agent 会话', { id: idSchema }, ['id'], async ({ id }) => {
    const row = getRow(ctx, id);
    const target = targetFor(row);
    const result = await ctx.native('session.open', target);
    if (result?.opened === false) throw new Error(result.error || '会话未打开，请检查该提供方的适配器');
    const latest = getRow(ctx, id);
    change(ctx, id, {
      openedAt: Date.now(),
      ...(latest.status === 'resolved' ? {} : { status: 'opened', snoozedUntil: null, notificationId: null }),
    });
    await retire(latest.notificationId);
    return result ?? { opened: true };
  });
  action(ctx, 'attention_resolve', '把会话请求标记为已处理', { id: idSchema }, ['id'], async ({ id }) => {
    const row = getRow(ctx, id);
    if (row.status === 'resolved') return row;
    const next = change(ctx, id, { status: 'resolved', resolvedAt: Date.now(), snoozedUntil: null, notificationId: null });
    await retire(row.notificationId);
    return next;
  });
  action(ctx, 'attention_snooze', '稍后再提醒一个会话请求', { id: idSchema, minutes: integer(1, 1440) }, ['id'], async ({ id, minutes = 10 }) => {
    const row = getRow(ctx, id);
    if (row.status === 'resolved') return row;
    const next = change(ctx, id, {
      status: 'snoozed', snoozedUntil: Date.now() + minutes * 60000,
      revision: (row.revision ?? 0) + 1, notificationId: null,
    });
    await retire(row.notificationId);
    return next;
  });
  ctx.onTick(({ now }) => {
    if (ctx.config().enabled === false) return;
    for (const row of rows(ctx)) {
      if ((row.status === 'snoozed' && row.snoozedUntil <= now) || (row.status === 'pending' && !row.notificationId)) publish(row);
    }
  });
};
