import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('clipline');
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type DragEvent } from 'react';
import {flushSync} from 'react-dom';
import { ArrowUpRight, Clipboard, Copy, File, FileCode2, Image as ImageIcon, Link2, Paperclip, Pin, PinOff, Trash2, X } from 'lucide-react';
import { DataMessage, Empty, IconButton, useActions, useData, type PanelProps } from '../../src/ui/primitives';
import { errorMessage } from '../../src/ui/types';
import {CLIPS_IMPORTED_EVENT,CLIPS_POSITIONED_EVENT,CLIPS_DRAGGING_EVENT,clipDragging} from '../../src/ui/clipEvents';
const PdfPreview = lazy(() => import('./PdfPreview'));
type PreviewBox={x:number;y:number;width:number;height:number;bridge?:{x:number;y:number;width:number;height:number}};
function placePreview(card:HTMLElement,width:number,height:number,minimumHeight:number):PreviewBox{
    const rect=card.getBoundingClientRect();card.style.setProperty('--card-screen-left',rect.left+'px');
    const bar=card.querySelector('.clip-actions')!.getBoundingClientRect(),margin=16,gap=16;
    const rowBottom=Math.max(bar.bottom,...Array.from(document.querySelectorAll('.clip-actions')).map(node=>node.getBoundingClientRect().bottom));
    const below=rowBottom+gap,spaceBelow=innerHeight-margin-below,spaceAbove=rect.top-gap-margin;
    const rightEdge=Math.max(rect.right,bar.right),leftEdge=Math.min(rect.left,bar.left);
    const right=innerWidth-margin-rightEdge-gap,left=leftEdge-gap-margin;
    const actualWidth=Math.min(width,innerWidth-margin*2),center=Math.max(margin+actualWidth/2,Math.min(innerWidth-margin-actualWidth/2,rect.x+rect.width/2));
    if(spaceBelow>=Math.min(height,minimumHeight))return {x:center,y:below,width:actualWidth,height:Math.min(height,spaceBelow),bridge:{x:Math.max(bar.left,center-actualWidth/2),y:bar.bottom-3,width:Math.max(12,Math.min(bar.right,center+actualWidth/2)-Math.max(bar.left,center-actualWidth/2)),height:below-bar.bottom+6}};
    if(Math.max(right,left)>=Math.min(actualWidth,360)){
      const onRight=right>=left,w=Math.min(actualWidth,onRight?right:left),h=Math.min(height,innerHeight-margin*2),y=Math.max(margin,Math.min(innerHeight-margin-h,rect.top));
      const edge=onRight?rightEdge+gap:leftEdge-gap-w;
      return {x:edge+w/2,y,width:w,height:h,bridge:{x:onRight?rect.right-3:edge+w-3,y:Math.max(rect.top,y),width:(onRight?rightEdge-rect.right:rect.left-leftEdge)+gap+6,height:Math.max(12,Math.min(bar.bottom,y+h)-Math.max(rect.top,y))}};
    }
    const above=spaceAbove>spaceBelow,h=Math.max(80,Math.min(height,above?spaceAbove:spaceBelow));
    return {x:center,y:above?Math.max(margin,rect.top-gap-h):below,width:actualWidth,height:h};
}
function inClipGroup(target:EventTarget|null,id:string){
    const node=target instanceof Element?target.closest('[data-clip-id],[data-preview-id]'):null;
    return node?.getAttribute('data-clip-id')===id||node?.getAttribute('data-preview-id')===id;
}
type Clip = {
    id: string;
    kind: string;
    name?: string;
    mime?: string;
    preview?: string;
    text?: string;
    assetId?: string;
    createdAt?: number;
    updatedAt?: number;
    size?: number;
    missing?: boolean;
    pinned?: boolean;
    hangX?: number | null;
};
function clipPreviewKind(clip: Clip) {
    if (clip.preview && ['text', 'image', 'video', 'html', 'markdown', 'pdf', 'file'].includes(clip.preview))
        return clip.preview;
    if (clip.mime?.startsWith('image/'))
        return 'image';
    return clip.kind;
}
function PreviewContent({clip,compact=false}:{clip:Clip;compact?:boolean}){
    const kind=clipPreviewKind(clip),url=clip.kind!=='text'?window.notch.assetUrl(clip.assetId||clip.id,compact&&kind==='image'?'thumb':'preview'):'';
    if(clip.missing)return <Empty icon={<File size={20}/>} title={tr('找不到原文件')} detail={tr('文件可能已移动，重新定位后可以继续使用这个挂件。')}/>;
    if(kind==='image')return <img src={url} alt={clip.name||tr('剪贴图片')}/>;
    if(kind==='video')return <video src={url} controls={!compact} muted={compact} preload="metadata"/>;
    if(kind==='pdf')return <Suspense fallback={<p className="quiet loading">{tr('正在载入 PDF…')}</p>}><PdfPreview url={url} compact={compact}/></Suspense>;
    if(['html','markdown','text'].includes(kind)&&url)return <iframe title={clip.name||tr('剪贴预览')} src={url} sandbox=""/>;
    if(kind==='text')return <pre>{compact?clip.text?.slice(0,700):clip.text}</pre>;
    return <Empty icon={<File size={20}/>} title={clip.name||tr('文件')} detail={tr('可使用系统应用打开')}/>;
}
export function ClipPanel({ revision, feedback, edit, itemId }: PanelProps) {
    const { data, setData, error, busy, reload } = useData<Clip[]>('clip_list', revision, []);
    const actions = useActions(feedback, reload);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [hovered,setHovered]=useState<({id:string}&PreviewBox)|null>(null);
    const [activeId,setActiveId]=useState<string|null>(null);
    const [previewBox,setPreviewBox]=useState<PreviewBox|null>(null);
    const [exporting,setExporting]=useState<string|null>(null);
    const hoverTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
    const leaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
    const rope=useRef<SVGPathElement>(null);
    const held=useRef<{id:string;x:number;y:number;latestX:number;latestY:number;frame:number;tilt:number;ropeLeft:number;ropeWidth:number;center:number;position:number;width:number;node:HTMLElement;moved:boolean}|null>(null);
    const hoverBounds=useRef<{node:HTMLElement;left:number;top:number}|null>(null),glowFrame=useRef(0),glowPoint=useRef<{node:HTMLElement;x:number;y:number}|null>(null);
    const [positions,setPositions]=useState<Record<string,number>>({});
    const moveQueue=useRef(Promise.resolve());
    // Commit the translated cards and remove the temporary rope offset in one paint.
    useEffect(()=>{const commit=(event:Event)=>flushSync(()=>{setPositions({});setData((event as CustomEvent<Clip[]>).detail);});window.addEventListener(CLIPS_POSITIONED_EVENT,commit);return()=>window.removeEventListener(CLIPS_POSITIONED_EVENT,commit);},[]);
    useEffect(()=>setPositions(current=>Object.fromEntries(Object.entries(current).filter(([id,x])=>data.some(item=>item.id===id&&item.hangX!==x)))),[data]);
    function savePosition(id:string,x:number,beforeId?:string){
      setPositions(current=>({...current,[id]:x}));
      moveQueue.current=moveQueue.current.then(async()=>{
        const result=await actions.run('clip_move',{id,x,...(beforeId?{beforeId}:{})});
        if(!result.ok)setPositions(current=>{if(current[id]!==x)return current;const next={...current};delete next[id];return next;});
      });
    }
    const suppressClick=useRef(false);
    function paintHeld(){
      const drag=held.current;if(!drag)return;
      drag.position=Math.max(64,Math.min(drag.width-64,drag.center+drag.latestX-drag.x));
      const x=drag.position-drag.center,y=Math.max(-55,Math.min(65,drag.latestY-drag.y));
      if(Math.hypot(x,y)>4)drag.moved=true;if(!drag.moved)return;
      drag.node.dataset.pulling='true';drag.node.style.transform=`translate3d(${x}px,${y}px,0) rotate(${drag.tilt+Math.max(-13,Math.min(13,x*.12))}deg)`;
      const pull=Math.max(20,Math.min(340,(drag.latestX-drag.ropeLeft)/drag.ropeWidth*360));
      rope.current?.setAttribute('d',`M 0 20 Q ${pull} ${23+y*.5} 360 20`);
    }
    function release(event:PointerEvent<HTMLElement>,cancel=false){
      const drag=held.current;if(!drag)return;cancelAnimationFrame(drag.frame);
      if(!cancel){drag.latestX=event.clientX;drag.latestY=event.clientY;paintHeld();}held.current=null;
      if(drag.node.hasPointerCapture(event.pointerId))drag.node.releasePointerCapture(event.pointerId);
      drag.node.dataset.pulling='false';drag.node.parentElement?.removeAttribute('data-active');drag.node.style.transition='none';drag.node.style.removeProperty('transform');
      if(drag.moved&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        drag.node.dataset.settling='true';
        const y=Math.max(-55,Math.min(65,drag.latestY-drag.y)),swing=Math.max(-13,Math.min(13,(drag.position-drag.center)*.12));
        const animation=drag.node.animate([{transform:`translate3d(0,${y}px,0) rotate(${drag.tilt+swing}deg)`},{transform:drag.node.matches(':hover')?'translateY(-4px) rotate(0deg) scale(1.035)':`rotate(${drag.tilt}deg)`}],{duration:280,easing:'cubic-bezier(.18,1.3,.3,1)'});
        void animation.finished.then(()=>{delete drag.node.dataset.settling;drag.node.style.removeProperty('transition');}).catch(()=>{});
      }else drag.node.style.removeProperty('transition');
      rope.current?.setAttribute('d','M 0 20 Q 180 23 360 20');edit(false);
      clipDragging(false);
      if(cancel)return;
      if(!drag.moved)return;
      suppressClick.current=true;
      const target=document.elementsFromPoint(event.clientX,event.clientY).map(node=>node.closest('[data-clip-id]')).find(node=>node && node.getAttribute('data-clip-id')!==drag.id);
      const beforeId=target?.getAttribute('data-clip-id');
      savePosition(drag.id,drag.position/drag.width,beforeId||undefined);
    }
    function holdHover(){clearTimeout(leaveTimer.current);}
    function clearPreview(){clearTimeout(hoverTimer.current);clearTimeout(leaveTimer.current);setActiveId(null);setHovered(null);setSelected(null);suppressClick.current=false;edit(false);}
    useEffect(()=>{const clear=(event:Event)=>{if((event as CustomEvent<boolean>).detail){clearTimeout(hoverTimer.current);clearTimeout(leaveTimer.current);setActiveId(null);setHovered(null);setSelected(null);}};window.addEventListener(CLIPS_DRAGGING_EVENT,clear);return()=>{window.removeEventListener(CLIPS_DRAGGING_EVENT,clear);cancelAnimationFrame(glowFrame.current);clearTimeout(leaveTimer.current);};},[]);
    useEffect(()=>window.notch.onEvent(({type})=>{if(type==='clip.captured')clearPreview();}),[]);
    useEffect(()=>{window.addEventListener(CLIPS_IMPORTED_EVENT,clearPreview);return ()=>{window.removeEventListener(CLIPS_IMPORTED_EVENT,clearPreview);clearTimeout(hoverTimer.current);};},[]);
    const lastItem = useRef<string | undefined>(undefined);
    const clips = Array.isArray(data) ? data : [];
    const preview = clips.find(clip => clip.id === selected);
    useLayoutEffect(()=>{
      if(!selected){setPreviewBox(null);return;}
      const position=()=>{const node=document.querySelector<HTMLElement>('[data-clip-id="'+CSS.escape(selected)+'"]');if(node)setPreviewBox(placePreview(node,880,Math.min(innerHeight*.75,740),340));};
      position();window.addEventListener('resize',position);return()=>window.removeEventListener('resize',position);
    },[selected,preview?.updatedAt]);
    useEffect(()=>{if(preview&&preview.kind!=='text'&&!preview.missing)void window.notch.prepareClipDrag(preview.id,preview.updatedAt).catch(()=>{});},[selected,preview?.updatedAt]);
    const hoverItem=clips.find(clip=>clip.id===hovered?.id);
    useEffect(() => {
        if (itemId === lastItem.current)
            return;
        const item = clips.find(clip => clip.id === itemId);
        if (item) {
            lastItem.current = itemId;
            setSelected(item.id);
            edit(false);
        }
        if (!itemId)
            lastItem.current = undefined;
    }, [data, itemId]);
    function select(item: Clip | null) { clearTimeout(hoverTimer.current);clearTimeout(leaveTimer.current);setHovered(null);setSelected(item?.id ?? null); edit(false); }
    function hover(item:Clip,node:HTMLElement){
      if(item.kind!=='text'&&!item.missing)void window.notch.prepareClipDrag(item.id,item.updatedAt).catch(()=>{});
      const rect=node.getBoundingClientRect();
      node.style.setProperty('--card-screen-left',rect.left+'px');setActiveId(item.id);
      hoverBounds.current={node,left:rect.left,top:rect.top};
      clearTimeout(hoverTimer.current);holdHover();if(selected||held.current||exporting||hovered?.id===item.id)return;
      hoverTimer.current=setTimeout(()=>{if(node.isConnected)setHovered({id:item.id,...placePreview(node,300,252,252)});},240);
    }
    function leaveHover(id:string,relatedTarget:EventTarget|null){
      if(inClipGroup(relatedTarget,id)){holdHover();return;}
      clearTimeout(hoverTimer.current);clearTimeout(leaveTimer.current);
      leaveTimer.current=setTimeout(()=>{
        const nodes=document.querySelectorAll<HTMLElement>('[data-clip-id="'+CSS.escape(id)+'"],[data-preview-id="'+CSS.escape(id)+'"]');
        if(Array.from(nodes).some(node=>node.matches(':hover')||(document.hasFocus()&&node.contains(document.activeElement))))return;
        setActiveId(current=>current===id?null:current);
        setHovered(current=>current?.id===id?null:current);
      },400);
    }
    function exportClip(event:DragEvent<HTMLElement>,item:Clip){
      clearTimeout(hoverTimer.current);clearTimeout(leaveTimer.current);setHovered(null);suppressClick.current=true;
      if(item.kind==='text'){event.dataTransfer.setData('text/plain',item.text||'');event.dataTransfer.effectAllowed='copy';edit(true);return;}
      event.preventDefault();if(item.missing)return;
      setExporting(item.id);edit(true);
      void window.notch.startClipDrag(item.id).catch(error=>feedback(errorMessage(error),'error')).finally(()=>{setExporting(null);edit(false);});
    }
    async function importPaths(paths: string[]) {
        for (const path of paths)
            if (path)
                await actions.run('clip_import', { kind: 'file', path }, tr("已挂到剪贴绳"));
    }
    async function addFiles() {
        edit(true);
        try {
            await importPaths(await window.notch.pickFile());
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
        }
        finally {
            edit(false);
        }
    }
    async function locateFile(id: string) {
        try {
            const [path] = await window.notch.pickFile();
            if (path)
                await actions.run('clip_relink', { id, path }, tr("已重新关联"));
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
        }
    }
    const kind = preview ? clipPreviewKind(preview) : '';
    const url = preview && preview.kind !== 'text' ? window.notch.assetUrl(preview.assetId || preview.id, 'preview') : '';
    return <>
    {hovered&&hoverItem&&!preview&&<>
    {hovered.bridge&&<div className="clip-hover-bridge" data-preview-id={hoverItem.id} style={{left:hovered.bridge.x,top:hovered.bridge.y,width:hovered.bridge.width,height:hovered.bridge.height}} onPointerEnter={holdHover} onPointerLeave={event=>leaveHover(hoverItem.id,event.relatedTarget)}/>}
    <div id="clip-hover-preview" className="clip-hover-preview" role="dialog" aria-modal="false" aria-label={tr('悬停预览')} data-preview-id={hoverItem.id} style={{left:hovered.x,top:hovered.y,width:hovered.width,maxHeight:hovered.height,'--hover-preview-height':hovered.height+'px'} as CSSProperties} onPointerEnter={holdHover} onPointerLeave={event=>leaveHover(hoverItem.id,event.relatedTarget)} onFocusCapture={holdHover}>
      <header><strong className="ellipsis">{hoverItem.name||tr('剪贴预览')}</strong><span>{clipPreviewKind(hoverItem).toUpperCase()}</span></header>
      <div className="hover-preview-canvas"><PreviewContent clip={hoverItem} compact/></div>
      <button type="button" className="text-button" onClick={()=>select(hoverItem)}>{tr('点击展开预览')}</button>
    </div></>}
    {preview && <div className="clip-preview" data-kind={kind} role="dialog" aria-label={tr('剪贴预览')} style={previewBox?{left:previewBox.x,top:previewBox.y,width:previewBox.width,maxHeight:previewBox.height,'--clip-preview-height':previewBox.height+'px'} as CSSProperties:undefined}>
      <div className="toolbar"><strong className="ellipsis">{preview.name || tr("剪贴预览")}</strong>{preview.kind!=='text'&&!preview.missing&&<button type="button" className="button quiet-button" draggable onDragStart={event=>exportClip(event,preview)} title={tr('拖到其他软件')}><ArrowUpRight size={13}/>{tr('拖到其他软件')}</button>}<IconButton label={tr("关闭预览")} icon={<X size={16}/>} onClick={() => select(null)}/></div>
      <div className="preview-canvas" onDragStartCapture={event=>{if((event.target as Element).tagName==='IMG')exportClip(event,preview);}}><PreviewContent clip={preview}/></div>
      <div className="form-actions">{preview.missing ? <button className="button primary" onClick={() => void locateFile(preview.id)}><Link2 size={14}/>{tr("重新定位文件")}</button> : <>
        {preview.kind === 'file' && <button className="button" onClick={() => void actions.run('clip_copy_path', { id: preview.id }, tr("已复制文件路径"))}><Link2 size={14}/>{tr("复制路径")}</button>}
        {url && <button className="button" onClick={() => void actions.run('clip_open_file', { id: preview.id })}><ArrowUpRight size={14}/>{tr("打开文件")}</button>}
        <button className="button primary" onClick={() => void actions.run('clip_copy', { id: preview.id }, tr("已写入剪贴板"))}><Copy size={14}/>{tr("写回剪贴板")}</button>
      </>}</div>
    </div>}
    <div className="rope-board" onPaste={event=>{event.preventDefault();void window.notch.captureClip();}} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{
      event.preventDefault();setDragging(false);const files=Array.from(event.dataTransfer.files);
      if(files.length)void importPaths(files.map(file=>window.notch.filePath(file)));
      else{const text=event.dataTransfer.getData('text/plain');if(text.trim())void actions.run('clip_import',{kind:'text',text});}
    }} data-dragging={dragging} tabIndex={0} aria-label={tr('水平剪贴绳')}>
      <div className="rope-tools"><IconButton label={tr('添加文件')} icon={<Paperclip size={14}/>} onClick={()=>void addFiles()}/><IconButton label={tr('收录剪贴板')} icon={<Clipboard size={14}/>} onClick={()=>void actions.run('clip_capture')}/></div>
      <DataMessage busy={busy} error={error}/>
      <div className="rope-track"><svg className="rope-line" viewBox="0 0 360 80" preserveAspectRatio="none" aria-hidden="true"><path ref={rope} d="M 0 20 Q 180 23 360 20"/></svg>
        {!busy&&!clips.length&&<p className="rope-empty">{tr('粘贴即可上绳')} · Ctrl+Alt+V</p>}
        <div className="clip-grid" role="list" aria-label={tr('水平剪贴绳')}>
          {clips.map((item,index)=>{const itemKind=clipPreviewKind(item),x=positions[item.id]??item.hangX;return <div className="clip-anchor" key={item.id} style={{left:typeof x==='number'?`clamp(64px,calc(${x*100}% + var(--rope-shift,0px)),calc(100% - 64px))`:`calc(clamp(calc(64px + var(--default-radius)),var(--rope-x),calc(100% - 64px - var(--default-radius))) + ${index-(clips.length-1)/2} * var(--clip-step))`,'--clip-step':`min(114px,calc((100vw - 128px) / ${Math.max(1,clips.length-1)}))`,'--default-radius':`calc(${(clips.length-1)/2} * var(--clip-step))`} as CSSProperties}><article className="clip-card" data-kind={itemKind} data-clip-id={item.id} data-exporting={exporting===item.id} data-preview-active={hovered?.id===item.id||selected===item.id} data-interacting={activeId===item.id} role="listitem" style={{'--tilt':(index%2?2:-2)+'deg',animationDelay:Math.min(index,5)*25+'ms'} as CSSProperties} onPointerEnter={event=>hover(item,event.currentTarget)} onPointerLeave={event=>leaveHover(item.id,event.relatedTarget)}
            onPointerDown={event=>{
              if(event.button!==0||(event.target as Element).closest('.clip-actions,.clip-thumbnail'))return;
              event.preventDefault();cancelAnimationFrame(glowFrame.current);glowFrame.current=0;
              clearTimeout(hoverTimer.current);setHovered(null);
              for(const animation of event.currentTarget.getAnimations())animation.cancel();delete event.currentTarget.dataset.settling;event.currentTarget.style.transition='none';
              const anchor=event.currentTarget.parentElement!,box=anchor.getBoundingClientRect(),width=anchor.parentElement!.getBoundingClientRect().width,center=box.x+box.width/2;
              const line=rope.current!.ownerSVGElement!.getBoundingClientRect();
              held.current={id:item.id,x:event.clientX,y:event.clientY,latestX:event.clientX,latestY:event.clientY,frame:0,tilt:parseFloat(event.currentTarget.style.getPropertyValue('--tilt'))||0,ropeLeft:line.left,ropeWidth:line.width,center,position:center,width,node:event.currentTarget,moved:false};suppressClick.current=false;anchor.dataset.active='true';
              clipDragging(true);
              event.currentTarget.setPointerCapture(event.pointerId);edit(true);
            }}
            onPointerMove={event=>{
              const drag=held.current;if(!drag||drag.id!==item.id){
                const bounds=hoverBounds.current;if(!bounds||bounds.node!==event.currentTarget)return;
                glowPoint.current={node:event.currentTarget,x:event.clientX-bounds.left,y:event.clientY-bounds.top};
                if(!glowFrame.current)glowFrame.current=requestAnimationFrame(()=>{glowFrame.current=0;const point=glowPoint.current;if(point){point.node.style.setProperty('--mouse-x',point.x+'px');point.node.style.setProperty('--mouse-y',point.y+'px');}});return;
              }
              drag.latestX=event.clientX;drag.latestY=event.clientY;
              if(!drag.frame)drag.frame=requestAnimationFrame(()=>{drag.frame=0;paintHeld();});
            }} onPointerUp={event=>release(event)} onPointerCancel={event=>release(event,true)} onLostPointerCapture={event=>release(event,true)}
            onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}>
            <button type="button" className="clothespin" title={tr('拖动夹子沿绳子移动，方向键微调')} aria-label={tr('拖动夹子沿绳子移动，方向键微调')} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home'){void actions.run('clip_move',{id:item.id,resetPosition:true});return;}const anchor=event.currentTarget.closest('.clip-anchor')!.getBoundingClientRect();savePosition(item.id,Math.max(64,Math.min(innerWidth-64,anchor.x+anchor.width/2+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?32:8)))/innerWidth);}}/>
            <button className="clip-thumbnail" draggable={!item.missing} onPointerDown={()=>{if(item.kind!=='text'&&!item.missing)void window.notch.prepareClipDrag(item.id,item.updatedAt).catch(()=>{});}} onDragStart={event=>exportClip(event,item)} onDragEnd={()=>{if(item.kind==='text'){edit(false);void window.notch.rpc('ui.open',{view:'closed'});}}} title={item.name||tr('查看剪贴')} aria-label={item.name||tr('查看剪贴')} aria-describedby={hovered?.id===item.id?'clip-hover-preview':undefined} aria-pressed={selected===item.id} onClick={()=>select(item)}>{item.missing?<span>{tr('原文件已移动')}</span>:itemKind==='image'?<img draggable={false} src={window.notch.assetUrl(item.assetId||item.id,'thumb')} alt={item.name||tr('剪贴图片')}/>:item.kind==='text'?<span>{item.text}</span>:<div className="file-jacket"><FileCode2 size={23}/><b>{itemKind.toUpperCase()}</b></div>}</button>
            <div className="clip-actions" onPointerEnter={()=>{holdHover();setActiveId(item.id);}} onFocusCapture={()=>{holdHover();setActiveId(item.id);}}><IconButton label={tr('查看剪贴')} icon={<ArrowUpRight size={14}/>} onClick={()=>select(item)}/><IconButton label={tr('写回剪贴板')} icon={<Copy size={14}/>} disabled={item.missing} onClick={()=>void actions.run('clip_copy',{id:item.id})}/><IconButton label={item.pinned?tr('取消置顶'):tr('置顶剪贴')} icon={<Pin size={14}/>} onClick={()=>void actions.run('clip_pin',{id:item.id,pinned:!item.pinned})}/><IconButton label={tr('删除剪贴')} danger icon={<Trash2 size={14}/>} onClick={()=>void actions.run('clip_remove',{id:item.id})}/></div>
          </article></div>;})}
        </div>
      </div>
    </div>
  </>;
}
