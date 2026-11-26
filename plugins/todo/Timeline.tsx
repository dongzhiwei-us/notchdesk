import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
import { IconButton } from '../../src/ui/primitives';
import { dayDate, dayKey, hoursForDay, hourSpan, shiftDay, todoSpan, weekOf, type Granularity, type ScheduleDraft, type Todo, type TodoTag } from './calendar';
import { GranularitySwitch } from './GranularitySwitch';
const { tr, fmt } = createPluginTranslator('todo');
export function TodoTimeline({ items, today, granularity, setGranularity, tags, create, open }: {
    items: Todo[]; today: string; granularity: Granularity; setGranularity: (value: Granularity) => void; tags: TodoTag[];
    create: (schedule: ScheduleDraft) => void; open: (item: Todo) => void;
}) {
    const [week, setWeek] = useState(() => weekOf(today));
    const [day, setDay] = useState(today);
    const [selection, setSelection] = useState<{ from: number; until: number } | null>(null);
    const drag = useRef<{ id: number; from: number } | null>(null);
    const previousToday = useRef(today);
    const scroll = useRef<HTMLDivElement>(null);
    useEffect(() => { drag.current = null; setSelection(null); }, [granularity, week, day]);
    useEffect(() => {
        const previous = previousToday.current; previousToday.current = today;
        setWeek(value => value === weekOf(previous) ? weekOf(today) : value); setDay(value => value === previous ? today : value);
    }, [today]);
    useEffect(() => { if (granularity === 'hour' && scroll.current) { const hours = hoursForDay(day).length - 1; scroll.current.scrollLeft = Math.min(8, hours - 1) * 44; } else if (scroll.current) scroll.current.scrollLeft = 0; }, [granularity, day]);
    const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDay(week, index)), [week]);
    const hours = useMemo(() => hoursForDay(day), [day]), count = granularity === 'day' ? 7 : hours.length - 1;
    const columns = granularity === 'day' ? 'repeat(7,minmax(0,1fr))' : hours.slice(1).map((value, index) => `${(value - hours[index]) / 3600000}fr`).join(' ');
    const dateLabel = (value: string) => dayDate(value).toLocaleDateString(currentLocale(), { month: 'long', day: 'numeric', weekday: 'short' });
    const hourLabel = (value: number) => new Date(value).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const scheduled = useMemo(() => items.flatMap(item => { const span = granularity === 'day' ? todoSpan(item, week) : hourSpan(item, day); return span ? [{ item, span }] : []; }), [items, granularity, week, day]);
    const column = (event: PointerEvent<HTMLDivElement>) => {
        const box = event.currentTarget.getBoundingClientRect(), ratio = Math.max(0, Math.min(.999999, (event.clientX - box.left) / box.width));
        if (granularity === 'day') return Math.min(6, Math.floor(ratio * 7));
        const time = hours[0] + ratio * (hours.at(-1)! - hours[0]);
        return Math.max(0, hours.findIndex((value, index) => index < hours.length - 1 && value <= time && time < hours[index + 1]));
    };
    function createRange(from: number, until = from) {
        if (granularity === 'day') create({ timeGranularity: 'day', startDate: days[from], endDate: days[until] });
        else create({ timeGranularity: 'hour', startAt: hours[from], endAt: hours[until + 1] });
    }
    const selectedFrom = selection ? Math.min(selection.from, selection.until) : 0, selectedUntil = selection ? Math.max(selection.from, selection.until) + 1 : 0;
    const startRatio = granularity === 'day' ? selectedFrom / 7 : (hours[selectedFrom] - hours[0]) / (hours.at(-1)! - hours[0]);
    const endRatio = granularity === 'day' ? selectedUntil / 7 : (hours[selectedUntil] - hours[0]) / (hours.at(-1)! - hours[0]);
    const canvasStyle = { '--todo-columns': count, '--todo-grid': columns, ...(granularity === 'hour' ? { minWidth: `${count * 44}px` } : {}) } as CSSProperties;
    return <section className="todo-timeline" data-granularity={granularity} aria-label={tr('待办时间轴')}>
        <div className="todo-timeline-controls"><GranularitySwitch value={granularity} onChange={setGranularity} label={tr('视图粒度')}/><span className="quiet">{granularity === 'day' ? tr('一周日程') : tr('一天的小时安排')}</span></div>
        <div className="todo-timeline-heading"><div><span className="todo-eyebrow">{tr('日程')}</span>{granularity === 'day' ? <strong>{dayDate(week).toLocaleDateString(currentLocale(), { year: 'numeric', month: 'long' })}</strong> : <input type="date" aria-label={tr('小时视图日期')} value={day} onChange={event => { if (event.target.value) { setDay(event.target.value); setWeek(weekOf(event.target.value)); } }}/>}</div>
            <div className="row-actions"><button type="button" className="button quiet-button" onClick={() => { setWeek(weekOf(today)); setDay(today); }}>{tr('今天')}</button>
                <IconButton label={granularity === 'day' ? tr('上一周') : tr('上一天')} icon={<ChevronLeft size={15}/>} onClick={() => { if (granularity === 'day') { setWeek(shiftDay(week, -7)); setDay(shiftDay(day, -7)); } else { const next = shiftDay(day, -1); setDay(next); setWeek(weekOf(next)); } }}/>
                <IconButton label={granularity === 'day' ? tr('下一周') : tr('下一天')} icon={<ChevronRight size={15}/>} onClick={() => { if (granularity === 'day') { setWeek(shiftDay(week, 7)); setDay(shiftDay(day, 7)); } else { const next = shiftDay(day, 1); setDay(next); setWeek(weekOf(next)); } }}/></div></div>
        <div className="todo-timeline-scroll" ref={scroll}><div className="todo-timeline-canvas" style={canvasStyle}>
            <div className="todo-date-axis">{granularity === 'day' ? days.map((value, index) => <button type="button" key={value} data-today={value === today} aria-label={fmt('在{{date}}新增待办', { date: dateLabel(value) })} title={dateLabel(value)} onClick={() => { setDay(value); createRange(index); }}>
                <small>{dayDate(value).toLocaleDateString(currentLocale(), { weekday: 'short' })}</small><strong>{dayDate(value).getDate()}</strong><span className="todo-date-dot" aria-hidden="true" data-filled={items.some(item => todoSpan(item, value)?.from === 0)} />
            </button>) : hours.slice(0, -1).map((value, index) => <button type="button" key={value} aria-label={fmt('在{{time}}新增待办', { time: new Date(value).toLocaleString(currentLocale()) })} onClick={() => createRange(index)}><small>{hourLabel(value)}</small></button>)}</div>
            <div className="todo-timeline-bars">{scheduled.map(({ item, span }) => {
                const label = [tags.find(tag => tag.id === item.tagId)?.name, item.title].filter(Boolean).join(' · ');
                return <div className={`todo-timeline-lane${granularity === 'hour' ? ' todo-hour-lane' : ''}`} key={item.id}><button type="button" className="todo-time-bar" data-status={item.status} data-before={span.before} data-after={span.after}
                    style={granularity === 'day' ? { gridColumn: `${span.from + 1} / ${span.until + 2}` } : { left: `${span.from * 100}%`, width: `${Math.max(.006, span.until - span.from) * 100}%` }} onClick={() => open(item)} title={label}><span>{item.status === 'completed' ? '✓ ' : ''}{label}</span></button></div>;
            })}{!scheduled.length && <p className="todo-timeline-empty">{granularity === 'day' ? tr('这一周还没有安排') : tr('这一天还没有安排')}</p>}</div>
            <div className="todo-range-create" aria-label={granularity === 'day' ? tr('拖选日期区间新增待办') : tr('拖选小时区间新增待办')} onPointerDown={event => {
                if (event.button !== 0) return; const from = column(event); drag.current = { id: event.pointerId, from }; setSelection({ from, until: from }); event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={event => {
                if (!drag.current || drag.current.id !== event.pointerId) return; const until = column(event), from = drag.current.from; setSelection(previous => previous?.until === until ? previous : { from, until });
            }} onPointerUp={event => {
                if (!drag.current || drag.current.id !== event.pointerId) return; const from = drag.current.from, until = column(event); drag.current = null; setSelection(null); event.currentTarget.releasePointerCapture(event.pointerId); createRange(Math.min(from, until), Math.max(from, until));
            }} onPointerCancel={() => { drag.current = null; setSelection(null); }}>
                {selection && <span className="todo-range-selection" aria-hidden="true" style={{ left: `${startRatio * 100}%`, width: `${(endRatio - startRatio) * 100}%` }}/>}
                {Array.from({ length: count }, (_, index) => <button type="button" key={index} aria-label={granularity === 'day' ? fmt('在{{date}}新增待办', { date: dateLabel(days[index]) }) : fmt('在{{time}}新增待办', { time: new Date(hours[index]).toLocaleString(currentLocale()) })} onClick={event => { if (event.detail === 0) createRange(index); }}><Plus size={13}/></button>)}
            </div>
        </div></div>
        <p className="todo-timeline-hint">{granularity === 'day' ? tr('点击日期，或拖选下方区间来新增') : tr('横向滚动查看小时，点击或拖选下方区间新增')}</p>
    </section>;
}
