import { useEffect, useId, useRef, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { displayShortcut, shortcutFromEvent } from '../shared/shortcuts';
import { tr } from './i18n';
export function ShortcutInput({ label, value, defaultValue, set }: { label: string; value: string; defaultValue: string; set: (value: string) => void }) {
    const id = useId(), input = useRef<HTMLInputElement>(null), active = useRef<string | null>(null), mounted = useRef(true), releasing = useRef(false);
    const [recording, setRecording] = useState(false), [error, setError] = useState('');
    const platform = window.notch.platform;
    function stop() { const token = active.current; active.current = null; releasing.current = false; setRecording(false); if (token) void window.notch.shortcutRecording?.(false, token).catch(() => {}); }
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (active.current) void window.notch.shortcutRecording?.(false, active.current).catch(() => {}); active.current = null; }; }, []);
    async function start() {
        if (recording) { stop(); return; }
        const token = id + ':' + Date.now(); active.current = token;
        try { await window.notch.shortcutRecording?.(true, token); if (!mounted.current || active.current !== token) { void window.notch.shortcutRecording?.(false, token); return; } setError(''); setRecording(true); input.current?.focus(); }
        catch { active.current = null; setError(tr('无法开始快捷键录入')); }
    }
    return <div className="shortcut-field"><span className="shortcut-caption">{label}</span><div className="shortcut-input-row">
        <input ref={input} aria-label={label} aria-describedby={id + '-hint'} readOnly value={recording ? tr('请按下组合键') : displayShortcut(value, platform)} placeholder={tr('未设置')} data-recording={recording} onBlur={stop} onKeyDown={event => {
            if (!recording) return;
            if (event.key === 'Tab') { stop(); return; }
            event.preventDefault(); event.stopPropagation();
            if (event.repeat) return;
            if (event.key === 'Escape') { stop(); return; }
            if (['Backspace','Delete'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { set(''); setError(''); stop(); return; }
            try { const shortcut = shortcutFromEvent(event); if (shortcut) { set(shortcut); setError(''); setRecording(false); releasing.current = true; } } catch (error) { setError(tr((error as Error).message)); }
        }} onKeyUp={event => { if (releasing.current && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) stop(); }}/>
        <button className="button" type="button" onClick={() => void start()}><Keyboard size={14}/>{recording ? tr('取消录入') : tr('录入')}</button>
        <button className="icon-button" type="button" disabled={!value && !recording} title={tr('清空快捷键')} aria-label={tr('清空快捷键')} onClick={() => { stop(); set(''); setError(''); }}><X size={14}/></button>
        <button className="icon-button" type="button" title={tr('恢复默认快捷键')} aria-label={tr('恢复默认快捷键')} onClick={() => { stop(); set(defaultValue); setError(''); }}><RotateCcw size={14}/></button>
    </div><small id={id + '-hint'} className={error ? 'inline-error' : 'quiet'} role={error ? 'alert' : undefined}>{error || (recording ? tr('Esc 取消，Delete 清空。录入期间暂停本应用的全局快捷键。') : tr('点击录入后按下组合键，留空表示不启用。'))}</small></div>;
}
