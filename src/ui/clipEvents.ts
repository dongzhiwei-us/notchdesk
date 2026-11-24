export const CLIPS_IMPORTED_EVENT = 'notch:clips-imported';
export const CLIPS_POSITIONED_EVENT = 'notch:clips-positioned';
export const CLIPS_DRAGGING_EVENT = 'notch:clips-dragging';
export function clipDragging(active:boolean){window.dispatchEvent(new CustomEvent(CLIPS_DRAGGING_EVENT,{detail:active}));}
