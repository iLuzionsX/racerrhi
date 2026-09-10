import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newCar,refreshCarState,setSurfaceSampler,stepCar,M5_FIXED_DT} from './m5-bridge';
import {RALLY_PACKED,RALLY_LOOSE} from '../dist/rally-material.mjs';

const rows:any[]=[];
for(const surface of ['paved','packed','loose'] as const)for(const speedKmh of [50,70,90])for(const handwheel of [.35,.5,.65])for(const controller of ['previous','soil-aware'] as const){
 setSurfaceSampler((x,z)=>({p:{x,y:0,z},normal:{x:0,y:1,z:0},distance:0,material:surface==='paved'?undefined:surface==='packed'?RALLY_PACKED:RALLY_LOOSE}));
 const car:any=newCar(0,0,0);
 if(controller==='previous'){const original=car._m5.vehicle.driverAids.updateTCS.bind(car._m5.vehicle.driverAids);car._m5.vehicle.driverAids.updateTCS=(slips:number[],dt:number)=>original(slips,dt);}
 for(let i=0;i<240;i++)stepCar(car,{brake:1},M5_FIXED_DT);
 const rb=car._m5.vehicle.rigidBody,speed=speedKmh/3.6;rb.velocity={x:0,y:0,z:speed};car._m5.vehicle.wheels.forEach((w:any)=>w.reset(speed));refreshCarState(car);
 let maxSlip=0,finalSlip=0,maxLoad=0,tcsSteps=0,atRelease=0,recovery=0;
 for(let i=0;i<840;i++){
  const target=i<60?0:i<240?handwheel:i<300?handwheel*(300-i)/60:0;
  stepCar(car,{analogSteerActive:true,analogSteerTarget:target,throttle:i<300?1:0},M5_FIXED_DT);
  maxSlip=Math.max(maxSlip,Math.abs(car.slip)*180/Math.PI);maxLoad=Math.max(maxLoad,...car.wheels.map((w:any)=>w.normalLoadN));tcsSteps+=Number(car.tcsActive);finalSlip=car.slip*180/Math.PI;
  assert(Number.isFinite(car.x+car.z+car.heading+car.speed));if(i===299)atRelease=Math.abs(finalSlip);if(i===539)recovery=Math.abs(finalSlip);
 }
 assert(maxLoad<35000);rows.push({surface,speedKmh,handwheel,controller,maxSlipDeg:maxSlip,finalSlipDeg:finalSlip,atReleaseDeg:atRelease,afterLiftTwoSecondsDeg:recovery,finalSpeedKmh:car.speed*3.6,tcsSteps,x:car.x,z:car.z});
}
for(const after of rows.filter(r=>r.controller==='soil-aware')){
 const before=rows.find(r=>r.controller==='previous'&&r.surface===after.surface&&r.speedKmh===after.speedKmh&&r.handwheel===after.handwheel);
 if(after.surface==='paved')assert.deepEqual({...before,controller:'soil-aware'},after,'paved behaviour changed');
 else {
  assert(after.maxSlipDeg<22,'ordinary dirt turn became a sustained spin: '+JSON.stringify(after));
  assert(Math.abs(after.finalSlipDeg)<3,'dirt did not settle after releasing steering and throttle: '+JSON.stringify(after));
  if(before.maxSlipDeg>35)assert(after.maxSlipDeg<before.maxSlipDeg*.65,'power oversteer was not materially reduced');
 }
}
// Assist OFF is a real opt-out, and the contact patch/steering remain untouched.
setSurfaceSampler((x,z)=>({p:{x,y:0,z},distance:0,material:RALLY_PACKED}));const car:any=newCar(0,0,0),aids=car._m5.vehicle.driverAids;
aids.config.tcsMode='OFF';assert.deepEqual(aids.updateTCS([1,1,1,1],M5_FIXED_DT,.9),{throttleMultiplier:1,tcsActive:false});
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-grip.json',JSON.stringify({status:'passed',rows},null,2));console.table(rows.filter(r=>r.speedKmh===70).map(({surface,handwheel,controller,maxSlipDeg,finalSlipDeg})=>({surface,handwheel,controller,maxSlipDeg,finalSlipDeg})));
