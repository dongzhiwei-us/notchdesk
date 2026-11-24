import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('todo');
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Clock3, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import { formatTime, localMinute } from '../../src/ui/types';
type Todo = {
    id: string;
    title: string;
    notes?: string;
    dueAt?: number | null;
    status: 'pending' | 'in-progress' | 'completed';
    snoozedUntil?: number;
};
const statuses = { pending: tr("待开始"), 'in-progress': tr("进行中"), completed: tr("已完成") };
const blankTodo = { title: '', notes: '', dueAt: '', status: 'pending' as Todo['status'] };
export function TodoPanel({ revision, feedback, edit, itemId }: PanelProps) {
    const { data, error, busy, reload } = useData<Todo[]>('todo_list', revision, []);
    const actions = useActions(feedback, reload);
    const [filter, setFilter] = useState('open');
    const [form, setForm] = usePanelDraft<typeof blankTodo & {
        id?: string;
    } | null>('todo.editor',null,edit);
    const openedItem = useRef<string | undefined>(undefined);
    const todos = Array.isArray(data) ? data : [];
    const filtered = todos.filter(item => filter === 'all' || (filter === 'open' ? item.status !== 'completed' : item.status === 'completed'));
    function openForm(todo?: Todo) {
        setForm(todo ? { ...todo, notes: todo.notes ?? '', dueAt: localMinute(todo.dueAt) } : blankTodo);
        edit(true);
    }
    function closeForm() { setForm(null); edit(false); }
    useEffect(() => {
        if (itemId === openedItem.current)
            return;
        const todo = todos.find(item => item.id === itemId);
        if (todo) {
            openedItem.current = itemId;
            openForm(todo);
        }
        if (!itemId)
            openedItem.current = undefined;
    }, [data, itemId]);
    async function save(event: FormEvent) {
        event.preventDefault();
        if (!form || !form.title.trim())
            return;
        const { id, title, notes, dueAt, status } = form;
        const params = { title: title.trim(), notes: notes.trim(), dueAt: dueAt ? new Date(dueAt).getTime() : null };
        const result = await actions.run(id ? 'todo_update' : 'todo_add', id ? { ...params, id, status } : params, id ? tr("待办已更新") : tr("待办已添加"));
        if (result.ok)
            closeForm();
    }
    return <>
    <div className="toolbar">
      <div className="segments" aria-label={tr("筛选待办")}>
        {[['open', tr("未完成")], ['completed', tr("已完成")], ['all', tr("全部")]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{tr(label)}</button>)}
      </div>
      <button className="button primary" onClick={() => openForm()}><Plus size={15}/>{tr("新增待办")}</button>
    </div>
    {form && <form className="editor" onSubmit={save}>
      <label>{tr("任务")}<input autoFocus required maxLength={240} placeholder={tr("下一步要做什么\uFF1F")} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label>
      <label>{tr("备注")}<textarea rows={2} maxLength={4000} placeholder={tr("可选")} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
      <div className="form-grid">
        <label>{tr("提醒时间")}<input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })}/></label>
        {form.id && <label>{tr("状态")}<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Todo['status'] })}>{Object.entries(statuses).map(([id, text]) => <option key={id} value={id}>{tr(text)}</option>)}</select></label>}
      </div>
      <div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr("取消")}</button><button className="button primary" disabled={actions.busy}>{form.id ? tr("保存修改") : tr("创建待办")}</button></div>
    </form>}
    <DataMessage busy={busy} error={error}/>
    {!busy && !error && !filtered.length && !form && <Empty icon={<Check size={21}/>} title={filter === 'completed' ? tr("这里还没有已完成的待办") : tr("一片清爽")} detail={filter === 'completed' ? undefined : tr("把下一件事加进来\uFF0C悬屿会记住\u3002")}/>}
    <div className="rows">{filtered.map(item => {
            const completed = item.status === 'completed';
            const overdue = !completed && !!item.dueAt && Math.max(item.dueAt, item.snoozedUntil || 0) < Date.now();
            return <article className="todo-row row" data-status={item.status} key={item.id}>
        <button className="todo-check" aria-label={completed ? fmt("将{{value0}}重新打开", { value0: item.title }) : fmt("完成{{value0}}", { value0: item.title })} title={completed ? tr("重新打开") : tr("标为完成")} onClick={() => void actions.run('todo_update', { id: item.id, status: completed ? 'pending' : 'completed' }, completed ? tr("已重新打开") : tr("已完成"))}>
          {completed ? <Check size={12}/> : item.status === 'in-progress' ? <span /> : null}
        </button>
        <div className="row-content"><button className="text-button row-title" onClick={() => openForm(item)}>{item.title}</button>
          <div className="row-meta">{item.dueAt && <span className={overdue ? 'overdue' : ''}><Clock3 size={12}/>{overdue && tr("已逾期 \u00B7 ")}{formatTime(item.dueAt)}</span>}{item.notes && <span className="ellipsis" title={item.notes}>{item.notes}</span>}</div>
        </div>
        <div className="row-actions"><span className="status-pill" data-status={item.status}>{tr(statuses[item.status])}</span>
          <IconButton label={tr("编辑")} icon={<Pencil size={14}/>} onClick={() => openForm(item)}/>
          <IconButton label={tr("删除")} danger icon={<Trash2 size={14}/>} onClick={() => { void actions.run('todo_remove', { id: item.id }, tr("待办已删除")); }}/>
        </div>
      </article>;
        })}</div>
  </>;
}
