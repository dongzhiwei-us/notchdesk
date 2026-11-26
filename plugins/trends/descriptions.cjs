const { load } = require('cheerio');
const { marked } = require('marked');
const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const short = value => compact(value).slice(0, 500);

function modelIntroduction(markdown) {
  const text = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  for (const token of marked.lexer(text)) {
    if (token.type !== 'paragraph' && token.type !== 'html') continue;
    const $ = load(marked.parse(token.raw, { async: false }));
    $('script,style,svg,img').remove();
    const candidate = short($.text());
    if (candidate.length >= 50 && !/^(?:\[|!\[|<|license:)/i.test(candidate)) return candidate;
  }
  return '';
}
function blogIntroduction(html) {
  const $ = load(html);
  return short($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'));
}
async function prefix(response) {
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (size < 512 * 1024) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = value.subarray(0, 512 * 1024 - size); chunks.push(chunk); size += chunk.length;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
// Only the daily archive loads descriptions; live trend switching stays fast.
// Four workers and a shared deadline bound both requests and total work.
async function describe(ctx, sections, live = () => true) {
  const cache = ctx.store.get('descriptionCache', {}), now = Date.now();
  const jobs = sections.flatMap(section => section.items.filter(item => !item.description && ['huggingface', 'claude'].includes(section.source)).map(item => ({ source: section.source, item })));
  const budget = AbortSignal.timeout(20000);
  let cursor = 0, failures = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const { source, item } = jobs[cursor++], key = source + ':' + item.id;
      const previous = cache[key];
      if (previous && now - previous.fetchedAt < 7 * 86400000) { Object.assign(item, previous); continue; }
      try {
        const url = source === 'huggingface' ? 'https://huggingface.co/' + item.id + '/raw/main/README.md' : item.url;
        const parsed = new URL(url);
        if ((source === 'huggingface' && (parsed.origin !== 'https://huggingface.co' || !/^[\w.-]+\/[\w.-]+$/.test(item.id))) || (source === 'claude' && (parsed.origin !== 'https://claude.dev' || !/^\/blog\/[\w-]+\/?$/.test(parsed.pathname)))) throw Error('Invalid description source');
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([budget, AbortSignal.timeout(6000)]), headers: { 'User-Agent': 'NotchDesk/1.0 (daily trends archive)' } });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const raw = await prefix(response), description = source === 'huggingface' ? modelIntroduction(raw) : blogIntroduction(raw);
        if (!description) throw Error('No introduction available');
        const details = { description, descriptionKind: source === 'huggingface' ? 'model-card' : 'page-meta', descriptionFetchedAt: now, descriptionUrl: url };
        cache[key] = { ...details, fetchedAt: now }; Object.assign(item, details);
      } catch {
        failures++;
        if (previous?.description) Object.assign(item, previous, { descriptionStale: true });
        else {
          item.description = source === 'huggingface' ? [item.task && 'Task: ' + item.task, item.library && 'Library: ' + item.library, 'Downloads: ' + (item.downloads ?? 0), 'Likes: ' + (item.likes ?? 0)].filter(Boolean).join(' · ') : 'Article on claude.dev' + (item.date ? ' · ' + item.date : '') + (item.readingMinutes ? ' · ' + item.readingMinutes + ' min read' : '');
          item.descriptionKind = 'metadata'; item.descriptionUnavailable = true;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  if (jobs.length && live()) ctx.store.set('descriptionCache', Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 500)));
  return failures;
}
module.exports = { describe, modelIntroduction, blogIntroduction };
