const { action, text, choice, boolean, integer, idSchema, rows, save, change, remove, record, requiredText, localDay, localTime } = require('../shared.cjs');
const catalog = require('./catalog.cjs');
const dayMs = 86400000;
const wordKey = (word) => word.trim().toLowerCase();
const examplesSchema = { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { text: text(2000), translation: text(2000, 0) }, required: ['text'], additionalProperties: false } };
module.exports.activate = (ctx) => {
  // Preserve old personal words and progress; the bundled catalog is not auto-favorited.
  if (ctx.store.get('schemaVersion', 0) < 2) {
    save(ctx, rows(ctx).map((item) => {
      const builtin = catalog.find((word) => wordKey(word.word) === wordKey(item.word));
      const examples = item.examples?.length >= 2 ? item.examples : [...(item.example ? [{ text: item.example }] : []), ...(builtin?.examples ?? []).filter(example => example.text !== item.example)];
      return { ...item, phonetic: item.phonetic || builtin?.phonetic || '', examples, favorite: item.favorite ?? true, ...(builtin ? { meaningEn: item.meaningEn ?? builtin.meaningEn } : {}) };
    }));
    ctx.store.set('schemaVersion', 2); ctx.store.set('seeded', true);
  }
  const dayState = (day) => {
    const state = ctx.store.get('reviewDay', {});
    return state.day === day ? state : { day, reviewedIds: [] };
  };
  function words() {
    const personal = rows(ctx);
    return [...personal, ...catalog.filter((builtin) => !personal.some((item) => item.id === builtin.id || wordKey(item.word) === wordKey(builtin.word)))];
  }
  function find(id) {
    const item = words().find((word) => word.id === id);
    if (!item) throw new Error(ctx.t('找不到该词汇'));
    return item;
  }
  function list(now = Date.now()) {
    const day = localDay(now), state = dayState(day), all = words();
    const favorites = all.filter((item) => item.favorite), limit = ctx.config().dailyLimit ?? 12;
    const due = favorites.filter((item) => (item.reviewAt ?? 0) <= now && !state.reviewedIds.includes(item.id))
      .sort((a, b) => (a.reviewAt ?? 0) - (b.reviewAt ?? 0)).slice(0, Math.max(0, limit - state.reviewedIds.length));
    return { words: all, favorites, due, day, reviewed: state.reviewedIds.length, dailyLimit: limit, snoozedUntil: state.snoozedUntil ?? null, skipped: state.skipped ?? false };
  }
  function explore(next = false) {
    const pool = words().filter((item) => !item.favorite && item.phonetic && item.examples?.length >= 2), state = ctx.store.get('explore', { seen: [] });
    if (!next && pool.some((item) => item.id === state.current)) return { item: pool.find((item) => item.id === state.current), remaining: pool.length };
    let candidates = pool.filter((item) => !state.seen.includes(item.id) && item.id !== state.current), seen = state.seen;
    if (!candidates.length) { candidates = pool.filter((item) => item.id !== state.current); seen = []; }
    const item = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0] ?? null;
    ctx.store.set('explore', { current: item?.id ?? null, seen: item ? [...seen, item.id] : [] });
    return { item, remaining: pool.length };
  }
  action(ctx, 'vocabulary_list', '查看词库、收藏和今天待复习的单词，含音标、释义与例句', {}, [], () => list());
  action(ctx, 'vocabulary_explore', '探索未收藏词汇；next=true 换一个，同一轮不重复', { next: boolean }, [], ({ next }) => explore(next));
  action(ctx, 'vocabulary_favorite', '收藏或取消收藏词汇；取消后不再参与每日复习', { id: idSchema, favorite: boolean }, ['id', 'favorite'], ({ id, favorite }) => {
    const item = find(id), patch = { favorite, ...(favorite && !item.favorite ? { reviewAt: Date.now() } : {}) };
    if (rows(ctx).some((row) => row.id === id)) return change(ctx, id, patch);
    const saved = record({ ...item, ...patch }); saved.id = item.id; save(ctx, [saved, ...rows(ctx)]); return saved;
  });
  action(ctx, 'vocabulary_add', '收录或更新并收藏词汇。新词需 phonetic 音标、meaning 释义和至少两条 examples；example 兼容旧调用', {
    id: idSchema, word: text(160), phonetic: text(240), meaning: text(1200), meaningEn: text(1200, 0), example: text(2000, 0), examples: examplesSchema,
  }, ['word', 'meaning'], ({ id, word, meaning, phonetic, meaningEn, example, examples }) => {
    const cleanWord = requiredText(word), previous = id ? find(id) : words().find((item) => wordKey(item.word) === wordKey(cleanWord));
    if (id && previous.word !== cleanWord && words().some(item => item.id !== id && wordKey(item.word) === wordKey(cleanWord))) throw new Error(ctx.t('该词汇已存在'));
    const resolvedExamples = examples ?? (example ? [{ text: example }, ...(previous?.examples ?? []).filter((item) => item.text !== example)] : previous?.examples ?? []);
    const details = { word: cleanWord, meaning: requiredText(meaning), phonetic: (phonetic ?? previous?.phonetic ?? '').trim(),
      examples: resolvedExamples.map((item) => ({ text: requiredText(item.text), translation: item.translation?.trim() ?? '' })), favorite: true,
      meaningEn: meaningEn ?? previous?.meaningEn ?? '', example: resolvedExamples[0]?.text ?? '' };
    if (!details.phonetic || new Set(details.examples.map(item => item.text.toLowerCase())).size < 2) throw new Error(ctx.t('请补全音标和至少两条例句'));
    if (previous && rows(ctx).some((item) => item.id === previous.id)) return change(ctx, previous.id, details);
    const row = record({ ...details, reviewAt: Date.now(), intervalDays: 0, reviewCount: 0 });
    if (previous) row.id = previous.id; save(ctx, [row, ...rows(ctx)]); return row;
  }, { activate: true });
  action(ctx, 'vocabulary_remove', '删除个人词汇及其复习记录；内置词汇仍可在探索中发现', { id: idSchema }, ['id'], ({ id }) => remove(ctx, id));
  action(ctx, 'vocabulary_review', '复习收藏词汇，记录掌握程度并安排下次复习', { id: idSchema, result: choice('again', 'hard', 'good', 'easy') }, ['id', 'result'], ({ id, result }) => {
    const row = find(id);
    if (!row.favorite) throw new Error(ctx.t('请先收藏该词汇'));
    const now = Date.now(), day = localDay(now), state = dayState(day);
    if (state.reviewedIds.includes(id)) return row;
    const previous = row.intervalDays || 1;
    const intervals = { again: 0, hard: Math.max(1, Math.round(previous * 1.2)), good: Math.max(2, previous * 2), easy: Math.max(4, previous * 3) };
    const intervalDays = Math.min(365, intervals[result]), reviewAt = now + (result === 'again' ? 10 * 60000 : intervalDays * dayMs);
    const updated = change(ctx, id, { reviewAt, intervalDays, reviewCount: (row.reviewCount ?? 0) + 1, lastResult: result });
    if (result !== 'again') ctx.store.set('reviewDay', { ...state, reviewedIds: [...state.reviewedIds, id] });
    return updated;
  });
  action(ctx, 'vocabulary_snooze', '延后今日词汇提醒', { minutes: integer(1, 1440) }, [], ({ minutes = 30 }) => {
    const state = dayState(localDay(Date.now())), snoozedUntil = Date.now() + minutes * 60000;
    ctx.store.set('reviewDay', { ...state, snoozedUntil }); return { snoozedUntil };
  });
  action(ctx, 'vocabulary_skip', '跳过今天的词汇提醒', {}, [], () => {
    ctx.store.set('reviewDay', { ...dayState(localDay(Date.now())), skipped: true }); return { skipped: true };
  });
  action(ctx, 'vocabulary_open', '打开词汇的探索、收藏或复习界面', { mode: choice('explore', 'favorites', 'review') }, [], ({ mode = 'review' }) => ctx.native('ui.open', { view: 'vocabulary', pluginId: 'vocabulary', itemId: mode + ':' + record({}).id }));
  ctx.onTick(({ now }) => {
    const config = ctx.config(); if (config.enabled === false) return;
    const day = localDay(now), state = dayState(day), dueAt = state.snoozedUntil ?? localTime(day, config.reviewTime ?? '11:00');
    if (state.skipped || now < dueAt || state.notifiedAt === dueAt) return;
    const { due } = list(now); if (!due.length) return;
    ctx.notify({ key: day + ':' + dueAt, title: ctx.t('词汇复习'), body: ctx.t('今天还有 {{count}} 个词待复习。', { count: due.length }), priority: 'activity', origin: { type: 'vocabulary', day },
      actions: [{ label: ctx.t('开始复习'), method: 'vocabulary_open', params: {} }, { label: ctx.t('稍后 30 分钟'), method: 'vocabulary_snooze', params: { minutes: 30 } }, { label: ctx.t('今天跳过'), method: 'vocabulary_skip', params: {} }] });
    ctx.store.set('reviewDay', { ...state, notifiedAt: dueAt });
  });
};
