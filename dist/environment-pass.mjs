import * as T from 'three';

export function environmentPass(scene,at,ground,route,trees,roadMaterial){
 // World-space broad variation breaks repeating asphalt tiles without painted wetness.
 roadMaterial.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRoadWorld=(modelMatrix*vec4(position,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadWorld;').replace('#include <color_fragment>','#include <color_fragment>\nfloat wear=sin(vRoadWorld.x*.061+sin(vRoadWorld.z*.027))*sin(vRoadWorld.z*.043);diffuseColor.rgb*=.88+wear*.10;');
 };
 roadMaterial.customProgramCacheKey=()=> 'dry-asphalt-world-wear-v1';
 const pose=new T.Object3D(),boxes=[];
 const addBox=(p,w,h,d,rotation)=>boxes.push({p,w,h,d,rotation});
 // Panel divisions, structural frames, recessed shutter ribs and deep roof fascia.
 for(let i=0;i<9;i++){
  const a=at(.014+i*.005),p=a.p.clone().addScaledVector(a.n,28),rotation=Math.atan2(a.d.x,a.d.z);
  for(const z of [-4.35,0,4.35])addBox(p.clone().addScaledVector(a.n,-7.65).addScaledVector(a.d,z).add(new T.Vector3(0,2.7,0)),.28,5.4,.25,rotation);
  for(let j=0;j<11;j++)addBox(p.clone().addScaledVector(a.n,-7.69).add(new T.Vector3(0,.25+j*.215,0)),.18,.045,5.8,rotation);
  addBox(p.clone().addScaledVector(a.n,-7.7).add(new T.Vector3(0,3,0)),.7,.3,9.4,rotation);
  addBox(p.clone().add(new T.Vector3(0,5.75,0)),15.7,.34,9.6,rotation);
 }
 const facade=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0x595e58,roughness:.82}),boxes.length);
 boxes.forEach((b,i)=>{pose.position.copy(b.p);pose.scale.set(b.w,b.h,b.d);pose.rotation.set(0,b.rotation,0);pose.updateMatrix();facade.setMatrixAt(i,pose.matrix);});facade.castShadow=facade.receiveShadow=true;scene.add(facade);
 // Small Mediterranean scrub clusters; route shoulders stay clear.
 const bushes=new T.InstancedMesh(new T.IcosahedronGeometry(1,2),new T.MeshStandardMaterial({color:0xffffff,roughness:1}),720);
 for(let i=0;i<720;i++){
  const a=route.paths[1].samples[Math.floor(((i*317)%720)/720*(route.paths[1].samples.length-1))],offset=(i%2?1:-1)*(11+37*(.5+.5*Math.sin(i*81.73))),p=a.p.clone().addScaledVector(a.n,offset);
  const size=.4+(.5+.5*Math.sin(i*42.61))*1.1;pose.position.set(p.x,ground(p.x,p.z)+size*.55,p.z);pose.rotation.set(i*.31,i*2.399,i*.47);pose.scale.set(size,size*.65,size);pose.updateMatrix();bushes.setMatrixAt(i,pose.matrix);bushes.setColorAt(i,new T.Color().setHSL(.20+Math.sin(i)*.025,.20,.21+.07*(.5+.5*Math.sin(i*3.17))));
 }
 bushes.castShadow=bushes.receiveShadow=true;scene.add(bushes);
 // Baked-style, soft local grounding under vegetation: one instanced draw.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),g=ctx.createRadialGradient(32,32,2,32,32,32);g.addColorStop(0,'rgba(15,22,12,.30)');g.addColorStop(1,'rgba(15,22,12,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
 const shade=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:new T.CanvasTexture(canvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),trees.length);
 trees.forEach((p,i)=>{pose.position.set(p.x,p.y+.04,p.z);pose.rotation.set(-Math.PI/2,0,0);pose.scale.set(p.s*1.5,p.s*1.5,1);pose.updateMatrix();shade.setMatrixAt(i,pose.matrix);});scene.add(shade);
 return value=>{bushes.count=value==='high'?360:180;};
}
