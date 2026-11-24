import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('vocabulary');
import { useState } from 'react';
import { BookOpenText, Plus, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
type Word = {
    id: string;
    word: string;
    meaning: string;
    example?: string;
    nextReviewAt?: number;
};
export function VocabularyPanel({ revision, feedback, edit }: PanelProps) {
    const empty = { words: [] as Word[], due: [] as Word[] };
    const { data, error, busy, reload } = useData('vocabulary_list', revision, empty);
    const actions = useActions(feedback, reload);
    const [form, setForm] = usePanelDraft<{
        word: string;
        meaning: string;
        example: string;
    } | null>('vocabulary.editor',null,edit);
    const [reveal, setReveal] = useState(false);
    const words = Array.isArray(data?.words) ? data.words : [];
    const due = Array.isArray(data?.due) ? data.due.map(value => typeof value === 'string' ? words.find(word => word.id === value) : value).filter((item): item is Word => !!item) : [];
    const current = due[0];
    function closeForm() { setForm(null); edit(false); }
    return <>
    <div className="toolbar"><span className="quiet">{words.length}{tr("个词汇 \u00B7")}{due.length}{tr("个待复习")}</span><button className="button primary" onClick={() => { setForm({ word: '', meaning: '', example: '' }); edit(true); }}><Plus size={15}/>{tr("收录词汇")}</button></div>
    {form && <form className="editor" onSubmit={async (event) => {
                event.preventDefault();
                if ((await actions.run('vocabulary_add', form, tr("词汇已收录"))).ok)
                    closeForm();
            }}>
      <div className="form-grid"><label>{tr("词汇")}<input autoFocus required value={form.word} onChange={event => setForm({ ...form, word: event.target.value })}/></label><label>{tr("释义")}<input required value={form.meaning} onChange={event => setForm({ ...form, meaning: event.target.value })}/></label></div>
      <label>{tr("例句")}<input value={form.example} onChange={event => setForm({ ...form, example: event.target.value })}/></label>
      <div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr("取消")}</button><button className="button primary" disabled={actions.busy}>{tr("保存")}</button></div>
    </form>}
    <DataMessage busy={busy} error={error}/>
    {!busy && !error && !words.length && !form && <Empty icon={<BookOpenText size={22}/>} title={tr("词汇本还空着")} detail={tr("把你刚学到的词记在这里\u3002")}/>}
    {current && <div className="word-flashcard" data-revealed={reveal} key={current.id}><div className="feature-label"><BookOpenText size={14}/>{tr("现在复习")}</div><h2>{current.word}</h2>{reveal ? <><p>{current.meaning}</p>{current.example && <p className="quiet">{current.example}</p>}<div className="choice-row">{[['again', tr("重来")], ['hard', tr("困难")], ['good', tr("记住了")], ['easy', tr("简单")]].map(([id, text]) => <button className="button" key={id} onClick={async () => {
                        if ((await actions.run('vocabulary_review', { id: current.id, result: id }, tr("复习已记录"))).ok)
                            setReveal(false);
                    }}>{tr(text)}</button>)}</div></> : <button className="button" onClick={() => setReveal(true)}>{tr("显示释义")}</button>}</div>}
    <div className="rows">{words.map(item => <article className="row" key={item.id}><div className="row-content"><strong className="row-title">{item.word}</strong><span className="row-meta">{item.meaning}</span></div><IconButton label={tr("删除词汇")} danger icon={<Trash2 size={14}/>} onClick={() => void actions.run('vocabulary_remove', { id: item.id }, tr("词汇已删除"))}/></article>)}</div>
  </>;
}
