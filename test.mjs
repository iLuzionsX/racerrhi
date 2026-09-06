import fs from 'node:fs';
import assert from 'node:assert/strict';
import {sanitize,bounds,angleDelta,steerFromAngle} from './dist/controls.mjs';
import {chaseCameraProfile,estimatedSteadyStateLagM} from './dist/chase-camera.mjs';
import {bonnetCameraProfile} from './dist/bonnet-camera.mjs';
for(const [w,h] of [[320,568],[390,844],[844,390],[1920,1080]])for(const x of [0,.5,1]){const c=sanitize({wheelSize:300,pedalSize:115,wheelX:x,wheelY:x,pedalX:x,pedalY:x});for(const r of [bounds(c,w,h).wheel,bounds(c,w,h).pedals]){assert(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}}
for(const [w,h] of [[320,568],[390,844]]){const c=sanitize({});const b=bounds(c,w,h);assert(b.wheel.x+b.wheel.width<=b.pedals.x||b.pedals.x+b.pedals.width<=b.wheel.x);}
assert.equal(sanitize(null).wheelSize,210);assert.equal(sanitize({wheelSize:999,quality:'invalid'}).wheelSize,300);assert.equal(sanitize({wheelX:NaN}).wheelX,.02);assert.equal(sanitize({pedalX:NaN}).pedalX,.98);assert(Math.abs(angleDelta(Math.PI-.1,-Math.PI+.1)-.2)<1e-10);assert.equal(steerFromAngle(Math.PI),1);assert.equal(steerFromAngle(-Math.PI),-1);console.log('PASS control bounds, saved-setting validation and steering wrap');

import {newCar,stepCar,setCarPose,getM5PhysicsMetadata,advanceLap} from './dist/physics.mjs';
const meta=getM5PhysicsMetadata();
assert.equal(meta.repository,'iLuzionsX/Racing26');
assert.equal(meta.commit,'abff9f452e4c2b22ac1220a1414418ace3f36e0a');
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
assert(Object.values(s).filter(v=>typeof v==='number').every(Number.isFinite));assert.equal(s.wheels.length,4);assert(s.wheels.slice(0,2).every(w=>Number.isFinite(w.steerAngleRad)&&Number.isFinite(w.rotationAngleRad)));assert(Math.abs(s.wheels[0].steerAngleRad)>.01&&Math.abs(s.wheels[1].steerAngleRad)>.01);assert(Math.abs(s.heading-startHeading)>.02);assert(Math.abs(s.roll)<1.25);console.log('PASS M5 steering produces bounded chassis response with per-wheel telemetry');

const lap=()=>({elapsed:0,next:1,previous:0,valid:true,count:1});let l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,true,10);assert.equal(advanceLap(l,.01,true,1),51);console.log('PASS ordered sectors complete lap');
l=lap();advanceLap(l,.95,true,1);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS start-line shortcut rejected');
l=lap();for(const t of [.05,.26,.51,.76,.95])advanceLap(l,t,t!==.51,10);assert.equal(advanceLap(l,.01,true,1),null);console.log('PASS off-track lap rejected');

const gameSource=fs.readFileSync(new URL('./dist/game.js',import.meta.url),'utf8');
assert(gameSource.includes('car.add(steerPivot)'));assert(!gameSource.includes('body.add(steerPivot)'));assert(gameSource.includes('const chassisCgLocalY=.52-.035'));console.log('PASS wheel assemblies are decoupled from chassis roll/pitch');
const chassisCgDeclaration=gameSource.indexOf('const chassisCgLocalY=.52-.035'),m5VisualLoad=gameSource.indexOf('try{\n const visual=await loadM5Visual()');assert(chassisCgDeclaration>=0&&m5VisualLoad>=0&&chassisCgDeclaration<m5VisualLoad);console.log('PASS chassis CG render constant remains in animation-loop scope');

const indexSource=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
const uiSource=fs.readFileSync(new URL('./dist/ui.js',import.meta.url),'utf8');
assert(gameSource.includes('w.rotation.y=ws.steerAngleRad;'));assert(!gameSource.includes('w.rotation.y=-steer;'));assert(gameSource.includes('wheelStateById.get(w.userData.id)'));console.log('PASS M5 render steering sign and wheel identity match vehicle physics');
assert(indexSource.includes('maximum-scale=1,user-scalable=no'));assert(indexSource.includes('./ui.js?v=4')&&indexSource.includes('./game.js?v=8'));assert(uiSource.includes("document.addEventListener('touchend'")&&uiSource.includes("{passive:false}"));console.log('PASS Mobile Safari double-tap zoom suppression and cache-busted controls');

assert(uiSource.includes("'gesturestart','gesturechange','gestureend'"));assert(uiSource.includes("e.touches.length>1")&&uiSource.includes("document.addEventListener('touchmove'"));assert(indexSource.includes('./ui.js?v=4')&&indexSource.includes('./game.js?v=8'));assert(gameSource.includes("./ui.js?v=4"));console.log('PASS Mobile Safari pinch zoom suppression and synchronized v4 module cache bust');

assert(gameSource.includes("d=a.d.clone().lerp(b.d,u).normalize()"));assert(gameSource.includes("n=a.n.clone().lerp(b.n,u).normalize()"));console.log('PASS Racerrhi road tangent/normal interpolation for M5 suspension continuity');

for(const kph of [100,200,300]){
  const speed=kph/3.6;
  const p=chaseCameraProfile(speed);
  assert(p.distanceM>=8.5&&p.distanceM<=9.4);
  assert(p.fovDeg>=53&&p.fovDeg<=57.5);
  assert(p.followRate>=4&&p.followRate<=12);
  assert.equal(p.maxWorldLagM,2.6);
}
const old200Lag=estimatedSteadyStateLagM(200/3.6,4);
assert(old200Lag>13);
const high=chaseCameraProfile(300/3.6);
assert(high.distanceM+high.maxWorldLagM<=12.01);
assert(gameSource.includes("chaseCameraProfile(renderState.speedMs)"));
assert(gameSource.includes("chaseErrorLength>chaseProfile.maxWorldLagM"));
console.log('PASS chase camera high-speed pullback and world-space lag are bounded');

const bonnet=bonnetCameraProfile();
assert.equal(bonnet.mountForwardM,1.15);
assert.equal(bonnet.mountHeightM,1.18);
assert.equal(bonnet.lookAheadM,22);
assert(bonnet.headingFollowRate>=10&&bonnet.headingFollowRate<=16);
assert(bonnet.positionFollowRate>=12&&bonnet.positionFollowRate<=20);
assert(bonnet.targetFollowRate>=10&&bonnet.targetFollowRate<=18);
assert(bonnet.maxWorldLagM<=.35);
assert(gameSource.includes("bonnetForward.lerp(f,headingAlpha).normalize()"));
assert(gameSource.includes("bonnetErrorLength>bonnetProfile.maxWorldLagM"));
assert(gameSource.includes("bonnetProfile?bonnetProfile.targetFollowRate:6"));
console.log('PASS bonnet camera filters heading, grade, position and look target with tight mount lag');
