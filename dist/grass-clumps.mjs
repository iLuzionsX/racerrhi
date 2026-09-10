import * as T from 'three';

// Small tapered, bent blades have actual silhouette and self-shading, unlike
// opaque polyhedral "bush rocks". One instanced draw; no alpha sorting/overdraw.
export function grassClumpGeometry(){
 const p=[],colors=[];
 for(let blade=0;blade<19;blade++){
  const angle=blade*2.399,spread=.35*Math.sqrt(blade/19),x=Math.sin(angle)*spread,z=Math.cos(angle)*spread;
  const height=.36+.64*(.5+.5*Math.sin(blade*7.13)),w=.028+.019*(.5+.5*Math.sin(blade)),dx=Math.cos(angle)*w,dz=-Math.sin(angle)*w,bx=Math.sin(angle)*height*.28,bz=Math.cos(angle)*height*.28;
  const a=[x-dx,0,z-dz],b=[x+dx,0,z+dz],c=[x+bx*.4-dx*.55,height*.55,z+bz*.4-dz*.55],d=[x+bx*.4+dx*.55,height*.55,z+bz*.4+dz*.55],tip=[x+bx,height,z+bz];
  for(const v of [a,b,c,b,d,c,c,d,tip]){p.push(...v);const shade=.38+.62*Math.min(1,v[1]/height);colors.push(shade,shade,shade);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
