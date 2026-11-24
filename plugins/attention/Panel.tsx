import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('attention');
import { ArrowUpRight, Bell, Check, Clock3 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, type PanelProps } from '../../src/ui/primitives';
import { formatTime } from '../../src/ui/types';
type Request = {
    id: string;
    provider: string;
    title: string;
    body?: string;
    status?: string;
    createdAt?: number;
};
const statusLabel: Record<string, string> = { pending: tr("待处理"), opened: tr("已打开"), snoozed: tr("稍后提醒"), resolved: tr("已处理") };
export function AttentionPanel({ revision, feedback }: PanelProps) {
    const attention = useData<Request[]>('attention_list', revision, []);
    const actions = useActions(feedback, attention.reload);
    const items = Array.isArray(attention.data) ? attention.data : [];
    return <>
    <DataMessage busy={attention.busy} error={attention.error}/>
    {!attention.busy && !attention.error && !items.length && <Empty icon={<Bell size={20}/>} title={tr("暂无协作提醒")} detail={tr("已连接的 Agent 可以请求你关注某个会话\u3002")}/>}
    <div className="rows">{items.map(item => <article className="row" key={item.id}>
      <div className="row-icon"><Bell size={16}/></div>
      <div className="row-content"><strong className="row-title">{item.title || tr("协作提醒")}</strong><span className="row-meta">{[item.provider, statusLabel[item.status ?? 'pending'], formatTime(item.createdAt)].filter(Boolean).join(' · ')}</span>{item.body && <span className="row-meta ellipsis" title={item.body}>{item.body}</span>}</div>
      <div className="row-actions">{item.status !== 'resolved' && <><IconButton label={tr("稍后 10 分钟")} disabled={actions.busy} icon={<Clock3 size={15}/>} onClick={() => void actions.run('attention_snooze', { id: item.id, minutes: 10 }, tr("10 分钟后再提醒"))}/><IconButton label={tr("标记已处理")} disabled={actions.busy} icon={<Check size={15}/>} onClick={() => void actions.run('attention_resolve', { id: item.id }, tr("已处理"))}/></>}
        <button className="button" disabled={actions.busy} onClick={() => void actions.run('attention_open', { id: item.id })}>{tr("打开")}<ArrowUpRight size={13}/></button></div>
    </article>)}</div>
  </>;
}
