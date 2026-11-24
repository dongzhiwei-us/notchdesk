import {tr} from './i18n';
import {useEffect,useRef,useState,type HTMLAttributes} from 'react';
import {Bell,Settings2,X} from 'lucide-react';
import {PluginIcon} from './common';
import {titleOf,type Plugin} from './types';

const point=(angle:number,radius:number)=>[
  208+Math.cos(angle*Math.PI/180)*radius,
  208+Math.sin(angle*Math.PI/180)*radius
];
function segment(start:number,end:number){
  const a=point(start,190),b=point(end,190),c=point(end,112),d=point(start,112);
  return `M${a} A190,190 0 0 1 ${b} L${c} A112,112 0 0 0 ${d} Z`;
}
type Props={
  plugins:Plugin[];
  activeId?:string;
  activationKey?:number;
  full:boolean;
  select:(plugin:Plugin)=>void;
  settings:()=>void;
  notices:()=>void;
  close:()=>void;
  unread:number;
  grip:HTMLAttributes<HTMLElement>;
};

export function Wheel({plugins,activeId,activationKey,full,select,settings,notices,close,unread,grip}:Props){
  const element=useRef<HTMLDivElement>(null);
  const [rotation,setRotation]=useState(90);
  const rotationRef=useRef(90);
  const press=useRef<{x:number,y:number}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const step=360/Math.max(plugins.length,1);
  const index=activeId?plugins.findIndex(plugin=>plugin.id===activeId):0;
  const selected=plugins[index];
  const latest=useRef({plugins,step,select});
  latest.current={plugins,step,select};

  useEffect(()=>{
    clearTimeout(timer.current);
    if(index<0)return;
    const target=90-index*step;
    const angle=target+360*Math.round((rotationRef.current-target)/360);
    rotationRef.current=angle;
    setRotation(angle);
  },[index,step,activationKey]);

  useEffect(()=>{
    const node=element.current;
    if(!node)return;
    function settle(){
      const {plugins,step,select}=latest.current;
      if(!plugins.length)return;
      const raw=Math.round((90-rotationRef.current)/step);
      const next=((raw%plugins.length)+plugins.length)%plugins.length;
      const angle=90-raw*step;
      rotationRef.current=angle;
      setRotation(angle);
      select(plugins[next]);
    }
    function scroll(event:WheelEvent){
      event.preventDefault();
      if(event.ctrlKey||!latest.current.plugins.length)return;
      const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      if(!delta)return;
      const units=event.deltaMode===1?16:event.deltaMode===2?200:1;
      const angle=rotationRef.current-Math.max(-30,Math.min(30,delta*units*.25));
      rotationRef.current=angle;
      setRotation(angle);
      clearTimeout(timer.current);
      timer.current=setTimeout(settle,110);
    }
    node.addEventListener('wheel',scroll,{passive:false});
    return ()=>{node.removeEventListener('wheel',scroll);clearTimeout(timer.current);};
  },[]);

  return <div ref={element} className="wheel" data-wheel-mode={full?'full':'half'} data-wheel-active={selected?.id} role="region" aria-label={tr('插件圆盘')} tabIndex={0}>
    <div className="wheel-disc">
      <div className="wheel-grain"/>
      <div className="wheel-rotor" style={{transform:`rotate(${rotation}deg)`}}>
        <svg viewBox="0 0 416 416" className="wheel-sectors" aria-hidden="true">
          {plugins.map((plugin,i)=><path key={plugin.id} className="wheel-sector" data-plugin={plugin.id} data-active={plugin.id===selected?.id} d={segment(i*step-step/2+1.5,i*step+step/2-1.5)}/>)}
        </svg>
        {plugins.map((plugin,i)=>{
          const [x,y]=point(i*step,152);
          return <button type="button" key={plugin.id} className="wheel-button" data-plugin={plugin.id} data-active={plugin.id===selected?.id} aria-pressed={plugin.id===selected?.id} onPointerDown={event=>{press.current={x:event.clientX,y:event.clientY};}} onClick={event=>{
            const start=press.current;press.current=null;
            if(event.detail>0&&start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>6)return;
            clearTimeout(timer.current);
            const target=90-i*step;
            const angle=target+360*Math.round((rotationRef.current-target)/360);
            rotationRef.current=angle;setRotation(angle);
            select(plugin);
          }} style={{left:x,top:y,transform:`translate(-50%,-50%) rotate(${-rotation}deg)`}}>
            <PluginIcon plugin={plugin} size={23}/><span>{tr(titleOf(plugin))}</span>
          </button>;
        })}
      </div>
      <div className="wheel-hub">
        <div className="wheel-hub-actions">
          <button aria-label={tr('通知')} onClick={notices}><Bell size={16}/>{unread>0&&<i/>}</button>
          <button aria-label={tr('设置')} onClick={settings}><Settings2 size={17}/></button>
          <button aria-label={tr('收起圆盘')} onClick={close}><X size={16}/></button>
        </div>
        <strong className="shell-grip" {...grip} title={tr('拖动移动刘海')}>{selected?tr(titleOf(selected)):tr('悬屿')}</strong>
        <span className="wheel-hint">{tr('滚动旋转 · 点击打开')}</span>
      </div>
      <div className="wheel-detent"/>
    </div>
  </div>;
}
