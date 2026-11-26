const { action, text, choice, integer, instant, idSchema, rows, save, getRow, change, remove, record, requiredText } = require('../shared.cjs');

const statuses = choice('pending', 'in-progress', 'completed');

// dueAt remains the deadline/reminder alias used by older clients and morning briefs.
const { normalize, schedule } = require('./schedule.cjs');

module.exports.activate = (ctx) => {
  const list = () => rows(ctx).map(normalize).sort((a, b) =>
    Number(a.status === 'completed') - Number(b.status === 'completed') ||
    (a.dueAt ?? a.startAt ?? Infinity) - (b.dueAt ?? b.startAt ?? Infinity) || b.createdAt - a.createdAt);
  const date = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
  const fields = { title: text(240), notes: text(20000, 0), startAt: instant, endAt: instant, dueAt: instant, timeGranularity: choice('day', 'hour'), startDate: date, endDate: date, tagId: { type: ['string', 'null'], minLength: 1, maxLength: 128 } };
  const tags = () => ctx.store.get('tags', []);
  function tagId(value, previous = null) {
    const id = value === undefined ? previous : value;
    if (id !== null && !tags().some(tag => tag.id === id)) throw Error(ctx.t('找不到该标签'));
    return id;
  }
  action(ctx, 'todo_tags_list', '查看可分配给待办的自定义标签', {}, [], tags);
  action(ctx, 'todo_tag_add', '新增自定义标签，如 MR、chore、coding、CR；名称不区分大小写去重', { name: text(40) }, ['name'], ({ name }) => {
    name = requiredText(name).normalize('NFKC');
    if (name.length > 40) throw Error(ctx.t('标签名称最多 40 个字符'));
    const existing = tags().find(tag => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    if (tags().length >= 100) throw Error(ctx.t('最多创建 100 个标签'));
    const tag = record({ name }); ctx.store.set('tags', [...tags(), tag]); return tag;
  });
  action(ctx, 'todo_tag_remove', '删除标签并清除任务关联，保留任务本身与提醒', { id: idSchema }, ['id'], ({ id }) => {
    const previous = tags(); let clearedTasks = 0;
    const items = rows(ctx).map(item => { if (item.tagId !== id) return item; clearedTasks++; return { ...item, tagId: null, updatedAt: Date.now() }; });
    if (clearedTasks) save(ctx, items);
    ctx.store.set('tags', previous.filter(tag => tag.id !== id));
    return { removed: previous.some(tag => tag.id === id), id, clearedTasks };
  });
  const view = () => ({ granularity: ctx.store.get('timelineGranularity', 'day') });
  action(ctx, 'todo_view_get', '读取待办时间轴的天/小时视图偏好', {}, [], view);
  action(ctx, 'todo_view_set', '切换并保存时间轴视图，不修改任何任务的时间', { granularity: choice('day', 'hour') }, ['granularity'], ({ granularity }) => { ctx.store.set('timelineGranularity', granularity); return view(); });
  async function retireNotice(id) {
    if (!id) return;
    try {
      await ctx.invoke('notifications.dismiss', { id });
    } catch {
      ctx.log('warn', 'todo.notice_dismiss_failed');
    }
  }

  action(ctx, 'todo_list', '查看本地保存的待办、Markdown 内容和起止时间', {}, [], list);
  action(ctx, 'todo_add', '新增待办：hour 使用 startAt/endAt 毫秒时间戳；day 使用 startDate/endDate（含结束当天）；可选 tagId，默认无标签。notes 支持 Markdown', { ...fields, sourceKey: text(300) }, ['title'], ({ title, notes = '', sourceKey, tagId: requestedTag, ...times }) => {
    const previous = sourceKey && rows(ctx).find((item) => item.sourceKey === sourceKey);
    if (previous) return normalize(previous);
    const row = record({ title: requiredText(title), notes, ...schedule(times), tagId: tagId(requestedTag), status: 'pending', snoozedUntil: null, ...(sourceKey ? { sourceKey } : {}) });
    save(ctx, [row, ...rows(ctx)]);
    return row;
  }, {activate:true});
  action(ctx, 'todo_update', '修改待办的 Markdown 内容、天/小时时间精度、起止日期/时间、标签或完成状态；tagId=null 清除标签，时间/日期可设 null 清空', { id: idSchema, ...fields, status: statuses }, ['id'], async ({ id, ...update }) => {
    const existing = getRow(ctx, id);
    Object.assign(update, schedule(update, existing));
    update.tagId = tagId(update.tagId, existing.tagId ?? null);
    const changedTime = update.endAt !== (existing.endAt ?? existing.dueAt ?? null);
    if (update.title !== undefined) update.title = requiredText(update.title);
    if (changedTime) {
      update.snoozedUntil = null;
      update.reminderRevision = (existing.reminderRevision ?? 0) + 1;
    }
    if (update.status === 'completed') {
      update.completedAt = existing.completedAt ?? Date.now();
      update.snoozedUntil = null;
    } else if (update.status && existing.status === 'completed') {
      update.completedAt = null;
      update.reminderRevision = (existing.reminderRevision ?? 0) + 1;
    }
    if (changedTime || update.status === 'completed') update.noticeId = null;
    const row = change(ctx, id, update);
    if (update.noticeId === null) await retireNotice(existing.noticeId);
    return row;
  });
  action(ctx, 'todo_remove', '删除待办事项', { id: idSchema }, ['id'], async ({ id }) => {
    const item = rows(ctx).find((row) => row.id === id);
    const result = remove(ctx, id);
    await retireNotice(item?.noticeId);
    return result;
  });
  action(ctx, 'todo_snooze', '稍后再提醒一项待办', { id: idSchema, minutes: integer(1, 1440) }, ['id'], async ({ id, minutes }) => {
    const row = getRow(ctx, id);
    if (row.status === 'completed' || row.dueAt == null) throw new Error('该待办没有可延后的提醒');
    const item = change(ctx, id, { snoozedUntil: Date.now() + (minutes ?? ctx.config().snoozeMinutes ?? 5) * 60000, noticeId: null });
    await retireNotice(row.noticeId);
    return normalize(item);
  });

  ctx.onTick(({ now }) => {
    const config = ctx.config();
    if (config.reminders === false) return;
    for (const item of list()) {
      const due = item.snoozedUntil ?? item.dueAt;
      if (item.status === 'completed' || due == null || due > now) continue;
      const key = item.id + ':' + due + ':' + (item.reminderRevision ?? 0);
      if (item.notifiedKey === key) continue;
      const notice = ctx.notify({
        key, title: item.title, body: item.notes?.slice(0, 180) || ctx.t('待办已到提醒时间'),
        priority: 'scheduled', origin: { type: 'todo', id: item.id },
        actions: [
          { label: ctx.t('完成'), method: 'todo_update', params: { id: item.id, status: 'completed' } },
          { label: ctx.t('稍后 {{minutes}} 分钟',{minutes:config.snoozeMinutes??5}), method: 'todo_snooze', params: { id: item.id, minutes: config.snoozeMinutes ?? 5 } },
        ],
      });
      change(ctx, item.id, { notifiedKey: key, noticeId: notice?.id ?? null });
    }
  });
};
