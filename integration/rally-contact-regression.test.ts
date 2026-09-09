import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rallyGameplayFixture} from './rally-gameplay-fixture';
import {newCar,setCarPose,setSurfaceSampler,stepCar,refreshCarState,M5_FIXED_DT} from './m5-bridge';
const f=rallyGameplayFixture();setSurfaceSampler(f.sample);const reports=[];
for(const t of [.2,.4,.65,.9]){
 const a=f.rally.paths[1].curve.getPointAt(t),d=f.rally.paths[1].curve.getTangentAt(t),yaw=Math.atan2(d.x,d.z),car:any=newCar(a.x,a.z,yaw);setCarPose(car,a.x,a.z,yaw,0);
 for(let i=0;i<360;i++)f.tick(car,{brake:1},M5_FIXED_DT);
 const holdDistance=Math.hypot(car.x-a.x,car.z-a.z);assert(holdDistance<.35,'braked car cannot hold a rally grade');
 const rb=car._m5.vehicle.rigidBody;rb.position.y+=.8;rb.velocity.x=0;rb.velocity.y=0;rb.velocity.z=0;
 // Lift the unsprung masses with the chassis. Moving only the sprung body would
 // stretch its springs against wheels still resting on the ground, not create flight.
 for(const s of car._m5.vehicle.suspension.states){s.hubPositionWorldY+=.8;s.hubVelocityWorldY=0;}
 refreshCarState(car);
 let airborneSteps=0,peakLoad=0,minimumY=rb.position.y;
 for(let i=0;i<360;i++){
  f.tick(car,{brake:1},M5_FIXED_DT);minimumY=Math.min(minimumY,rb.position.y);
  for(const w of car.wheels){peakLoad=Math.max(peakLoad,w.normalLoadN);assert(w.normalLoadN>=0);if(w.contactState==='airborne'){airborneSteps++;assert(w.normalLoadN<1,'airborne wheel retained load');assert(Math.hypot(w.forceLongitudinalN,w.forceLateralN)<1,'airborne tire generated traction: '+JSON.stringify(w));}}
  assert(!car.boundaryContact.active,'landing triggered a circuit correction');
 }
 assert(airborneSteps>20,'airborne contact scenario did not leave the ground: '+JSON.stringify({t,airborneSteps,peakLoad,minimumY,y:rb.position.y}));assert(peakLoad<100000,'landing impulse is unbounded');assert(rb.position.y>f.sample(car.x,car.z).p.y,'chassis fell through rally terrain');
 reports.push({t,holdDistanceM:holdDistance,airborneWheelSteps:airborneSteps,peakLoadN:peakLoad,minimumChassisY:minimumY,finalChassisY:rb.position.y});
}
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-contact.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
