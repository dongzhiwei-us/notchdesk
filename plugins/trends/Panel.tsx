import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
const { fmt: tr } = createPluginTranslator('trends');
import { useEffect, useState } from 'react';
import { Archive, ArrowUpRight, Download, Link2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { TrendsArchive } from './Archive';
import { DataMessage, Empty, IconButton, rowsFrom, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import { errorMessage } from '../../src/ui/types';
import './style.css';
type Source = 'github' | 'huggingface' | 'claude';
const links = { github: 'https://github.com/trending?since=daily', huggingface: 'https://huggingface.co/models?sort=trending', claude: 'https://claude.dev/' };
function open(url: string, feedback: PanelProps['feedback']) { void window.notch.openExternal(url).catch(error => feedback(errorMessage(error), 'error')); }
export function TrendsPanel(props: PanelProps) {
    const requestedSource = props.itemId?.split(':')[0];
    const requestedDate = requestedSource === 'archive' ? props.itemId?.split(':')[1] || undefined : undefined;
    const [history, setHistory] = useState(requestedSource === 'archive');
    const [source, setSource] = useState<Source>(requestedSource === 'huggingface' || requestedSource === 'claude' ? requestedSource : 'github');
    useEffect(() => { if (requestedSource === 'archive') setHistory(true); else if (requestedSource === 'github' || requestedSource === 'huggingface' || requestedSource === 'claude') { setSource(requestedSource); setHistory(false); } }, [props.itemId]);
    return <div className="trends-workspace"><div className="toolbar trends-source-toolbar"><div className="segments trends-source-tabs" role="group" aria-label={tr('趋势来源')}>
        {(['github', 'huggingface', 'claude'] as const).map(value => <button key={value} aria-pressed={!history && source === value} onClick={() => { if (value !== source || history) props.edit(false); setSource(value); setHistory(false); }}>{value === 'github' ? 'GitHub' : value === 'huggingface' ? 'Hugging Face' : 'claude.dev'}</button>)}
    </div></div>
    <div className="trends-page-link">{!history && <button className="text-button link" onClick={() => open(links[source], props.feedback)}>{source === 'github' ? tr('打开今日 GitHub Trending') : source === 'huggingface' ? tr('打开 Hugging Face 模型榜') : tr('打开 claude.dev')}<ArrowUpRight size={13}/></button>}<button className="text-button link" aria-pressed={history} onClick={() => { props.edit(false); setHistory(value => !value); }}><Archive size={13}/>{history ? tr('返回实时趋势') : tr('历史归档')}</button></div>
    {history ? <TrendsArchive {...props} requestedDate={requestedDate}/> : source === 'github' ? <GitHubPanel {...props}/> : <FeedPanel key={source} source={source} {...props}/>}</div>;
}
function FeedPanel({ source, revision, feedback }: PanelProps & { source: 'huggingface' | 'claude' }) {
    const feed = useData<any>('trends_feed_list', revision, null, { source });
    const [refreshing, setRefreshing] = useState(false);
    const rows = feed.data?.source === source ? feed.data.items ?? [] : [];
    return <section className="trends-feed" aria-label={source === 'huggingface' ? tr('热门模型 Top 10') : tr('最新文章 10 篇')}>
        <div className="subhead"><strong>{source === 'huggingface' ? tr('热门模型 Top 10') : tr('最新文章 10 篇')}</strong><IconButton label={tr('刷新趋势')} icon={<RefreshCw size={15}/>} disabled={refreshing || feed.busy} onClick={async () => {
            setRefreshing(true); try { feed.setData(await window.notch.rpc('trends_feed_list', { source, force: true })); } catch (error) { feedback(errorMessage(error), 'error'); } finally { setRefreshing(false); }
        }}/></div>
        <p className="quiet trends-source-note">{source === 'huggingface' ? tr('按 Hugging Face 热门趋势排序') : tr('按发布日期倒序，非热度排名')}</p>
        <DataMessage busy={feed.busy || refreshing} error={feed.error}/>
        {feed.data?.error && <p className="inline-error" role="status">{feed.data.stale ? tr('更新失败，正在显示本地缓存。') : tr('暂时无法读取来源，请刷新或打开原站。')} <span>{feed.data.error}</span></p>}
        <div className="trends-ranked-list">{rows.map((item: any) => <article className="trends-ranked-row" key={item.id}><span className="trends-rank" aria-label={tr('第 {{rank}} 项', { rank: item.rank })}>{String(item.rank).padStart(2, '0')}</span><div className="row-content"><button className="text-button row-title link" onClick={() => open(item.url, feedback)}>{item.title}<ArrowUpRight size={12}/></button>
            {source === 'huggingface' ? <span className="row-meta">{item.task && <span>{item.task}</span>}<span><Download size={11}/>{tr('下载 {{count}}', { count: Number(item.downloads).toLocaleString(currentLocale()) })}</span><span><Star size={11}/>{tr('喜欢 {{count}}', { count: Number(item.likes).toLocaleString(currentLocale()) })}</span></span>
            : <span className="row-meta">{item.date && <time dateTime={item.date}>{item.date}</time>}{item.readingMinutes && <span>{tr('{{count}} 分钟阅读', { count: item.readingMinutes })}</span>}{item.author && <span>{item.author}</span>}</span>}
        </div></article>)}</div>
        {!feed.busy && !refreshing && !feed.error && !feed.data?.error && !rows.length && <Empty icon={<Star size={21}/>} title={tr('暂无趋势结果')} detail={tr('切换时段或刷新后再试。')}/>}
        {feed.data?.fetchedAt && <small className="quiet trends-fetch-time">{tr('更新于 {{time}}', { time: new Date(feed.data.fetchedAt).toLocaleString(currentLocale()) })}{feed.data.stale ? ' · ' + tr('缓存') : ''}</small>}
    </section>;
}
function GitHubPanel({ revision, feedback, edit }: PanelProps) {
    const [period, setPeriod] = useState('daily');
    const [language, setLanguage] = useState('');
    const [form, setForm] = usePanelDraft<{ provider: string; owner: string; repo: string } | null>('trends.editor', null, edit);
    const trends = useData<any>('trends_list', revision, null, { period, language: language || undefined });
    const sources = useData<any>('trends_sources', revision, []);
    const actions = useActions(feedback, () => { trends.reload(); sources.reload(); });
    const repos = rowsFrom(trends.data, ['items', 'repositories', 'repos', 'results', 'trends']);
    const tracked = rowsFrom(sources.data, ['sources', 'items']);
    function closeForm() { setForm(null); edit(false); }
    return <>
    <div className="toolbar trends-github-toolbar"><div className="segments" role="group" aria-label={tr('趋势时段')}>{[['daily', tr('日')], ['weekly', tr('周')], ['monthly', tr('月')]].map(([id, label]) => <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}</div>
      <div className="row-actions"><select aria-label={tr('语言')} value={language} onChange={event => setLanguage(event.target.value)}><option value="">{tr('全部语言')}</option>{['TypeScript', 'Python', 'Rust', 'Go', 'JavaScript'].map(value => <option key={value}>{value}</option>)}</select><IconButton label={tr('刷新趋势')} icon={<RefreshCw size={15}/>} disabled={actions.busy} onClick={async () => {
            const result = await actions.run('trends_list', { period, language: language || undefined, force: true }); if (result.ok) trends.setData(result.result);
        }}/></div>
    </div>
    <DataMessage busy={trends.busy} error={trends.error}/>
    {trends.data?.error && <p className="inline-error" role="status">{trends.data.stale ? tr('更新失败，正在显示本地缓存。') : tr('暂时无法读取来源，请刷新或打开原站。')} {trends.data.error}</p>}
    {!trends.busy && !trends.error && !trends.data?.error && !repos.length && <Empty icon={<Star size={21}/>} title={tr('暂无趋势结果')} detail={tr('切换时段或刷新后再试。')}/>}
    <div className="rows">{repos.slice(0, 16).map((item, index) => <article className="row" key={item.id ?? index}><div className="row-content"><button className="text-button row-title link" onClick={() => open(item.url, feedback)}>{item.fullName ?? item.title}<ArrowUpRight size={12}/></button><span className="row-meta">{item.language && <span>{item.language}</span>}{typeof item.stars === 'number' && <span><Star size={11}/> {item.stars.toLocaleString()}</span>}{item.description && <span className="ellipsis">{item.description}</span>}</span></div></article>)}</div>
    <div className="subhead"><span>{tr('已关注来源')}</span><button className="button" onClick={() => { setForm({ provider: 'github', owner: '', repo: '' }); edit(true); }}><Plus size={14}/>{tr('关注')}</button></div>
    {form && <form className="editor" onSubmit={async event => { event.preventDefault(); if ((await actions.run('trends_source_add', { ...form, repo: form.repo || undefined }, tr('关注已添加'))).ok) closeForm(); }}>
        <div className="form-grid"><label>{tr('服务')}<select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })}><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></label><label>{tr('所有者')}<input required autoFocus value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })}/></label></div>
        <label>{tr('仓库')}<input value={form.repo} placeholder={tr('可选')} onChange={event => setForm({ ...form, repo: event.target.value })}/></label><div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr('取消')}</button><button className="button primary" disabled={actions.busy}>{tr('保存')}</button></div></form>}
    <DataMessage busy={sources.busy} error={sources.error}/>
    <div className="rows">{tracked.map(item => <article className="row" key={item.id}><Link2 size={15}/><div className="row-content"><strong className="row-title">{item.label || [item.owner, item.repo].filter(Boolean).join('/')}</strong><span className="row-meta">{item.provider}</span></div><IconButton label={tr('取消关注')} danger icon={<Trash2 size={14}/>} onClick={() => void actions.run('trends_source_remove', { id: item.id }, tr('已取消关注'))}/></article>)}</div>
  </>;
}
