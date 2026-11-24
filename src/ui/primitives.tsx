import { tr, fmt } from './i18n';
import { useCallback, useEffect, useState, type ReactNode, type SetStateAction } from 'react';
import { errorMessage } from './types';
export interface PanelProps {
    revision: number;
    itemId?: string;
    feedback: (message: string, kind?: 'error' | 'info') => void;
    edit: (active: boolean) => void;
}
// Keep unfinished forms in this renderer session when a floating panel closes.
// Nothing is written to disk; save/cancel explicitly clears a nullable draft.
const panelDrafts=new Map<string,unknown>();
export function usePanelDraft<T>(key:string,initial:T,edit?:PanelProps['edit']){
    const [value,setValue]=useState<T>(()=>panelDrafts.has(key)?panelDrafts.get(key) as T:initial);
    const update=useCallback((change:SetStateAction<T>)=>{
        setValue(previous=>{
            const next=typeof change==='function'?(change as (value:T)=>T)(previous):change;
            if(next==null||next==='')panelDrafts.delete(key);else panelDrafts.set(key,next);
            return next;
        });
    },[key]);
    useEffect(()=>{if(value)edit?.(true);},[]);
    return [value,update] as const;
}
export function useData<T>(method: string, revision: number, initial: T, params?: Record<string, unknown>) {
    const [data, setData] = useState(initial);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(true);
    const [localRevision, setRevision] = useState(0);
    const paramsKey = JSON.stringify(params ?? {});
    useEffect(() => {
        let live = true;
        window.notch.rpc<T>(method, JSON.parse(paramsKey)).then(value => {
            if (live) {
                setData(value ?? initial);
                setError('');
            }
        }).catch(error => {
            if (live)
                setError(errorMessage(error));
        }).finally(() => {
            if (live)
                setBusy(false);
        });
        return () => { live = false; };
    }, [method, revision, localRevision, paramsKey]);
    return { data, setData, error, busy, reload: () => setRevision(value => value + 1) };
}
export function useActions(feedback: PanelProps['feedback'], reload: () => void) {
    const [busy, setBusy] = useState(false);
    async function run(method: string, params: Record<string, unknown> = {}, message?: string) {
        setBusy(true);
        try {
            const result = await window.notch.rpc(method, params);
            reload();
            if (message)
                feedback(message);
            return { ok: true as const, result };
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
            return { ok: false as const };
        }
        finally {
            setBusy(false);
        }
    }
    return { busy, run };
}
export function Empty({ icon, title, detail }: {
    icon: ReactNode;
    title: string;
    detail?: string;
}) {
    return <div className="empty"><div className="empty-icon">{icon}</div><strong>{tr(title)}</strong>{detail && <span>{detail}</span>}</div>;
}
export function IconButton({ label, icon, onClick, danger, disabled }: {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
}) {
    return <button className={`icon-button${danger ? ' danger' : ''}`} type="button" title={tr(label)} aria-label={tr(label)} onClick={onClick} disabled={disabled}>{icon}</button>;
}
export function DataMessage({ busy, error }: {
    busy: boolean;
    error: string;
}) {
    return error ? <p className="inline-error" role="alert">{error}</p> : busy ? <div className="plugin-loading" role="status" aria-label={tr("正在读取")}><i /><i /><i /></div> : null;
}
export function rowsFrom(result: any, keys: string[]) {
    return (Array.isArray(result) ? result : keys.map(key => result?.[key]).find(Array.isArray) ?? []) as any[];
}
export function DataTree({ value, depth = 0 }: {
    value: any;
    depth?: number;
}) {
    if (value == null)
        return null;
    if (typeof value !== 'object')
        return <span>{typeof value === 'boolean' ? value ? tr("是") : tr("否") : String(value)}</span>;
    if (depth > 5)
        return null;
    if (Array.isArray(value))
        return value.length ? <ul className="data-list">{value.slice(0, 35).map((item, index) => <li key={index}><DataTree value={item} depth={depth + 1}/></li>)}</ul> : <span>{tr("无")}</span>;
    return <dl className="data-tree">{Object.entries(value).filter(([, item]) => item != null).slice(0, 35).map(([key, item]) => <div key={key}><dt>{key}</dt><dd><DataTree value={item} depth={depth + 1}/></dd></div>)}</dl>;
}
