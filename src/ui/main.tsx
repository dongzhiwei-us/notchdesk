import { applyLocale, currentLocale, subscribeLocale } from './i18n';
import { tr, fmt } from './i18n';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Bell, BellRing, ChevronDown, CircleAlert, CircleCheck, Pin, PinOff, Settings2, Sparkles, X } from 'lucide-react';
import { panels } from '../../plugins/panels';
import { DataTree, Empty, IconButton } from './primitives';
import { GenericPanel, PluginIcon, PluginLabel, RuntimePanel } from './common';
const Settings = lazy(() => import('./settings').then(module => ({ default: module.Settings })));
import { detailOf, errorMessage, fallbackState, formatTime, titleOf, type Notice, type Plugin, type State, type Tool } from './types';
import './style.css';
import { Wheel } from './Wheel';
import {useShellDrag} from './shellDrag';
import {CLIPS_IMPORTED_EVENT} from './clipEvents';
import {ClotheslineSurface} from '../../plugins/clipline/Surface';

type View = {
    kind: 'closed' | 'menu';
} | {
    kind: 'plugin';
    id: string;
    itemId?: string;
} | {
    kind: 'notice';
    id?: string;
};
type Flash = {
    message: string;
    kind: 'error' | 'info';
};
const viewName = (view: View) => view.kind === 'plugin' ? view.id : view.kind;
const emptySettings = {};
const idleDuration = 250;
function BrandMark() { return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>; }
function NoticePanel({ notices, selected, choose, feedback, refresh, preferences, complete }: {
    notices: Notice[];
    selected?: string;
    choose: (id?: string) => void;
    feedback: (message: string, kind?: 'error' | 'info') => void;
    refresh: () => void;
    preferences?: Record<string, unknown>;
    complete:()=>void;
}) {
    const [detail, setDetail] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const item = notices.find(notice => notice.id === selected);
    useEffect(() => setDetail(null), [selected]);
    async function run(method: string, params: Record<string, unknown>, advance = false) {
        setBusy(true);
        try {
            const result = await window.notch.rpc(method, params);
            if (method === 'notifications.explain')
                setDetail(result);
            else
                refresh();
            if (advance) complete();
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
        }
        finally {
            setBusy(false);
        }
    }
    if (item)
        return <><div className="toolbar"><button className="button quiet-button" onClick={() => choose()}><ArrowLeft size={14}/>{tr("所有通知")}</button><span className="quiet">{formatTime(item.createdAt)}</span></div>
    <article className="notice-card"><div className="tile-icon" data-plugin={item.pluginId}><BellRing size={22}/></div><h2>{item.title}</h2>{item.body && <p>{item.body}</p>}
      <div className="choice-row">{!item.dismissedAt && item.actions?.map((action, index) => <button className={`button${index === 0 ? ' primary' : ''}`} key={index} disabled={busy} onClick={() => void run('notifications.action', { id: item.id, index }, true)}>{tr(action.label)}</button>)}
        {!item.dismissedAt && <button className="button" disabled={busy} onClick={() => void run('notifications.dismiss', { id: item.id }, true)}>{tr("关闭提醒")}</button>}
        <button className="button quiet-button" disabled={busy} onClick={() => void run('notifications.explain', { id: item.id })}>{tr("提醒详情")}</button></div></article>
    {!!detail && <div className="feature-card"><DataTree value={detail}/></div>}</>;
    return <>
    {preferences && <div className="toolbar"><label className="checkbox-field"><input type="checkbox" checked={Boolean(preferences.doNotDisturb)} disabled={busy} onChange={event => void run('notifications.settings', { doNotDisturb: event.target.checked })}/>{tr("勿扰模式")}</label></div>}
    {!notices.length && <Empty icon={<Bell size={22}/>} title={tr("暂无通知")} detail={tr("到期事项和协作提醒会出现在这里\u3002")}/>}
    <div className="rows">{notices.map(notice => <button className="row notice-row" key={notice.id} onClick={() => choose(notice.id)}><div className="row-icon"><Bell size={15}/></div><div className="row-content"><strong className="row-title">{notice.title}</strong><span className="row-meta ellipsis">{notice.body || formatTime(notice.createdAt)}</span></div>{notice.unread && !notice.dismissedAt && <span className="unread-dot"/>}</button>)}</div>
  </>;
}
function App() {
    useSyncExternalStore(subscribeLocale, currentLocale);
    const [state, setState] = useState<State>(fallbackState);
    const languageResources=state.plugins.map(plugin=>plugin.id+':'+plugin.revision).join('|');
    useEffect(() => applyLocale(state.theme.locale || 'system', state.plugins), [state.theme.locale, languageResources]);
    const shellDrag=useShellDrag();
    const settingsVisible=useRef(false);
    const moving=useRef(false);
    const fileDrag=useRef(false);
    const dragDepth=useRef(0);
    const pendingDrops=useRef(0);
    const dropQueue=useRef<Promise<void>>(Promise.resolve());
    const [dropActive,setDropActive]=useState(false);
    const [dropCount,setDropCount]=useState(0);
    const toolsKey=useRef('');
    const [tools, setTools] = useState<Tool[]>([]);
    const [revision, setRevision] = useState(0);
    const [flash, setFlash] = useState<Flash | null>(null);
    const [view, setView] = useState<View>({ kind: 'closed' });
    const [displayView, setDisplayView] = useState<View>({ kind: 'menu' });
    const [leaving, setLeaving] = useState(false);
    const [closing,setClosing]=useState(false);
    const [closingFrom,setClosingFrom]=useState<View['kind']>('menu');
    const collapseTimer=useRef<number>(0);
    const paintedRegions=useRef<Array<{x:number;y:number;width:number;height:number}>>([]);
    const displayTimer = useRef<number>(0);
    const [pinned, setPinned] = useState(false);
    const [activationKey,setActivationKey]=useState(0);
    const standalone = location.hash.startsWith('#settings');
    const [settingsSection, setSettingsSection] = useState(() => standalone ? decodeURIComponent(location.hash.split(/[/?]/)[1] || '') : undefined);
    const notch = useRef<HTMLButtonElement>(null);
    const wheel = useRef<HTMLDivElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const current = useRef<View>(view);
    const sticky = useRef(false);
    const editing = useRef(false);
    const inside = useRef(false);
    const readTicket = useRef(0);
    const moveTicket = useRef(0);
    const closeTimer = useRef<number>(0);
    const hoverTimer = useRef<number>(0);
    const flashTimer = useRef<number>(0);
    const transientTimer=useRef<number>(0);
    const refreshTimer = useRef<number>(0);
    const feedback = useCallback((message: string, kind: Flash['kind'] = 'info') => {
        window.clearTimeout(flashTimer.current);
        setFlash({ message, kind });
        flashTimer.current = window.setTimeout(() => setFlash(null), kind === 'error' ? 6500 : 1900);
    }, []);
    const pin = useCallback((value: boolean) => { sticky.current = value; setPinned(value); }, []);
    const refresh = useCallback(() => {
        const ticket = ++readTicket.current;
        if (!window.notch)
            return;
        void window.notch.rpc<State>('state.get').then(data=>{
            if(ticket!==readTicket.current)return;
            setState({...fallbackState,...data,theme:{...fallbackState.theme,...data.theme}});
            const key=data.plugins.map(plugin=>plugin.id+':'+plugin.enabled+':'+plugin.revision).join('|');
            if(toolsKey.current!==key){
                toolsKey.current=key;
                void window.notch.rpc<Tool[]|{tools:Tool[]}>('tools.list').then(value=>setTools(Array.isArray(value)?value:value.tools)).catch(()=>{});
            }
            setRevision(value=>value+1);
        }).catch(()=>{});
    }, []);
    const go = useCallback(async (target: View, reason: string) => {
        const from = current.current;
        if (JSON.stringify(from) === JSON.stringify(target))
            return;
        const ticket = ++moveTicket.current;
        try {
            const guard = await window.notch?.rpc<{
                allowed?: boolean;
                reason?: string;
            }>('ui.transition', { from: viewName(from), to: viewName(target), reason });
            if (ticket !== moveTicket.current)
                return;
            if (guard?.allowed === false) {
                if (guard.reason && reason !== 'hover')
                    feedback(guard.reason, 'error');
                return;
            }
        }
        catch {
            if (ticket !== moveTicket.current)
                return;
        }
        if (reason === 'hover' && !inside.current)
            return;
        if (target.kind !== 'plugin' || from.kind !== 'plugin' || from.id !== target.id)
            editing.current = false;
        current.current = target;
        window.clearTimeout(collapseTimer.current);
        if(target.kind==='closed'&&from.kind!=='closed'){
            setClosingFrom(from.kind);setClosing(true);
            collapseTimer.current=window.setTimeout(()=>setClosing(false),matchMedia('(prefers-reduced-motion: reduce)').matches?0:260);
        }else setClosing(false);
        setView(target);
        window.clearTimeout(displayTimer.current);
        if (target.kind !== 'closed') {
            if (from.kind !== 'closed' && viewName(from) !== viewName(target)) {
                setLeaving(true);
                displayTimer.current = window.setTimeout(() => { setDisplayView(target); setLeaving(false); }, 60);
            }
            else {
                setDisplayView(target);
                setLeaving(false);
            }
        }
    }, [feedback]);
    const scheduleClose = useCallback(() => {
        window.clearTimeout(closeTimer.current);
        if (sticky.current || editing.current || inside.current || moving.current || fileDrag.current || pendingDrops.current>0)
            return;
        closeTimer.current = window.setTimeout(() => {
            const element = document.activeElement;
            if (!inside.current && !sticky.current && !editing.current && !fileDrag.current && pendingDrops.current===0 && !(element instanceof HTMLElement && element.matches('input, textarea, select, [contenteditable=true]')))
                void go({ kind: 'closed' }, 'pointer-left');
        }, idleDuration);
    }, [go]);
    const entered = useCallback(() => {
        if(settingsVisible.current||moving.current)return;
        inside.current = true;
        window.clearTimeout(closeTimer.current);
        if (current.current.kind === 'closed'){window.cancelAnimationFrame(hoverTimer.current);hoverTimer.current=window.requestAnimationFrame(()=>{if(!moving.current&&inside.current)void go({ kind: 'menu' }, 'hover');});}
    }, [go]);
    const left = useCallback(() => {
        inside.current = false;
        window.cancelAnimationFrame(hoverTimer.current);
        scheduleClose();
    }, [scheduleClose]);
    const hide = useCallback(() => {
        window.cancelAnimationFrame(hoverTimer.current);
        window.clearTimeout(transientTimer.current);
        fileDrag.current=false;dragDepth.current=0;setDropActive(false);
        pin(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
        void go({ kind: 'closed' }, 'close');
    }, [go, pin]);
    useEffect(() => {
        refresh();
        if (!window.notch)
            return;
        return window.notch.onEvent(({ type, payload }) => {
            if (type === 'changed' || type === 'server.ready' || type === 'notification') {
                window.clearTimeout(refreshTimer.current);
                refreshTimer.current = window.setTimeout(refresh, 35);
            }
            if (standalone) {
                if (type === 'open' && payload?.view === 'settings')
                    setSettingsSection(payload.section);
                return;
            }
            if(type==='settings.visibility'){settingsVisible.current=!!payload;if(payload)hide();return;}
            if(type==='shell.dragging'){moving.current=!!payload;return;}
            if(type==='shell.editing'){editing.current=!!payload;return;}
            if(type==='action.completed'){hide();return;}
            if(type==='shell.blur'){if(!moving.current&&!fileDrag.current&&pendingDrops.current===0)hide();return;}
            if(type==='shell.error'){feedback(String(payload),'error');return;}
            if (type === 'hover') {
                if (payload)
                    entered();
                else
                    left();
            }
            if (type === 'notification') {
                const notice = payload?.notice ?? payload;
                if (!settingsVisible.current && !sticky.current && !editing.current && notice?.id && !notice.dismissedAt)
                    void go({ kind: 'notice', id: notice.id }, 'notification');
                else if (notice?.title)
                    feedback(notice.title);
            }
            if (type === 'open') {
                if (payload?.view === 'closed') {
                    hide();
                    return;
                }
                const pluginId = payload?.pluginId ?? (payload?.view && !['menu', 'notice', 'notification', 'plugin'].includes(payload.view) ? payload.view : undefined);
                pin(pluginId==='clipline'?false:!payload?.transient);
                window.clearTimeout(transientTimer.current);
                if(payload?.transient||pluginId==='clipline')transientTimer.current=window.setTimeout(()=>{if(!inside.current&&!editing.current&&!moving.current)hide();},4500);
                if (pluginId){
                    if(payload?.activationId)setActivationKey(value=>value+1);
                    void go({ kind: 'plugin', id: pluginId, itemId: payload?.id ?? payload?.itemId ?? payload?.assetId }, payload?.reason||'external');
                }
                else if (payload?.view === 'notification' || payload?.view === 'notice')
                    void go({ kind: 'notice', id: payload?.id }, 'external');
                else
                    void go({ kind: 'menu' }, 'external');
            }
        });
    }, [entered, feedback, go, hide, left, pin, refresh, scheduleClose,standalone]);
    useEffect(() => {
        if (standalone)
            return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape')
                hide();


        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [hide, go, standalone]);
    useLayoutEffect(() => {
        if (standalone || !window.notch)
            return;
        function measure() {
            // Windows setShape clips paint as well as input. Keep the last painted
            // region until the exit transform finishes, then restore the small bar.
            if(closing&&view.kind==='closed'){window.notch.setHitAreas(paintedRegions.current);return;}
            const regions = [notch.current, view.kind !== 'closed' && view.kind !== 'menu' ? surface.current : null].flatMap(element => {
                if (!element)
                    return [];
                const { x, y, width, height } = element.getBoundingClientRect();
                return width && height ? [{ x, y, width, height }] : [];
            });
            if (view.kind !== 'closed' && wheel.current && view.kind !== 'notice') {
                const node=wheel.current;
                const parent=node.offsetParent?.getBoundingClientRect() || {left:0,top:0};
                const box={x:parent.left+node.offsetLeft,y:parent.top+node.offsetTop,width:node.offsetWidth,height:node.offsetHeight};
                const radius = box.width / 2, cy = state.theme.wheelPlacement==='floating'?radius:0;
                for (let y = 0; y < box.height; y += 2) {
                    const dy = Math.min(radius, Math.abs(y + .5 - cy));
                    const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
                    regions.push({ x: box.x + radius - half, y: box.y + y, width: half * 2, height: 2 });
                }
            }
            paintedRegions.current=regions;window.notch.setHitAreas(regions);
        }
        measure();
        const settled = closing?0:window.setTimeout(()=>{measure();void window.notch.rpc('ui.settled',{view:viewName(view),...(view.kind==='plugin'?{pluginId:view.id}:{})}).catch(()=>{});},view.kind==='closed'?0:260);
        const observer = new ResizeObserver(measure);
        if (notch.current)
            observer.observe(notch.current);
        if (surface.current)
            observer.observe(surface.current);
        if (wheel.current)
            observer.observe(wheel.current);
        return () => { window.clearTimeout(settled); observer.disconnect(); };
    }, [standalone, view.kind, state.theme.wheelPlacement,closing]);
    useEffect(() => {
        if (!standalone)
            window.notch?.uiState?.({ view: viewName(view), pluginId: view.kind === 'plugin' ? view.id : undefined, itemId: view.kind === 'plugin' ? view.itemId : undefined, pinned,closing });
    }, [view, pinned, standalone,closing]);
    useEffect(()=>{
        if(view.kind!=='notice'||pinned)return;
        const timer=window.setTimeout(()=>{if(!inside.current&&!editing.current)hide();},7000);
        return ()=>window.clearTimeout(timer);
    },[view,pinned,hide]);
    const order = ['todo', 'clipline', 'snippets', 'vocabulary', 'trends', 'morning', 'attention', 'wellness'];
    const enabled = state.plugins.filter(plugin => plugin.enabled).sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 99) - (order.includes(b.id) ? order.indexOf(b.id) : 99));
    const wheelPlugins=enabled.filter(plugin=>plugin.presentation?.wheel!==false);
    const plugin = displayView.kind === 'plugin' ? enabled.find(plugin => plugin.id === displayView.id) : undefined;
    useEffect(() => {
        if (state.host?.online && current.current.kind === 'plugin' && !enabled.some(item => item.id === (current.current as {
            id: string;
        }).id)) {
            feedback(tr("插件已卸载或停用"));
            void go({ kind: 'menu' }, 'plugin-unloaded');
        }
    }, [state.plugins, state.host?.online, go, feedback]);
    const unread = state.notifications.filter(notice => notice.unread !== false && !notice.dismissedAt);
    const theme = { 'data-mode': state.theme.mode, 'data-palette': state.theme.palette, 'data-material': state.theme.material };
    const toast = flash && <div className={`toast ${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>{flash.kind === 'error' ? <CircleAlert size={16}/> : <CircleCheck size={16}/>}<span>{flash.message}</span><IconButton label={tr("关闭消息")} icon={<X size={12}/>} onClick={() => setFlash(null)}/></div>;
    function acceptsFiles(event:DragEvent<HTMLElement>){return event.dataTransfer.types.includes('Files');}
    function dragEntered(event:DragEvent<HTMLElement>){
        if(!acceptsFiles(event))return;
        event.preventDefault();
        dragDepth.current++;
        fileDrag.current=true;
        setDropActive(true);
        window.clearTimeout(closeTimer.current);
        if(settingsVisible.current)void window.notch.rpc('ui.open',{view:'menu',transient:true}).catch(error=>feedback(errorMessage(error),'error'));
        else if(current.current.kind==='closed')void go({kind:'menu'},'file-drag');
    }
    function dragLeft(event:DragEvent<HTMLElement>){
        if(!fileDrag.current)return;
        dragDepth.current=Math.max(0,dragDepth.current-1);
        if(dragDepth.current===0){fileDrag.current=false;setDropActive(false);scheduleClose();}
    }
    function filesDropped(event:DragEvent<HTMLElement>){
        if(!acceptsFiles(event))return;
        event.preventDefault();event.stopPropagation();
        const paths=[...new Set(Array.from(event.dataTransfer.files).map(file=>window.notch.filePath(file)).filter(Boolean))];
        fileDrag.current=false;dragDepth.current=0;setDropActive(false);
        if(!paths.length)return;
        pendingDrops.current++;setDropCount(count=>count+1);
        dropQueue.current=dropQueue.current.catch(()=>{}).then(async()=>{
            let imported=0;
            const failures:string[]=[];
            for(const path of paths){
                try{await window.notch.rpc('clip_import',{kind:'file',path});imported++;}
                catch(error){failures.push(errorMessage(error));}
            }
            window.dispatchEvent(new Event(CLIPS_IMPORTED_EVENT));
            refresh();
            if(failures.length)feedback(imported?fmt('已挂入 {{count}} 个文件，{{failed}} 个失败',{count:imported,failed:failures.length}):failures[0],'error');
            else feedback(fmt('已挂入 {{count}} 个文件',{count:imported}));
        }).catch(error=>feedback(errorMessage(error),'error')).finally(()=>{
            pendingDrops.current--;setDropCount(count=>count-1);scheduleClose();
        });
    }
    function openNotices() { pin(true); void go({ kind: 'notice' }, 'select'); }
    function openSettings() { hide();Promise.resolve(window.notch?.openSettings()).catch(error => feedback(errorMessage(error), 'error')); }
    if (standalone)
        return <main className="settings-page theme" {...theme}><Suspense fallback={<div className="plugin-loading" role="status" aria-label={tr('正在读取')}><i/><i/><i/></div>}><Settings state={state} refresh={refresh} section={settingsSection} feedback={feedback} standalone/></Suspense>{toast}</main>;
    const panelProps = { revision, feedback, itemId: displayView.kind === 'plugin' ? displayView.itemId : undefined, edit: (active: boolean) => {
            if (current.current.kind !== 'closed')
                editing.current = active;
            if (!active)
                scheduleClose();
        } };
    const BuiltIn = plugin && panels[plugin.id];
    return <main className="island theme" data-view={view.kind} data-closing={closing} data-exit-view={closing?closingFrom:undefined} data-plugin={plugin?.id} data-pinned={pinned} data-file-drag={dropActive} data-file-loading={dropCount>0} onDragEnterCapture={dragEntered} onDragLeaveCapture={dragLeft} onDragOverCapture={event=>{if(acceptsFiles(event)){event.preventDefault();event.dataTransfer.dropEffect="copy";}}} onDropCapture={filesDropped} data-placement={state.theme.wheelPlacement || 'edge'} {...theme} onPaste={event=>{if(event.defaultPrevented||event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;event.preventDefault();void window.notch.captureClip();}} onFocusCapture={() => window.clearTimeout(closeTimer.current)} onBlurCapture={() => window.setTimeout(scheduleClose, 0)}>
    <button type="button" className="notch" {...shellDrag} ref={notch} aria-label={tr("展开悬屿")} aria-expanded={view.kind !== 'closed'} onClick={() => { pin(true); void go({ kind: 'menu' }, 'select'); }}><BrandMark />{unread.length > 0 && <span className="unread-dot"/>}</button>
    <div className="wheel-region" ref={wheel} inert={view.kind === 'closed'} aria-hidden={view.kind === 'closed'}>
      <Wheel plugins={wheelPlugins} activeId={view.kind === 'plugin' ? view.id : plugin?.id} activationKey={activationKey} full={state.theme.wheelPlacement==='floating'} select={item=>{if(item.id==='clipline')pin(false);void go({kind:'plugin',id:item.id},'wheel');}} settings={openSettings} notices={openNotices} close={hide} unread={unread.length} grip={shellDrag}/>
    </div>
    {(dropActive||dropCount>0)&&<div className="file-drop-hint" role="status">{dropCount>0?tr('正在挂入文件'):tr('松开即可挂到剪贴绳')}</div>}
    <div className="surface" ref={surface} inert={view.kind === 'closed'} aria-hidden={view.kind === 'closed'}>
      <div className="deck">
        <header className="desk-header">
          <div className="identity"><div className="brand-emblem"><BrandMark /></div><div><strong>{tr("悬屿")}</strong><small>NOTCHDESK</small></div></div>
          <div className="desk-actions"><IconButton label={pinned ? tr("取消固定") : tr("固定面板")} icon={pinned ? <PinOff size={15}/> : <Pin size={15}/>} onClick={() => {
            const next = !pinned;
            pin(next);
            if (!next)
                scheduleClose();
        }}/>
            <button type="button" className="icon-button notice-toggle" title={tr("通知")} aria-label={fmt("通知{{value0}}", { value0: unread.length ? fmt("\uFF0C{{value0}} 条未读", { value0: unread.length }) : '' })} onClick={openNotices}><Bell size={16}/>{unread.length > 0 && <span className="unread-dot"/>}</button>
            <IconButton label={tr("设置")} icon={<Settings2 size={17}/>} onClick={openSettings}/></div>
        </header>
        {(view.kind !== 'closed'||closing) && displayView.kind !== 'menu' && displayView.kind !== 'closed' && <>
          <div className={`panel${leaving ? " panel-leaving" : ""}`} key={displayView.kind === 'plugin' ? displayView.id : displayView.kind}>
            <div className="panel-heading"><div className="tile-icon" data-plugin={plugin?.id}>{plugin ? <PluginIcon plugin={plugin} size={21}/> : <Bell size={20}/>}</div><div><h1>{plugin ? titleOf(plugin) : displayView.kind === 'notice' ? tr("通知") : tr("插件不可用")}</h1>{plugin && detailOf(plugin) && <p>{tr(detailOf(plugin))}</p>}</div></div>
            <div className="panel-content">
              {displayView.kind === 'notice' && <NoticePanel notices={state.notifications} selected={displayView.id} choose={id => void go({ kind: 'notice', id }, 'select')} feedback={feedback} refresh={refresh} preferences={state.notificationSettings} complete={hide}/>}
              {plugin?.id==='clipline' ? null : plugin?.ui ? <RuntimePanel plugin={plugin} tools={tools} values={state.settings[plugin.id]?.values ?? emptySettings} props={panelProps}/> : BuiltIn ? <BuiltIn {...panelProps}/> : plugin ? <GenericPanel plugin={plugin} tools={tools} {...panelProps}/> : displayView.kind !== 'notice' && <Empty icon={<Sparkles size={21}/>} title={tr("此插件尚未启用")} detail={tr("可以从设置启用\u3002")}/>}
            </div>
          </div>
        </>}
        {toast}
      </div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(location.hash.startsWith('#rope')?<ClotheslineSurface/>:<App />);
