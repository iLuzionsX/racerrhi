import {defaults,sanitize,bounds,clamp,angleDelta,steerFromAngle} from './controls.mjs';
const $=id=>document.getElementById(id);
export const config=sanitize((()=>{try{return JSON.parse(localStorage.getItem('apex-controls-v2'));}catch{return {};}})());
export const input={steer:0,throttle:0,brake:0,held:false};
let angle=0,lastAngle=0,pointer=null,active=false,editing=false,drag=null,session='attack';
const command=(name,value)=>dispatchEvent(new CustomEvent('apex:command',{detail:{name,value}}));
const save=()=>{try{localStorage.setItem('apex-controls-v2',JSON.stringify(config));}catch{}};
export function clearInput(){pointer=null;angle=0;Object.assign(input,{steer:0,throttle:0,brake:0,held:false});for(const id of ['gas','brake']){$(id).classList.remove('active');delete $(id).dataset.pointer;}}
export function sessionVisible(on){active=on;layout();}
function layout(){const b=bounds(config,innerWidth,innerHeight);for(const [id,key] of [['wheel-control','wheel'],['pedal-control','pedals']]){const r=b[key];Object.assign($(id).style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});}for(const id of ['gas','brake']){Object.assign($(id).style,{width:b.pedal+'px',height:b.pedal*(id==='gas'?1.7:1.3)+'px'});}$('touch').hidden=!(editing||(active&&config.show));}
const wheel=$('wheel'),theta=e=>{const r=wheel.getBoundingClientRect();return Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2);};
wheel.onpointerdown=e=>{if(editing||pointer!==null)return;e.preventDefault();pointer=e.pointerId;wheel.setPointerCapture(pointer);lastAngle=theta(e);input.held=true;};
wheel.onpointermove=e=>{if(pointer!==e.pointerId||editing)return;const r=wheel.getBoundingClientRect();if(Math.hypot(e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2)<r.width*.12)return;const next=theta(e);angle=clamp(angle+angleDelta(lastAngle,next),-Math.PI*.75,Math.PI*.75);lastAngle=next;input.steer=steerFromAngle(angle,config.sensitivity);};
const release=e=>{if(e.pointerId===pointer){pointer=null;input.held=false;}};wheel.onpointerup=wheel.onpointercancel=wheel.onlostpointercapture=release;
wheel.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();angle=e.key==='Home'?0:clamp(angle+(e.key==='ArrowRight'?.2:-.2),-Math.PI*.75,Math.PI*.75);input.steer=steerFromAngle(angle,config.sensitivity);}};
for(const [id,key] of [['gas','throttle'],['brake','brake']]){const el=$(id);el.onpointerdown=e=>{if(editing)return;e.preventDefault();el.dataset.pointer=String(e.pointerId);el.setPointerCapture(e.pointerId);input[key]=1;el.classList.add('active');};const up=e=>{if(el.dataset.pointer!==String(e.pointerId))return;input[key]=0;delete el.dataset.pointer;el.classList.remove('active');};el.onpointerup=el.onpointercancel=el.onlostpointercapture=up;}
let prev=performance.now();function animate(now){const dt=Math.min(.1,(now-prev)/1000);prev=now;if(!input.held){angle*=Math.exp(-9*dt);input.steer=steerFromAngle(angle,config.sensitivity);}$('wheel-art').style.transform=`rotate(${angle}rad)`;wheel.setAttribute('aria-valuenow',Math.round(input.steer*100));requestAnimationFrame(animate);}requestAnimationFrame(animate);
const fields={'sensitivity':['sensitivity',100],'wheel-size':['wheelSize',1],'pedal-size':['pedalSize',1],'wheel-x':['wheelX',100],'wheel-y':['wheelY',100],'pedal-x':['pedalX',100],'pedal-y':['pedalY',100]};
function refresh(){for(const [id,[key,factor]] of Object.entries(fields)){$(id).value=Math.round(config[key]*factor);$(id+'-value').textContent=$(id).value+(id.includes('size')?' px':'%');}$('show-controls').checked=config.show;$('quality').value=config.quality;$('engine-sound').checked=config.sound;layout();}
for(const [id,[key,factor]] of Object.entries(fields))$(id).oninput=()=>{config[key]=Number($(id).value)/factor;refresh();save();};
$('show-controls').onchange=()=>{config.show=$('show-controls').checked;layout();save();};$('quality').onchange=()=>{config.quality=$('quality').value;save();command('settings');};$('engine-sound').onchange=()=>{config.sound=$('engine-sound').checked;save();command('sound');};
function settings(){clearInput();command('pause',true);$('pause-dialog').close();refresh();$('settings').showModal();}
$('open-settings').onclick=$('pause-settings').onclick=settings;$('close-settings').onclick=()=>$('settings').close();$('settings').onclose=()=>{if(!editing)command('pause',false);};
$('edit-layout').onclick=()=>{editing=true;clearInput();$('settings').close();document.body.classList.add('editing');$('layout-editor').hidden=false;layout();};
$('finish-layout').onclick=()=>{editing=false;drag=null;document.body.classList.remove('editing');$('layout-editor').hidden=true;save();refresh();$('settings').showModal();};
for(const el of document.querySelectorAll('.movable')){el.addEventListener('pointerdown',e=>{if(!editing)return;e.preventDefault();const r=el.getBoundingClientRect();drag={id:e.pointerId,key:el.dataset.control,dx:e.clientX-r.left,dy:e.clientY-r.top,w:r.width,h:r.height};el.setPointerCapture(e.pointerId);});el.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const key=drag.key==='wheel'?'wheel':'pedal';config[key+'X']=clamp((e.clientX-drag.dx-14)/Math.max(1,innerWidth-drag.w-28),0,1);config[key+'Y']=clamp((e.clientY-drag.dy-14)/Math.max(1,innerHeight-drag.h-28),0,1);layout();});el.addEventListener('pointerup',()=>{drag=null;save();});el.addEventListener('pointercancel',()=>{drag=null;});}
$('defaults').onclick=()=>{const d=defaults();for(const k of ['show','sensitivity','wheelSize','pedalSize','wheelX','wheelY','pedalX','pedalY'])config[k]=d[k];save();refresh();};
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
