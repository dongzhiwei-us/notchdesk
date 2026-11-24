const { action, boolean, idSchema, text, localDay, localTime } = require('../shared.cjs');

const hour = 3600000;
const providers = { github: 'GitHub', gitlab: 'GitLab' };
const repoProvider = ({ provider }) => Object.hasOwn(providers, provider);
const accountIdentity = (accounts) => JSON.stringify(accounts.map((account) => [account.provider, account.host, account.connected, account.id, account.login]).sort());
const asArray = (value) => Array.isArray(value) ? value : [];
const toText = (value) => typeof value === 'string' ? value : '';
const safeLink = (value) => typeof value === 'string' && /^https?:\/\/[^/\s]+(?:\/|$)/i.test(value) ? value : undefined;

function dateBefore(now, count) {
  const date = new Date(now);
  date.setDate(date.getDate() - count);
  return localDay(date.getTime());
}

function issue(item, provider) {
  const gh = provider === 'github';
  const url = safeLink(gh ? item.html_url : item.web_url);
  const project = gh ? item.repository_url?.split('/').slice(-2).join('/') : item.references?.full?.split(/[!#]/)[0];
  return { id: provider + ':' + item.id, title: toText(item.title), detail: [providers[provider], project].filter(Boolean).join(' · '), url, updatedAt: item.updated_at };
}

function githubEvent(item) {
  const name = toText(item.repo?.name);
  if (!name) return null;
  const labels = { PushEvent: '推送提交', PullRequestEvent: '更新 PR', PullRequestReviewEvent: '审查 PR', IssuesEvent: '更新 Issue', CreateEvent: '创建分支或标签', ReleaseEvent: '发布版本', IssueCommentEvent: '评论 Issue' };
  if (!labels[item.type]) return null;
  const direct = item.payload?.pull_request?.html_url ?? item.payload?.issue?.html_url;
  const url = safeLink(direct) ?? (/^[\w.-]+\/[\w.-]+$/.test(name) ? 'https://github.com/' + name : undefined);
  return { id: 'github:' + item.id, title: labels[item.type] + ' · ' + name, detail: 'GitHub', url, updatedAt: item.created_at };
}

function gitlabEvent(item) {
  const observable = toText(item.target_title || item.push_data?.commit_title || item.push_data?.ref);
  if (!observable) return null;
  return { id: 'gitlab:' + item.id, title: observable, detail: 'GitLab · ' + toText(item.target_type || item.action_name), updatedAt: item.created_at };
}

module.exports.activate = (ctx) => {
  let cached;
  let remaining;
  let delivering = false;
  const installedAt = ctx.store.get('installedAt', null) ?? Date.now();
  ctx.store.set('installedAt', installedAt);

  const api = (provider, path, query) => ctx.native('accounts.fetch', { provider, path, ...(query ? { query } : {}) });

  async function fetchAccount(account, day, now) {
    const { provider } = account;
    const result = { provider, connected: !!account.connected, label: providers[provider], reviews: [], issues: [], activity: [] };
    if (!account.connected) return result;
    try {
      const me = await api(provider, '/user');
      const login = provider === 'github' ? me.login : me.username;
      if (typeof login !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(login)) throw new Error('账号返回了无效的用户名');
      const from = dateBefore(now, 1);
      const requests = provider === 'github' ? [
        api(provider, '/search/issues', { q: 'is:pr is:open review-requested:' + login, sort: 'updated', per_page: '8' }),
        api(provider, '/search/issues', { q: 'is:issue is:open assignee:' + login, sort: 'updated', per_page: '8' }),
        api(provider, '/users/' + encodeURIComponent(login) + '/events', { per_page: '25' }),
      ] : [
        api(provider, '/merge_requests', { state: 'opened', scope: 'all', reviewer_username: login, per_page: '8' }),
        api(provider, '/issues', { state: 'opened', scope: 'all', assignee_username: login, per_page: '8' }),
        api(provider, '/events', { after: dateBefore(now, 2), per_page: '25' }),
      ];
      const [reviews, issues, activity] = await Promise.allSettled(requests);
      for (const [key, response] of [['reviews', reviews], ['issues', issues]]) {
        if (response.status !== 'fulfilled') continue;
        const list = provider === 'github' ? response.value?.items : response.value;
        result[key] = asArray(list).map((item) => issue(item, provider)).filter((item) => item.title);
      }
      if (activity.status === 'fulfilled') {
        const event = provider === 'github' ? githubEvent : gitlabEvent;
        result.activity = asArray(activity.value).filter((item) => {
          const created = Date.parse(item.created_at);
          return Number.isFinite(created) && localDay(created) >= from && localDay(created) < day;
        }).map(event).filter(Boolean);
      }
      if (reviews.status === 'rejected' || issues.status === 'rejected' || activity.status === 'rejected') {
        result.error = '有部分仓库数据暂时不可用，请检查账号权限或网络。';
      }
    } catch {
      result.error = '暂时无法读取此账号，请检查授权或网络。';
    }
    return result;
  }

  async function repoFacts(day, now, force) {
    let accounts;
    try {
      accounts = asArray(await ctx.native('accounts.list', {})).filter(repoProvider);
    } catch {
      accounts = [];
    }
    const identity = accountIdentity(accounts);
    if (!force && cached?.day === day && cached.identity === identity && now - cached.generatedAt < hour) return cached.results;
    if (remaining?.day === day && remaining.identity === identity) return remaining.task;
    const task = Promise.all(accounts.map((account) => fetchAccount(account, day, now)))
      .then((results) => {
        cached = { day, identity, generatedAt: Date.now(), results };
        return results;
      }).finally(() => {
        if (remaining?.task === task) remaining = undefined;
      });
    remaining = { day, identity, task };
    return task;
  }

  async function digest(now, force = false) {
    const day = localDay(now);
    const limit = ctx.config().maxItems ?? 4;
    const [todos, sources] = await Promise.all([
      Promise.resolve().then(() => ctx.invoke('todo_list', {})).catch(() => []),
      repoFacts(day, now, force),
    ]);
    const today = asArray(todos).filter((item) => item.status !== 'completed' && item.dueAt != null && localDay(item.dueAt) <= day);
    const yesterday = dateBefore(now, 1);
    const completed = asArray(todos).filter((item) => item.status === 'completed' && item.completedAt != null && localDay(item.completedAt) === yesterday)
      .sort((a, b) => b.completedAt - a.completedAt);
    const openReviews = sources.flatMap((source) => source.reviews);
    const openIssues = sources.flatMap((source) => source.issues);
    const activity = sources.flatMap((source) => source.activity).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const sections = [
      { id: 'todo', title: ctx.t('逾期与今日到点'), total: today.length, items: today.slice(0, limit).map((item) => ({
        id: item.id, title: item.title, detail: localDay(item.dueAt) < day ? '逾期' : '今天', dueAt: item.dueAt,
      })) },
      { id: 'reviews', title: ctx.t('待你审查的 PR／MR'), total: openReviews.length, items: openReviews.slice(0, limit) },
      { id: 'issues', title: ctx.t('分配给你的 Issue'), total: openIssues.length, items: openIssues.slice(0, limit) },
      { id: 'activity', title: ctx.t('昨天的仓库活动'), total: activity.length, items: activity.slice(0, limit) },
      { id: 'completed', title: ctx.t('昨天完成的待办'), total: completed.length, items: completed.slice(0, limit).map((item) => ({
        id: item.id, title: item.title, detail: '已完成', completedAt: item.completedAt,
      })) },
    ];
    const suggestions = [];
    if (today[0]) suggestions.push({ title: ctx.t('先看最近到期的待办'), detail: today[0].title, method: 'morning_open_todo', params: { id: today[0].id } });
    const offer = (verb, kind, item) => {
      if (!item) return;
      const id = kind + ':' + item.id;
      suggestions.push({ id, title: verb, detail: item.title, url: item.url, method: 'morning_adopt', params: { id } });
    };
    offer('把待审查变更加为待办', 'reviews', openReviews[0]);
    offer('把已分配 Issue 加为待办', 'issues', openIssues[0]);
    return {
      day, generatedAt: now, sections, suggestions,
      sources: sources.map(({ provider, connected, label, error }) => ({ provider, connected, label, ...(error ? { error } : {}) })),
    };
  }

  action(ctx, 'morning_get', '读取开发晨报和基于实际待办、仓库数据的建议', { force: boolean }, [], ({ force }) => digest(Date.now(), force));
  action(ctx, 'morning_open', '打开开发晨报', {}, [], () => ctx.native('ui.open', { view: 'morning', pluginId: 'morning' }));
  action(ctx, 'morning_open_todo', '从开发晨报跳转到待办面板', { id: idSchema }, ['id'], ({ id }) =>
    ctx.native('ui.open', { view: 'todo', pluginId: 'todo', itemId: id }));
  action(ctx, 'morning_adopt', '把晨报中的一条仓库建议加入待办', { id: text(200) }, ['id'], async ({ id }) => {
    const { suggestions } = await digest(Date.now());
    const selected = suggestions.find((item) => item.id === id && item.method === 'morning_adopt');
    if (!selected) throw new Error('这条晨报建议已不在当前列表中');
    return ctx.invoke('todo_add', {
      title: selected.detail.slice(0, 240), notes: [selected.title, selected.url].filter(Boolean).join('\n'),
      sourceKey: 'morning:' + id,
    });
  });

  ctx.onTick(async ({ now, locked }) => {
    const config = ctx.config();
    const day = localDay(now);
    const dueAt = localTime(day, config.deliveryTime ?? '10:00');
    if (locked || config.enabled === false || delivering || ctx.store.get('deliveredDay', null) === day || now < dueAt) return;
    delivering = true;
    try {
      const { sections } = await digest(now);
      const labels = [
        sections[0].total ? sections[0].total + ' 项到期待办' : '',
        sections[1].total ? sections[1].total + ' 个待审查变更' : '',
        sections[2].total ? sections[2].total + ' 个分配给你的 Issue' : '',
      ].filter(Boolean);
      ctx.notify({
        key: day, title: ctx.t('开发晨报'), body: labels.join('，') || '今天的工作概览已就绪。',
        priority: installedAt > dueAt ? 'activity' : 'scheduled', origin: { type: 'morning', day },
        actions: [{ label: ctx.t('打开晨报'), method: 'morning_open', params: {} }],
      });
      ctx.store.set('deliveredDay', day);
    } catch (error) {
      ctx.log('warn', 'morning.delivery_failed', { message: error.message });
    } finally {
      delivering = false;
    }
  });
};
