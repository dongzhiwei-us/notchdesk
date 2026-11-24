import {BrowserWindow,screen,type WebPreferences,type Rectangle} from 'electron';

export function clotheslineWindow(options:{
  url:string;prefs:WebPreferences;
  call:(method:string,params?:any)=>Promise<any>;
  anchor:()=>Rectangle;
  emit:(type:string,payload:any,window:BrowserWindow)=>void;
  protect:(window:BrowserWindow)=>void;
  front:()=>void;
  context:()=>{notch:Rectangle;wheelHeight:number};
  blur:()=>void;
  focus:()=>void;
  backdrop:(window:BrowserWindow)=>void;
  pin:(pinned:boolean)=>void;
}){
  let window:BrowserWindow|null=null,creating:Promise<void>|undefined,desired=false;
  let areas:Rectangle[]=[],editing=false,ignore=true,dragging=false,moving=false,shapeKey='';
  let request=0;
  let pinned=false;
  let hideTimer:ReturnType<typeof setTimeout>|undefined;
  const displayFor=(layout:any)=>screen.getAllDisplays().find(d=>String(d.id)===layout?.displayId)||screen.getDisplayMatching(options.anchor());
  async function show(itemId?:string){
    desired=true;clearTimeout(hideTimer);const ticket=++request;
    const [layout,preferences]=await Promise.all([options.call('clip_layout_get'),options.call('clip_window_get')]);
    if(!desired||ticket!==request)return;
    setPinned(preferences.pinned===true);
    const display=displayFor(layout);
    if(!window){
      window=new BrowserWindow({...display.workArea,title:'悬挂剪贴',show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,skipTaskbar:true,alwaysOnTop:true,fullscreenable:false,webPreferences:options.prefs});
      window.setAlwaysOnTop(true,'floating');
      if(process.platform==='darwin')window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
      if(process.platform==='win32')window.setShape([{x:0,y:0,width:1,height:1}]);
      else window.setIgnoreMouseEvents(true,{forward:true});
      options.protect(window);
      options.backdrop(window);
      window.on('blur',options.blur);
      window.on('focus',options.focus);
      window.on('closed',()=>{window=null;areas=[];moving=false;shapeKey='';});
      creating=window.loadURL(options.url+'#rope');
    }
    await creating;
    if(!window||window.isDestroyed()||!desired||ticket!==request)return;
    window.setBounds(display.workArea);
    options.emit('rope.open',{itemId,...info()},window);
    if(process.platform==='win32')window.setIgnoreMouseEvents(false);
    window.showInactive();
    options.front();
  }
  function hide(){if(!desired)return;desired=false;request++;editing=false;setMoving(false);if(window?.isVisible()){options.emit('rope.closed',{},window);window.setIgnoreMouseEvents(true,{forward:true});hideTimer=setTimeout(()=>{if(!desired)window?.hide();},170);}}
  function hit(point:Electron.Point){
    if(!desired||!window?.isVisible())return false;
    const bounds=window.getBounds(),x=point.x-bounds.x,y=point.y-bounds.y;
    const inside=areas.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
    const accepts=inside||moving;
    if(process.platform!=='win32'&&ignore===accepts){ignore=!accepts;window.setIgnoreMouseEvents(ignore,{forward:true});}
    return accepts||editing;
  }
  function accepts(id:number){return window?.webContents.id===id;}
  function shape(rects:any){
    if(!window||!Array.isArray(rects))return;
    const bounds=window.getBounds();
    areas=rects.slice(0,640).flatMap(r=>{
      if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite))return [];
      const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y));
      const width=Math.min(bounds.width-x,Math.ceil(r.x+r.width)-x),height=Math.min(bounds.height-y,Math.ceil(r.y+r.height)-y);
      return width>0&&height>0?[{x,y,width,height}]:[];
    });
    if(!moving)paintShape();
  }
  function paintShape(){
    if(process.platform!=='win32'||!window||window.isDestroyed())return;
    const bounds=window.getBounds();
    const next=moving?[{x:0,y:0,width:bounds.width,height:bounds.height}]:(areas.length?areas:[{x:0,y:0,width:1,height:1}]);
    const key=JSON.stringify(next);if(key===shapeKey)return;shapeKey=key;window.setShape(next);
  }
  function setMoving(value:boolean){
    if(moving===value)return;moving=value;paintShape();
    if(moving&&window&&process.platform!=='win32'){ignore=false;window.setIgnoreMouseEvents(false);}
  }
  function setPinned(value:boolean){if(pinned===value)return;pinned=value;options.pin(value);}
  function info(){return {visible:desired&&!!window?.isVisible(),pinned,bounds:window?.getBounds(),displayId:window?String(screen.getDisplayMatching(window.getBounds()).id):undefined,...options.context()};}
  function ownsHandle(handle:string){if(!window||window.isDestroyed())return false;const buffer=window.getNativeWindowHandle();return (buffer.length===8?buffer.readBigUInt64LE().toString():String(buffer.readUInt32LE()))===handle;}
  return {show,hide,hit,accepts,shape,info,ownsHandle,setMoving,setPinned,isPinned:()=>pinned,material:()=>{if(window)options.backdrop(window);},setEditing:(value:boolean)=>{editing=value;},setDragging:(value:boolean)=>{dragging=value;},busy:()=>editing||dragging||moving,owns:(win:BrowserWindow|null)=>!!win&&win===window,visible:()=>desired&&!!window?.isVisible(),destroy:()=>{clearTimeout(hideTimer);window?.destroy();},send:(type:string,payload:any)=>{if(window)options.emit(type,payload,window);}};
}
