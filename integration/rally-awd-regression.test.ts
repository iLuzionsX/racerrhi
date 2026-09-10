import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DifferentialSystem} from '../.vendor/Racing26/src/physics/Differential';
import {newCar,setCarPose,setSurfaceSampler,stepCar,M5_FIXED_DT} from './m5-bridge';
const probe:any=newCar(0,0,0),diff=new DifferentialSystem(probe._m5.vehicle.differential.config),matrix=[];
// Input torque must be conserved. Clutch coupling may dissipate shaft power,
// never add power or reverse behavior just because the vehicle drives backwards.
for(const torque of [-8000,-1500,-100,0,100,1500,8000])for(const speeds of [[40,40,40,40],[40,40,75,75],[75,75,40,40],[40,40,120,35],[40,40,35,120],[0,0,0,0]]){
 const omega=speeds as [number,number,number,number],out=diff.distributeTorque(torque,omega),reverse=diff.distributeTorque(-torque,omega.map(v=>-v) as typeof omega);
 const sum=out.wheelTorques.reduce((a,b)=>a+b,0),outputPower=out.wheelTorques.reduce((a,t,i)=>a+t*omega[i],0),inputPower=torque*out.pinionSpeed;
 assert(Math.abs(sum-torque)<1e-7,'differential created drive torque');assert(outputPower<=inputPower+1e-6,'differential generated energy');
 out.wheelTorques.forEach((t,i)=>assert(Math.abs(t+reverse.wheelTorques[i])<1e-7,'reverse torque symmetry broken'));
 const frontShare=Math.abs(torque)>1?(out.wheelTorques[0]+out.wheelTorques[1])/torque:.4;assert(frontShare>=.2-1e-8&&frontShare<=.5+1e-8);
 matrix.push({torque,omega,frontShare,clutchDissipationW:inputPower-outputPower});
}
const steady=diff.distributeTorque(3000,[40,40,40,40]),rearSlip=diff.distributeTorque(3000,[40,40,65,65]);
assert(rearSlip.wheelTorques[0]+rearSlip.wheelTorques[1]>steady.wheelTorques[0]+steady.wheelTorques[1],'rear overspeed failed to engage front coupling');
const runs=[];
for(const profile of ['packed','split-grip'] as const){
 setSurfaceSampler((x,z)=>({p:{x,y:0,z},distance:0,material:{type:'gravel',friction:profile==='split-grip'&&x>0?.35:.66,looseness:profile==='split-grip'&&x>0?1:.5,rollingResistance:.032,isKerbRumble:false}}));
 const car:any=newCar(0,0,0);for(let i=0;i<180;i++)stepCar(car,{brake:1},M5_FIXED_DT);setCarPose(car,0,0,0,30/3.6);
 let maxYaw=0,maxSlip=0,minimumFrontShare=1,maximumFrontShare=0,tcsSteps=0,peakWheelspin=0;
 const differential=car._m5.vehicle.differential,original=differential.distributeTorque.bind(differential);
 differential.distributeTorque=(torque:number,omega:any)=>{const out=original(torque,omega);if(torque>100){const front=(out.wheelTorques[0]+out.wheelTorques[1])/torque;minimumFrontShare=Math.min(minimumFrontShare,front);maximumFrontShare=Math.max(maximumFrontShare,front);}return out;};
 for(let i=0;i<600;i++){stepCar(car,{throttle:i<420?.5:0},M5_FIXED_DT);assert(Number.isFinite(car.speed+car.heading));maxYaw=Math.max(maxYaw,Math.abs(car.yawRate));maxSlip=Math.max(maxSlip,Math.abs(car.slip));if(car.tcsActive)tcsSteps++;peakWheelspin=Math.max(peakWheelspin,...car.wheels.map((w:any)=>Math.abs(w.slipRatio)));}
 assert(car.speed>8,'mixed grip stalled the drivetrain');assert(maxYaw<1,'split grip caused unbounded yaw');assert(minimumFrontShare>=.2&&maximumFrontShare<=.5);
 runs.push({profile,finalSpeedKmh:car.speed*3.6,maxYawDegS:maxYaw*180/Math.PI,maxSlipDeg:maxSlip*180/Math.PI,minimumFrontShare,maximumFrontShare,tcsSteps,peakWheelspin});
}
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-awd.json',JSON.stringify({status:'passed',matrix,runs},null,2));console.log(JSON.stringify(runs,null,2));
