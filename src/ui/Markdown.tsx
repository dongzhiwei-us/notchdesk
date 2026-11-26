import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import './markdown.css';

export function MarkdownView({ text, onError }: { text: string; onError?: (message: string) => void }) {
    const html = useMemo(() => {
        const renderer = new Renderer();
        renderer.checkbox = ({ checked }) => checked ? '☑ ' : '☐ ';
        return DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true, renderer }), {
            ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
            ALLOWED_URI_REGEXP: /^(?:https?:|#)/i,
            ALLOW_DATA_ATTR: false,
        });
    }, [text]);
    return <div className="markdown-body" onClick={event => {
        const link = (event.target as Element).closest('a');
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (href && /^https?:\/\//i.test(href)) void window.notch.openExternal(href).catch(error => onError?.(String(error.message)));
    }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MarkdownEditor({ label, value, onChange, placeholder, required = false, maxLength = 20000, labels }: {
    label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; maxLength?: number;
    labels: { edit: string; preview: string; empty: string; hint: string };
}) {
    const id = useId();
    const [preview, setPreview] = useState(false);
    const deferred = useDeferredValue(value);
    return <div className="markdown-editor">
        <div className="markdown-editor-heading"><label htmlFor={id}>{label}</label><div className="segments" role="group" aria-label={`${label} · ${labels.edit} / ${labels.preview}`}>
            <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>{labels.edit}</button>
            <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>{labels.preview}</button>
        </div></div>
        <textarea id={id} aria-describedby={id + '-hint'} hidden={preview} required={required && !preview} rows={4} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
        {preview && <div className="markdown-editor-preview" tabIndex={0} role="region" aria-label={labels.preview}>{value.trim() ? <MarkdownView text={deferred} /> : <span className="quiet">{labels.empty}</span>}</div>}
        <small id={id + '-hint'} className="markdown-hint">{labels.hint}</small>
    </div>;
}
