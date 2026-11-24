import {useRef, type HTMLAttributes} from 'react';

export function useShellDrag():HTMLAttributes<HTMLElement> {
  const start=useRef<{x:number;y:number}|null>(null);
  const moved=useRef(false);
  return {
    onPointerDown(event){
      if(event.button!==0)return;
      start.current={x:event.screenX,y:event.screenY};moved.current=false;
      event.currentTarget.setPointerCapture(event.pointerId);
      void window.notch.beginMove();
    },
    onPointerMove(event){
      if(start.current && Math.hypot(event.screenX-start.current.x,event.screenY-start.current.y)>4)moved.current=true;
    },
    onPointerUp(event){
      if(!start.current)return;
      start.current=null;
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      void window.notch.endMove();
    },
    onPointerCancel(){start.current=null;void window.notch.endMove();},
    onClickCapture(event){if(moved.current){event.preventDefault();event.stopPropagation();moved.current=false;}}
  };
}
