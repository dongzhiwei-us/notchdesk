import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('trends');
import { useState } from 'react';
import { ArrowUpRight, Link2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, rowsFrom, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import { errorMessage } from '../../src/ui/types';
export function TrendsPanel({ revision, feedback, edit }: PanelProps) {
    const [period, setPeriod] = useState('weekly');
    const [language, setLanguage] = useState('');
    const [form, setForm] = usePanelDraft<{
        provider: string;
        owner: string;
        repo: string;
    } | null>('trends.editor',null,edit);
    const trends = useData<any>('trends_list', revision, null, { period, language: language || undefined });
    const sources = useData<any>('trends_sources', revision, []);
    const actions = useActions(feedback, () => { trends.reload(); sources.reload(); });
    const repos = rowsFrom(trends.data, ['items', 'repositories', 'repos', 'results', 'trends']);
    const tracked = rowsFrom(sources.data, ['sources', 'items']);
    function closeForm() { setForm(null); edit(false); }
    return <>
    <div className="toolbar"><div className="segments" aria-label={tr("趋势时段")}>{[['daily', tr("日")], ['weekly', tr("周")], ['monthly', tr("月")]].map(([id, text]) => <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>{tr(text)}</button>)}</div>
      <div className="row-actions"><select aria-label={tr("语言")} value={language} onChange={event => setLanguage(event.target.value)}><option value="">{tr("全部语言")}</option>{['TypeScript', 'Python', 'Rust', 'Go', 'JavaScript'].map(value => <option key={value}>{value}</option>)}</select><IconButton label={tr("刷新趋势")} icon={<RefreshCw size={15}/>} disabled={actions.busy} onClick={async () => {
            const result = await actions.run('trends_list', { period, language: language || undefined, force: true });
            if (result.ok)
                trends.setData(result.result);
        }}/></div>
    </div>
    <DataMessage busy={trends.busy} error={trends.error}/>
    {!trends.busy && !trends.error && !repos.length && <Empty icon={<Star size={21}/>} title={tr("暂无趋势结果")} detail={tr("切换时段或刷新后再试\u3002")}/>}
    <div className="rows">{repos.slice(0, 16).map((item, index) => {
            const name = item.fullName ?? item.full_name ?? item.name ?? item.repo ?? item.repository ?? item.title;
            const url = item.url ?? item.html_url ?? item.web_url;
            const stars = item.stars ?? item.stargazers_count ?? item.star_count;
            return <article className="row" key={item.id ?? url ?? index}><div className="row-content">{url ? <button className="text-button row-title link" onClick={() => void window.notch.openExternal(url).catch(error => feedback(errorMessage(error), 'error'))}>{String(name ?? url)} <ArrowUpRight size={12}/></button> : <strong className="row-title">{String(name ?? tr("仓库"))}</strong>}<span className="row-meta">{item.language && <span>{item.language}</span>}{typeof stars === 'number' && <span><Star size={11}/> {stars.toLocaleString()}</span>}{item.description && <span className="ellipsis">{item.description}</span>}</span></div></article>;
        })}</div>
    <div className="subhead"><span>{tr("已关注来源")}</span><button className="button" onClick={() => { setForm({ provider: 'github', owner: '', repo: '' }); edit(true); }}><Plus size={14}/>{tr("关注")}</button></div>
    {form && <form className="editor" onSubmit={async (event) => {
                event.preventDefault();
                if ((await actions.run('trends_source_add', { ...form, repo: form.repo || undefined }, tr("关注已添加"))).ok)
                    closeForm();
            }}><div className="form-grid"><label>{tr("服务")}<select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })}><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></label><label>{tr("所有者")}<input required autoFocus value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })}/></label></div><label>{tr("仓库")}<input value={form.repo} placeholder={tr("可选")} onChange={event => setForm({ ...form, repo: event.target.value })}/></label><div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr("取消")}</button><button className="button primary" disabled={actions.busy}>{tr("保存")}</button></div></form>}
    <DataMessage busy={sources.busy} error={sources.error}/>
    <div className="rows">{tracked.map(item => <article className="row" key={item.id}><Link2 size={15}/><div className="row-content"><strong className="row-title">{item.label || [item.owner, item.repo].filter(Boolean).join('/')}</strong><span className="row-meta">{item.provider}</span></div><IconButton label={tr("取消关注")} danger icon={<Trash2 size={14}/>} onClick={() => void actions.run('trends_source_remove', { id: item.id }, tr("已取消关注"))}/></article>)}</div>
  </>;
}
