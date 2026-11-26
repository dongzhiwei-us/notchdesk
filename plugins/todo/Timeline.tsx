import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
import { IconButton } from '../../src/ui/primitives';
import { dayDate, dayKey, shiftDay, todoSpan, weekOf, type Todo } from './calendar';
const { tr, fmt } = createPluginTranslator('todo');

export function TodoTimeline({ items, today, create, open }: {
    items: Todo[]; today: string; create: (from: string, until?: string) => void; open: (item: Todo) => void;
}) {
    const [week, setWeek] = useState(() => weekOf(today));
    const [selection, setSelection] = useState<{ from: number; until: number } | null>(null);
    const drag = useRef<{ id: number; from: number } | null>(null);
    const previousToday = useRef(today);
    useEffect(() => {
        const previousWeek = weekOf(previousToday.current); previousToday.current = today;
        setWeek(value => value === previousWeek ? weekOf(today) : value);
    }, [today]);
    const days = Array.from({ length: 7 }, (_, index) => shiftDay(week, index));
    const dateLabel = (day: string) => dayDate(day).toLocaleDateString(currentLocale(), { month: 'long', day: 'numeric', weekday: 'short' });
    const scheduled = items.flatMap(item => { const span = todoSpan(item, week); return span ? [{ item, span }] : []; });
    const column = (event: PointerEvent<HTMLDivElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        return Math.max(0, Math.min(6, Math.floor((event.clientX - box.left) / (box.width / 7))));
    };
    return <section className="todo-timeline" aria-label={tr('待办时间轴')}>
        <div className="todo-timeline-heading"><div><span className="todo-eyebrow">{tr('日程')}</span><strong>{dayDate(week).toLocaleDateString(currentLocale(), { year: 'numeric', month: 'long' })}</strong></div>
            <div className="row-actions"><button type="button" className="button quiet-button" onClick={() => setWeek(weekOf(dayKey()))}>{tr('今天')}</button>
                <IconButton label={tr('上一周')} icon={<ChevronLeft size={15}/>} onClick={() => setWeek(shiftDay(week, -7))}/>
                <IconButton label={tr('下一周')} icon={<ChevronRight size={15}/>} onClick={() => setWeek(shiftDay(week, 7))}/></div></div>
        <div className="todo-timeline-scroll"><div className="todo-timeline-canvas">
            <div className="todo-date-axis">{days.map(day => <button type="button" key={day} data-today={day === today} aria-label={fmt('在{{date}}新增待办', { date: dateLabel(day) })} title={dateLabel(day)} onClick={() => create(day)}>
                <small>{dayDate(day).toLocaleDateString(currentLocale(), { weekday: 'short' })}</small><strong>{dayDate(day).getDate()}</strong><span className="todo-date-dot" aria-hidden="true" data-filled={items.some(item => !!todoSpan(item, day) && todoSpan(item, day)?.from === 0)} />
            </button>)}</div>
            <div className="todo-timeline-bars">{scheduled.map(({ item, span }) => <div className="todo-timeline-lane" key={item.id}>
                <button type="button" className="todo-time-bar" data-status={item.status} data-before={span.before} data-after={span.after} style={{ gridColumn: `${span.from + 1} / ${span.until + 2}` }} onClick={() => open(item)} title={item.title}>
                    <span>{item.status === 'completed' ? '✓ ' : ''}{item.title}</span>
                </button></div>)}
                {!scheduled.length && <p className="todo-timeline-empty">{tr('这一周还没有安排')}</p>}
            </div>
            <div className="todo-range-create" aria-label={tr('拖选日期区间新增待办')} onPointerDown={event => {
                if (event.button !== 0) return;
                const from = column(event); drag.current = { id: event.pointerId, from }; setSelection({ from, until: from }); event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={event => {
                if (!drag.current || drag.current.id !== event.pointerId) return;
                const until = column(event), from = drag.current.from;
                setSelection(previous => previous?.until === until ? previous : { from, until });
            }} onPointerUp={event => {
                if (!drag.current || drag.current.id !== event.pointerId) return;
                const from = drag.current.from, until = column(event); drag.current = null; setSelection(null); event.currentTarget.releasePointerCapture(event.pointerId);
                create(days[Math.min(from, until)], days[Math.max(from, until)]);
            }} onPointerCancel={() => { drag.current = null; setSelection(null); }}>
                {selection && <span className="todo-range-selection" aria-hidden="true" style={{ left: `${Math.min(selection.from, selection.until) / 7 * 100}%`, width: `${(Math.abs(selection.until - selection.from) + 1) / 7 * 100}%` }}/>}
                {days.map(day => <button type="button" key={day} aria-label={fmt('在{{date}}新增待办', { date: dateLabel(day) })} onClick={event => { if (event.detail === 0) create(day); }}><Plus size={13}/></button>)}
            </div>
        </div></div>
        <p className="todo-timeline-hint">{tr('点击日期，或拖选下方区间来新增')}</p>
    </section>;
}
