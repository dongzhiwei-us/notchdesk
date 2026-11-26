import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('todo');
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Clock3, HardDrive, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import { MarkdownEditor, MarkdownView } from '../../src/ui/Markdown';
import { errorMessage, formatTime, localMinute } from '../../src/ui/types';
import { dayDate, dayKey, endOf, type Granularity, type ScheduleDraft, type Todo, type TodoTag } from './calendar';
import { TodoTimeline } from './Timeline';
import { GranularitySwitch } from './GranularitySwitch';
import { TodoTags } from './Tags';
import './style.css';

const statuses = { pending: '待开始', 'in-progress': '进行中', completed: '已完成' };
type Form = { id?: string; title: string; notes: string; startAt: string; endAt: string; status: Todo['status']; timeGranularity: Granularity; tagId: string; originalTimes?: { startAt: number | null; endAt: number | null } };
const blankTodo: Form = { title: '', notes: '', startAt: '', endAt: '', status: 'pending', timeGranularity: 'day', tagId: '' };
function TodoDetails({ text, feedback }: { text: string; feedback: PanelProps['feedback'] }) {
    const [open, setOpen] = useState(false);
    return <details className="todo-details" onToggle={event => setOpen(event.currentTarget.open)}><summary>{tr('查看内容')}</summary>{open && <MarkdownView text={text} onError={message => feedback(message, 'error')}/>}</details>;
}
export function TodoPanel({ revision, feedback, edit, itemId }: PanelProps) {
    const { data, error, busy, reload } = useData<Todo[]>('todo_list', revision, []);
    const tagData = useData<TodoTag[]>('todo_tags_list', revision, []);
    const view = useData<{ granularity: Granularity }>('todo_view_get', revision, { granularity: 'day' });
    const actions = useActions(feedback, reload);
    const [granularity, setScale] = useState<Granularity>('day');
    const viewWrites = useRef(Promise.resolve());
    const pendingView = useRef(0);
    const [tagFilter, setTagFilter] = useState('*');
    const [tagsOpen, setTagsOpen] = useState(false);
    const [filter, setFilter] = useState('open');
    const [now, setNow] = useState(Date.now);
    const [form, setForm] = usePanelDraft<Form | null>('todo.editor', null, edit);
    const openedItem = useRef<string | undefined>(undefined);
    const editor = useRef<HTMLFormElement>(null);
    const todos = Array.isArray(data) ? data : [];
    const tags = Array.isArray(tagData.data) ? tagData.data : [];
    const filtered = todos.filter(item => (filter === 'all' || (filter === 'open' ? item.status !== 'completed' : item.status === 'completed')) && (tagFilter === '*' || (item.tagId ?? '') === tagFilter));
    useEffect(() => { if (!pendingView.current) setScale(view.data.granularity); }, [view.data.granularity]);
    useEffect(() => {
        if (tagData.busy) return;
        if (tagFilter && tagFilter !== '*' && !tags.some(tag => tag.id === tagFilter)) setTagFilter('*');
        if (form?.tagId && !tags.some(tag => tag.id === form.tagId)) setForm(previous => previous ? { ...previous, tagId: '' } : previous);
    }, [tagData.data, tagData.busy]);
    function setGranularity(value: Granularity) {
        setScale(value); pendingView.current++;
        viewWrites.current = viewWrites.current.catch(() => {}).then(async () => {
            try { const saved = await window.notch.rpc<{ granularity: Granularity }>('todo_view_set', { granularity: value }); if (pendingView.current === 1) view.setData(saved); }
            catch (error) { feedback(errorMessage(error), 'error'); if (pendingView.current === 1) { setScale(view.data.granularity); view.reload(); } }
            finally { pendingView.current--; }
        });
    }
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
    useEffect(() => { if (form) editor.current?.scrollIntoView({ block: 'nearest' }); }, [form?.id, !!form]);
    function openForm(todo?: Todo, schedule?: ScheduleDraft) {
        const precision = todo?.timeGranularity ?? (todo ? 'hour' : schedule?.timeGranularity ?? granularity);
        setForm(todo ? { id: todo.id, title: todo.title, status: todo.status, notes: todo.notes ?? '', timeGranularity: precision, tagId: todo.tagId ?? '',
            originalTimes: { startAt: todo.startAt ?? null, endAt: endOf(todo) }, startAt: precision === 'day' ? todo.startDate ?? (todo.startAt == null ? '' : dayKey(todo.startAt)) : localMinute(todo.startAt), endAt: precision === 'day' ? todo.endDate ?? (endOf(todo) == null ? '' : dayKey(endOf(todo)!)) : localMinute(endOf(todo)) }
            : { ...blankTodo, timeGranularity: precision, ...(schedule ? { originalTimes: { startAt: schedule.startAt ?? null, endAt: schedule.endAt ?? null }, startAt: precision === 'day' ? schedule.startDate ?? '' : localMinute(schedule.startAt), endAt: precision === 'day' ? schedule.endDate ?? '' : localMinute(schedule.endAt) } : {}) });
        edit(true);
    }
    function changePrecision(value: Granularity) {
        if (!form || value === (form.timeGranularity ?? 'hour')) return;
        const end = instant('endAt'), start = instant('startAt');
        const until = end != null && start != null && end > start ? end - 1 : end;
        setForm({ ...form, timeGranularity: value, originalTimes: undefined, startAt: form.startAt ? value === 'day' ? form.startAt.slice(0, 10) : form.startAt + 'T00:00' : '', endAt: form.endAt ? value === 'day' ? until == null ? form.endAt.slice(0, 10) : dayKey(until) : form.endAt + 'T23:59' : '' });
    }
    function closeForm() { setForm(null); edit(false); }
    useEffect(() => {
        if (itemId === openedItem.current) return;
        const todo = todos.find(item => item.id === itemId);
        if (todo) { openedItem.current = itemId; openForm(todo); }
        if (!itemId) openedItem.current = undefined;
    }, [data, itemId]);
    function instant(field: 'startAt' | 'endAt') {
        if (!form?.[field]) return null;
        const original = form.originalTimes?.[field];
        return original != null && localMinute(original) === form[field] ? original : new Date(form[field]).getTime();
    }
    const invalidRange = !!form?.startAt && !!form.endAt && (form.timeGranularity === 'day' ? form.endAt < form.startAt : instant('endAt')! < instant('startAt')!);
    async function save(event: FormEvent) {
        event.preventDefault();
        if (!form || !form.title.trim() || invalidRange) return;
        const { id, title, notes, startAt, endAt, status, timeGranularity, tagId } = form;
        const params = { title: title.trim(), notes, timeGranularity, tagId: tagId || null, ...(timeGranularity === 'day' ? { startDate: startAt || null, endDate: endAt || null } : { startAt: instant('startAt'), endAt: instant('endAt') }) };
        const result = await actions.run(id ? 'todo_update' : 'todo_add', id ? { ...params, id, status } : params, id ? tr('待办已更新') : tr('待办已添加'));
        if (result.ok) closeForm();
    }
    return <div className="todo-workspace">
        <div className="toolbar todo-toolbar"><div className="segments" aria-label={tr('筛选待办')}>
            {[['open', tr('未完成')], ['completed', tr('已完成')], ['all', tr('全部')]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div><button type="button" className="button primary" onClick={() => openForm()}><Plus size={15}/>{tr('新增待办')}</button></div>
        <div className="todo-tag-toolbar"><select aria-label={tr('筛选标签')} value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="*">{tr('全部标签')}</option><option value="">{tr('无标签')}</option>{tags.map(tag => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select><button type="button" className="button quiet-button" aria-expanded={tagsOpen} onClick={() => { setTagsOpen(value => !value); if (tagsOpen) edit(!!form); }}><Tags size={14}/>{tr('管理标签')}</button></div>
        {tagsOpen && <TodoTags tags={tags} feedback={feedback} edit={edit} reload={() => { tagData.reload(); reload(); }}/>}<DataMessage busy={false} error={tagData.error || view.error}/>
        <TodoTimeline items={filtered} today={dayKey(now)} granularity={granularity} setGranularity={setGranularity} tags={tags} create={schedule => openForm(undefined, schedule)} open={item => openForm(item)}/>
        {form && <form ref={editor} className="editor todo-editor" onSubmit={save}>
            <label>{tr('任务')}<input autoFocus required maxLength={240} placeholder={tr('下一步要做什么？')} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })}/></label>
            <GranularitySwitch value={form.timeGranularity ?? 'hour'} onChange={changePrecision} label={tr('任务时间精度')}/>
            <div className="form-grid todo-time-fields">
                <label>{form.timeGranularity === 'day' ? tr('开始日期') : tr('开始时间')}<input type={form.timeGranularity === 'day' ? 'date' : 'datetime-local'} value={form.startAt} aria-describedby={invalidRange ? 'todo-time-error' : undefined} onChange={event => setForm({ ...form, startAt: event.target.value })}/></label>
                <label>{form.timeGranularity === 'day' ? tr('结束日期') : tr('结束时间')}<input type={form.timeGranularity === 'day' ? 'date' : 'datetime-local'} value={form.endAt} min={form.timeGranularity === 'day' ? form.startAt || undefined : undefined} aria-invalid={invalidRange} aria-describedby={invalidRange ? 'todo-time-error' : undefined} onChange={event => setForm({ ...form, endAt: event.target.value })}/></label>
            </div>
            {invalidRange ? <p id="todo-time-error" className="inline-error" role="alert">{tr('结束时间不能早于开始时间')}</p> : <small className="quiet">{form.timeGranularity === 'day' ? tr('结束日期包含当天；在当天结束时提醒。日期可留空。') : tr('设置结束时间后，到点提醒；也可以暂不安排时间。')}</small>}
            <label>{tr('标签')}<select value={form.tagId || ''} onChange={event => setForm({ ...form, tagId: event.target.value })}><option value="">{tr('无标签')}</option>{tags.map(tag => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select></label>
            <MarkdownEditor label={tr('详细内容')} value={form.notes} onChange={notes => setForm({ ...form, notes })} placeholder={tr('用 Markdown 记录步骤、清单或代码')} labels={{ edit: tr('编辑'), preview: tr('预览'), empty: tr('暂无内容可预览'), hint: tr('支持 Markdown：标题、列表、链接和代码块') }}/>
            {form.id && <label>{tr('状态')}<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as Todo['status'] })}>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></label>}
            <div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr('取消')}</button><button className="button primary" disabled={actions.busy || invalidRange}>{form.id ? tr('保存修改') : tr('创建待办')}</button></div>
        </form>}
        <DataMessage busy={busy} error={error}/>
        <div className="todo-agenda-heading"><strong>{tr('任务清单')} <span>{filtered.length}</span></strong><span className="todo-storage-note"><HardDrive size={12}/>{tr('本地保存，重启恢复')}</span></div>
        {!busy && !error && !filtered.length && !form && <Empty icon={<Check size={21}/>} title={filter === 'completed' ? tr('这里还没有已完成的待办') : tr('一片清爽')} detail={filter === 'completed' ? undefined : tr('把下一件事加进来，悬屿会记住。')}/>}
        <div className="rows todo-agenda">{filtered.map(item => {
            const completed = item.status === 'completed', end = endOf(item);
            const tag = tags.find(tag => tag.id === item.tagId);
            const dateFormat = (value: string) => dayDate(value).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' });
            const overdue = !completed && end != null && Math.max(end, item.snoozedUntil || 0) < now;
            return <article className="todo-row row" data-status={item.status} key={item.id}>
                <button className="todo-check" disabled={actions.busy} aria-label={completed ? fmt('将{{value0}}重新打开', { value0: item.title }) : fmt('完成{{value0}}', { value0: item.title })} title={completed ? tr('重新打开') : tr('标为完成')} onClick={() => void actions.run('todo_update', { id: item.id, status: completed ? 'pending' : 'completed' }, completed ? tr('已重新打开') : tr('已完成'))}>
                    {completed ? <Check size={12}/> : item.status === 'in-progress' ? <span/> : null}
                </button>
                <div className="row-content"><div className="todo-row-heading"><button className="text-button row-title" onClick={() => openForm(item)}>{item.title}</button>{tag && <span className="todo-task-tag" title={tag.name}>{tag.name}</span>}</div>
                    <div className="row-meta todo-time-label" data-overdue={overdue}><Clock3 size={12}/>{overdue && <b>{tr('逾期')}</b>}{item.timeGranularity === 'day' ? <><span>{tr('按天')}</span>{item.startDate && <span>{dateFormat(item.startDate)}</span>}{item.startDate && item.endDate && item.startDate !== item.endDate && <span aria-hidden="true">→</span>}{item.endDate && item.endDate !== item.startDate && <span>{dateFormat(item.endDate)}</span>}</> : <>{item.startAt != null && <span>{formatTime(item.startAt)}</span>}{item.startAt != null && end != null && <span aria-hidden="true">→</span>}{end != null && <span>{formatTime(end)}</span>}</>}{item.startAt == null && end == null && <span>{tr('未安排时间')}</span>}</div>
                    {item.notes && <TodoDetails text={item.notes} feedback={feedback}/>}
                </div>
                <div className="row-actions"><span className="status-pill" data-status={item.status}>{tr(statuses[item.status])}</span><IconButton label={tr('编辑')} icon={<Pencil size={14}/>} onClick={() => openForm(item)}/><IconButton label={tr('删除')} danger disabled={actions.busy} icon={<Trash2 size={14}/>} onClick={() => void actions.run('todo_remove', { id: item.id }, tr('待办已删除'))}/></div>
            </article>;
        })}</div>
    </div>;
}
