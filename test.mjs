import fs from 'node:fs';
import assert from 'node:assert/strict';
import {sanitize,bounds,angleDelta,steerFromAngle,thumbSteer} from './dist/controls.mjs';
import {chaseCameraProfile,estimatedSteadyStateLagM} from './dist/chase-camera.mjs';
import {bonnetCameraProfile} from './dist/bonnet-camera.mjs';
import {wheelVisualHubY} from './dist/wheel-contact.mjs';
import {nearestRoadProjection} from './dist/road-projection.mjs';
// Cross nearest-vertex boundaries on a grade. Height must follow the continuous
// road plane and longitudinal progress must not become false lateral distance.
const gradeSamples=[0,1,2,3,4,5].map(z=>({p:{x:0,y:z*.1,z}}));
gradeSamples.push({p:{x:10,y:.5,z:5}},{p:{x:10,y:0,z:0}});
for(let z=.3;z<4.7;z+=.013) {
 const {index,fraction}=nearestRoadProjection(gradeSamples,.2,z);
 const a=gradeSamples[index].p,b=gradeSamples[(index+1)%gradeSamples.length].p;
 assert(Math.abs(a.y+(b.y-a.y)*fraction-z*.1)<1e-10,'road sampling introduced a height step');
 assert(Math.abs(a.z+(b.z-a.z)*fraction-z)<1e-10,'road sampling introduced false off-track distance');
}
const seam=nearestRoadProjection(gradeSamples,4,0);
assert.equal(seam.index,gradeSamples.length-1);
assert(Math.abs(seam.fraction-.6)<1e-12,'closed track seam projected onto the wrong segment');
console.log('PASS continuous road projection across vertex boundaries and lap seam');
assert.equal(sanitize({}).keyboardResponse,1.25);
assert.equal(sanitize({keyboardResponse:NaN,keyboardStrength:Infinity}).keyboardStrength,1);
assert.equal(sanitize({keyboardResponse:99,keyboardStrength:-2}).keyboardResponse,1.8);
assert.equal(sanitize({keyboardResponse:99,keyboardStrength:-2}).keyboardStrength,.75);
// Sample the actual cylinder surface independently of the support calculation.
for(const slope of [-.25,0,.25])for(const heading of [0,.6,1.57]) {
 const road={p:{y:0},d:{x:0,y:slope,z:1},distance:0};
 const hub=wheelVisualHubY(.34,road,heading);
 for(let i=0;i<180;i++)for(const side of [-1,1]) {
  const angle=i*Math.PI/90;
  const localX=side*.285/2,localZ=.369*Math.sin(angle);
  const z=-Math.sin(heading)*localX+Math.cos(heading)*localZ;
  const y=hub+.369*Math.cos(angle);
  assert(y>=slope*z+.02-1e-9,'visible tyre penetrated road plane');
 }
 assert.equal(wheelVisualHubY(2,road,heading),2,'airborne wheel was pulled to the road');
}
console.log('PASS keyboard tuning persistence bounds and rigid tyre clearance on grades');
import {createRewardState,chooseChallenge,awardSkill,stepFlow,multiplierForFlow,ghostDelta,formatDelta} from './dist/reward-loop.mjs';
for(const [w,h] of [[320,568],[390,844],[844,390],[1920,1080]])for(const x of [0,.5,1]){const c=sanitize({wheelSize:300,pedalSize:115,wheelX:x,wheelY:x,pedalX:x,pedalY:x});for(const r of [bounds(c,w,h).wheel,bounds(c,w,h).pedals]){assert(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}}
for(const [w,h] of [[320,568],[390,844]]){const c=sanitize({});const b=bounds(c,w,h);assert(b.wheel.x+b.wheel.width<=b.pedals.x||b.pedals.x+b.pedals.width<=b.wheel.x);}
assert.equal(sanitize(null).wheelSize,210);assert.equal(sanitize({wheelSize:999,quality:'invalid'}).wheelSize,300);assert.equal(sanitize({wheelX:NaN}).wheelX,.02);assert.equal(sanitize({pedalX:NaN}).pedalX,.98);assert(Math.abs(angleDelta(Math.PI-.1,-Math.PI+.1)-.2)<1e-10);assert.equal(steerFromAngle(Math.PI),1);assert.equal(steerFromAngle(-Math.PI),-1);console.log('PASS control bounds, saved-setting validation and steering wrap');
assert.equal(sanitize({}).wheelMode,'drag');
assert.equal(sanitize({wheelMode:'rotate',wheelX:.4}).wheelMode,'rotate');
assert.equal(sanitize({wheelMode:'invalid'}).wheelMode,'drag');
for(const width of [140,210,300])for(const sensitivity of [.6,1,1.5]){
  const stroke=width*.45/sensitivity;
  assert(Math.abs(thumbSteer(0,stroke,width,sensitivity)-1)<1e-12);
  assert(Math.abs(thumbSteer(0,-stroke,width,sensitivity)+1)<1e-12);
  let fine=0;for(let i=0;i<20;i++)fine=thumbSteer(fine,stroke/40,width,sensitivity);
  assert(Math.abs(fine-.5)<1e-12,'pointer event frequency changed steering');
  assert.equal(thumbSteer(.4,0,width,sensitivity),.4);
  const full=thumbSteer(0,stroke*4,width,sensitivity);
  assert(thumbSteer(full,-stroke*.05,width,sensitivity)<.96,'overtravel delayed reversal');
}
assert.equal(thumbSteer(0,210*.45,210,1),1);assert.equal(thumbSteer(0,-210*.45,210,1),-1);console.log('PASS thumb travel, edge-reachable full lock, sensitivity, event-rate independence and immediate unwind');

const reward=createRewardState();
assert.equal(multiplierForFlow(0),1);assert.equal(multiplierForFlow(100),3);
const baseSector=awardSkill(reward,'sector',null);assert(baseSector>=160);assert(reward.flow>0&&reward.score===baseSector);
const doubleClean=chooseChallenge({hasGhost:false,random:()=>.9});assert.equal(doubleClean.id,'double-clean');
const doubled=createRewardState();const doubledPoints=awardSkill(doubled,'sector',doubleClean);assert.equal(doubledPoints,320);
for(let i=0;i<120;i++)stepFlow(doubled,{dt:1/120,cleanDriving:true});assert(doubled.flow>18,'clean driving should build flow');
const broken=stepFlow(doubled,{dt:1/120,wallContact:true});assert.equal(broken.broken,true);assert.equal(doubled.flow,0);assert.equal(doubled.multiplier,1);
const ghost=chooseChallenge({hasGhost:true,random:()=>.99});assert.equal(ghost.id,'ghost-rival');
const trace=[{p:0,t:0},{p:.5,t:30},{p:1,t:60}];assert(Math.abs(ghostDelta(trace,.25,14)-(-1))<1e-9);assert.equal(formatDelta(-1),'−1.000');assert.equal(formatDelta(1),'+1.000');
console.log('PASS minimalist skill score, flow break, challenge modifiers and ghost delta');


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
const physicsSource=fs.readFileSync(new URL('./dist/physics.mjs',import.meta.url),'utf8');
assert(gameSource.includes('car.add(steerPivot)'));assert(!gameSource.includes('body.add(steerPivot)'));assert(gameSource.includes('const chassisCgLocalY=.52-.035'));console.log('PASS wheel assemblies are decoupled from chassis roll/pitch');
assert(physicsSource.includes("./m5-runtime.js?v=6"));console.log('PASS corrected M5 runtime cache bust is active');
const chassisCgDeclaration=gameSource.indexOf('const chassisCgLocalY=.52-.035'),m5VisualLoad=gameSource.indexOf('try{\n const visual=await loadG90Visual()');assert(chassisCgDeclaration>=0&&m5VisualLoad>=0&&chassisCgDeclaration<m5VisualLoad);console.log('PASS chassis CG render constant remains in animation-loop scope');

const indexSource=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
const uiSource=fs.readFileSync(new URL('./dist/ui.js',import.meta.url),'utf8');
assert(gameSource.includes('w.rotation.y=ws.steerAngleRad;'));assert(!gameSource.includes('w.rotation.y=-steer;'));assert(gameSource.includes('wheelStateById.get(w.userData.id)'));console.log('PASS M5 render steering sign and wheel identity match vehicle physics');
assert(indexSource.includes('maximum-scale=1,user-scalable=no'));assert(indexSource.includes('./ui.js?v=7')&&indexSource.includes('./game.js?v=19'));assert(uiSource.includes("document.addEventListener('touchend'")&&uiSource.includes("{passive:false}"));console.log('PASS Mobile Safari double-tap zoom suppression and cache-busted controls');

assert(uiSource.includes('input.held=false;input.steer=0'));assert(uiSource.includes("'gesturestart','gesturechange','gestureend'"));assert(uiSource.includes("e.touches.length>1")&&uiSource.includes("document.addEventListener('touchmove'"));assert(indexSource.includes('./ui.js?v=7')&&indexSource.includes('./game.js?v=19'));assert(gameSource.includes("./ui.js?v=7"));console.log('PASS Mobile Safari pinch zoom suppression and synchronized UI module cache bust');

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

assert(gameSource.includes('rebaseM5RenderSnapshotPose(renderState'));assert(gameSource.includes("./physics.mjs?v=6"));console.log('PASS intro and return-to-menu rebase world-space wheel hubs with staged chassis pose');

const visualsSource=fs.readFileSync(new URL('./dist/visuals.js',import.meta.url),'utf8');
const graphicsSource=fs.readFileSync(new URL('./dist/graphics.mjs',import.meta.url),'utf8');
const assetSource=fs.readFileSync(new URL('./download-assets-hq.mjs',import.meta.url),'utf8');
const hdrLoad=visualsSource.indexOf("const hdr=await new RGBELoader()"),qualityReturn=visualsSource.indexOf("return async quality=>");
assert(hdrLoad>=0&&qualityReturn>hdrLoad,'HDR environment setup must remain reachable before the quality callback declaration');
assert(visualsSource.includes("material.normalMap=maps[1]")&&visualsSource.includes("material.roughnessMap=maps[2]"));
assert(assetSource.includes("'sand-1k','1k'")&&assetSource.includes("'dirt-1k','1k'")&&!assetSource.includes("'sand','2k'")&&!assetSource.includes("'dirt','2k'"));
assert(visualsSource.includes("'road-scan'")&&visualsSource.includes("'rally-scan'")&&!visualsSource.includes("},6500);"),'do not restore expensive 4K runoff prefetch');
assert(gameSource.includes("if(runoffQualityReady)reloadSurfaceQuality(config.quality)")&&!gameSource.includes("config.quality==='balanced')reloadSurfaceQuality"));
assert(gameSource.includes("trackDetailQuality(config.quality)")&&gameSource.includes("},1800);")&&gameSource.includes("buildRunoff();ribbon(0,15,roadMat)"));
assert(graphicsSource.includes("high?128:64")&&graphicsSource.includes("high?.8:1.2")&&graphicsSource.includes("clearcoatRoughness:.065"));
assert(gameSource.includes("mobile?1.5:1.65")&&gameSource.includes("mobile?1536:2048"));
console.log('PASS high graphics path uses HDR reflections, full PBR runoff maps, live quality switching and roadside micro-detail');

assert(indexSource.includes('CHALLENGE LAP')&&indexSource.includes('id="skill-hud"'));assert(gameSource.includes("awardDrivingSkill('apex','PERFECT APEX')")&&gameSource.includes("awardDrivingSkill('driftSave','DRIFT SAVED')")&&gameSource.includes("awardDrivingSkill('nearMiss','NEAR MISS')"));assert(gameSource.includes("session==='challenge'?'CHALLENGE LAP':'TIME ATTACK'"));console.log('PASS minimalist challenge-lap HUD and earned driving skill hooks');
