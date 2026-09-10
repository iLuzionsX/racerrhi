import * as T from 'three';
import {RGBELoader} from './assets/RGBELoader.js';
import {groundMaterial} from './ground-material.mjs';

export async function surfaces(scene,renderer,materials,sky){
 const loader=new T.TextureLoader(),cache=new Map(),maxAniso=renderer.capabilities.getMaxAnisotropy();
 const load=path=>{if(!cache.has(path))cache.set(path,loader.loadAsync(path));return cache.get(path);};
 const apply=async(name,material)=>{
  const prefix=name==='asphalt'?'road-scan':name==='dirt'?'rally-scan':name==='sand'?'sand-1k':name;
  const maps=await Promise.all(['color','normal','rough'].map(kind=>load('./assets/terrain/'+prefix+'-'+kind+'.jpg')));
  maps.forEach((tx,i)=>{tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.anisotropy=Math.min(maxAniso,12);if(i===0)tx.colorSpace=T.SRGBColorSpace;});
  material.color.set('white');material.map=maps[0];material.normalMap=maps[1];material.roughnessMap=maps[2];
  material.normalScale.setScalar(name==='asphalt'?.16:name==='grass'?.26:name==='rock'?.48:.18);
  material.roughness=1;material.envMapIntensity=name==='asphalt'?.4:.35;
  groundMaterial(material,{kind:name==='sand'||name==='dirt'?'soil':name,metres:name==='grass'?2:name==='rock'?3:name==='sand'?2:2.1});
 };
 await Promise.all(Object.entries(materials).map(([name,material])=>apply(name,material)));
 try{
  const hdr=await new RGBELoader().loadAsync('./assets/terrain/daylight.hdr');
  hdr.mapping=T.EquirectangularReflectionMapping;scene.environment=hdr;scene.environmentIntensity=.55;
  scene.background=hdr;scene.backgroundIntensity=.8;scene.backgroundBlurriness=.018;scene.remove(sky);
  // Align the shadow-casting sun with the actual HDR sun, instead of illuminating
  // the car from a different direction than its sky/reflections.
  const {data,width,height}=hdr.image;let peak=-Infinity,pixel=0;
  for(let i=0;i<width*height/2;i++){const value=data[i*4]+data[i*4+1]+data[i*4+2];if(value>peak){peak=value;pixel=i;}}
  const azimuth=((pixel%width+.5)/width-.5)*Math.PI*2,elevation=(.5-(Math.floor(pixel/width)+.5)/height)*Math.PI;
  scene.userData.sunDirection?.set(Math.cos(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.sin(azimuth)*Math.cos(elevation));
 }catch(error){console.warn('HDR environment unavailable; keeping procedural sky.',error);}
 // Both tiers use the same compact surface set. No background 4K downloads and
 // no material swaps while driving; only filtering/geometry budgets change.
 return async quality=>{
  for(const promise of cache.values()){const tx=await promise;tx.anisotropy=Math.min(maxAniso,quality==='high'?16:8);tx.needsUpdate=true;}
 };
}
export async function foliage(scene,positions){
 const bark=new T.MeshStandardMaterial({color:0x5f5342,roughness:1});
 const trunks=new T.InstancedMesh(new T.CylinderGeometry(.09,.17,1,16),bark,positions.length),pose=new T.Object3D();
 positions.forEach((p,i)=>{pose.position.set(p.x,p.y+p.s*.55,p.z);pose.scale.set(p.s*.48,p.s*1.1,p.s*.48);pose.rotation.y=(i*.73)%Math.PI;pose.updateMatrix();trunks.setMatrixAt(i,pose.matrix);});trunks.castShadow=trunks.receiveShadow=true;scene.add(trunks);
 const tex=await new T.TextureLoader().loadAsync('./assets/terrain/stone-pine.png');tex.colorSpace=T.SRGBColorSpace;
 const material=new T.MeshStandardMaterial({map:tex,alphaTest:.42,side:T.DoubleSide,roughness:.96,alphaToCoverage:true});
 const geo=new T.PlaneGeometry(1,1);geo.translate(0,.5,0);
 const forest=new T.InstancedMesh(geo,material,positions.length*3),dummy=new T.Object3D();
 forest.name='coastal-tree-canopies';
 positions.forEach((p,i)=>{for(let k=0;k<3;k++){const idx=i*3+k,jitter=1+Math.sin(i*12.91)*.17,width=.82+.32*(.5+.5*Math.sin(i*6.13));dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.s*2.45*jitter*width,p.s*2.65*jitter,p.s*2.45*jitter*width);dummy.rotation.y=i*2.399+k*Math.PI/3;dummy.updateMatrix();forest.setMatrixAt(idx,dummy.matrix);const tint=new T.Color().setHSL(.25+Math.sin(i*.91)*.025,.13,.62+Math.sin(i*1.71)*.065);forest.setColorAt(idx,tint);}});
 forest.castShadow=true;forest.receiveShadow=true;scene.add(forest);
}

export function trackDetail(scene,at,length){
 const makeLayer=(count,seed,color)=>{
  let s=seed>>>0;const random=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const geo=new T.IcosahedronGeometry(.12,1),mat=new T.MeshStandardMaterial({color,roughness:1,metalness:0});
  const inst=new T.InstancedMesh(geo,mat,count),dummy=new T.Object3D();
  for(let i=0;i<count;i++){
   const t=(i/count+random()*.012)%1,a=at(t),side=random()<.5?-1:1,offset=side*(9.1+random()*12.5);
   dummy.position.copy(a.p).addScaledVector(a.n,offset);dummy.position.y+=(Math.abs(offset)<16.5?-.09:-.14)+.015;
   const scale=.45+random()*1.65;dummy.scale.set(scale*(.65+random()*.5),scale*.55,scale*(.75+random()*.55));dummy.rotation.set(random()*2,random()*Math.PI,random()*2);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);
  }
  inst.receiveShadow=true;scene.add(inst);return inst;
 };
 const near=makeLayer(Math.min(320,Math.floor(length*.27)),4151,0x817865);
 const extra=makeLayer(Math.min(980,Math.floor(length*.82)),9917,0x706959);
 extra.visible=false;
 return quality=>{extra.visible=quality==='high';near.visible=true;};
}

export function furniture(scene,at,length,opening=()=>false){
 const steel=new T.MeshStandardMaterial({color:'#7e858a',roughness:.32,metalness:.88,envMapIntensity:1.1}),rubber=new T.MeshStandardMaterial({color:'#151719',roughness:.94});
 const dummy=new T.Object3D();const tires=new T.InstancedMesh(new T.TorusGeometry(.38,.17,18,56),rubber,360);
 for(let i=0;i<360;i++){const a=at(.27+Math.floor(i/3)*.00055);dummy.position.copy(a.p).addScaledVector(a.n,-14.5);dummy.position.y+=.22+(i%3)*.3;dummy.rotation.set(Math.PI/2,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();tires.setMatrixAt(i,dummy.matrix);}tires.castShadow=tires.receiveShadow=true;scene.add(tires);
 const points=[];for(const side of [-1,1])for(let i=0;i<Math.floor(length/7);i++){const a=at(i/Math.floor(length/7)),b=at((i+1)/Math.floor(length/7));const p=a.p.clone().addScaledVector(a.n,side*17),q=b.p.clone().addScaledVector(b.n,side*17);if(opening(p.x,p.z)||opening(q.x,q.z))continue;points.push(p.clone().add(new T.Vector3(0,1,0)),p.clone().add(new T.Vector3(0,3.2,0)));for(const h of [1.3,1.8,2.3,2.8,3.2])points.push(p.clone().add(new T.Vector3(0,h,0)),q.clone().add(new T.Vector3(0,h,0)));}scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#7d8588',transparent:true,opacity:.56})));
 for(let i=0;i<14;i++){const a=at(i*.007),p=a.p.clone().addScaledVector(a.n,20);const pole=new T.Mesh(new T.CylinderGeometry(.09,.14,10,12),steel);pole.position.copy(p).y+=5;pole.castShadow=true;scene.add(pole);const lamp=new T.Mesh(new T.BoxGeometry(1.8,.18,.65),new T.MeshStandardMaterial({color:'#ededda',emissive:'#ffe4b0',emissiveIntensity:1.35,roughness:.34}));lamp.position.copy(p).y+=10;scene.add(lamp);}
}
