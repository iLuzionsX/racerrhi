import assert from 'node:assert/strict';
import {sanitize,bounds,angleDelta,steerFromAngle} from './dist/controls.mjs';
for(const [w,h] of [[320,568],[390,844],[844,390],[1920,1080]])for(const x of [0,.5,1]){const c=sanitize({wheelSize:300,pedalSize:115,wheelX:x,wheelY:x,pedalX:x,pedalY:x});for(const r of [bounds(c,w,h).wheel,bounds(c,w,h).pedals]){assert(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}}
for(const [w,h] of [[320,568],[390,844]]){const c=sanitize({});const b=bounds(c,w,h);assert(b.wheel.x+b.wheel.width<=b.pedals.x||b.pedals.x+b.pedals.width<=b.wheel.x);}
assert.equal(sanitize(null).wheelSize,210);assert.equal(sanitize({wheelSize:999,quality:'invalid'}).wheelSize,300);assert.equal(sanitize({wheelX:NaN}).wheelX,.02);assert.equal(sanitize({pedalX:NaN}).pedalX,.98);assert(Math.abs(angleDelta(Math.PI-.1,-Math.PI+.1)-.2)<1e-10);assert.equal(steerFromAngle(Math.PI),1);assert.equal(steerFromAngle(-Math.PI),-1);console.log('PASS control bounds, saved-setting validation and steering wrap');

import {newCar,stepCar,setCarPose,getM5PhysicsMetadata,advanceLap} from './dist/physics.mjs';
const meta=getM5PhysicsMetadata();
assert.equal(meta.repository,'iLuzionsX/Racing26');
assert.equal(meta.commit,'e330cf5edb2c77b40267dd17d12e09858e3602a1');
assert(Math.abs(meta.massKg-2381.8135)<.01);
assert.equal(meta.drivetrain,'AWD');
assert.equal(meta.fixedStepHz,120);
console.log('PASS Racing26 M5 donor identity',meta.massKg.toFixed(1),'kg',meta.drivetrain);

const road={distance:0};let s=newCar(0,0,0);
for(let i=0;i<1200;i++)stepCar(s,{throttle:1,brake:0,steer:0},1/120,road);
assert(s.speed>40&&s.speed<80);assert(Math.abs(s.x)<.25);assert(Object.values(s).filter(v=>typeof v==='number').every(Number.isFinite));assert.equal(s.wheels.length,4);console.log('PASS M5 acceleration and straight-line stability',s.speed.toFixed(2),'m/s');
for(let i=0;i<720;i++)stepCar(s,{throttle:0,brake:1,steer:0},1/120,road);
assert(Math.abs(s.speed)<5);console.log('PASS M5 sustained braking');

s=newCar(0,0,0);setCarPose(s,0,0,0,25);const startHeading=s.heading;
for(let i=0;i<240;i++)stepCar(s,{throttle:.1,brake:0,steer:.45},1/120,road);
assert(Object.values(s).filter(v=>typeof v==='number').every(Number.isFinite));assert.equal(s.wheels.length,4);assert(s.wheels.slice(0,2).every(w=>Number.isFinite(w.steerAngle)&&Number.isFinite(w.rotationAngle)));assert(Math.abs(s.wheels[0].steerAngle)>.01&&Math.abs(s.wheels[1].steerAngle)>.01);assert(Math.abs(s.heading-startHeading)>.02);assert(Math.abs(s.roll)<1.25);console.log('PASS M5 steering produces bounded chassis response with per-wheel telemetry');

const lap=()=>({elapsed:0,next:1,previous:0,valid:true,count:1});let l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,true,10);assert.equal(advanceLap(l,.01,true,1),51);console.log('PASS ordered sectors complete lap');
l=lap();advanceLap(l,.95,true,1);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS start-line shortcut rejected');
l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,t!==.51,10);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS off-track lap rejected');
