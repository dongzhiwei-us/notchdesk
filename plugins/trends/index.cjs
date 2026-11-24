const { action, text, choice, boolean, idSchema, rows, save, remove, record } = require('../shared.cjs');

const tidy = (value) => value.trim().replace(/\s+/g, ' ');
const slug = /^[A-Za-z0-9][A-Za-z0-9_.%#+-]{0,40}$/;
const project = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const providerSchema = choice('github', 'gitlab');
const periodSchema = choice('daily', 'weekly', 'monthly');
const numberFrom = (text) => Number(text.match(/[\d,]+/)?.[0]?.replaceAll(',', '') ?? 0);
const github = 'https://github.com';

async function loadTrending(period, language) {
  const { load } = require('cheerio');
  const url = github + '/trending' + (language ? '/' + encodeURIComponent(language) : '') + '?since=' + period;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'Accept': 'text/html', 'User-Agent': 'NotchDesk/1.0 (desktop GitHub Trending reader)' },
    redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub Trending 返回 HTTP ' + response.status);
  const $ = load(await response.text());
  const items = $('article.Box-row').toArray().flatMap((element) => {
    const row = $(element);
    const href = row.find('h2 a').attr('href')?.trim();
    if (!/^\/[\w.-]+\/[\w.-]+$/.test(href ?? '')) return [];
    const fullName = href.slice(1);
    const [owner, name] = fullName.split('/');
    return [{
      id: fullName, rank: 0, provider: 'github', name, fullName, owner,
      title: fullName, url: github + href, description: tidy(row.find('p').first().text()),
      language: tidy(row.find('[itemprop=programmingLanguage]').text()) || null,
      stars: numberFrom(row.find('a[href$="/stargazers"]').text()),
      forks: numberFrom(row.find('a[href$="/forks"]').text()),
      starsInPeriod: numberFrom(row.find('span.float-sm-right').text()),
    }];
  }).slice(0, 25).map((item, index) => ({ ...item, rank: index + 1 }));
  if (!items.length && !/trending repositories|trending developers/i.test($.text())) throw new Error('GitHub Trending 页面暂时无法解析');
  return { url, items, fetchedAt: Date.now() };
}

function repoCard(item, provider, label) {
  const gh = provider === 'github';
  const fullName = gh ? item.full_name : item.path_with_namespace;
  if (!fullName) return null;
  return {
    id: provider + ':' + fullName, provider, name: item.name, fullName, title: fullName,
    owner: gh ? item.owner?.login : item.namespace?.full_path, source: label,
    url: gh ? item.html_url : item.web_url, description: item.description ?? '',
    language: item.language ?? null, stars: (gh ? item.stargazers_count : item.star_count) ?? 0,
    forks: (gh ? item.forks_count : item.forks_count) ?? 0,
    updatedAt: item.pushed_at ?? item.last_activity_at ?? item.updated_at ?? null,
    private: gh ? !!item.private : item.visibility === 'private',
  };
}

module.exports.activate = (ctx) => {
  const inFlight = new Map();

  function trending(period, language, force, cacheMinutes) {
    const key = period + ':' + language;
    const cache = ctx.store.get('trendingCache', {});
    const previous = cache[key];
    if (!force && previous && Date.now() - previous.fetchedAt < cacheMinutes * 60000) return Promise.resolve({ ...previous, stale: false });
    if (inFlight.has(key)) return inFlight.get(key);
    const task = loadTrending(period, language).then((result) => {
      const latest = ctx.store.get('trendingCache', {});
      const entries = Object.entries({ ...latest, [key]: result }).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 12);
      ctx.store.set('trendingCache', Object.fromEntries(entries));
      return { ...result, stale: false };
    }).catch((error) => ({
      items: previous?.items ?? [], url: previous?.url ?? github + '/trending', fetchedAt: previous?.fetchedAt ?? null,
      stale: !!previous, error: error.message,
    })).finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
  }

  async function personal() {
    const sources = rows(ctx);
    const settled = await Promise.all(sources.map(async (source) => {
      const { provider, owner, repo, label } = source;
      try {
        let url;
        let query;
        if (provider === 'github') {
          url = repo ? '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) : '/users/' + encodeURIComponent(owner) + '/repos';
          if (!repo) query = { sort: 'updated', per_page: '5' };
        } else {
          url = repo ? '/projects/' + encodeURIComponent(owner + '/' + repo) : '/groups/' + encodeURIComponent(owner) + '/projects';
          if (!repo) query = { order_by: 'last_activity_at', sort: 'desc', per_page: '5' };
        }
        const result = await ctx.native('accounts.fetch', { provider, path: url, ...(query ? { query } : {}) });
        const items = (Array.isArray(result) ? result : [result]).slice(0, 5).map((item) => repoCard(item ?? {}, provider, label)).filter(Boolean);
        return { ...source, items };
      } catch (error) {
        return { ...source, items: [], error: error.message };
      }
    }));
    return settled;
  }

  action(ctx, 'trends_sources', '查看额外追踪的 GitHub 和 GitLab 来源', {}, [], () => rows(ctx));
  action(ctx, 'trends_source_add', '加入要追踪的仓库或组织', { provider: providerSchema, owner: text(240), repo: text(100), label: text(120) }, ['provider', 'owner'], ({ provider, owner, repo, label }) => {
    const clean = owner.trim();
    const segments = clean.split('/');
    if ((provider === 'github' && segments.length !== 1) || !segments.every((segment) => project.test(segment)) || (repo && !project.test(repo))) {
      throw new Error('请输入有效的仓库所有者和仓库名');
    }
    const current = rows(ctx);
    const existing = current.find((item) => item.provider === provider && item.owner.toLowerCase() === clean.toLowerCase() && (item.repo ?? '').toLowerCase() === (repo ?? '').toLowerCase());
    if (existing) return existing;
    if (current.length >= 12) throw new Error('最多可添加 12 个追踪来源');
    const row = record({ provider, owner: clean, repo: repo ?? null, label: label?.trim() || (repo ? clean + '/' + repo : clean) });
    save(ctx, [row, ...current]);
    return row;
  });
  action(ctx, 'trends_source_remove', '移除仓库或组织来源', { id: idSchema }, ['id'], ({ id }) => remove(ctx, id));
  action(ctx, 'trends_list', '查询真实 GitHub Trending 和已添加的仓库源', { period: periodSchema, language: text(40, 0), force: boolean }, [], async ({ period, language, force }) => {
    const config = ctx.config();
    period ??= config.defaultPeriod ?? 'daily';
    language = (language ?? config.defaultLanguage ?? '').trim().toLowerCase();
    if (language && !slug.test(language)) throw new Error('请输入有效的 GitHub Trending 语言标识');
    const [publicResult, sources] = await Promise.all([trending(period, language, force, config.cacheMinutes ?? 20), personal()]);
    return { ...publicResult, period, language, sources, personalized: sources.flatMap((source) => source.items) };
  });
};
