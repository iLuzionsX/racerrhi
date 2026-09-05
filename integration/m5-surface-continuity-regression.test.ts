import * as THREE from 'three';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';

const points = [
  [-225,13,-200],[-225,13,50],[-185,16,245],[-55,22,325],[100,27,265],[155,24,115],
  [290,22,65],[300,20,-65],[170,18,-110],[85,14,-225],[185,11,-320],[70,11,-385],[-110,12,-345],
].map(([x,y,z]) => new THREE.Vector3(x,y,z));

const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
curve.arcLengthDivisions = 4000;
const N = 1400;
const samples = Array.from({length:N},(_,i)=>{
  const t=i/N;
  const p=curve.getPointAt(t);
  const d=curve.getTangentAt(t).normalize();
  const n=new THREE.Vector3(d.z,0,-d.x).normalize();
  return {p,d,n,t};
});

function nearest(x:number,z:number,smooth:boolean){
  let best=Infinity,index=0;
  for(let i=0;i<N;i++){
    const p=samples[i].p;
    const q=(p.x-x)**2+(p.z-z)**2;
    if(q<best){best=q;index=i;}
  }
  const a=samples[index],b=samples[(index+1)%N];
  const abx=b.p.x-a.p.x,abz=b.p.z-a.p.z;
  const u=THREE.MathUtils.clamp(((x-a.p.x)*abx+(z-a.p.z)*abz)/Math.max(.01,abx*abx+abz*abz),0,1);
  const p=a.p.clone().lerp(b.p,u);
  const d=smooth ? a.d.clone().lerp(b.d,u).normalize() : a.d.clone();
  return {p,d,t:(index+u)/N};
}

function surfaceNormal(road:{d:THREE.Vector3}){
  const {x:dx,y:dy,z:dz}=road.d;
  const h=Math.max(1e-8,dx*dx+dz*dz);
  let nx=-dx*dy,ny=h,nz=-dy*dz;
  const L=Math.hypot(nx,ny,nz)||1;
  return new THREE.Vector3(nx/L,ny/L,nz/L);
}

function angleDeg(a:THREE.Vector3,b:THREE.Vector3){
  return Math.acos(THREE.MathUtils.clamp(a.dot(b),-1,1))*180/Math.PI;
}

let legacyMaxNormalStepDeg=0;
let smoothMaxNormalStepDeg=0;
let legacyMaxRoadVelocityStep=0;
let smoothMaxRoadVelocityStep=0;
let worstT=0;

const speedMs=100/3.6;
let prevLegacy:THREE.Vector3|null=null,prevSmooth:THREE.Vector3|null=null;
let prevLegacyVy:number|null=null,prevSmoothVy:number|null=null;

for(let i=0;i<N*8;i++){
  const t=i/(N*8);
  const p=curve.getPointAt(t);
  const actualD=curve.getTangentAt(t).normalize();
  const legacy=surfaceNormal(nearest(p.x,p.z,false));
  const smooth=surfaceNormal(nearest(p.x,p.z,true));

  const v=new THREE.Vector3(actualD.x*speedMs,0,actualD.z*speedMs);
  const legacyVy=-(legacy.x*v.x+legacy.z*v.z)/Math.max(.15,legacy.y);
  const smoothVy=-(smooth.x*v.x+smooth.z*v.z)/Math.max(.15,smooth.y);

  if(prevLegacy&&prevSmooth&&prevLegacyVy!==null&&prevSmoothVy!==null){
    const legacyStep=angleDeg(prevLegacy,legacy);
    const smoothStep=angleDeg(prevSmooth,smooth);
    const legacyVyStep=Math.abs(legacyVy-prevLegacyVy);
    const smoothVyStep=Math.abs(smoothVy-prevSmoothVy);
    if(legacyStep>legacyMaxNormalStepDeg || legacyVyStep>legacyMaxRoadVelocityStep) worstT=t;
    legacyMaxNormalStepDeg=Math.max(legacyMaxNormalStepDeg,legacyStep);
    smoothMaxNormalStepDeg=Math.max(smoothMaxNormalStepDeg,smoothStep);
    legacyMaxRoadVelocityStep=Math.max(legacyMaxRoadVelocityStep,legacyVyStep);
    smoothMaxRoadVelocityStep=Math.max(smoothMaxRoadVelocityStep,smoothVyStep);
  }
  prevLegacy=legacy;prevSmooth=smooth;prevLegacyVy=legacyVy;prevSmoothVy=smoothVy;
}

if(!(smoothMaxNormalStepDeg < legacyMaxNormalStepDeg*0.55)){
  throw new Error('interpolated tangent did not materially smooth road normal');
}
if(!(smoothMaxRoadVelocityStep < legacyMaxRoadVelocityStep*0.55)){
  throw new Error('interpolated tangent did not materially smooth suspension road velocity');
}

console.log(JSON.stringify({
  scenario:'Racerrhi road tangent continuity for Racing26 M5 suspension',
  sampleSpacingM:curve.getLength()/N,
  speedKmh:100,
  worstT,
  legacyMaxNormalStepDeg,
  smoothMaxNormalStepDeg,
  legacyMaxRoadVelocityStepMps:legacyMaxRoadVelocityStep,
  smoothMaxRoadVelocityStepMps:smoothMaxRoadVelocityStep,
  improvement:{
    normalStepRatio:smoothMaxNormalStepDeg/legacyMaxNormalStepDeg,
    roadVelocityStepRatio:smoothMaxRoadVelocityStep/legacyMaxRoadVelocityStep,
  },
  status:'passed'
},null,2));
