const { action, boolean, choice, integer, localDay } = require('../shared.cjs');

const kinds = ['water', 'walk'];
const labels = { water: '喝水', walk: '走动' };
const duration = (config, kind) => (config[kind + 'Minutes'] ?? (kind === 'water' ? 60 : 120)) * 60;
const asMinutes = (time) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

module.exports.activate = (ctx) => {
  function stateFor(now, config) {
    const date = new Date(now);
    const day = localDay(now);
    const time = date.getHours() * 60 + date.getMinutes();
    const start = asMinutes(config.workStart ?? '09:00');
    const end = asMinutes(config.workEnd ?? '22:00');
    const inWorkingHours = start === end || (start < end ? time >= start && time < end : time >= start || time < end);
    const stored = ctx.store.get('workingState', {});
    const activeSeconds = stored.day === day ? stored.activeSeconds : 0;
    const state = { day, activeSeconds, paused: stored.day === day && !!stored.paused, inWorkingHours, enabled: config.enabled !== false };
    for (const kind of kinds) {
      const interval = duration(config, kind);
      const slot = stored.day === day ? stored[kind] ?? {} : {};
      const lastAt = slot.lastAt ?? 0;
      const dueAtActiveSeconds = lastAt + interval;
      const snoozedUntil = slot.snoozedUntil ?? null;
      state[kind] = {
        ...slot, lastAt, dueAtActiveSeconds, snoozedUntil,
        due: activeSeconds >= dueAtActiveSeconds && (snoozedUntil == null || now >= snoozedUntil),
        remainingSeconds: Math.max(0, dueAtActiveSeconds - activeSeconds),
      };
    }
    return state;
  }

  const persist = (state) => ctx.store.set('workingState', state);

  action(ctx, 'wellness_status', '查看今天的工作时长和休息提醒状态', {}, [], () => stateFor(Date.now(), ctx.config()));
  action(ctx, 'wellness_pause', '暂停或恢复今天的休息提醒', { paused: boolean }, [], ({ paused }) => {
    const state = stateFor(Date.now(), ctx.config());
    state.paused = paused ?? !state.paused;
    persist(state);
    return state;
  });
  action(ctx, 'wellness_handle', '处理喝水或走动提醒', { kind: choice('water', 'walk', 'both'), decision: choice('done', 'skip', 'snooze'), minutes: integer(1, 180) }, ['kind', 'decision'], ({ kind, decision, minutes }) => {
    const now = Date.now();
    const config = ctx.config();
    const state = stateFor(now, config);
    for (const item of kind === 'both' ? kinds : [kind]) {
      const slot = state[item];
      if (decision === 'snooze') {
        if (slot.due) state[item] = { ...slot, due: false, snoozedUntil: now + (minutes ?? config.snoozeMinutes ?? 10) * 60000 };
      } else {
        state[item] = { lastAt: state.activeSeconds, due: false, dueAtActiveSeconds: state.activeSeconds + duration(config, item), remainingSeconds: duration(config, item), snoozedUntil: null };
      }
    }
    persist(state);
    return state;
  });

  ctx.onTick(({ now, elapsedSeconds, activeSeconds, idleSeconds, locked }) => {
    const config = ctx.config();
    const state = stateFor(now, config);
    if (!state.enabled || state.paused || !state.inWorkingHours || locked || idleSeconds >= (config.idleThreshold ?? 180)) return;
    const delta = Math.max(0, Math.min(15, Number(elapsedSeconds ?? activeSeconds) || 0));
    state.activeSeconds += delta;
    const ready = [];
    for (const kind of kinds) {
      const slot = state[kind];
      slot.remainingSeconds = Math.max(0, slot.dueAtActiveSeconds - state.activeSeconds);
      slot.due = slot.remainingSeconds === 0 && (slot.snoozedUntil == null || now >= slot.snoozedUntil);
      const key = state.day + ':' + kind + ':' + slot.dueAtActiveSeconds + ':' + (slot.snoozedUntil ?? 0);
      if (slot.due && slot.notifiedKey !== key) ready.push({ kind, key });
    }
    if (ready.length) {
      const both = ready.length === 2;
      const kind = both ? 'both' : ready[0].kind;
      const label = both ? '喝口水，起来走走' : ready[0].kind === 'water' ? '喝口水' : '起来走走';
      ctx.notify({
        key: ready.map((item) => item.key).join('+'), title: ctx.t(label),
        body: both ? ctx.t('两项休息提醒同时到期。') : ctx.t('今天的工作时间已达到{{kind}}间隔。',{kind:ctx.t(labels[ready[0].kind])}),
        priority: 'gentle', origin: { type: 'wellness', kind },
        actions: [
          { label: ctx.t('完成'), method: 'wellness_handle', params: { kind, decision: 'done' } },
          { label: ctx.t('稍后'), method: 'wellness_handle', params: { kind, decision: 'snooze' } },
          { label: ctx.t('跳过本次'), method: 'wellness_handle', params: { kind, decision: 'skip' } },
        ],
      });
      for (const item of ready) state[item.kind].notifiedKey = item.key;
    }
    if (delta > 0 || ready.length) persist(state);
  });
};
