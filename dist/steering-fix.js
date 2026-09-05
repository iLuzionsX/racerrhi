const wheel=document.getElementById('steering-wheel');
let startAngle=0;
const TAU=Math.PI*2;
const center=()=>{const r=wheel.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};};
const angle=(x,y)=>{const c=center();return Math.atan2(y-c.y,x-c.x);};
const delta=(a,b)=>{let d=a-b;while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d;};
wheel.addEventListener('pointerdown',e=>{if(e.isTrusted)startAngle=angle(e.clientX,e.clientY);},true);
wheel.addEventListener('pointermove',e=>{
  if(!e.isTrusted)return;
  const c=center();
  const current=angle(e.clientX,e.clientY);
  const d=delta(current,startAngle);
  const reflected=startAngle-d;
  const radius=Math.hypot(e.clientX-c.x,e.clientY-c.y);
  const mirrored=new PointerEvent('pointermove',{
    bubbles:true,cancelable:true,composed:true,
    pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,
    buttons:e.buttons,button:e.button,pressure:e.pressure,
    clientX:c.x+Math.cos(reflected)*radius,
    clientY:c.y+Math.sin(reflected)*radius
  });
  e.stopImmediatePropagation();
  wheel.dispatchEvent(mirrored);
},true);
await import('./game.js');
