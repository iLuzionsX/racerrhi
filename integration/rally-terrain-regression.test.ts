import assert from 'node:assert/strict';
import {rallyGameplayFixture} from './rally-gameplay-fixture';
const f=rallyGameplayFixture();let maxStep=0,maxSlope=0,worst:any,worstSlope:any;
for(const path of f.rally.paths)for(let i=10;i<path.samples.length-10;i+=20){
 const a=path.samples[i];let previous:any;
 if(f.nearest(a.p.x,a.p.z).distance>25)assert(f.ground(a.p.x,a.p.z)<f.rally.roadHeight(a.p.x,a.p.z)-.1,'base terrain covers the dirt mesh');
 for(let offset=-12;offset<=12;offset+=.1){
  const x=a.p.x+a.n.x*offset,z=a.p.z+a.n.z*offset,s=f.sample(x,z);
  if(previous&&s.rally&&previous.rally){const step=Math.abs(s.p.y-previous.p.y);if(step>maxStep){maxStep=step;worst={path:path.name,t:a.t,offset,x,z,step};}}
  if(s.normal){const slope=Math.hypot(s.normal.x,s.normal.z)/s.normal.y;if(slope>maxSlope){maxSlope=slope;worstSlope={path:path.name,t:a.t,offset,x,z,normal:s.normal};}}
  assert(Number.isFinite(s.p.y));previous=s;
 }
}
console.log(JSON.stringify({maxStepM:maxStep,maxSlope,worst,worstSlope},null,2));
assert(maxStep<.12,'road-to-shoulder height has a cliff across a 10 cm step');
assert(maxSlope<1.2,'rally contact normal contains a near-vertical spike');
