import {useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type PointerEvent} from 'react';
import {GripHorizontal,Pin,RotateCcw,X} from 'lucide-react';
import {flushSync} from 'react-dom';
import {applyLocale,currentLocale,subscribeLocale,createPluginTranslator} from '../../src/ui/i18n';
import {fallbackState,errorMessage,type State,type Rect} from '../../src/ui/types';
import {IconButton} from '../../src/ui/primitives';
import {ClipPanel} from './Panel';
import {CLIPS_IMPORTED_EVENT,CLIPS_POSITIONED_EVENT,CLIPS_DRAGGING_EVENT,clipDragging} from '../../src/ui/clipEvents';
const {tr}=createPluginTranslator('clipline');
type Layout={x:number;y:number;displayId?:string;anchor?:'notch'|'screen'};
type Geometry={bounds?:Rect;notch?:Rect;wheelHeight?:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,max));

export function ClotheslineSurface(){
  useSyncExternalStore(subscribeLocale,currentLocale);
  const [state,setState]=useState<State>(fallbackState),[revision,setRevision]=useState(0);
  const [layout,setLayout]=useState<Layout>({x:.5,y:.2,anchor:'notch'}),[itemId,setItemId]=useState<string>();
  const [geometry,setGeometry]=useState<Geometry>({});
  const [message,setMessage]=useState(''),[visible,setVisible]=useState(false);
  const [pinned,setPinned]=useState(false),[pinBusy,setPinBusy]=useState(false);
  const root=useRef<HTMLElement>(null),current=useRef(layout),displayId=useRef<string|undefined>(undefined);
  const manipulatingInput=useRef(false);
  const drag=useRef<{x:number;y:number;latestX:number;latestY:number;frame:number;layout:Layout;original:Layout;pointerId:number}|null>(null);
  const follow=layout.anchor==='notch';
  const centerX=follow&&geometry.notch?(geometry.notch.x+geometry.notch.width/2-(geometry.bounds?.x||0))/innerWidth:layout.x;
  const ropeY=clamp(follow?(geometry.notch?.y||0)-(geometry.bounds?.y||0)+(geometry.wheelHeight||156)+48:layout.y*innerHeight,64,Math.max(64,innerHeight-220));
  const feedback=useCallback((message:string)=>setMessage(message),[]);
  const refresh=useCallback(async()=>{
    if(drag.current||manipulatingInput.current)return;
    try{
      const next=await window.notch.rpc<State>('state.get');
      if(drag.current||manipulatingInput.current)return;
      setState(next);
      if(!next.plugins.some(p=>p.id==='clipline'&&p.enabled))return;
      const [preferences,value]=await Promise.all([window.notch.rpc<{pinned:boolean}>('clip_window_get'),window.notch.rpc<Layout>('clip_layout_get')]);
      if(drag.current||manipulatingInput.current)return;
      setPinned(preferences.pinned);
      if(!drag.current){current.current=value;setLayout(value);}
      setRevision(v=>v+1);
    }catch(error){feedback(errorMessage(error));}
  },[feedback]);
  useEffect(()=>{void refresh();const stop=window.notch.onEvent(({type,payload})=>{
    if(['changed','server.ready','clip.captured'].includes(type))void refresh();
    if(type==='clipline.pin')setPinned(payload.pinned===true);
    if(type==='plugin.activated'&&payload.pluginId==='clipline'&&!payload.itemId)window.dispatchEvent(new Event(CLIPS_IMPORTED_EVENT));
    if(type==='rope.open'){displayId.current=payload.displayId;setPinned(payload.pinned===true);setGeometry(payload);setItemId(payload.itemId);if(!payload.itemId)window.dispatchEvent(new Event(CLIPS_IMPORTED_EVENT));setVisible(true);void refresh();}
    if(type==='rope.context')setGeometry(payload);
    if(type==='rope.closed'){setVisible(false);setItemId(undefined);setMessage('');}
  });void window.notch.ropeReposition().catch(error=>feedback(errorMessage(error)));return stop;},[refresh,feedback]);
  const resources=state.plugins.map(p=>p.id+':'+p.revision).join('|');
  useEffect(()=>applyLocale(state.theme.locale||'system',state.plugins),[state.theme.locale,resources]);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),2600);return()=>clearTimeout(timer);},[message]);
  useEffect(()=>{if(visible&&layout.displayId&&displayId.current&&layout.displayId!==displayId.current)void window.notch.ropeReposition();},[layout.displayId,visible]);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')void window.notch.rpc('clip_window_hide');};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
  useLayoutEffect(()=>{
    if(!visible)return;
    let frame=0,last='',manipulating=false;
    function schedule(){if(!manipulating&&!frame)frame=requestAnimationFrame(measure);}
    function measure(){
      frame=0;
      const rects=Array.from(root.current?.querySelectorAll('.rope-drag-handle,.rope-tools,.clip-card,.clip-actions,.clip-hover-bridge,.clip-preview,.clip-hover-preview,.rope-empty,.rope-feedback')||[]).flatMap(node=>{
        if(node.matches('.clip-actions')&&getComputedStyle(node).pointerEvents==='none')return [];
        if(node.matches('.clip-card')){
          const card=node as HTMLElement,box=card.parentElement!.getBoundingClientRect(),settling=card.dataset.settling==='true';
          return [{x:box.x-18,y:box.y-(settling?84:28),width:box.width+36,height:card.offsetHeight+(settling?184:93)}];
        }
        const box=node.getBoundingClientRect();return box.width&&box.height?[{x:box.x-8,y:box.y-10,width:box.width+16,height:box.height+20}]:[];
      });
      const key=JSON.stringify(rects);if(key!==last){last=key;window.notch.setHitAreas(rects);}
    }
    function interaction(event:Event){
      manipulating=!!(event as CustomEvent<boolean>).detail;
      manipulatingInput.current=manipulating;
      cancelAnimationFrame(frame);frame=0;
      if(manipulating)void window.notch.ropeMoving(true);
      else frame=requestAnimationFrame(()=>{measure();void window.notch.ropeMoving(false);void refresh();});
    }
    const observer=new MutationObserver(changes=>{
      if(changes.some(change=>{
        if(change.type!=='attributes')return true;
        const node=change.target as Element;
        return !node.matches('.rope-line path')&&!(node.matches('.clip-card')&&['style','data-pulling'].includes(change.attributeName||''));
      }))schedule();
    });observer.observe(root.current!,{subtree:true,childList:true,attributes:true});
    const resize=new ResizeObserver(schedule);resize.observe(root.current!);
    window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);document.addEventListener('load',schedule,true);
    window.addEventListener(CLIPS_DRAGGING_EVENT,interaction);
    const settled=(event:Event)=>{if((event.target as Element).matches('.rope-page,.rope-board,.clip-preview,.clip-hover-preview'))schedule();};
    root.current!.addEventListener('transitionend',settled);root.current!.addEventListener('animationend',settled);
    schedule();return()=>{cancelAnimationFrame(frame);manipulatingInput.current=false;observer.disconnect();resize.disconnect();root.current?.removeEventListener('transitionend',settled);root.current?.removeEventListener('animationend',settled);window.removeEventListener(CLIPS_DRAGGING_EVENT,interaction);void window.notch.ropeMoving(false);window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);document.removeEventListener('load',schedule,true);};
  },[visible]);
  function start(event:PointerEvent<HTMLButtonElement>){
    if(event.button!==0||drag.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    for(const node of root.current?.querySelectorAll<HTMLElement>('.clip-anchor')||[]){const box=node.getBoundingClientRect();node.style.setProperty('--drag-origin-x',(box.x+box.width/2)+'px');}
    drag.current={x:event.clientX,y:event.clientY,latestX:event.clientX,latestY:event.clientY,frame:0,original:current.current,layout:{...current.current,x:centerX,y:ropeY/innerHeight,anchor:'screen'},pointerId:event.pointerId};
    clipDragging(true);
    root.current?.setAttribute('data-moving','true');void window.notch.ropeEditing(true);
  }
  function move(event:PointerEvent<HTMLButtonElement>){
    const held=drag.current;if(!held||held.pointerId!==event.pointerId)return;
    held.latestX=event.clientX;held.latestY=event.clientY;
    if(!held.frame)held.frame=requestAnimationFrame(()=>{held.frame=0;paintMove();});
  }
  function paintMove(){
    const held=drag.current;if(!held)return;
    const next={...held.layout,x:clamp(held.layout.x+(held.latestX-held.x)/innerWidth,0,1),y:clamp(held.layout.y+(held.latestY-held.y)/innerHeight,0,1),displayId:displayId.current};
    current.current=next;
    root.current?.style.setProperty('--rope-dx',((next.x-held.layout.x)*innerWidth)+'px');
    root.current?.style.setProperty('--rope-dy',(clamp(next.y*innerHeight,64,Math.max(64,innerHeight-220))-held.layout.y*innerHeight)+'px');
  }
  async function release(event:PointerEvent<HTMLButtonElement>,cancel=false){
    const held=drag.current;if(!held)return;
    cancelAnimationFrame(held.frame);
    if(!cancel){held.latestX=event.clientX;held.latestY=event.clientY;paintMove();}
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    clipDragging(false);
    const next=cancel?held.original:current.current;
    try{if(!cancel){await window.notch.rpc('clip_layout_set',{...next,shiftX:next.x-held.layout.x});const cards=await window.notch.rpc('clip_list');window.dispatchEvent(new CustomEvent(CLIPS_POSITIONED_EVENT,{detail:cards}));}current.current=next;flushSync(()=>setLayout({...next}));}
    catch(error){current.current=held.original;flushSync(()=>setLayout(held.original));feedback(errorMessage(error));}
    finally{root.current?.style.removeProperty('--rope-dx');root.current?.style.removeProperty('--rope-dy');root.current?.setAttribute('data-moving','false');drag.current=null;void refresh();await window.notch.ropeEditing(false);}
  }
  const style={'--rope-x':clamp(centerX,0,1)*100+'%','--rope-y':ropeY+'px'} as CSSProperties;
  return <main ref={root} className="rope-page theme" data-mode={state.theme.mode} data-palette={state.theme.palette} data-material={state.theme.material} data-visible={visible} style={style} onPaste={event=>{if(event.defaultPrevented)return;event.preventDefault();void window.notch.captureClip().catch(error=>feedback(errorMessage(error)));}} onDragOver={event=>event.preventDefault()} onDrop={event=>{
    if(event.defaultPrevented)return;event.preventDefault();const paths=Array.from(event.dataTransfer.files).map(file=>window.notch.filePath(file));
    void (async()=>{for(const path of paths)await window.notch.rpc('clip_import',{kind:'file',path});if(!paths.length){const text=event.dataTransfer.getData('text/plain');if(text.trim())await window.notch.rpc('clip_import',{kind:'text',text});}void refresh();})().catch(error=>feedback(errorMessage(error)));
  }}>
    <div className="rope-controls rope-tools">
      <button type="button" className="icon-button rope-pin" aria-label={pinned?tr('取消固定剪贴绳'):tr('固定剪贴绳')} title={pinned?tr('取消固定剪贴绳'):tr('固定剪贴绳')} aria-pressed={pinned} disabled={pinBusy} onClick={()=>{setPinBusy(true);void window.notch.rpc<{pinned:boolean}>('clip_window_set',{pinned:!pinned}).then(value=>setPinned(value.pinned)).catch(error=>feedback(errorMessage(error))).finally(()=>setPinBusy(false));}}><Pin size={13}/></button>
      <IconButton label={tr('恢复默认位置')} icon={<RotateCcw size={13}/>} onClick={()=>void window.notch.rpc('clip_layout_set',{reset:true}).catch(error=>feedback(errorMessage(error)))}/>
      <IconButton label={tr('收起剪贴绳')} icon={<X size={13}/>} onClick={()=>void window.notch.rpc('clip_window_hide')}/>
    </div>
    <button className="rope-drag-handle" type="button" aria-label={tr('拖动绳子调整位置')} title={tr('拖动绳子调整位置')} onPointerDown={start} onPointerMove={move} onPointerUp={event=>void release(event)} onPointerCancel={event=>void release(event,true)} onKeyDown={event=>{
      const directions:Record<string,[number,number]>={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]};const delta=directions[event.key];if(!delta)return;event.preventDefault();void window.notch.rpc('clip_layout_set',{x:clamp(centerX+delta[0],0,1),y:clamp(ropeY/innerHeight+delta[1],0,1),anchor:'screen',displayId:displayId.current});
    }}><GripHorizontal size={13}/></button>
    <ClipPanel revision={revision} itemId={itemId} feedback={feedback} edit={active=>void window.notch.ropeEditing(active)}/>
    {message&&<div className="rope-feedback" role="status">{message}</div>}
  </main>;
}
