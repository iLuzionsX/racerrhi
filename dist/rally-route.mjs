import * as T from 'three';
import {rallyMaterial} from './rally-material.mjs';
import {groundMaterial} from './ground-material.mjs';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
export const rallyEntrance=(x,z)=>x>-231&&x<-178&&z>-209&&z<-178;
export function createRallyRoute(){
 const loop=[[-140,18,-140],[-135,22,-60],[-165,27,10],[-110,38,95],[-30,46,165],[45,41,110],[85,33,35],[25,29,5],[65,24,-85],[-10,18,-160],[-95,16,-180]];
 const access=[[-225,13,-191],[-206,13,-191],[-179,14,-194],[-150,16,-182],[-140,18,-140]];
 const paths=[{name:'access',points:access,closed:false},{name:'loop',points:loop,closed:true}].map(path=>{
  const curve=new T.CatmullRomCurve3(path.points.map(p=>new T.Vector3(...p)),path.closed,'centripetal');curve.arcLengthDivisions=2000;
  const length=curve.getLength(),count=Math.ceil(length/.75);
  const samples=Array.from({length:count+1},(_,i)=>{const t=i/count,p=curve.getPointAt(t),d=curve.getTangentAt(t).normalize(),n=new T.Vector3(d.z,0,-d.x).normalize();return {p,d,n,t};});
  return {...path,curve,length,samples};
 });
 // Spatial buckets avoid scanning the whole rally route for every wheel at 120Hz.
 const cells=new Map(),segments=[];
 for(const path of paths)for(let i=0;i<path.samples.length-1;i++){
  const a=path.samples[i],b=path.samples[i+1],segment={a,b,path: path.name,index:i};segments.push(segment);
  for(let x=Math.floor((Math.min(a.p.x,b.p.x)-32)/32);x<=Math.floor((Math.max(a.p.x,b.p.x)+32)/32);x++)for(let z=Math.floor((Math.min(a.p.z,b.p.z)-32)/32);z<=Math.floor((Math.max(a.p.z,b.p.z)+32)/32);z++){
   const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);
  }
 }
 function nearest(x,z){
  let best=null,bestSq=Infinity;
  for(const s of cells.get(Math.floor(x/32)+','+Math.floor(z/32))||segments){
   const dx=s.b.p.x-s.a.p.x,dz=s.b.p.z-s.a.p.z,u=clamp(((x-s.a.p.x)*dx+(z-s.a.p.z)*dz)/(dx*dx+dz*dz));
   const px=s.a.p.x+dx*u,pz=s.a.p.z+dz*u,q=(x-px)**2+(z-pz)**2;
   if(q<bestSq){bestSq=q;best={s,u,px,pz};}
  }
  const {s,u,px,pz}=best,d=s.a.d.clone().lerp(s.b.d,u).normalize(),n=new T.Vector3(d.z,0,-d.x).normalize();
  return {p:new T.Vector3(px,T.MathUtils.lerp(s.a.p.y,s.b.p.y,u),pz),d,n,t:T.MathUtils.lerp(s.a.t,s.b.t,u),distance:Math.sqrt(bestSq),side:(x-px)*n.x+(z-pz)*n.z,route:s.path,rally:true,surfaceOffset:.025};
 }
 function roadHeight(x,z,r=nearest(x,z)){
  const strength=r.route==='access'?smooth((r.t*paths[0].length-12)/35):1;
  const crown=-.014*(Math.sqrt(r.side*r.side+.1)-Math.sqrt(.1));
  const rut=-.01*Math.exp(-(((Math.abs(r.side)-1.05)/.28)**2));
  // Spatially fixed centimetre undulations excite the real suspension. No camera
  // shake, random vertical impulses, or frame-rate-dependent grip changes.
  const rough=.012*Math.sin(x*.24+z*.35)+.004*Math.sin(x*.65)*Math.cos(z*.7)+.002*Math.sin(z*1.5+x*.3);
  return r.p.y+strength*(crown+rut+rough);
 }
 const terrainAnchors=paths.flatMap(path=>path.samples.filter((_,i)=>i%12===0));
 function terrainElevation(x,z){
  let sum=0,weight=0;
  for(const a of terrainAnchors){const q=(x-a.p.x)**2+(z-a.p.z)**2;if(q>18000)continue;const w=Math.exp(-q/648);sum+=a.p.y*w;weight+=w;}
  return weight>1e-12?sum/weight:nearest(x,z).p.y;
 }
 function height(x,z,ground,r=nearest(x,z)){
  if(r.distance<=5)return roadHeight(x,z,r);
  if(r.distance>=12)return ground(x,z);
  return T.MathUtils.lerp(roadHeight(x,z,r),ground(x,z),smooth((r.distance-5)/7));
 }
 function surface(x,z,paved,ground){
  const r=nearest(x,z);
  if(paved.distance<=7.5 || (paved.distance<r.distance && r.distance>14 && paved.distance<18))return paved;
  const blend=smooth((paved.distance-7.5)/12),edge=smooth((r.distance-2.8)/3.2);
  const variation=.015*Math.sin(x*.09+z*.12);
  const material=rallyMaterial(edge,blend,variation);
  const y=height(x,z,ground,r),e=.12;
  const normal={x:(height(x-e,z,ground)-height(x+e,z,ground))/(2*e),y:1,z:(height(x,z-e,ground)-height(x,z+e,ground))/(2*e)};
  return {...r,p:new T.Vector3(x,y,z),normal,material};
 }
 return {paths,nearest,surface,height,roadHeight,terrainElevation,length:paths[1].length,entrance:rallyEntrance};
}

export function buildRallyVisuals(scene,route,renderer,ground){
 const loader=new T.TextureLoader();
 const soil=groundMaterial(new T.MeshStandardMaterial({color:0xffffff,roughness:1,envMapIntensity:.35,transparent:true,depthWrite:false}),{kind:'soil',metres:2,feather:true});
 const ready=Promise.all(['color','normal','rough'].map(kind=>loader.loadAsync('./assets/terrain/rally-scan-'+kind+'.jpg'))).then(maps=>{
  maps.forEach((tx,i)=>{tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.anisotropy=Math.min(12,renderer.capabilities.getMaxAnisotropy());if(i===0)tx.colorSpace=T.SRGBColorSpace;});
  [soil.map,soil.normalMap,soil.roughnessMap]=maps;soil.normalScale.set(.22,.22);soil.needsUpdate=true;
 });
 // One feathered, ground-following shoulder. Shared world UVs avoid the tiled
 // brown-carpet look, stretched corner UVs, and seams where the access joins.
 for(const path of route.paths){
  const positions=[],uv=[],indices=[],columns=15;
  path.samples.forEach((a,i)=>{
   for(let col=0;col<columns;col++){
    const offset=(col/(columns-1)*2-1)*7,p=a.p.clone().addScaledVector(a.n,offset);
    positions.push(p.x,route.height(p.x,p.z,ground)+.026,p.z);uv.push(offset,i*path.length/(path.samples.length-1));
   }
   if(i<path.samples.length-1)for(let col=0;col<columns-1;col++){const j=i*columns+col;indices.push(j,j+columns,j+1,j+1,j+columns,j+columns+1);}
  });
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const m=new T.Mesh(g,soil);m.receiveShadow=true;m.renderOrder=1;scene.add(m);
 }
 const pose=new T.Object3D(),stoneMat=new T.MeshStandardMaterial({color:0x777164,roughness:1});
 const stones=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),stoneMat,180);
 const posts=new T.InstancedMesh(new T.CylinderGeometry(.045,.055,.8,7),new T.MeshStandardMaterial({color:0x716857,roughness:1}),52);
 for(let i=0;i<180;i++){
  const path=route.paths[1],a=path.samples[Math.floor(((i*173)%557)/557*(path.samples.length-1))],side=i%2?1:-1;
  pose.position.copy(a.p).addScaledVector(a.n,side*(5.3+(Math.sin(i*83.13)*.5+.5)*4));
  const s=.035+(Math.sin(i*3.3)*.5+.5)*.12;
  pose.position.y=route.height(pose.position.x,pose.position.z,ground)+s*.15;
  pose.scale.set(s*1.4,s*.65,s);pose.rotation.set(i*.3,i*2.39,i*.7);pose.updateMatrix();stones.setMatrixAt(i,pose.matrix);
  stones.setColorAt(i,new T.Color().setScalar(.72+.26*(.5+.5*Math.sin(i*7.7))));
 }
 for(let i=0;i<52;i++){
  const path=route.paths[1],a=path.samples[Math.floor(i/52*(path.samples.length-1))];pose.position.copy(a.p).addScaledVector(a.n,(i%2?1:-1)*6.6);
  pose.position.y=route.height(pose.position.x,pose.position.z,ground)+.32;pose.scale.set(1,1,1);pose.rotation.set(0,i,0);pose.updateMatrix();posts.setMatrixAt(i,pose.matrix);
 }
 stones.castShadow=stones.receiveShadow=true;posts.castShadow=posts.receiveShadow=true;scene.add(stones,posts);
 return {ready,quality(value){stones.count=value==='high'?180:90;soil.map&&(soil.map.anisotropy=Math.min(value==='high'?16:8,renderer.capabilities.getMaxAnisotropy()));}};
}
