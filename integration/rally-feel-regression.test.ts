import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newCar,refreshCarState,setSurfaceSampler,stepCar,M5_FIXED_DT} from './m5-bridge';
import {damperForceForVelocity} from '../.vendor/Racing26/src/physics/Suspension';

// Trace the complete path, including the kinematic adapter installed by Simulation.
// Direct TireModel tests cannot detect an adapter silently dropping a new argument.
setSurfaceSampler((x,z)=>({p:{x,y:0,z},normal:{x:0,y:1,z:0},distance:0,material:{type:'gravel',friction:.66,rollingResistance:.032,looseness:x>0?1:.5,isKerbRumble:false}}));
const probe:any=newCar(0,0,0),seen:number[][]=[[],[],[],[]];
probe._m5.vehicle.wheels.forEach((wheel:any,i:number)=>{const calculate=wheel.tireModel.calculate.bind(wheel.tireModel);wheel.tireModel.calculate=(input:any)=>{seen[i].push(input.surfaceLooseness);return calculate(input);};});
for(let i=0;i<120;i++)stepCar(probe,{brake:1},M5_FIXED_DT);
seen.forEach((values,i)=>{assert(values.length>0);assert(values.every(v=>v===(i%2===0?1:.5)),`looseness lost before tire ${i}: ${values.slice(-4)}`);});

// A digressive damper must still dissipate energy and remain monotonic at the
// actual preset values. No arbitrary spring/ARB change is warranted if this passes.
for(const sign of [-1,1]){let previous=0;for(let speed=.002;speed<=2;speed+=.002){const force=sign*damperForceForVelocity(sign*speed,5200,3000,6500,4030);assert(force>=previous-1e-8);previous=force;}}

const scenarios:any[]=[];
for(const wiring of ['legacy','fixed'] as const)for(const profile of ['paved','packed','loose','rough','downhill','crest'] as const)for(const action of ['brake','power','lift'] as const){
 const rough=['rough','downhill','crest'].includes(profile),height=(z:number)=>profile==='rough'?.025*Math.sin(z*2*Math.PI/3):profile==='downhill'?-.10*z:profile==='crest'?1.2*Math.exp(-(((z-25)/8)**2)):0;
 setSurfaceSampler((x,z)=>({p:{x,y:height(z),z},normal:{x:0,y:1,z:-(height(z+.001)-height(z-.001))/.002},distance:0,material:profile==='paved'?undefined:{type:'gravel',friction:profile==='loose'?.49:.66,rollingResistance:profile==='loose'?.075:.032,looseness:profile==='loose'?1:.5,isKerbRumble:false}}));
 const car:any=newCar(0,0,0);
 // Reproduce the old adapter's dropped final argument for a controlled A/B.
 if(wiring==='legacy')car._m5.vehicle.wheels.forEach((wheel:any)=>{const calculate=wheel.tireModel.calculate.bind(wheel.tireModel);wheel.tireModel.calculate=(input:any)=>calculate({...input,surfaceLooseness:0});});
 for(let i=0;i<240;i++)stepCar(car,{brake:1},M5_FIXED_DT);
 // Preserve the settled grade-relative chassis/suspension pose; a horizontal
 // teleport onto a downhill slope would create a spurious airborne transient.
 const rb=car._m5.vehicle.rigidBody,speed=60/3.6;rb.velocity={x:0,y:(height(car.z+.001)-height(car.z-.001))/.002*speed,z:speed};
 car._m5.vehicle.wheels.forEach((w:any)=>w.reset(speed));car._m5.vehicle.suspension.states.forEach((s:any)=>s.hubVelocityWorldY=rb.velocity.y);refreshCarState(car);
 let maxSlip=0,maxYaw=0,maxLoad=0,airborne=0,peakPitch=0,earlyFront=0,earlyRear=0,frontN=0,rearN=0,minSpeed=Infinity,peakDamperSpeed=0;
 for(let i=0;i<600;i++){
  // Small, fixed hand-wheel position: the power case remains below the loose
  // surface's cornering envelope rather than asking a large slide to self-correct.
  const steering=i<60?0:i<210?.20:i<300?.20*(300-i)/90:0;
  stepCar(car,{analogSteerActive:true,analogSteerTarget:steering,brake:action==='brake'&&i<180?.6:0,throttle:(action==='power'&&i<300)||(action==='lift'&&i<150)?.35:0},M5_FIXED_DT);
  const loads=car.wheels.map((w:any)=>w.normalLoadN);assert(loads.every((n:number)=>Number.isFinite(n)&&n>=0));assert(Number.isFinite(car.heading+car.speed));
  frontN=(loads[0]+loads[1]);rearN=(loads[2]+loads[3]);if(i>=24&&i<60){earlyFront+=frontN/36;earlyRear+=rearN/36;}
  maxLoad=Math.max(maxLoad,...loads);maxSlip=Math.max(maxSlip,Math.abs(car.slip));maxYaw=Math.max(maxYaw,Math.abs(car.yawRate));peakPitch=Math.max(peakPitch,Math.abs(car.pitch));minSpeed=Math.min(minSpeed,car.speed);
  airborne+=car.wheels.filter((w:any)=>w.contactState==='airborne').length;
  peakDamperSpeed=Math.max(peakDamperSpeed,...car._m5.vehicle.suspension.states.map((s:any)=>Math.abs(s.velocity)));
 }
 assert(maxLoad<50000,'unbounded wheel load');assert(maxSlip<.65,'modest corner became an unrecoverable slide');assert(Math.abs(car.yawRate)<.2,'steering release retained excessive yaw: '+JSON.stringify({profile,action,yaw:car.yawRate,slip:car.slip,speed:car.speed,steer:car.steer}));
 if(action==='brake'&&!rough)assert(earlyFront/(earlyFront+earlyRear)>.57,'braking failed to load the front axle');
 if(action==='power'&&!rough)assert(earlyFront/(earlyFront+earlyRear)<.54,'acceleration failed to transfer load rearward');
 scenarios.push({wiring,profile,action,maxSlipDeg:maxSlip*180/Math.PI,maxYawDegS:maxYaw*180/Math.PI,maxLoadN:maxLoad,airborneWheelSteps:airborne,peakPitchDeg:peakPitch*180/Math.PI,earlyFrontShare:earlyFront/(earlyFront+earlyRear),minSpeedKmh:minSpeed*3.6,finalSpeedKmh:car.speed*3.6,peakDamperSpeedMs:peakDamperSpeed});
}
for(const action of ['brake','power','lift']){const before=scenarios.find(s=>s.wiring==='legacy'&&s.profile==='paved'&&s.action===action),after=scenarios.find(s=>s.wiring==='fixed'&&s.profile==='paved'&&s.action===action);assert.deepEqual({...before,wiring:'fixed'},after,'paved response changed');}
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-feel.json',JSON.stringify({status:'passed',looseness:seen.map(v=>v.at(-1)),scenarios},null,2));console.log(JSON.stringify(scenarios,null,2));
