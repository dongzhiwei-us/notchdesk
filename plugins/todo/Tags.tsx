import { Plus, X } from 'lucide-react';
import { createPluginTranslator } from '../../src/ui/i18n';
import { IconButton, useActions, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import type { TodoTag } from './calendar';
const { fmt: tr } = createPluginTranslator('todo');
export function TodoTags({ tags, feedback, reload, edit }: { tags: TodoTag[]; feedback: PanelProps['feedback']; edit: PanelProps['edit']; reload: () => void }) {
    const [name, setName] = usePanelDraft('todo.tag-editor', '', edit);
    const actions = useActions(feedback, reload);
    return <div className="todo-tags-manager">
        <p className="quiet">{tr('每个任务可选一个标签，默认无标签。删除标签会保留任务。')}</p>
        <div className="todo-tag-library">{tags.map(tag => <span className="todo-tag-chip" key={tag.id}>{tag.name}<IconButton label={tr('删除标签 {{name}}', { name: tag.name })} icon={<X size={12}/>} disabled={actions.busy} onClick={() => void actions.run('todo_tag_remove', { id: tag.id }, tr('标签已删除'))}/></span>)}{!tags.length && <span className="quiet">{tr('还没有标签')}</span>}</div>
        <form onSubmit={async event => { event.preventDefault(); if (name.trim() && (await actions.run('todo_tag_add', { name: name.trim() }, tr('标签已新增'))).ok) setName(''); }}>
            <label>{tr('新标签')}<input maxLength={40} value={name} onFocus={() => edit(true)} placeholder="MR / chore / coding / CR" onChange={event => setName(event.target.value)}/></label>
            <button className="button" disabled={actions.busy || !name.trim()}><Plus size={13}/>{tr('添加标签')}</button>
        </form>
    </div>;
}
