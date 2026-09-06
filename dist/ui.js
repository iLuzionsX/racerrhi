import {defaults,sanitize,bounds,clamp,angleDelta,thumbSteer} from './controls.mjs?v=2';
const $=id=>document.getElementById(id);
export const config=sanitize((()=>{try{return JSON.parse(localStorage.getItem('apex-controls-v2'));}catch{return {};}})());
export const input={steer:0,throttle:0,brake:0,held:false};
let lastAngle=null,lastX=0,wheelWidth=210,pointer=null,active=false,editing=false,drag=null,session='attack';
const command=(name,value)=>dispatchEvent(new CustomEvent('apex:command',{detail:{name,value}}));
const save=()=>{try{localStorage.setItem('apex-controls-v2',JSON.stringify(config));}catch{}};
export function clearInput(){pointer=null;lastAngle=null;Object.assign(input,{steer:0,throttle:0,brake:0,held:false});for(const id of ['gas','brake']){$(id).classList.remove('active');delete $(id).dataset.pointer;}}
export function sessionVisible(on){active=on;layout();}
function layout(){const b=bounds(config,innerWidth,innerHeight);for(const [id,key] of [['wheel-control','wheel'],['pedal-control','pedals']]){const r=b[key];Object.assign($(id).style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});}for(const id of ['gas','brake']){Object.assign($(id).style,{width:b.pedal+'px',height:b.pedal*(id==='gas'?1.7:1.3)+'px'});}$('touch').hidden=!(editing||(active&&config.show));}
const wheel=$('wheel');
function wheelAngle(e){
  const r=wheel.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
  return Math.hypot(x,y)<r.width*.12?null:Math.atan2(y,x);
}
wheel.onpointerdown=e=>{
  if(editing||pointer!==null||(e.pointerType==='mouse'&&e.button!==0))return;
  e.preventDefault();pointer=e.pointerId;wheel.setPointerCapture(pointer);
  lastX=e.clientX;wheelWidth=wheel.getBoundingClientRect().width;lastAngle=wheelAngle(e);input.held=true;
};
wheel.onpointermove=e=>{
  if(pointer!==e.pointerId||editing)return;
  if(config.wheelMode==='drag'){
    input.steer=thumbSteer(input.steer,e.clientX-lastX,wheelWidth,config.sensitivity);
  }else{
    const next=wheelAngle(e);
    if(next!==null&&lastAngle!==null)input.steer=clamp(input.steer+angleDelta(lastAngle,next)/(Math.PI*.75)*config.sensitivity,-1,1);
    // Re-anchor after crossing the hub instead of interpreting it as a half turn.
    lastAngle=next;
  }
  lastX=e.clientX;
};
const release=e=>{if(e.pointerId===pointer){pointer=null;lastAngle=null;input.held=false;}};
wheel.onpointerup=wheel.onpointercancel=wheel.onlostpointercapture=release;
wheel.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();input.steer=e.key==='Home'?0:clamp(input.steer+(e.key==='ArrowRight'?.08:-.08),-1,1);}};
for(const [id,key] of [['gas','throttle'],['brake','brake']]){const el=$(id);el.onpointerdown=e=>{if(editing)return;e.preventDefault();el.dataset.pointer=String(e.pointerId);el.setPointerCapture(e.pointerId);input[key]=1;el.classList.add('active');};const up=e=>{if(el.dataset.pointer!==String(e.pointerId))return;input[key]=0;delete el.dataset.pointer;el.classList.remove('active');};el.onpointerup=el.onpointercancel=el.onlostpointercapture=up;}
let prev=performance.now();
function animate(now){
  const dt=Math.min(.1,(now-prev)/1000);prev=now;
  if(!input.held){input.steer*=Math.exp(-9*dt);if(Math.abs(input.steer)<.0001)input.steer=0;}
  const visualLock=config.wheelMode==='drag'?Math.PI*.4:Math.PI*.75;
  $('wheel-art').style.transform=`rotate(${input.steer*visualLock}rad)`;
  wheel.setAttribute('aria-valuenow',Math.round(input.steer*100));requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
const fields={'sensitivity':['sensitivity',100],'wheel-size':['wheelSize',1],'pedal-size':['pedalSize',1],'wheel-x':['wheelX',100],'wheel-y':['wheelY',100],'pedal-x':['pedalX',100],'pedal-y':['pedalY',100]};
function refresh(){for(const [id,[key,factor]] of Object.entries(fields)){$(id).value=Math.round(config[key]*factor);$(id+'-value').textContent=$(id).value+(id.includes('size')?' px':'%');}$('wheel-mode').value=config.wheelMode;$('wheel-caption').textContent=config.wheelMode==='drag'?'SLIDE TO STEER':'ROTATE TO STEER';$('wheel-hint').textContent=config.wheelMode==='drag'?'Touch anywhere on the wheel and slide left or right. Lift to center.':'Rotate around the rim to steer. Lift to center.';$('show-controls').checked=config.show;$('quality').value=config.quality;$('engine-sound').checked=config.sound;layout();}
for(const [id,[key,factor]] of Object.entries(fields))$(id).oninput=()=>{config[key]=Number($(id).value)/factor;refresh();save();};
$('wheel-mode').onchange=()=>{clearInput();config.wheelMode=$('wheel-mode').value;refresh();save();};
$('show-controls').onchange=()=>{config.show=$('show-controls').checked;layout();save();};$('quality').onchange=()=>{config.quality=$('quality').value;save();command('settings');};$('engine-sound').onchange=()=>{config.sound=$('engine-sound').checked;save();command('sound');};
function settings(){clearInput();command('pause',true);$('pause-dialog').close();refresh();$('settings').showModal();}
$('open-settings').onclick=$('pause-settings').onclick=settings;$('close-settings').onclick=()=>$('settings').close();$('settings').onclose=()=>{if(!editing)command('pause',false);};
$('edit-layout').onclick=()=>{editing=true;clearInput();$('settings').close();document.body.classList.add('editing');$('layout-editor').hidden=false;layout();};
$('finish-layout').onclick=()=>{editing=false;drag=null;document.body.classList.remove('editing');$('layout-editor').hidden=true;save();refresh();$('settings').showModal();};
for(const el of document.querySelectorAll('.movable')){el.addEventListener('pointerdown',e=>{if(!editing)return;e.preventDefault();const r=el.getBoundingClientRect();drag={id:e.pointerId,key:el.dataset.control,dx:e.clientX-r.left,dy:e.clientY-r.top,w:r.width,h:r.height};el.setPointerCapture(e.pointerId);});el.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const key=drag.key==='wheel'?'wheel':'pedal';config[key+'X']=clamp((e.clientX-drag.dx-14)/Math.max(1,innerWidth-drag.w-28),0,1);config[key+'Y']=clamp((e.clientY-drag.dy-14)/Math.max(1,innerHeight-drag.h-28),0,1);layout();});el.addEventListener('pointerup',()=>{drag=null;save();});el.addEventListener('pointercancel',()=>{drag=null;});}
$('defaults').onclick=()=>{const d=defaults();for(const k of ['show','sensitivity','wheelMode','wheelSize','pedalSize','wheelX','wheelY','pedalX','pedalY'])config[k]=d[k];save();refresh();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='Use your browser fullscreen option';}};
for(const el of document.querySelectorAll('[data-session]'))el.onclick=()=>{session=el.dataset.session;for(const b of document.querySelectorAll('[data-session]')){b.classList.toggle('selected',b===el);b.setAttribute('aria-pressed',String(b===el));}};
$('drive').onclick=()=>command('start',session);$('camera').onclick=()=>command('camera');$('pause').onclick=()=>{clearInput();command('pause',true);$('pause-dialog').showModal();};$('resume').onclick=()=>{$('pause-dialog').close();command('pause',false);};$('restart').onclick=()=>{$('pause-dialog').close();command('restart');};$('exit').onclick=()=>{$('pause-dialog').close();command('exit');};$('pause-dialog').oncancel=()=>command('pause',false);
$('credits').onclick=()=>$('creditdialog').showModal();$('closecredits').onclick=()=>$('creditdialog').close();
addEventListener('resize',()=>{clearInput();layout();});addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});refresh();

// Mobile Safari can still recognize a rapid second tap as browser zoom even when
// the game surface uses touch-action:none. Cancel only that second touch-end so
// fast steering/pedal taps remain game input instead of viewport zoom.
let lastTouchEnd=0;
document.addEventListener('touchend',e=>{const now=performance.now();if(now-lastTouchEnd<350)e.preventDefault();lastTouchEnd=now;},{passive:false});

// Block Safari pinch-to-zoom without interfering with normal one-finger controls.
const preventGestureZoom=e=>e.preventDefault();
for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,preventGestureZoom,{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
