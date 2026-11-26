import { createPluginTranslator, currentLocale } from '../../src/ui/i18n';
const { fmt: tr } = createPluginTranslator('vocabulary');
import { useEffect, useState } from 'react';
import { BookOpenText, Bookmark, Check, Compass, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, usePanelDraft, type PanelProps } from '../../src/ui/primitives';
import './style.css';
type Example = { text: string; translation?: string };
type Word = { id: string; word: string; phonetic?: string; meaning: string; meaningEn?: string; examples?: Example[]; favorite: boolean; reviewAt?: number; reviewCount?: number };
type Listing = { words: Word[]; favorites: Word[]; due: Word[]; reviewed: number };
type Mode = 'explore' | 'favorites' | 'review';
type Form = { id?: string; word: string; phonetic: string; meaning: string; first: string; firstZh: string; second: string; secondZh: string; extra?: Example[] };
const empty: Listing = { words: [], favorites: [], due: [], reviewed: 0 };
export function VocabularyPanel({ revision, itemId, feedback, edit }: PanelProps) {
    const requestedMode = itemId?.split(':')[0];
    const listing = useData<Listing>('vocabulary_list', revision, empty);
    const discovery = useData<{ item: Word | null; remaining: number }>('vocabulary_explore', revision, { item: null, remaining: 0 });
    const actions = useActions(feedback, () => { listing.reload(); discovery.reload(); });
    const [mode, setMode] = useState<Mode>(requestedMode === 'review' || requestedMode === 'favorites' ? requestedMode : 'explore');
    const [selected, setSelected] = useState('');
    const [reveal, setReveal] = useState(false);
    const [practice, setPractice] = useState<string[] | null>(null);
    const [form, setForm] = usePanelDraft<Form | null>('vocabulary.editor', null, edit);
    const { favorites, due, reviewed } = listing.data;
    const reviewWords = practice ? practice.map(id => favorites.find(word => word.id === id)).filter((word): word is Word => !!word) : due;
    const current = mode === 'explore' ? discovery.data.item : mode === 'favorites' ? favorites.find(word => word.id === selected) ?? favorites[0] : reviewWords[0];
    const english = currentLocale() === 'en-US';
    useEffect(() => { const timer = window.setInterval(listing.reload, 30000); return () => window.clearInterval(timer); }, []);
    useEffect(() => setReveal(false), [current?.id, mode]);
    useEffect(() => { if (requestedMode === 'review' || requestedMode === 'favorites' || requestedMode === 'explore') { setMode(requestedMode); setPractice(null); } }, [itemId]);
    function closeForm() { setForm(null); edit(false); }
    function openForm(word?: Word) {
        setForm({ ...(word ? { id: word.id, extra: word.examples?.slice(2) } : {}), word: word?.word ?? '', phonetic: word?.phonetic ?? '', meaning: word?.meaning ?? '', first: word?.examples?.[0]?.text ?? '', firstZh: word?.examples?.[0]?.translation ?? '', second: word?.examples?.[1]?.text ?? '', secondZh: word?.examples?.[1]?.translation ?? '' }); edit(true);
    }
    return <div className="vocabulary-workspace">
        <div className="toolbar"><div className="segments vocabulary-modes" role="group" aria-label={tr('词汇模式')}>
            {([['explore', tr('探索'), Compass], ['favorites', tr('收藏'), Bookmark], ['review', tr('复习'), BookOpenText]] as const).map(([value, label, Icon]) => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); if (value === 'review') setPractice(null); }}><Icon size={13}/>{label}</button>)}
        </div><IconButton label={tr('收录词汇')} icon={<Plus size={16}/>} onClick={() => openForm()}/></div>
        <p className="vocabulary-status quiet">{tr('收藏 {{count}} 个 · 今天已复习 {{reviewed}} 个', { count: favorites.length, reviewed })}</p>
        {form && <form className="editor" onSubmit={async event => {
            event.preventDefault();
            const { first, firstZh, second, secondZh, extra, ...details } = form;
            const result = await actions.run('vocabulary_add', { ...details, examples: [{ text: first, translation: firstZh }, { text: second, translation: secondZh }, ...(extra ?? [])] }, tr('词汇已收录'));
            if (result.ok) { closeForm(); setMode('favorites'); setSelected((result.result as Word).id); }
        }}>
            <div className="form-grid"><label>{tr('词汇')}<input autoFocus required maxLength={160} value={form.word} onChange={event => setForm({ ...form, word: event.target.value })}/></label><label>{tr('音标')}<input required maxLength={240} value={form.phonetic} placeholder="/…/" onChange={event => setForm({ ...form, phonetic: event.target.value })}/></label></div>
            <label>{tr('释义')}<textarea required maxLength={1200} rows={2} value={form.meaning} onChange={event => setForm({ ...form, meaning: event.target.value })}/></label>
            {(['first', 'second'] as const).map((key, index) => <div className="vocabulary-example-fields" key={key}><label>{tr('例句 {{number}}', { number: index + 1 })}<textarea required maxLength={2000} rows={2} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}/></label><label>{tr('例句译文（可选）')}<input maxLength={2000} value={form[key === 'first' ? 'firstZh' : 'secondZh']} onChange={event => setForm({ ...form, [key === 'first' ? 'firstZh' : 'secondZh']: event.target.value })}/></label></div>)}
            <div className="form-actions"><button className="button quiet-button" type="button" onClick={closeForm}>{tr('取消')}</button><button className="button primary" disabled={actions.busy}>{tr('保存')}</button></div>
        </form>}
        <DataMessage busy={listing.busy || (mode === 'explore' && discovery.busy)} error={listing.error || (mode === 'explore' ? discovery.error : '')}/>
        {current && <article className="vocabulary-card" key={`${mode}:${current.id}`}>
            <div className="vocabulary-card-top"><span className="feature-label">{mode === 'explore' ? tr('未收藏 · 探索') : mode === 'review' ? tr('现在复习') : tr('我的收藏')}</span><div className="row-actions">
                <IconButton label={tr('编辑词汇')} icon={<Pencil size={14}/>} onClick={() => openForm(current)}/>
                <button className="icon-button vocabulary-bookmark" type="button" aria-label={current.favorite ? tr('取消收藏') : tr('收藏词汇')} title={current.favorite ? tr('取消收藏') : tr('收藏词汇')} aria-pressed={current.favorite} disabled={actions.busy} onClick={() => void actions.run('vocabulary_favorite', { id: current.id, favorite: !current.favorite }, current.favorite ? tr('已取消收藏') : tr('已收藏'))}><Bookmark size={17} fill={current.favorite ? 'currentColor' : 'none'}/></button>
            </div></div>
            <h2 lang="en">{current.word}</h2><p className="vocabulary-phonetic" lang="en">{current.phonetic || tr('音标待补充')}</p>
            {mode !== 'review' || reveal ? <div className="vocabulary-answer"><p className="vocabulary-definition">{english && current.meaningEn ? current.meaningEn : current.meaning}</p>
                <ol className="vocabulary-examples">{current.examples?.map((example, index) => <li key={index}><p lang="en">{example.text}</p>{!english && example.translation && <p className="quiet">{example.translation}</p>}</li>)}</ol>
                {(!current.phonetic || (current.examples?.length ?? 0) < 2) && <button className="text-button link" onClick={() => openForm(current)}>{tr('补全音标与两条例句')}</button>}
                {mode === 'review' && <div className="choice-row">{[['again', tr('重来')], ['hard', tr('困难')], ['good', tr('记住了')], ['easy', tr('简单')]].map(([result, label]) => <button className={`button${result === 'good' ? ' primary' : ''}`} key={result} disabled={actions.busy} onClick={async () => {
                    if ((await actions.run('vocabulary_review', { id: current.id, result }, tr('复习已记录'))).ok) { setReveal(false); if (practice) setPractice(practice.slice(1)); }
                }}>{label}</button>)}</div>}
            </div> : <button className="button primary vocabulary-reveal" onClick={() => setReveal(true)}>{tr('显示释义与例句')}</button>}
            {mode === 'explore' && <button className="button vocabulary-next" disabled={actions.busy} onClick={async () => {
                const result = await actions.run('vocabulary_explore', { next: true }); if (result.ok) discovery.setData(result.result as typeof discovery.data);
            }}><RefreshCw size={14}/>{tr('下一个单词')}</button>}
        </article>}
        {!listing.busy && !current && !form && <Empty icon={mode === 'review' ? <Check size={24}/> : <BookOpenText size={24}/>} title={mode === 'review' ? tr('本轮复习完成') : mode === 'favorites' ? tr('还没有收藏') : tr('已探索所有词汇')} detail={mode === 'review' ? tr('可以复习全部收藏，或等下次到期。') : tr('去探索发现新词，点击书签加入收藏。')}/>}
        {mode === 'review' && !!favorites.length && <button className="button vocabulary-next" onClick={() => { setPractice(favorites.map(word => word.id)); setReveal(false); }}>{tr('复习全部收藏')}</button>}
        {mode === 'favorites' && <div className="rows vocabulary-favorites">{favorites.map(word => <article className="row" data-selected={current?.id === word.id} key={word.id}><button className="text-button row-content" onClick={() => setSelected(word.id)} aria-pressed={current?.id === word.id}><strong className="row-title" lang="en">{word.word}</strong><span className="row-meta">{english && word.meaningEn ? word.meaningEn : word.meaning}</span></button><IconButton label={tr('取消收藏')} icon={<Bookmark size={14} fill="currentColor"/>} onClick={() => void actions.run('vocabulary_favorite', { id: word.id, favorite: false }, tr('已取消收藏'))}/><IconButton label={tr('删除词汇')} danger icon={<Trash2 size={14}/>} onClick={() => void actions.run('vocabulary_remove', { id: word.id }, tr('词汇已删除'))}/></article>)}</div>}
        <small className="quiet vocabulary-footnote">{tr('收藏与复习进度保存在本机。探索使用离线开发者词库。')}</small>
    </div>;
}
