import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createRallyRoute,rallyEntrance} from '../dist/rally-route.mjs';
import {nearestRoadProjection} from '../dist/road-projection.mjs';
import {newCar,setCarPose,setSurfaceSampler,stepCar,M5_FIXED_DT} from './m5-bridge';
import {rallyGameplayFixture} from './rally-gameplay-fixture';
const fixture=rallyGameplayFixture(),{rally:route,game,samples,nearest:paved,sample}=fixture;
assert(route.length>800&&route.length<1800);
let maxGrade=0,minY=Infinity,maxY=-Infinity,minClearance=Infinity,maxStep=0;
for(const path of route.paths)for(let i=0;i<path.samples.length;i++){
 const a=path.samples[i],r=route.nearest(a.p.x,a.p.z);assert(r.distance<.01);
 maxGrade=Math.max(maxGrade,Math.abs(a.d.y)/Math.hypot(a.d.x,a.d.z));minY=Math.min(minY,a.p.y);maxY=Math.max(maxY,a.p.y);
 if(path.name==='loop')minClearance=Math.min(minClearance,paved(a.p.x,a.p.z).distance);
 if(i)maxStep=Math.max(maxStep,Math.abs(a.p.y-path.samples[i-1].p.y));
 if(paved(a.p.x,a.p.z).distance>18){const s=sample(a.p.x,a.p.z);assert.equal(s.material.type,'gravel');assert(s.material.friction<.75&&s.material.friction>.68);assert(Math.abs(s.p.y-a.p.y)<.035);}
}
assert(maxGrade<.27,'rally hill too steep');assert(maxY-minY>25);assert(minClearance>22,'rally intersects existing circuit');assert(maxStep<.55);
// Original asphalt height and material sampling remain authoritative everywhere.
for(const a of samples.filter((_,i)=>i%7===0))assert.equal(sample(a.p.x,a.p.z).material,undefined);
let previous=sample(-225,-191),largestSeam=0;
for(let x=-224.9;x<=-180;x+=.1){const s=sample(x,-191);largestSeam=Math.max(largestSeam,Math.abs(s.p.y-previous.p.y));previous=s;}
assert(largestSeam<.05,'entrance has a vertical discontinuity');assert(rallyEntrance(-209,-191));assert(!rallyEntrance(-209,-150));
assert(game.includes('if(lastRoad.rally)lap.valid=false'));
// Settle the actual pinned vehicle on twelve representative rally grades.
setSurfaceSampler(sample);
const contacts=[];
for(let i=0;i<12;i++){
 const a=route.paths[1].samples[Math.floor(i/12*(route.paths[1].samples.length-1))];
 const car:any=newCar(a.p.x,a.p.z,Math.atan2(a.d.x,a.d.z));setCarPose(car,a.p.x,a.p.z,Math.atan2(a.d.x,a.d.z),0);
 for(let tick=0;tick<240;tick++)stepCar(car,{brake:1},M5_FIXED_DT);
 const rb=car._m5.vehicle.rigidBody;assert(Number.isFinite(rb.position.y));assert(Math.abs(rb.position.y-a.p.y)<2,'car fell through rally surface');
 contacts.push({height:a.p.y,chassisHeight:rb.position.y});
}
// Drive the loop with a simple look-ahead driver through the unchanged physics.
const loop=route.paths[1],a=loop.samples[4],driver:any=newCar(a.p.x,a.p.z,Math.atan2(a.d.x,a.d.z));
setCarPose(driver,a.p.x,a.p.z,Math.atan2(a.d.x,a.d.z),0);
for(let tick=0;tick<180;tick++)stepCar(driver,{brake:1},M5_FIXED_DT);
let travel=0,lastT=a.t,maxDeviation=0,maxSlip=0;
for(let tick=0;tick<24000&&travel<.98;tick++){
 const r=route.nearest(driver.x,driver.z),t=r.route==='loop'?r.t:0,look=10+Math.abs(driver.speed)*.45;
 let deltaT=t-lastT;if(deltaT<-.5)deltaT+=1;if(deltaT>.5)deltaT-=1;travel+=deltaT;lastT=t;
 const target=loop.curve.getPointAt((t+look/route.length)%1),error=Math.atan2(Math.sin(Math.atan2(target.x-driver.x,target.z-driver.z)-driver.heading),Math.cos(Math.atan2(target.x-driver.x,target.z-driver.z)-driver.heading));
 const rack=Math.max(-1,Math.min(1,Math.atan2(2*driver._m5.vehicle.config.wheelbase*Math.sin(error),look)/driver._m5.vehicle.config.maxSteerAngle));
 let lo=0,hi=1;for(let j=0;j<18;j++){const mid=(lo+hi)/2;if(.30*mid+.70*mid**4.5<Math.abs(rack))lo=mid;else hi=mid;}
 fixture.tick(driver,{analogSteerActive:true,analogSteerTarget:-Math.sign(rack)*(lo+hi)/2,throttle:Math.max(0,Math.min(1,.22+(10-driver.speed)*.25)),brake:Math.max(0,Math.min(1,(driver.speed-11)*.25))},M5_FIXED_DT);
 assert(!driver.boundaryContact.active,'gameplay corrected rally driver back to circuit');
 maxDeviation=Math.max(maxDeviation,r.distance);maxSlip=Math.max(maxSlip,Math.abs(driver.slip));
 assert(Number.isFinite(driver.speed)&&Math.abs(driver.slip)<1,'rally driver became unstable');
}
assert(travel>.95,'look-ahead driver did not complete the dirt loop');assert(maxDeviation<4.25,'rally loop cannot be followed within its driving width');
console.log(JSON.stringify({status:'passed',lengthM:route.length,minY,maxY,maxGrade,minCircuitClearanceM:minClearance,largestSeamM:largestSeam,contacts,driving:{lapFraction:travel,maxDeviationM:maxDeviation,maxSlipDeg:maxSlip*180/Math.PI}},null,2));
