import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, FileText, Save } from 'lucide-react';
import { createPluginTranslator } from '../../src/ui/i18n';
import { MarkdownView } from '../../src/ui/Markdown';
import { DataMessage, Empty, IconButton, useActions, useData, type PanelProps } from '../../src/ui/primitives';
const { fmt: tr } = createPluginTranslator('trends');
type Day = { date: string; count: number; partial: boolean; generatedAt: number };
type History = { directory: string; days: Day[]; schedule?: { enabled: boolean; time: string; timezone: string } };
type Document = { date: string; found: boolean; content?: string; exportError?: string; files?: { markdown: string }; generatedAt?: number };
function localDay() { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); }
export function TrendsArchive({ revision, feedback, requestedDate }: PanelProps & { requestedDate?: string }) {
    const today = localDay();
    const [date, setDate] = useState(requestedDate || today);
    const selected = useRef(!!requestedDate);
    const history = useData<History>('trends_archive_list', revision, { directory: '', days: [] });
    const document = useData<Document>('trends_archive_get', revision, { date: '', found: false }, { date, format: 'markdown' });
    const actions = useActions(feedback, () => { history.reload(); document.reload(); });
    useEffect(() => { if (requestedDate) { selected.current = true; setDate(requestedDate); } }, [requestedDate]);
    useEffect(() => {
        if (!selected.current && !history.busy) { selected.current = true; if (history.data.days.length && !history.data.days.some(day => day.date === today)) setDate(history.data.days[0].date); }
    }, [history.busy, history.data.days]);
    const position = history.data.days.findIndex(day => day.date === date);
    const current = document.data.date === date ? document.data : null;
    const schedule = history.data.schedule;
    const content = current?.content?.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') ?? '';
    function choose(value: string) { if (value) { selected.current = true; setDate(value); } }
    return <section className="trends-archive" aria-label={tr('历史归档')}>
        <div className="toolbar trends-archive-toolbar"><div className="trends-archive-date">
            <IconButton label={tr('更早的归档')} icon={<ChevronLeft size={15}/>} disabled={position < 0 || position + 1 >= history.data.days.length} onClick={() => choose(history.data.days[position + 1].date)}/>
            <label><input type="date" aria-label={tr('归档日期')} value={date} max={today} onChange={event => choose(event.target.value)}/></label>
            <IconButton label={tr('更新的归档')} icon={<ChevronRight size={15}/>} disabled={position <= 0} onClick={() => choose(history.data.days[position - 1].date)}/>
        </div><button className="button primary" disabled={actions.busy} onClick={async () => {
            if ((await actions.run('trends_archive_save', { force: true }, tr('今日趋势已保存'))).ok) choose(today);
        }}><Save size={14}/>{actions.busy ? tr('正在保存…') : tr('保存今日')}</button></div>
        <div className="trends-archive-summary"><small className="quiet">{schedule ? schedule.enabled ? tr('每天 {{time}} 自动保存 · {{timezone}}', { time: schedule.time, timezone: schedule.timezone }) : tr('自动保存已关闭，可在设置中开启。') : tr('每天一份文档，随时回看。')}</small>
            {!!history.data.days.length && <select aria-label={tr('已保存的日期')} value={position >= 0 ? date : ''} onChange={event => choose(event.target.value)}><option value="" disabled>{tr('选择归档')}</option>{history.data.days.map(day => <option key={day.date} value={day.date}>{day.date} · {tr('{{count}} 条', { count: day.count })}{day.partial ? ' · ' + tr('部分来源不可用') : ''}</option>)}</select>}
        </div>
        <DataMessage busy={history.busy || document.busy || (!current && !document.error)} error={history.error || document.error}/>
        {current?.exportError && <p className="inline-error" role="status">{tr('本地文件导出失败，已保留数据库记录。')} {current.exportError}</p>}
        {current?.found && <><div className="trends-archive-filebar"><span className="quiet">Markdown + JSON</span><button className="button" disabled={actions.busy || !!current.exportError} onClick={() => void actions.run('trends_archive_open', { date })}><FileText size={14}/>{tr('打开文档')}</button></div>
            <div className="trends-archive-document"><MarkdownView text={content} onError={message => feedback(message, 'error')}/></div></>}
        {current && !current.found && !document.error && <Empty icon={<Archive size={24}/>} title={tr('这一天还没有归档')} detail={tr('可以保存今日趋势；未采集的过往日期不会自动补造。')}/>}
        {history.data.directory && <details className="trends-archive-directory"><summary>{tr('归档目录')}</summary><code>{history.data.directory}</code><p className="quiet">{tr('可分享每日 Markdown，或让其他工具读取 JSON 和 index.json。')}</p></details>}
    </section>;
}
