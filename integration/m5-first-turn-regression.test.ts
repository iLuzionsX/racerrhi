import * as THREE from 'three';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../.vendor/Racing26/src/physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../.vendor/Racing26/src/physics/m5G90';
import { racerrhiSteeringTargetForM5 } from './m5-steering-adapter';

const cfg:any={...DEFAULT_VEHICLE_CONFIG,...BMW_M5_2025_OVERRIDES};
const neutral={throttle:0,brake:0,steer:0,handbrake:false,shiftUp:false,shiftDown:false};

const points=[
[-225,13,-200],[-225,13,50],[-185,16,245],[-55,22,325],[100,27,265],[155,24,115],
[290,22,65],[300,20,-65],[170,18,-110],[85,14,-225],[185,11,-320],[70,11,-385],[-110,12,-345]
].map(([x,y,z])=>new THREE.Vector3(x,y,z));
const curve=new THREE.CatmullRomCurve3(points,true,'centripetal');curve.arcLengthDivisions=4000;
const N=1400;
const samples=Array.from({length:N},(_,i)=>{const t=i/N,p=curve.getPointAt(t),d=curve.getTangentAt(t).normalize(),n=new THREE.Vector3(d.z,0,-d.x).normalize();return{p,d,n,t};});
function at(t:number){t=((t%1)+1)%1;const f=t*N,i=Math.floor(f)%N,a=samples[i],b=samples[(i+1)%N],q=f-Math.floor(f);return{p:a.p.clone().lerp(b.p,q),d:a.d.clone().lerp(b.d,q).normalize(),n:a.n.clone().lerp(b.n,q).normalize(),t};}
function nearest(x:number,z:number){let best=Infinity,index=0;for(let i=0;i<N;i++){const p=samples[i].p,q=(p.x-x)**2+(p.z-z)**2;if(q<best){best=q;index=i;}}const a=samples[index],b=samples[(index+1)%N],abx=b.p.x-a.p.x,abz=b.p.z-a.p.z,len2=Math.max(.01,abx*abx+abz*abz),u=THREE.MathUtils.clamp(((x-a.p.x)*abx+(z-a.p.z)*abz)/len2,0,1),p=a.p.clone().lerp(b.p,u),d=a.d.clone().lerp(b.d,u).normalize(),n=a.n.clone().lerp(b.n,u).normalize(),dx=x-p.x,dz=z-p.z;return{p,d,n,distance:Math.hypot(dx,dz),side:dx*n.x+dz*n.z,t:(index+u)/N};}
const trackProvider={sampleSurface(x:number,z:number){const r=nearest(x,z),d=r.d,h=Math.max(1e-8,d.x*d.x+d.z*d.z);let nx=-d.x*d.y,ny=h,nz=-d.y*d.z,L=Math.hypot(nx,ny,nz)||1;nx/=L;ny/=L;nz/=L;const onRoad=r.distance<=7.7,onKerb=r.distance>7&&r.distance<=8.25;return{elevation:r.p.y,normal:PhysicsMath.vec3(nx,ny,nz),slopePitch:Math.atan2(d.y,Math.sqrt(h)),slopeRoll:0,type:onKerb?'kerb':onRoad?'asphalt':'gravel',friction:onKerb?.88:onRoad?1:.55,rollingResistance:onRoad?.015:.075,wetness:0,isKerbRumble:onKerb};}};
const flatProvider={sampleSurface(){return{elevation:0,normal:PhysicsMath.vec3(0,1,0),slopePitch:0,slopeRoll:0,type:'asphalt',friction:1,rollingResistance:.015,wetness:0,isKerbRumble:false};}};

function assert(condition:boolean,message:string):asserts condition{if(!condition)throw new Error(message);}

// First bend immediately after the start line. The source curve's minimum radius
// in the first few metres is ~168 m, so the corner itself is not geometrically
// extreme; the prior failure came from steering input scaling.
const station=at(2/N);
const yaw=Math.atan2(station.d.x,station.d.z);

function launchedM5(speedKmh:number){
 const sim=new Simulation(cfg,flatProvider as any);
 sim.reset(0,0,0);sim.vehicle.powertrain.isAutomatic=true;
 for(let i=0;i<240;i++)sim.stepExplicit(neutral,1);
 const target=speedKmh/3.6;
 let steps=0;
 while(Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z)<target&&steps<2400){
   sim.stepExplicit({...neutral,throttle:1},1);steps++;
 }
 const speed=Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
 (sim.vehicle as any).surfaceProvider=trackProvider;
 sim.vehicle.rigidBody.position=PhysicsMath.vec3(station.p.x,station.p.y+cfg.centerOfGravityHeight,station.p.z);
 sim.vehicle.rigidBody.orientation=PhysicsMath.quatFromEuler(0,yaw,0);
 sim.vehicle.rigidBody.velocity=PhysicsMath.quatRotateVec3(sim.vehicle.rigidBody.orientation,PhysicsMath.vec3(0,0,speed));
 sim.vehicle.rigidBody.angularVelocity=PhysicsMath.vec3(0,0,0);
 sim.vehicle.suspension.reset();sim.suspensionKinematics.reset();
 sim.vehicle.wheels.forEach((w:any)=>w.reset(speed));
 return sim;
}

function runFirstTurn(speedKmh:number,handWheelDeg:number,throttle:number){
 const sim=launchedM5(speedKmh);
 const raw=-Math.min(1,Math.abs(handWheelDeg)/135); // negative raw => canonical +left
 const initialTarget=racerrhiSteeringTargetForM5(sim,raw);
 let peakRearSlip=0,peakFrontSlip=0,peakYaw=0,peakKappa=0,minFz=Infinity;
 for(let i=0;i<180;i++){
   const ramp=Math.min(1,(i+1)/60);
   const target=racerrhiSteeringTargetForM5(sim,raw*ramp);
   const state=sim.stepExplicit({...neutral,steer:0,analogSteerTarget:target,throttle} as any,1);
   peakRearSlip=Math.max(peakRearSlip,Math.max(Math.abs(state.wheels[2].slipAngle),Math.abs(state.wheels[3].slipAngle))*180/Math.PI);
   peakFrontSlip=Math.max(peakFrontSlip,Math.max(Math.abs(state.wheels[0].slipAngle),Math.abs(state.wheels[1].slipAngle))*180/Math.PI);
   peakYaw=Math.max(peakYaw,Math.abs(state.yawRate)*180/Math.PI);
   peakKappa=Math.max(peakKappa,...state.wheels.map((w:any)=>Math.abs(w.slipRatio)));
   minFz=Math.min(minFz,...state.wheels.map((w:any)=>w.forceVectorNorm));
 }
 const state=sim.vehicle.getState();
 return{speedKmh,handWheelDeg,raw,initialTarget,peakRearSlipDeg:peakRearSlip,peakFrontSlipDeg:peakFrontSlip,peakYawDegS:peakYaw,peakKappa,minWheelFzN:minFz,finalSpeedKmh:state.speedKmh};
}

const cases=[] as ReturnType<typeof runFirstTurn>[];
for(const speed of [80,100,120])for(const hand of [45,60,90,135])cases.push(runFirstTurn(speed,hand,.7));

for(const c of cases){
 assert(Number.isFinite(c.peakRearSlipDeg)&&Number.isFinite(c.peakYawDegS),'non-finite first-turn response');
 assert(c.peakRearSlipDeg<20,'first-turn rear slip became a spin: '+JSON.stringify(c));
 assert(c.peakYawDegS<50,'first-turn yaw rate ran away: '+JSON.stringify(c));
 assert(c.peakKappa<.30,'first-turn tire longitudinal slip ran away: '+JSON.stringify(c));
 assert(c.minWheelFzN>500,'first-turn unloaded a wheel excessively: '+JSON.stringify(c));
}

// At road speed, Racerrhi full wheel travel must no longer equal full M5 rack.
const roadSpeedFull=launchedM5(100);
const roadSpeedTarget=Math.abs(racerrhiSteeringTargetForM5(roadSpeedFull,-1));
assert(roadSpeedTarget>0.28&&roadSpeedTarget<0.34,'road-speed steering ratio mismatch: '+roadSpeedTarget);

// At maneuvering speed, retain enough lock for the circuit's tight Riviera section.
const lowSpeed=launchedM5(20);
const lowSpeedTarget=Math.abs(racerrhiSteeringTargetForM5(lowSpeed,-1));
assert(lowSpeedTarget>0.90,'low-speed steering authority lost: '+lowSpeedTarget);

// Genuine opposite-lock recovery must still unlock substantial mechanical rack.
const recovery=launchedM5(100);
const recoverySpeed=Math.abs(recovery.vehicle.rigidBody.getLocalVelocity().z);
recovery.vehicle.rigidBody.velocity=PhysicsMath.quatRotateVec3(
 recovery.vehicle.rigidBody.orientation,
 PhysicsMath.vec3(-Math.tan(18*Math.PI/180)*recoverySpeed,0,recoverySpeed)
);
recovery.vehicle.rigidBody.angularVelocity=PhysicsMath.vec3(0,1.05,0);
const recoveryTarget=Math.abs(racerrhiSteeringTargetForM5(recovery,1));
assert(recoveryTarget>0.80,'opposite-lock recovery authority lost: '+recoveryTarget);

console.log(JSON.stringify({
 scenario:'Racerrhi first-turn M5 steering integration',
 roadSpeedFullRackRequest:roadSpeedTarget,
 lowSpeedFullRackRequest:lowSpeedTarget,
 severeRecoveryRackRequest:recoveryTarget,
 cases,
 status:'passed'
},null,2));
