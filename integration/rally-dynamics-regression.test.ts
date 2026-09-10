import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TireModel} from '../.vendor/Racing26/src/physics/TireModel';
import {PhysicsMath} from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {newCar,setCarPose,setSurfaceSampler,stepCar,refreshCarState,M5_FIXED_DT} from './m5-bridge';
import {RALLY_PACKED,RALLY_LOOSE} from '../dist/rally-material.mjs';
const profiles={paved:undefined,legacyDirt:{type:'gravel',friction:.62,rollingResistance:.045,isKerbRumble:false},packed:RALLY_PACKED,loose:RALLY_LOOSE} as const;
function surface(profile:keyof typeof profiles){setSurfaceSampler((x,z)=>({p:{x,y:0,z},d:{x:0,y:0,z:1},distance:0,material:profiles[profile]}));}
surface('paved');const reference:any=newCar(0,0,0),model=new TireModel(reference._m5.vehicle.wheels[0].tireConfig);
const forceCurves=[];
for(const loose of [0,.5,1]){
 let peak=0,peakAngle=0;
 for(let degrees=0;degrees<=40;degrees+=.25){const f=model.calculate({slipRatio:0,slipAngle:degrees*Math.PI/180,verticalLoad:6000,camberDeg:0,surfaceFriction:.66,surfaceLooseness:loose});if(f.fy>peak){peak=f.fy;peakAngle=degrees;}}
 for(const kappa of [-1,-.4,-.1,0,.1,.4,1])for(const alpha of [-.6,-.15,0,.15,.6]){
  const f=model.calculate({slipRatio:kappa,slipAngle:alpha,verticalLoad:6000,camberDeg:0,surfaceFriction:.66,surfaceLooseness:loose});
  assert(Number.isFinite(f.fx+f.fy));assert(f.fx*kappa>=-1e-7&&f.fy*alpha>=-1e-7,'tire generated force in the wrong slip direction');assert(f.combinedSlipUtilization!<=1.000001,'combined tire envelope exceeded');
 }
 forceCurves.push({looseness:loose,peakLateralN:peak,peakAngleDeg:peakAngle});
}
assert(forceCurves[2].peakAngleDeg>forceCurves[0].peakAngleDeg+2,'loose shear response did not broaden');
function run(profile:keyof typeof profiles,kph:number,brake:number,slipDeg=0){
 surface(profile);const car:any=newCar(0,0,0);setCarPose(car,0,0,0,0);
 for(let i=0;i<180;i++)stepCar(car,{brake:1},M5_FIXED_DT);
 setCarPose(car,0,0,0,kph/3.6);const rb=car._m5.vehicle.rigidBody;
 if(slipDeg){rb.velocity=PhysicsMath.vec3(-Math.sin(slipDeg*Math.PI/180)*kph/3.6,0,Math.cos(slipDeg*Math.PI/180)*kph/3.6);rb.angularVelocity=PhysicsMath.vec3(0,.25,0);refreshCarState(car);}
 let distance=0,previous={x:car.x,z:car.z},stoppedAt=null,atTwo:any,peakLoad=0,negativeLoads=0;
 const initialEnergy=.5*car._m5.vehicle.config.mass*PhysicsMath.vec3Dot(rb.velocity,rb.velocity);
 for(let i=0;i<1800;i++){
  stepCar(car,{brake},M5_FIXED_DT);distance+=Math.hypot(car.x-previous.x,car.z-previous.z);previous={x:car.x,z:car.z};
  for(const w of car.wheels){peakLoad=Math.max(peakLoad,w.normalLoadN);if(w.normalLoadN<0)negativeLoads++;}
  assert(Number.isFinite(car.speed+car.heading+rb.position.y));
  if(i===239)atTwo={speedKmh:car.speed*3.6,slipDeg:car.slip*180/Math.PI,yawDegS:car.yawRate*180/Math.PI};
  if(Math.hypot(rb.velocity.x,rb.velocity.z)<.3){stoppedAt=(i+1)*M5_FIXED_DT;break;}
 }
 const energy=.5*car._m5.vehicle.config.mass*PhysicsMath.vec3Dot(rb.velocity,rb.velocity);
 assert(energy<=initialEnergy*1.005,'unpowered dirt run gained kinetic energy');assert.equal(negativeLoads,0);
 if(brake>0)assert(stoppedAt!==null,'braking failed to stop the vehicle');
 return {profile,kph,brake,slipDeg,distanceM:distance,stopTimeS:stoppedAt,atTwo,peakLoadN:peakLoad,finalEnergyJ:energy};
}
const braking=[];
for(const kph of [40,80,120])for(const profile of ['paved','legacyDirt','packed','loose'] as const)braking.push(run(profile,kph,1));
for(const kph of [40,80,120]){const get=(p:string)=>braking.find(r=>r.kph===kph&&r.profile===p)!;assert(get('packed').distanceM>get('paved').distanceM*1.1,'dirt stops like asphalt');assert(get('loose').distanceM>get('packed').distanceM*1.08,'loose shoulder failed to reduce braking grip');assert(get('loose').distanceM<get('paved').distanceM*3,'gravel braking behaves like ice');}
const slides=[];
for(const kph of [60,100])for(const slip of [8,35])for(const brake of [0,.35,1])slides.push(run('packed',kph,brake,slip));
const coast=['paved','packed','loose'].map(p=>run(p as keyof typeof profiles,40,0));
const result={status:'passed',forceCurves,braking,slides,coast};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/rally-dynamics.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
