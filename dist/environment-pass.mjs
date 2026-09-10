import * as T from 'three';
import {grassClumpGeometry} from './grass-clumps.mjs';

export function environmentPass(scene,at,ground,route,trees,roadMaterial){
 // Ground materials own their shared metre-scale shading pipeline.
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
 const bushes=new T.InstancedMesh(grassClumpGeometry(),new T.MeshStandardMaterial({color:0xffffff,roughness:1,vertexColors:true,side:T.DoubleSide}),1440);
 for(let i=0;i<1440;i++){
  const a=route.paths[1].samples[Math.floor(((i*317)%1440)/1440*(route.paths[1].samples.length-1))],offset=(i%2?1:-1)*(5.8+23*(.5+.5*Math.sin(i*81.73))**2),p=a.p.clone().addScaledVector(a.n,offset);
  const size=.24+(.5+.5*Math.sin(i*42.61))*.72;pose.position.set(p.x,route.height(p.x,p.z,ground)-.025,p.z);pose.rotation.set(0,i*2.399,0);pose.scale.set(size*1.7,size,size*1.7);pose.updateMatrix();bushes.setMatrixAt(i,pose.matrix);bushes.setColorAt(i,new T.Color().setHSL(.19+Math.sin(i)*.022,.23,.18+.12*(.5+.5*Math.sin(i*3.17))));
 }
 bushes.castShadow=bushes.receiveShadow=true;scene.add(bushes);
 // Baked-style, soft local grounding under vegetation: one instanced draw.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),g=ctx.createRadialGradient(32,32,2,32,32,32);g.addColorStop(0,'rgba(15,22,12,.30)');g.addColorStop(1,'rgba(15,22,12,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
 const shade=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:new T.CanvasTexture(canvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),trees.length);
 trees.forEach((p,i)=>{pose.position.set(p.x,p.y+.04,p.z);pose.rotation.set(-Math.PI/2,0,0);pose.scale.set(p.s*1.5,p.s*1.5,1);pose.updateMatrix();shade.setMatrixAt(i,pose.matrix);});scene.add(shade);
 return value=>{bushes.count=value==='high'?1440:720;};
}
