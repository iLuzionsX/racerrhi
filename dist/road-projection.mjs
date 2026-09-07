// Find the closest point on the sampled track, including the segment behind
// the nearest vertex. Projecting only forward causes a half-segment height step
// each time the nearest vertex changes, and invents off-track lateral distance.
export function nearestRoadProjection(samples,x,z,stride=1) {
  const count=samples.length;
  let nearest=0,best=Infinity;
  for(let i=0;i<count;i+=stride) {
    const p=samples[i].p,d=(p.x-x)**2+(p.z-z)**2;
    if(d<best){best=d;nearest=i;}
  }
  if(stride>1)return {index:nearest,fraction:0};
  let index=nearest,fraction=0;
  best=Infinity;
  for(const candidate of [(nearest+count-1)%count,nearest]) {
    const a=samples[candidate].p,b=samples[(candidate+1)%count].p;
    const dx=b.x-a.x,dz=b.z-a.z;
    const u=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-12,dx*dx+dz*dz)));
    const d=(x-a.x-u*dx)**2+(z-a.z-u*dz)**2;
    if(d<best){best=d;index=candidate;fraction=u;}
  }
  return {index,fraction};
}
