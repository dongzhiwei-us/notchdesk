const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { action, text, choice, boolean, integer, localDay, localTime } = require('../shared.cjs');
const { describe } = require('./descriptions.cjs');
const definitions = {
  github: { title: 'GitHub Trending', url: 'https://github.com/trending?since=daily', sort: 'daily' },
  huggingface: { title: 'Hugging Face', url: 'https://huggingface.co/models?sort=trending', sort: 'trendingScore' },
  claude: { title: 'claude.dev', url: 'https://claude.dev/', sort: 'published-desc' },
};
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('需要有效日期 YYYY-MM-DD');
  return value;
}
const dateSchema = { ...text(10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#!|])/g, '\\$1').replace(/[\r\n]+/g, ' ');
function link(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href.replace(/[()]/g, char => char === '(' ? '%28' : '%29') : ''; } catch { return ''; } }
function markdown(doc) {
  const en = doc.locale === 'en-US';
  const lines = ['---', 'schema: notchdesk.trends.daily/v1', `date: "${doc.date}"`, `timezone: ${JSON.stringify(doc.timezone)}`, `captured_at: "${new Date(doc.generatedAt).toISOString()}"`, `revision: "${doc.revision}"`, `status: ${doc.partial ? 'partial' : 'complete'}`, '---', '', `# ${en ? 'Open source trends' : '开源趋势'} · ${doc.date}`, '',
    `${en ? 'Captured' : '归档时间'}: ${new Date(doc.generatedAt).toISOString()} · ${escape(doc.timezone)}`, '',
    en ? '> Public sources only. GitHub: daily, all languages. Hugging Face: trending score. claude.dev: newest articles, not a popularity ranking.' : '> 仅包含公开来源。GitHub 为不限语言的日榜；Hugging Face 按热门分数排序；claude.dev 为最新文章，不是热度排名。', ''];
  if (doc.partial) lines.push(en ? '> Some sources failed. See source status and fetch dates below; cached entries are not presented as new data.' : '> 本次部分来源更新失败。下方标明来源状态与原始抓取时间，缓存数据不冒充当天新数据。', '');
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, '', `[${en ? 'Source' : '来源'}](${link(section.url)}) · ${en ? 'Status' : '状态'}: ${section.status} · ${en ? 'Fetched' : '抓取时间'}: ${section.fetchedAt ? new Date(section.fetchedAt).toISOString() : '—'}`, '');
    if (section.error) lines.push(`${en ? 'Update error' : '更新错误'}: ${escape(section.error)}`, '');
    if (!section.items.length) lines.push(en ? 'No data available for this source.' : '该来源本次没有可用数据。', '');
    for (const [index, item] of section.items.entries()) {
      lines.push(`### ${item.rank ?? index + 1}. ${escape(item.title ?? item.fullName ?? item.id)}`, '', escape(item.description || (en ? 'No introduction provided by the source.' : '来源未提供介绍。')), '');
      const facts = [item.language, item.task, item.library, typeof item.stars === 'number' ? 'Stars: ' + item.stars : '', typeof item.starsInPeriod === 'number' ? (en ? 'Stars today: ' : '今日新增 Star: ') + item.starsInPeriod : '', typeof item.downloads === 'number' ? 'Downloads: ' + item.downloads : '', typeof item.likes === 'number' ? 'Likes: ' + item.likes : '', item.date, item.readingMinutes ? item.readingMinutes + ' min' : '', item.author].filter(Boolean);
      if (facts.length) lines.push(facts.map(escape).join(' · '), '');
      if (item.descriptionUnavailable) lines.push(en ? '*Introduction unavailable; the text above contains source metadata only.*' : '*暂未取得正文介绍；上方仅展示来源元数据。*', '');
      const url = link(item.url); if (url) lines.push(`[${en ? 'Details' : '查看详情'}](${url})`, '');
    }
  }
  return lines.join('\n') + '\n';
}
function summary(doc) { return { date: doc.date, generatedAt: doc.generatedAt, revision: doc.revision, partial: doc.partial, count: doc.sections.reduce((count, source) => count + source.items.length, 0), markdown: doc.date + '.md', json: doc.date + '.json' }; }

function createArchive(ctx, loaders) {
  const directory = path.join(ctx.assetDir, 'archives');
  let flight, disposed = false, exportQueue = Promise.resolve();
  const key = day => 'archive:' + validDay(day);
  const index = () => ctx.store.get('archiveIndex', []).sort((a, b) => b.date.localeCompare(a.date));
  const files = day => ({ markdown: path.join(directory, validDay(day) + '.md'), json: path.join(directory, day + '.json'), index: path.join(directory, 'index.md'), manifest: path.join(directory, 'index.json') });
  async function atomic(file, content) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  function exportDay(day) {
    const task = exportQueue.catch(() => {}).then(async () => {
      if (disposed) throw Error('Plugin unloaded');
      const doc = ctx.store.get(key(day), null); if (!doc) throw Error(ctx.t('这一天还没有归档'));
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const targets = files(day);
      let days = index();
      if (!days.some(item => item.date === day && item.revision === doc.revision)) {
        days = [summary(doc), ...days.filter(item => item.date !== day)].sort((a, b) => b.date.localeCompare(a.date));
        ctx.store.set('archiveIndex', days);
      }
      await atomic(targets.json, JSON.stringify(doc, null, 2) + '\n');
      await atomic(targets.markdown, markdown(doc));
      await atomic(targets.manifest, JSON.stringify({ schema: 'notchdesk.trends.index/v1', updatedAt: Date.now(), days }, null, 2) + '\n');
      await atomic(targets.index, '# NotchDesk · Trends archive\n\n' + days.map(item => `- [${item.date}](${item.markdown}) · ${item.count} items${item.partial ? ' · partial' : ''} · [JSON](${item.json})`).join('\n') + '\n');
      ctx.store.set('archiveExport:' + day, { revision: doc.revision, error: null });
    });
    exportQueue = task; return task;
  }
  async function result(day, format = 'json') {
    const doc = ctx.store.get(key(day), null);
    if (!doc) return { date: day, found: false, directory };
    const targets = files(day);
    const exported = ctx.store.get('archiveExport:' + day, null);
    let exportError = '';
    try {
      if (exported?.revision !== doc.revision || exported.error) throw Error('Export needs repair');
      await Promise.all(Object.values(targets).map(file => fs.access(file)));
    }
    catch { try { await exportDay(day); } catch (error) { exportError = error.message; } }
    return { date: day, found: true, directory, files: targets, partial: doc.partial, generatedAt: doc.generatedAt, ...(exportError ? { exportError } : {}), ...(format === 'markdown' ? { content: markdown(doc) } : { document: doc }) };
  }
  async function save(force = false) {
    if (disposed) throw Error('Plugin unloaded');
    if (flight) return flight;
    const day = localDay(Date.now()), old = ctx.store.get(key(day), null);
    const run = async () => {
      ctx.store.set('archiveAttempt', { day, at: Date.now() });
      if (!force && old && !old.partial) { await exportDay(day); return result(day); }
      const settled = await Promise.allSettled(Object.entries(definitions).map(async ([source, definition]) => {
        const data = await loaders[source]();
        const fresh = !data.error && !data.stale && data.fetchedAt != null && localDay(data.fetchedAt) === day;
        return { source, ...definition, status: fresh ? 'fresh' : data.items?.length ? 'stale' : 'unavailable', fetchedAt: data.fetchedAt ?? null, items: structuredClone(data.items ?? []), ...(data.error ? { error: data.error } : {}) };
      }));
      if (disposed) throw Error('Plugin unloaded');
      const sections = Object.entries(definitions).map(([source, definition], position) => {
        const settledSource = settled[position];
        const section = settledSource.status === 'fulfilled' ? settledSource.value : { source, ...definition, status: 'unavailable', fetchedAt: null, items: [], error: String(settledSource.reason?.message ?? settledSource.reason) };
        const previous = old?.sections.find(item => item.source === source);
        // A failed refresh must not erase a good snapshot already captured today.
        return section.status !== 'fresh' && previous?.items.length && (previous.status === 'fresh' || previous.status === 'retained') ? { ...previous, status: 'retained', error: section.error || 'Source refresh failed' } : section;
      });
      const descriptionFailures = await describe(ctx, sections, () => !disposed);
      if (disposed) throw Error('Plugin unloaded');
      if (localDay(Date.now()) !== day) throw Error('Archive date changed during capture; retry on the next tick');
      const doc = { schema: 'notchdesk.trends.daily/v1', date: day, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: ctx.locale(), generatedAt: Date.now(), revision: randomUUID(), partial: sections.some(section => section.status !== 'fresh'), descriptionFailures, sections };
      ctx.store.set(key(day), doc);
      ctx.store.set('archiveIndex', [summary(doc), ...index().filter(item => item.date !== day)]);
      try { await exportDay(day); }
      catch (error) { ctx.store.set('archiveExport:' + day, { revision: doc.revision, error: error.message }); throw error; }
      ctx.log('info', 'trends.archive_saved', { date: day, count: summary(doc).count, partial: doc.partial, descriptionFailures });
      return result(day);
    };
    flight = run().finally(() => { flight = undefined; }); return flight;
  }
  action(ctx, 'trends_archive_save', '保存今日三个公开趋势来源到本地 Markdown/JSON；force=true 更新今天，不伪造过往日期', { force: boolean }, [], ({ force }) => save(force));
  action(ctx, 'trends_archive_list', '按日期列出已保存的趋势归档及文档目录，可用于其他工具消费', { limit: integer(1, 3660), before: dateSchema }, [], ({ limit = 3660, before }) => {
    if (before) validDay(before);
    const config = ctx.config();
    return { directory, days: index().filter(item => !before || item.date < before).slice(0, limit), schedule: { enabled: config.archiveEnabled !== false, time: config.archiveTime ?? '10:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
  });
  action(ctx, 'trends_archive_get', '读取指定日期的趋势历史，format=json 提供结构化数据，markdown 提供完整文档', { date: dateSchema, format: choice('json', 'markdown') }, ['date'], ({ date, format }) => result(validDay(date), format));
  action(ctx, 'trends_archive_open', '用系统默认应用打开某一天的 Markdown 趋势文档', { date: dateSchema }, ['date'], async ({ date }) => {
    validDay(date); await exportDay(date); return ctx.native('file.open', { path: files(date).markdown });
  });
  ctx.onTick(async ({ now }) => {
    if (disposed || flight || ctx.config().archiveEnabled === false) return;
    const day = localDay(now);
    if (now < localTime(day, ctx.config().archiveTime ?? '10:00')) return;
    const existing = ctx.store.get(key(day), null), exported = ctx.store.get('archiveExport:' + day, null);
    if (existing && !existing.partial && exported?.revision === existing.revision && !exported.error) return;
    const attempt = ctx.store.get('archiveAttempt', {});
    if (attempt.day === day && now - attempt.at < 30 * 60000) return;
    // Clock advances at the OS level; dates are never backfilled with today's list.
    try { await save(); } catch (error) { if (!disposed) ctx.log('warn', 'trends.archive_failed', { date: day, message: error.message }); }
  });
  return () => { disposed = true; };
}
module.exports = { createArchive, validDay, markdown };
