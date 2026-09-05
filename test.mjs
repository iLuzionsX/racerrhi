import assert from 'node:assert/strict';
import {sanitize,bounds,angleDelta,steerFromAngle} from './dist/controls.mjs';
for(const [w,h] of [[320,568],[390,844],[844,390],[1920,1080]])for(const x of [0,.5,1]){const c=sanitize({wheelSize:300,pedalSize:115,wheelX:x,wheelY:x,pedalX:x,pedalY:x});for(const r of [bounds(c,w,h).wheel,bounds(c,w,h).pedals]){assert(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}}
assert.equal(sanitize(null).wheelSize,210);assert.equal(sanitize({wheelSize:999,quality:'invalid'}).wheelSize,300);assert.equal(sanitize({wheelX:NaN}).wheelX,.045);assert(Math.abs(angleDelta(Math.PI-.1,-Math.PI+.1)-.2)<1e-10);assert.equal(steerFromAngle(Math.PI),1);assert.equal(steerFromAngle(-Math.PI),-1);console.log('PASS control bounds, saved-setting validation and steering wrap');
import {newCar,stepCar,advanceLap} from './dist/physics.mjs';
const road={distance:0};let s=newCar(0,0,0);
for(let i=0;i<1200;i++)stepCar(s,{throttle:1,brake:0,steer:0},1/120,road);
assert(s.speed>35&&s.speed<65);assert(Math.abs(s.x)<.001);console.log('PASS acceleration and straight-line stability',s.speed.toFixed(2),'m/s');
for(let i=0;i<360;i++)stepCar(s,{throttle:0,brake:1,steer:0},1/120,road);
assert(s.speed<4);console.log('PASS sustained braking');
s=newCar(0,0,0);s.speed=50;let maxG=0;
for(let i=0;i<1200;i++){stepCar(s,{throttle:1,brake:0,steer:1},1/120,road);maxG=Math.max(maxG,Math.abs(s.yawRate*s.speed));assert(Object.values(s).every(Number.isFinite));}
assert(maxG<12.3);assert(s.heading<0);console.log('PASS high-speed full-lock lateral acceleration bounded',maxG.toFixed(2));
let smooth=newCar(0,0,0);smooth.speed=25;for(let i=0;i<240;i++)stepCar(smooth,{throttle:0,brake:0,steer:1},1/120,road);const yawBefore=smooth.yawRate;stepCar(smooth,{throttle:0,brake:0,steer:-1},1/120,road);assert(Math.abs(smooth.yawRate-yawBefore)<.1);console.log('PASS steering reversal does not snap');
const lap=()=>({elapsed:0,next:1,previous:0,valid:true,count:1});let l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,true,10);assert.equal(advanceLap(l,.01,true,1),51);console.log('PASS ordered sectors complete lap');
l=lap();advanceLap(l,.95,true,1);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS start-line shortcut rejected');
l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,t!==.51,10);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS off-track lap rejected');
