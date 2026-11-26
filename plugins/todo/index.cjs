const { action, text, choice, integer, instant, idSchema, rows, save, getRow, change, remove, record, requiredText } = require('../shared.cjs');

const statuses = choice('pending', 'in-progress', 'completed');

// dueAt remains the deadline/reminder alias used by older clients and morning briefs.
const normalize = (item) => ({ ...item, startAt: item.startAt ?? null, endAt: item.endAt ?? item.dueAt ?? null, dueAt: item.endAt ?? item.dueAt ?? null });
function schedule(input, previous = {}) {
  if (input.endAt !== undefined && input.dueAt !== undefined && input.endAt !== input.dueAt) throw new Error('结束时间与截止时间必须一致');
  const startAt = input.startAt !== undefined ? input.startAt : previous.startAt ?? null;
  const endAt = input.endAt !== undefined ? input.endAt : input.dueAt !== undefined ? input.dueAt : previous.endAt ?? previous.dueAt ?? null;
  if (startAt != null && endAt != null && endAt < startAt) throw new Error('结束时间不能早于开始时间');
  return { startAt, endAt, dueAt: endAt };
}

module.exports.activate = (ctx) => {
  const list = () => rows(ctx).map(normalize).sort((a, b) =>
    Number(a.status === 'completed') - Number(b.status === 'completed') ||
    (a.dueAt ?? a.startAt ?? Infinity) - (b.dueAt ?? b.startAt ?? Infinity) || b.createdAt - a.createdAt);
  const fields = { title: text(240), notes: text(20000, 0), startAt: instant, endAt: instant, dueAt: instant };
  async function retireNotice(id) {
    if (!id) return;
    try {
      await ctx.invoke('notifications.dismiss', { id });
    } catch {
      ctx.log('warn', 'todo.notice_dismiss_failed');
    }
  }

  action(ctx, 'todo_list', '查看本地保存的待办、Markdown 内容和起止时间', {}, [], list);
  action(ctx, 'todo_add', '新增待办，支持 Markdown notes、startAt 开始时间和 endAt 结束时间（毫秒时间戳），dueAt 为兼容别名', { ...fields, sourceKey: text(300) }, ['title'], ({ title, notes = '', sourceKey, ...times }) => {
    const previous = sourceKey && rows(ctx).find((item) => item.sourceKey === sourceKey);
    if (previous) return normalize(previous);
    const row = record({ title: requiredText(title), notes, ...schedule(times), status: 'pending', snoozedUntil: null, ...(sourceKey ? { sourceKey } : {}) });
    save(ctx, [row, ...rows(ctx)]);
    return row;
  }, {activate:true});
  action(ctx, 'todo_update', '修改待办的 Markdown 内容、起止时间或完成状态，时间可设为 null 清空', { id: idSchema, ...fields, status: statuses }, ['id'], async ({ id, ...update }) => {
    const existing = getRow(ctx, id);
    Object.assign(update, schedule(update, existing));
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
