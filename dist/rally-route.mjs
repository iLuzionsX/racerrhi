import * as T from 'three';

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
  const material={type:'gravel',friction:T.MathUtils.lerp(.88,.66-.17*edge+variation,blend),rollingResistance:T.MathUtils.lerp(.022,.032+.043*edge,blend),looseness:blend*(.5+.5*edge),isKerbRumble:false};
  const y=height(x,z,ground,r),e=.12;
  const normal={x:(height(x-e,z,ground)-height(x+e,z,ground))/(2*e),y:1,z:(height(x,z-e,ground)-height(x,z+e,ground))/(2*e)};
  return {...r,p:new T.Vector3(x,y,z),normal,material};
 }
 return {paths,nearest,surface,height,roadHeight,terrainElevation,length:paths[1].length,entrance:rallyEntrance};
}

export function buildRallyVisuals(scene,route,renderer,ground){
 const loader=new T.TextureLoader(),soil=new T.MeshStandardMaterial({color:0xa18a63,roughness:1,envMapIntensity:.2});
 const ready=Promise.all(['color','normal','rough'].map(kind=>loader.loadAsync('./assets/terrain/dirt-1k-'+kind+'.jpg'))).then(maps=>{
  maps.forEach((tx,i)=>{tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if(i===0)tx.colorSpace=T.SRGBColorSpace;});
  [soil.map,soil.normalMap,soil.roughnessMap]=maps;soil.normalScale.set(.12,.12);soil.needsUpdate=true;
 });
 const edgeCanvas=document.createElement('canvas');edgeCanvas.width=64;edgeCanvas.height=2;const edgeContext=edgeCanvas.getContext('2d'),fade=edgeContext.createLinearGradient(0,0,64,0);fade.addColorStop(0,'black');fade.addColorStop(.25,'white');fade.addColorStop(.75,'white');fade.addColorStop(1,'black');edgeContext.fillStyle=fade;edgeContext.fillRect(0,0,64,2);
 const shoulder=new T.MeshStandardMaterial({color:0x80734f,roughness:1,vertexColors:true,alphaMap:new T.CanvasTexture(edgeCanvas),transparent:true,depthWrite:false});
 function strip(path,width,offset,material,lift,edge=false){
  const positions=[],uv=[],colors=[],indices=[],columns=width>7?9:2;
  path.samples.forEach((a,i)=>{
   for(let col=0;col<columns;col++){const side=col/(columns-1)*2-1,irregular=width>7?.16*Math.sin(i*.12+side):0,p=a.p.clone().addScaledVector(a.n,offset+side*(width/2+irregular));positions.push(p.x,(ground?route.height(p.x,p.z,ground):route.roadHeight(p.x,p.z))+lift,p.z);uv.push(edge?(side+1)/2:(offset+side*width/2)/1.2,edge?.5:i*path.length/(path.samples.length-1)/1.2);const c=new T.Color().setHSL(.12,.19,.31+.045*Math.sin(i*.08));colors.push(c.r,c.g,c.b);}
   if(i<path.samples.length-1)for(let col=0;col<columns-1;col++){const j=i*columns+col;indices.push(j,j+columns,j+1,j+1,j+columns,j+columns+1);}
  });
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(edge)g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();const m=new T.Mesh(g,material);m.receiveShadow=true;scene.add(m);
 }
 const rut=new T.MeshStandardMaterial({color:0x504936,transparent:true,opacity:.16,depthWrite:false,roughness:1});
 for(const path of route.paths){strip(path,14,0,shoulder,-.025,true);strip(path,8.5,0,soil,.025);for(const side of [-1,1])strip(path,.55,side*1.05,rut,.029);}
 const pose=new T.Object3D(),stoneMat=new T.MeshStandardMaterial({color:0x7c7766,roughness:1}),stones=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),stoneMat,560),posts=new T.InstancedMesh(new T.CylinderGeometry(.065,.09,1.1,6),new T.MeshStandardMaterial({color:0xcac2a4,roughness:1}),220);
 for(let i=0;i<560;i++){const path=route.paths[1],a=path.samples[Math.floor(i/560*(path.samples.length-1))],side=i%2?1:-1;pose.position.copy(a.p).addScaledVector(a.n,side*(5.1+(Math.sin(i*83.13)*.5+.5)*4));pose.position.y+=.07;const s=.1+(Math.sin(i*3.3)*.5+.5)*.35;pose.scale.set(s*1.4,s*.65,s);pose.rotation.set(i*.3,i*2.39,i*.7);pose.updateMatrix();stones.setMatrixAt(i,pose.matrix);}
 for(let i=0;i<220;i++){const path=route.paths[1],a=path.samples[Math.floor(i/220*(path.samples.length-1))];pose.position.copy(a.p).addScaledVector(a.n,(i%2?1:-1)*6);pose.position.y+=.4;pose.scale.set(1,1,1);pose.rotation.set(0,i,0);pose.updateMatrix();posts.setMatrixAt(i,pose.matrix);}
 stones.receiveShadow=true;posts.castShadow=posts.receiveShadow=true;scene.add(stones,posts);
 // Keep scattered stones sparse, rather than a visually continuous stone border.
 for(let i=0;i<180;i++){const source=(i*173)%560,matrix=new T.Matrix4();stones.getMatrixAt(source,matrix);stones.setMatrixAt(i,matrix);}stones.count=180;
 return {ready,quality(value){stones.count=value==='high'?180:90;}};
}
