const { load } = require('cheerio');
const sources = {
  huggingface: { url: 'https://huggingface.co/models?sort=trending', endpoint: 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=10', sort: 'trendingScore' },
  claude: { url: 'https://claude.dev/', endpoint: 'https://claude.dev/', sort: 'published-desc' },
};
const tidy = (value) => value.trim().replace(/\s+/g, ' ');
const count = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
function parseModels(data) {
  if (!Array.isArray(data)) throw new Error('Hugging Face 模型列表格式已变化');
  const seen = new Set();
  const items = data.flatMap(item => {
    if (typeof item.id !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(item.id) || item.private || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, title: item.id, url: 'https://huggingface.co/' + item.id, task: item.pipeline_tag ?? '', library: item.library_name ?? '', likes: count(item.likes), downloads: count(item.downloads), trendingScore: count(item.trendingScore) }];
  }).slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 }));
  if (!items.length) throw new Error('Hugging Face 暂未返回公开模型');
  return items;
}
function parseBlogs(html) {
  const $ = load(html), seen = new Set();
  const items = $('a[href]').toArray().flatMap(element => {
    const row = $(element), href = row.attr('href');
    let url;
    try { url = new URL(href, sources.claude.url); } catch { return []; }
    if (url.origin !== 'https://claude.dev' || !/^\/blog\/[\w-]+\/?$/.test(url.pathname) || seen.has(url.pathname)) return [];
    const title = tidy(row.find('.p-title,h2,h3').first().text());
    if (!title) return [];
    seen.add(url.pathname);
    const date = tidy(row.find('.p-date,.feat-date,time').first().text());
    const stamp = date ? Date.parse(date + ' UTC') : NaN;
    return [{ id: url.pathname, title, url: url.origin + url.pathname, date: Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null,
      readingMinutes: Number(row.find('.p-time,.feat-time').first().text().match(/\d+/)?.[0]) || null,
      category: tidy(row.find('.feat-cat').text()), author: tidy(row.find('.feat-by').text()), _stamp: Number.isFinite(stamp) ? stamp : 0 }];
  }).sort((a, b) => b._stamp - a._stamp).slice(0, 10).map(({ _stamp, ...item }, index) => ({ ...item, rank: index + 1 }));
  if (!items.length) throw new Error('claude.dev 文章页面暂时无法解析');
  return items;
}
async function loadFeed(source) {
  const definition = sources[source];
  if (!definition) throw new Error('未知趋势来源');
  const response = await fetch(definition.endpoint, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { Accept: source === 'huggingface' ? 'application/json' : 'text/html', 'User-Agent': 'NotchDesk/1.0 (desktop trends reader)' } });
  if (!response.ok) throw new Error(source + ' HTTP ' + response.status);
  const items = source === 'huggingface' ? parseModels(await response.json()) : parseBlogs(await response.text());
  return { source, url: definition.url, sort: definition.sort, items, fetchedAt: Date.now() };
}
module.exports = { sources, parseModels, parseBlogs, loadFeed };
