import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rallyGameplayFixture} from './rally-gameplay-fixture';
import {newCar,setCarPose,setSurfaceSampler,stepCar,M5_FIXED_DT} from './m5-bridge';
const f=rallyGameplayFixture();setSurfaceSampler(f.sample);
const wrap=(t:number)=>(t%1+1)%1;
function driverInput(car:any,curve:any,t:number,length:number,direction:number,limit:number,closed:boolean){
 const point=(u:number)=>curve.getPointAt(closed?wrap(u):Math.max(0,Math.min(1,u)));
 const look=8+Math.abs(car.speed)*.55,target=point(t+direction*look/length);
 const heading=Math.atan2(target.x-car.x,target.z-car.z),error=Math.atan2(Math.sin(heading-car.heading),Math.cos(heading-car.heading));
 const rack=Math.max(-1,Math.min(1,Math.atan2(2*car._m5.vehicle.config.wheelbase*Math.sin(error),look)/car._m5.vehicle.config.maxSteerAngle));
 let lo=0,hi=1;for(let j=0;j<18;j++){const mid=(lo+hi)/2;if(.30*mid+.70*mid**4.5<Math.abs(rack))lo=mid;else hi=mid;}
 let targetSpeed=limit;
 for(const ahead of [0,12,25,40]){const u=t+direction*ahead/length,a=point(u-5/length),b=point(u),c=point(u+5/length),ab=b.clone().sub(a),bc=c.clone().sub(b),curvature=Math.abs(Math.atan2(ab.x*bc.z-ab.z*bc.x,ab.x*bc.x+ab.z*bc.z))/5;const corner=Math.sqrt(3.3/Math.max(.001,curvature));targetSpeed=Math.min(targetSpeed,Math.sqrt(corner*corner+2*2.6*ahead));}
 return {analogSteerActive:true,analogSteerTarget:-Math.sign(rack)*(lo+hi)/2,throttle:Math.max(0,Math.min(1,.2+(targetSpeed-car.speed)*.25)),brake:Math.max(0,Math.min(1,(car.speed-targetSpeed)*.3))};
}
const results=[];
for(const direction of [1,-1]){
 const path=f.rally.paths[1],a=path.samples[Math.floor(path.samples.length*.12)],yaw=Math.atan2(a.d.x,a.d.z)+(direction<0?Math.PI:0),car:any=newCar(a.p.x,a.p.z,yaw);
 setCarPose(car,a.p.x,a.p.z,yaw,0);for(let i=0;i<180;i++)stepCar(car,{brake:1},M5_FIXED_DT);
 let travel=0,lastT=a.t,maxDeviation=0,maxSpeed=0,maxSlip=0,maxStep=0,previous={x:car.x,z:car.z};
 for(let i=0;i<25000&&travel<.99;i++){
  const road=f.rally.nearest(car.x,car.z),t=road.route==='loop'?road.t:lastT;
  let delta=t-lastT;if(delta<-.5)delta++;if(delta>.5)delta--;travel+=direction*delta;lastT=t;
  f.tick(car,driverInput(car,path.curve,t,path.length,direction,23,true),M5_FIXED_DT);
  maxDeviation=Math.max(maxDeviation,road.distance);maxSpeed=Math.max(maxSpeed,car.speed*3.6);maxSlip=Math.max(maxSlip,Math.abs(car.slip)*180/Math.PI);maxStep=Math.max(maxStep,Math.hypot(car.x-previous.x,car.z-previous.z));previous={x:car.x,z:car.z};
  assert(!car.boundaryContact.active,'circuit barrier caught the rally car');assert(Number.isFinite(car.speed));
 }
 results.push({kind:'loop',direction,travel,maxDeviationM:maxDeviation,maxKmh:maxSpeed,maxSlipDeg:maxSlip,maxStepM:maxStep});
 assert(travel>.98,'faster driver failed to complete a loop');assert(maxDeviation<4.25,'faster driver left dirt driving width');assert(maxStep<.35,'gameplay teleported the car');
}
for(const direction of [1,-1]){
 const path=f.rally.paths[0],startT=direction>0?.04:.88,a=path.curve.getPointAt(startT),d=path.curve.getTangentAt(startT),yaw=Math.atan2(d.x,d.z)+(direction<0?Math.PI:0),car:any=newCar(a.x,a.z,yaw);
 setCarPose(car,a.x,a.z,yaw,0);let t=startT,maxStep=0,previous={x:car.x,z:car.z};
 for(let i=0;i<8000&&(direction>0?t<.86:t>.08);i++){
  const r=f.rally.nearest(car.x,car.z);t=r.route==='access'?r.t:t;
  f.tick(car,driverInput(car,path.curve,t,path.length,direction,8,false),M5_FIXED_DT);
  maxStep=Math.max(maxStep,Math.hypot(car.x-previous.x,car.z-previous.z));previous={x:car.x,z:car.z};assert(!car.boundaryContact.active,'access road hit circuit boundary');
 }
 results.push({kind:'access',direction,progress:t,maxStepM:maxStep});assert(direction>0?t>.85:t<.09,'car could not traverse access road');assert(maxStep<.15);
}
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-driving.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
