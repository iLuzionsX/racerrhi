import assert from 'node:assert/strict';
import {rallyGameplayFixture} from './rally-gameplay-fixture';
import {newCar,setCarPose,setSurfaceSampler,M5_FIXED_DT} from './m5-bridge';
const f=rallyGameplayFixture();setSurfaceSampler(f.sample);
const results=[];
for(const [x,z] of [[-177,-194],[-179,-194],[-160,-188],[-140,-140]]){
 const road=f.rally.nearest(x,z),car:any=newCar(x,z,Math.atan2(road.d.x,road.d.z));
 setCarPose(car,x,z,Math.atan2(road.d.x,road.d.z),4);
 const sim=car._m5;
 const result=f.tick(car,{throttle:.2},M5_FIXED_DT),travel=Math.hypot(car.x-x,car.z-z);
 results.push({x,z,travel,boundary:car.boundaryContact.active,rally:result.road.rally});
 assert.equal(car._m5,sim,'gameplay replaced the vehicle simulation');
 assert(travel<.15,`entrance pulled car ${travel.toFixed(2)} m toward circuit at ${x},${z}`);
 assert(!car.boundaryContact.active,'circuit guardrail applied to rally');
 assert(result.road.rally,'gameplay did not recognize rally surface');
}
console.log(JSON.stringify({status:'passed',entry:results},null,2));
