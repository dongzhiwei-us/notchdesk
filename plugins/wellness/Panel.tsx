import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('wellness');
import type { CSSProperties } from 'react';
import { Check, Droplets, Footprints, Timer } from 'lucide-react';
import { DataMessage, useActions, useData, type PanelProps } from '../../src/ui/primitives';
export function WellnessPanel({ revision, feedback }: PanelProps) {
    const wellness = useData<any>('wellness_status', revision, null);
    const actions = useActions(feedback, wellness.reload);
    const status = wellness.data;
    return <>
    <DataMessage busy={wellness.busy} error={wellness.error}/>
    {status && <><div className="toolbar"><span className="quiet"><Timer size={14}/>{tr("活跃")}{Math.floor(Number(status.activeSeconds || 0) / 60)}{tr("分钟")}</span><button className="button" disabled={actions.busy} onClick={() => void actions.run('wellness_pause', { paused: !status.paused }, status.paused ? tr("已恢复提醒") : tr("已暂停提醒"))}>{status.paused ? tr("恢复提醒") : tr("暂停提醒")}</button></div>
      <div className="wellness-grid">{[['water', tr("喝水"), <Droplets size={18}/>], ['walk', tr("活动"), <Footprints size={18}/>]].map(([id, label, icon]) => {
                const detail = status[String(id)];
                const minutes = detail?.remainingSeconds != null ? Math.ceil(detail.remainingSeconds / 60) : null;
                const duration=Math.max(1,Number(detail?.dueAtActiveSeconds||0)-Number(detail?.lastAt||0)||(id==='water'?3600:7200));
                const progress=Math.max(0,Math.min(1,1-Number(detail?.remainingSeconds||0)/duration));
                return <div className="wellness-orbit" data-kind={String(id)} key={String(id)}><div className="health-ring" style={{ '--progress':progress*360+'deg' } as CSSProperties}>{icon}<strong>{Math.max(0, minutes ?? 0)}<small>{tr("分钟")}</small></strong></div><div className="feature-label">{icon}{tr(label)}</div><p>{detail?.due ? tr("该休息一下了") : minutes === null ? status.paused ? tr("提醒已暂停") : tr("提醒已开启") : fmt("{{value0}} 分钟后提醒", { value0: Math.max(0, minutes) })}</p><button className="button" disabled={actions.busy} onClick={() => void actions.run('wellness_handle', { kind: id, decision: 'done' }, tr("已记录"))}><Check size={14}/>{tr("完成")}</button></div>;
            })}</div></>}
  </>;
}
