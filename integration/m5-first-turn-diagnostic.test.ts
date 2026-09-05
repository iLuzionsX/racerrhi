import * as THREE from 'three';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../.vendor/Racing26/src/physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../.vendor/Racing26/src/physics/m5G90';

const cfg:any={...DEFAULT_VEHICLE_CONFIG,...BMW_M5_2025_OVERRIDES};
const neutral={throttle:0,brake:0,steer:0,handbrake:false,shiftUp:false,shiftDown:false};
const pts=[
[-225,13,-200],[-225,13,50],[-185,16,245],[-55,22,325],[100,27,265],[155,24,115],
[290,22,65],[300,20,-65],[170,18,-110],[85,14,-225],[185,11,-320],[70,11,-385],[-110,12,-345]
].map(([x,y,z])=>new THREE.Vector3(x,y,z));
const curve=new THREE.CatmullRomCurve3(pts,true,'centripetal'); curve.arcLengthDivisions=4000;
const N=1400;
const samples=Array.from({length:N},(_,i)=>{const t=i/N,p=curve.getPointAt(t),d=curve.getTangentAt(t).normalize(),n=new THREE.Vector3(d.z,0,-d.x).normalize();return{p,d,n,t};});
function at(t:number){t=((t%1)+1)%1;const f=t*N,i=Math.floor(f)%N,a=samples[i],b=samples[(i+1)%N],q=f-Math.floor(f);return{p:a.p.clone().lerp(b.p,q),d:a.d.clone().lerp(b.d,q).normalize(),n:a.n.clone().lerp(b.n,q).normalize(),t};}
function nearest(x:number,z:number){let best=Infinity,index=0;for(let i=0;i<N;i++){const p=samples[i].p,q=(p.x-x)**2+(p.z-z)**2;if(q<best){best=q;index=i;}}const a=samples[index],b=samples[(index+1)%N],abx=b.p.x-a.p.x,abz=b.p.z-a.p.z,len2=Math.max(.01,abx*abx+abz*abz),u=THREE.MathUtils.clamp(((x-a.p.x)*abx+(z-a.p.z)*abz)/len2,0,1),p=a.p.clone().lerp(b.p,u),d=a.d.clone().lerp(b.d,u).normalize(),n=a.n.clone().lerp(b.n,u).normalize(),dx=x-p.x,dz=z-p.z;return{p,d,n,distance:Math.hypot(dx,dz),side:dx*n.x+dz*n.z,t:(index+u)/N};}
const provider={sampleSurface(x:number,z:number){const r=nearest(x,z),d=r.d,h=Math.max(1e-8,d.x*d.x+d.z*d.z);let nx=-d.x*d.y,ny=h,nz=-d.y*d.z,L=Math.hypot(nx,ny,nz)||1;nx/=L;ny/=L;nz/=L;const onRoad=r.distance<=7.7,onKerb=r.distance>7&&r.distance<=8.25;return{elevation:r.p.y,normal:PhysicsMath.vec3(nx,ny,nz),slopePitch:Math.atan2(d.y,Math.sqrt(h)),slopeRoll:0,type:onKerb?'kerb':onRoad?'asphalt':'gravel',friction:onKerb?.88:onRoad?1:.55,rollingResistance:onRoad?.015:.075,wetness:0,isKerbRumble:onKerb};}};

function radiusAt(u:number){const a=at(u-.002).p,b=at(u).p,c=at(u+.002).p;const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z,cx=c.x-a.x,cz=c.z-a.z,A=Math.hypot(ax,az),B=Math.hypot(bx,bz),C=Math.hypot(cx,cz),area2=Math.abs(ax*cz-cx*az);return area2<1e-8?Infinity:(A*B*C)/(2*area2);}
let firstU=0,firstR=Infinity;
for(let i=2;i<=260;i++){const u=i/1400;const r=radiusAt(u);if(r<firstR){firstR=r;firstU=u;}}
const station=at(firstU),yaw=Math.atan2(station.d.x,station.d.z);
console.log(JSON.stringify({firstCorner:{u:firstU,radiusM:firstR,frictionLimitKmh:Math.sqrt(1.0*9.81*firstR)*3.6,point:station.p.toArray(),yawDeg:yaw*180/Math.PI}},null,2));

function run(speedKmh:number,steer:number,throttle:number){
 const sim=new Simulation(cfg,provider as any);sim.reset(station.p.x,station.p.z,yaw);
 sim.vehicle.rigidBody.position.y=station.p.y+cfg.centerOfGravityHeight;
 sim.vehicle.suspension.reset();sim.suspensionKinematics.reset();
 for(let i=0;i<240;i++)sim.stepExplicit(neutral,1);
 const speed=speedKmh/3.6;
 sim.vehicle.rigidBody.velocity=PhysicsMath.quatRotateVec3(sim.vehicle.rigidBody.orientation,PhysicsMath.vec3(0,0,speed));
 sim.vehicle.wheels.forEach((w:any)=>w.reset(speed));
 let maxRearSlip=0,maxFrontSlip=0,maxYaw=0,maxLatG=0,maxSide=0,offRoad=0,minFz=Infinity;
 for(let i=0;i<240;i++){
   const ramp=Math.min(1,(i+1)/60);
   const state=sim.stepExplicit({...neutral,steer:steer*ramp,throttle},1);
   const rear=Math.max(Math.abs(state.wheels[2].slipAngle),Math.abs(state.wheels[3].slipAngle))*180/Math.PI;
   const front=Math.max(Math.abs(state.wheels[0].slipAngle),Math.abs(state.wheels[1].slipAngle))*180/Math.PI;
   maxRearSlip=Math.max(maxRearSlip,rear); maxFrontSlip=Math.max(maxFrontSlip,front);
   maxYaw=Math.max(maxYaw,Math.abs(state.yawRate)*180/Math.PI);maxLatG=Math.max(maxLatG,Math.abs(state.lateralG));
   const hit=nearest(state.x,state.z); maxSide=Math.max(maxSide,hit.distance); if(hit.distance>7.7)offRoad++;
   minFz=Math.min(minFz,...state.wheels.map((w:any)=>w.forceVectorNorm));
 }
 const state=sim.vehicle.getState();
 return{speedKmh,steer,throttle,maxRearSlipDeg:maxRearSlip,maxFrontSlipDeg:maxFrontSlip,maxYawDegS:maxYaw,maxLatG,maxTrackDistanceM:maxSide,offRoadFrames:offRoad,minWheelFzN:minFz,finalSpeedKmh:state.speedKmh,finalYawDegS:state.yawRate*180/Math.PI,finalSideM:nearest(state.x,state.z).distance};
}
const cases:any[]=[];
for(const speed of [60,80,100,120]) for(const steer of [.12,.18,.24,.30,.40]) for(const throttle of [0,.3,.7]) cases.push(run(speed,steer,throttle));
console.log(JSON.stringify({cases},null,2));


const flatProvider={sampleSurface(){return{elevation:0,normal:PhysicsMath.vec3(0,1,0),slopePitch:0,slopeRoll:0,type:'asphalt',friction:1,rollingResistance:.015,wetness:0,isKerbRumble:false};}};

function launchedCase(speedKmh:number, steer:number, throttle:number, tcsMode:'OFF'|'SPORT'|'FULL'='SPORT'){
 const localCfg:any={...cfg,tcsMode};
 const sim=new Simulation(localCfg,flatProvider as any);sim.reset(0,0,0);sim.vehicle.powertrain.isAutomatic=true;
 for(let i=0;i<240;i++)sim.stepExplicit(neutral,1);
 const target=speedKmh/3.6;
 let launchSteps=0;
 while(Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z)<target && launchSteps<2400){
   sim.stepExplicit({...neutral,throttle:1},1);launchSteps++;
 }
 const before=sim.vehicle.getState();
 const launchSpeed=Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
 const launchGear=(sim.vehicle.powertrain as any).gear;
 const launchRpm=(sim.vehicle.powertrain as any).engineRpm;
 (sim.vehicle as any).surfaceProvider=provider;
 sim.vehicle.rigidBody.position=PhysicsMath.vec3(station.p.x,station.p.y+localCfg.centerOfGravityHeight,station.p.z);
 sim.vehicle.rigidBody.orientation=PhysicsMath.quatFromEuler(0,yaw,0);
 sim.vehicle.rigidBody.velocity=PhysicsMath.quatRotateVec3(sim.vehicle.rigidBody.orientation,PhysicsMath.vec3(0,0,launchSpeed));
 sim.vehicle.rigidBody.angularVelocity=PhysicsMath.vec3(0,0,0);
 sim.vehicle.suspension.reset();sim.suspensionKinematics.reset();
 sim.vehicle.wheels.forEach((w:any)=>w.reset(launchSpeed));
 let peakRear=0,peakFront=0,peakYaw=0,peakKappa=0,minFz=Infinity;
 for(let i=0;i<180;i++){
   const ramp=Math.min(1,(i+1)/60);
   const s=sim.stepExplicit({...neutral,steer:steer*ramp,throttle},1);
   peakRear=Math.max(peakRear,Math.max(Math.abs(s.wheels[2].slipAngle),Math.abs(s.wheels[3].slipAngle))*180/Math.PI);
   peakFront=Math.max(peakFront,Math.max(Math.abs(s.wheels[0].slipAngle),Math.abs(s.wheels[1].slipAngle))*180/Math.PI);
   peakYaw=Math.max(peakYaw,Math.abs(s.yawRate)*180/Math.PI);
   peakKappa=Math.max(peakKappa,...s.wheels.map((w:any)=>Math.abs(w.slipRatio)));
   minFz=Math.min(minFz,...s.wheels.map((w:any)=>w.forceVectorNorm));
 }
 const end=sim.vehicle.getState();
 return{speedKmh,steer,throttle,tcsMode,launchSteps,launchSpeedKmh:launchSpeed*3.6,launchGear,launchRpm,peakRearSlipDeg:peakRear,peakFrontSlipDeg:peakFront,peakYawDegS:peakYaw,peakKappa,minWheelFzN:minFz,finalSpeedKmh:end.speedKmh,finalGear:(sim.vehicle.powertrain as any).gear,finalRpm:(sim.vehicle.powertrain as any).engineRpm};
}

const launched:any[]=[];
for(const speed of [80,100,120]) for(const throttle of [.15,.3,.7]) for(const mode of ['OFF','SPORT','FULL'] as const) launched.push(launchedCase(speed,.18,throttle,mode));
console.log(JSON.stringify({launchedCases:launched},null,2));
