import { createPluginTranslator } from '../../src/ui/i18n';
const { tr } = createPluginTranslator('snippets');
import { Code2, Copy, Plus, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import { MarkdownEditor, MarkdownView } from '../../src/ui/Markdown';
type Snippet = {
    id: string;
    title: string;
    text: string;
};
export function SnippetsPanel({ revision, feedback, edit }: PanelProps) {
    const { data, error, busy, reload } = useData<Snippet[]>('snippets_list', revision, []);
    const actions = useActions(feedback, reload);
    const [form, setForm] = usePanelDraft<{
        id?: string;
        title: string;
        text: string;
    } | null>('snippets.editor',null,edit);
    function open(item?: Snippet) { setForm(item ? { ...item } : { title: '', text: '' }); edit(true); }
    function reset() { setForm(null); edit(false); }
    const items = Array.isArray(data) ? data : [];
    return <>
    <div className="toolbar"><span className="quiet">{items.length} {tr("个片段")}</span><button className="button primary" onClick={() => open()}><Plus size={15}/>{tr("新建片段")}</button></div>
    {form && <form className="editor" onSubmit={async (event) => {
                event.preventDefault();
                const { id, title, text } = form;
                if (!text.trim()) { feedback(tr('请输入片段内容'), 'error'); return; }
                const result = await actions.run(id ? 'snippets_update' : 'snippets_add', id ? { id, title, text } : { title, text }, tr("片段已保存"));
                if (result.ok)
                    reset();
            }}>
      <label>{tr("名称")}<input autoFocus required maxLength={180} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder={tr("例如 代码审查上下文")}/></label>
      <MarkdownEditor label={tr('片段')} required maxLength={100000} value={form.text} onChange={text => setForm({ ...form, text })} placeholder={tr('贴入可复用的提示词、命令或说明')} labels={{ edit: tr('编辑'), preview: tr('预览'), empty: tr('暂无内容可预览'), hint: tr('支持 Markdown：标题、列表、链接和代码块') }}/>
      <div className="form-actions"><button className="button quiet-button" type="button" onClick={reset}>{tr("取消")}</button><button className="button primary" disabled={actions.busy}>{tr("保存")}</button></div>
    </form>}
    <DataMessage busy={busy} error={error}/>
    {!busy && !error && !form && !items.length && <Empty icon={<Code2 size={21}/>} title={tr("还没有片段")} detail={tr("把下一次还会用到的文本保存下来\u3002")}/>}
    <div className="rows">{items.map(item => <article className="row snippet-editor" key={item.id}>
      <div className="row-icon"><Code2 size={17}/></div><div className="row-content"><button className="text-button row-title" onClick={() => open(item)}>{item.title}</button><div className="snippet-markdown"><MarkdownView text={item.text} onError={message => feedback(message, 'error')}/></div></div>
      <div className="row-actions"><IconButton label={tr("复制片段")} icon={<Copy size={15}/>} onClick={() => void actions.run('snippets_copy', { id: item.id }, tr("片段已复制"))}/><IconButton label={tr("删除片段")} danger icon={<Trash2 size={14}/>} onClick={() => void actions.run('snippets_remove', { id: item.id }, tr("片段已删除"))}/></div>
    </article>)}</div>
  </>;
}
