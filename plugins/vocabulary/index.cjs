const { action, text, choice, integer, idSchema, rows, save, getRow, change, remove, record, requiredText, localDay, localTime } = require('../shared.cjs');

const dayMs = 86400000;
const starter = [
  ['idempotent', '幂等的；重复执行仍得到相同结果', 'Make the retry handler idempotent.'],
  ['regression', '回归；改动造成已正常工作的功能失效', 'Add a test to catch this regression.'],
  ['fallback', '备用方案；主路径失败时使用的逻辑', 'Use the cached response as a fallback.'],
  ['constraint', '约束；必须满足的条件', 'Clarify the latency constraint in the prompt.'],
  ['grounding', '使输出以给定证据或来源为依据', 'Grounding ties the answer to the retrieved documents.'],
  ['provenance', '来源与演变记录', 'Record the provenance of each retrieved fact.'],
  ['latency', '延迟；请求到响应之间的时间', 'Stream tokens to reduce perceived latency.'],
  ['deterministic', '确定性的；相同输入产生相同输出', 'Keep the acceptance test deterministic.'],
];

module.exports.activate = (ctx) => {
  if (!ctx.store.get('seeded', false)) {
    if (!rows(ctx).length) {
      const now = Date.now();
      save(ctx, starter.map(([word, meaning, example]) => record({ word, meaning, example, reviewAt: now, intervalDays: 0, reviewCount: 0 }, now)));
    }
    ctx.store.set('seeded', true);
  }
  const dayState = (day) => ctx.store.get('reviewDay', {}).day === day ? ctx.store.get('reviewDay', {}) : { day, reviewedIds: [] };

  function list(now = Date.now()) {
    const day = localDay(now);
    const state = dayState(day);
    const words = rows(ctx);
    const limit = ctx.config().dailyLimit ?? 12;
    const due = words
      .filter((item) => item.reviewAt <= now && !state.reviewedIds.includes(item.id))
      .sort((a, b) => Number(a.reviewCount === 0) - Number(b.reviewCount === 0) || a.reviewAt - b.reviewAt)
      .slice(0, Math.max(0, limit - state.reviewedIds.length));
    return { words, due, day, reviewed: state.reviewedIds.length, dailyLimit: limit, snoozedUntil: state.snoozedUntil ?? null, skipped: state.skipped ?? false };
  }

  action(ctx, 'vocabulary_list', '查看词库及今天待复习的单词', {}, [], () => list());
  action(ctx, 'vocabulary_add', '加入单词、释义和例句', { word: text(160), meaning: text(1200), example: text(2000, 0) }, ['word', 'meaning'], ({ word, meaning, example = '' }) => {
    const cleanWord = requiredText(word);
    const previous = rows(ctx).find((item) => item.word.toLocaleLowerCase() === cleanWord.toLocaleLowerCase());
    const details = { word: cleanWord, meaning: requiredText(meaning), example };
    if (previous) return change(ctx, previous.id, details);
    const row = record({ ...details, reviewAt: Date.now(), intervalDays: 0, reviewCount: 0 });
    save(ctx, [row, ...rows(ctx)]);
    return row;
  }, {activate:true});
  action(ctx, 'vocabulary_remove', '移除词汇', { id: idSchema }, ['id'], ({ id }) => remove(ctx, id));
  action(ctx, 'vocabulary_review', '提交一次复习结果', { id: idSchema, result: choice('again', 'hard', 'good', 'easy') }, ['id', 'result'], ({ id, result }) => {
    const row = getRow(ctx, id);
    const now = Date.now();
    const day = localDay(now);
    const state = dayState(day);
    if (state.reviewedIds.includes(id)) return row;
    const previous = row.intervalDays || 1;
    const intervals = { again: 1, hard: Math.max(1, Math.round(previous * 1.2)), good: Math.max(2, previous * 2), easy: Math.max(4, previous * 3) };
    const intervalDays = Math.min(365, intervals[result]);
    const reviewAt = now + intervalDays * dayMs;
    const updated = change(ctx, id, { reviewAt, intervalDays, reviewCount: row.reviewCount + 1, lastResult: result });
    ctx.store.set('reviewDay', { ...state, reviewedIds: [...state.reviewedIds, id] });
    return updated;
  });
  action(ctx, 'vocabulary_snooze', '延后今日词汇提醒', { minutes: integer(1, 1440) }, [], ({ minutes = 30 }) => {
    const now = Date.now();
    const state = dayState(localDay(now));
    const snoozedUntil = now + minutes * 60000;
    ctx.store.set('reviewDay', { ...state, snoozedUntil });
    return { snoozedUntil };
  });
  action(ctx, 'vocabulary_skip', '跳过今天的词汇提醒', {}, [], () => {
    const state = dayState(localDay(Date.now()));
    ctx.store.set('reviewDay', { ...state, skipped: true });
    return { skipped: true };
  });
  action(ctx, 'vocabulary_open', '打开词汇复习', {}, [], () => ctx.native('ui.open', { view: 'vocabulary', pluginId: 'vocabulary' }));

  ctx.onTick(({ now }) => {
    const config = ctx.config();
    if (config.enabled === false) return;
    const day = localDay(now);
    const state = dayState(day);
    const dueAt = state.snoozedUntil ?? localTime(day, config.reviewTime ?? '11:00');
    if (state.skipped || now < dueAt || state.notifiedAt === dueAt) return;
    const { due } = list(now);
    if (!due.length) return;
    ctx.notify({
      key: day + ':' + dueAt, title: ctx.t('词汇复习'), body: ctx.t('今天还有 {{count}} 个词待复习。',{count:due.length}),
      priority: 'activity', origin: { type: 'vocabulary', day },
      actions: [
        { label: ctx.t('开始复习'), method: 'vocabulary_open', params: {} },
        { label: ctx.t('稍后 30 分钟'), method: 'vocabulary_snooze', params: { minutes: 30 } },
        { label: ctx.t('今天跳过'), method: 'vocabulary_skip', params: {} },
      ],
    });
    ctx.store.set('reviewDay', { ...state, notifiedAt: dueAt });
  });
};
