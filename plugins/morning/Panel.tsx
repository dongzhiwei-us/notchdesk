import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('morning');
import { ArrowUpRight, CalendarDays, RefreshCw, Sparkles } from 'lucide-react';
import { DataMessage, useActions, useData, type PanelProps } from '../../src/ui/primitives';
import { errorMessage, formatTime } from '../../src/ui/types';
type Item = {
    id?: string;
    title: string;
    detail?: string;
    url?: string;
    dueAt?: number;
};
type Digest = {
    day: string;
    sections: Array<{
        id: string;
        title: string;
        total: number;
        items: Item[];
    }>;
    suggestions: Array<Item & {
        method?: string;
        params?: Record<string, unknown>;
    }>;
    sources: Array<{
        provider: string;
        label?: string;
        connected: boolean;
        error?: string;
    }>;
};
export function MorningPanel({ revision, feedback }: PanelProps) {
    const report = useData<Digest | null>('morning_get', revision, null);
    const actions = useActions(feedback, report.reload);
    const date = new Intl.DateTimeFormat(currentLocale(), { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    function openUrl(url: string) { void window.notch.openExternal(url).catch(error => feedback(errorMessage(error), 'error')); }
    async function forceRefresh() {
        const result = await actions.run('morning_get', { force: true });
        if (result.ok)
            report.setData(result.result);
    }
    return <><div className="toolbar"><span className="quiet">{date}</span><button className="button" disabled={actions.busy} onClick={() => void forceRefresh()}><RefreshCw size={14}/>{tr("刷新简报")}</button></div>
    <DataMessage busy={report.busy} error={report.error}/>
    {report.data?.sections.map(section => <div className="feature-card" key={section.id}>
      <div className="feature-label"><CalendarDays size={14}/>{tr(section.title)} <span className="quiet">· {section.total}</span></div>
      {section.items.length ? section.items.map((item, index) => <div className="digest-item" key={item.id ?? index}>
        {item.url ? <button className="text-button link" onClick={() => openUrl(item.url!)}>{item.title} <ArrowUpRight size={12}/></button> : <p>{item.title}</p>}
        {(item.detail || item.dueAt) && <span className="quiet">{[item.detail, formatTime(item.dueAt)].filter(Boolean).join(' · ')}</span>}
      </div>) : <p className="quiet">{tr("暂无事项")}</p>}
    </div>)}
    {!!report.data?.suggestions.length && <div className="feature-card"><div className="feature-label"><Sparkles size={14}/>{tr("建议下一步")}</div>{report.data.suggestions.map((item, index) => <div key={item.id ?? index} className="row"><div className="row-content"><strong className="row-title">{item.title}</strong>{item.detail && <span className="row-meta ellipsis">{item.detail}</span>}</div>
      {item.method && <button className="button" disabled={actions.busy} onClick={() => void actions.run(item.method!, item.params ?? {}, item.method === 'morning_adopt' ? tr("已加入待办") : undefined)}>{item.method === 'morning_adopt' ? tr("加入待办") : tr("查看")}</button>}
    </div>)}</div>}
    {report.data?.sources.filter(source => source.error).map(source => <p className="inline-error" key={source.provider}>{source.label || source.provider} {source.error}</p>)}
  </>;
}
