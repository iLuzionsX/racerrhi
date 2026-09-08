import * as T from 'three';
import {RGBELoader} from './assets/RGBELoader.js';

export async function surfaces(scene,renderer,materials,sky){
 const loader=new T.TextureLoader(),cache=new Map(),maxAniso=renderer.capabilities.getMaxAnisotropy();
 let loadedQuality='deferred';
 const load=path=>{if(!cache.has(path))cache.set(path,loader.loadAsync(path));return cache.get(path);};
 const repeatFor=name=>name==='grass'?[155,155]:name==='rock'?[7,7]:name==='dirt'?[9,9]:name==='sand'?[12,12]:[1,1];
 const apply=async(name,material,quality)=>{
  const runoff=name==='sand'||name==='dirt',utilityPrefix=runoff?`${name}-1k`:name,colorPrefix=runoff&&quality==='high'?name:utilityPrefix;
  // High upgrades only the albedo to 4K. Normal/roughness stay on the already
  // decoded full-PBR utility maps so changing quality never recompiles six huge textures at once.
  const paths=[`./assets/terrain/${colorPrefix}-color.jpg`,`./assets/terrain/${utilityPrefix}-normal.jpg`,`./assets/terrain/${utilityPrefix}-rough.jpg`];
  const maps=await Promise.all(paths.map(load));
  const repeat=repeatFor(name);
  maps.forEach((tx,i)=>{tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.repeat.set(...repeat);tx.anisotropy=Math.min(maxAniso,quality==='high'?16:12);if(i===0)tx.colorSpace=T.SRGBColorSpace;});
  material.color.set('white');material.map=maps[0];material.normalMap=maps[1];material.roughnessMap=maps[2];
  material.normalScale.setScalar(name==='asphalt'?.62:name==='grass'?1.05:name==='rock'?1.1:name==='sand'?.72:.86);
  material.roughness=name==='asphalt'?.9:name==='sand'?.93:name==='dirt'?.97:.98;
  material.envMapIntensity=name==='asphalt'?.32:name==='rock'?.24:.12;material.needsUpdate=true;
 };
 // Load the core 2K scanned road/land surfaces before play starts.
 await Promise.all(Object.entries(materials).filter(([name])=>name!=='sand'&&name!=='dirt').map(([name,material])=>apply(name,material,'high')));
 // Keep startup responsive: runoff begins with authored base color, then the
 // full scanned PBR set is streamed in after the first rendered view.
 for(const name of ['sand','dirt']){const material=materials[name];material.color.set(name==='sand'?'#b6a68a':'#75684e');material.roughness=name==='sand'?.93:.97;material.needsUpdate=true;}
 void (async()=>{try{
  const hdr=await new RGBELoader().loadAsync('./assets/terrain/sunset.hdr');
  hdr.mapping=T.EquirectangularReflectionMapping;scene.environment=hdr;scene.environmentIntensity=1.28;
  scene.background=hdr;scene.backgroundIntensity=.92;scene.backgroundBlurriness=.018;scene.remove(sky);
 }catch(error){console.warn('HDR environment unavailable; keeping procedural sky.',error);}})();
 // Warm the two 4K runoff albedos after startup. On a normal session they are
 // decoded before the player ever visits Display settings, making High a cheap map swap.
 setTimeout(()=>{for(const name of ['sand','dirt'])void load(`./assets/terrain/${name}-color.jpg`).catch(()=>{});},6500);
 return async quality=>{
  if(quality===loadedQuality)return;loadedQuality=quality;
  return Promise.all(['sand','dirt'].map(name=>apply(name,materials[name],quality)));
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
 positions.forEach((p,i)=>{for(let k=0;k<3;k++){const idx=i*3+k,jitter=1+Math.sin(i*12.91+k*7.3)*.045;dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.s*2.45*jitter,p.s*2.65*jitter,p.s*2.45*jitter);dummy.rotation.y=i*2.399+k*Math.PI/3;dummy.updateMatrix();forest.setMatrixAt(idx,dummy.matrix);const tint=new T.Color().setHSL(.29+Math.sin(i*.91)*.012,.28,.48+Math.sin(i*1.71)*.035);forest.setColorAt(idx,tint);}});
 forest.castShadow=true;forest.receiveShadow=true;scene.add(forest);
}

export function trackDetail(scene,at,length){
 const makeLayer=(count,seed,color)=>{
  let s=seed>>>0;const random=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const geo=new T.IcosahedronGeometry(.12,1),mat=new T.MeshStandardMaterial({color,roughness:1,metalness:0});
  const inst=new T.InstancedMesh(geo,mat,count),dummy=new T.Object3D();
  for(let i=0;i<count;i++){
   const t=(i/count+random()*.012)%1,a=at(t),side=random()<.5?-1:1,offset=side*(9.1+random()*12.5);
   dummy.position.copy(a.p).addScaledVector(a.n,offset);dummy.position.y+=.01+random()*.10;
   const scale=.45+random()*1.65;dummy.scale.set(scale*(.65+random()*.5),scale*.55,scale*(.75+random()*.55));dummy.rotation.set(random()*2,random()*Math.PI,random()*2);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);
  }
  inst.receiveShadow=true;scene.add(inst);return inst;
 };
 const near=makeLayer(Math.min(320,Math.floor(length*.27)),4151,0x817865);
 const extra=makeLayer(Math.min(980,Math.floor(length*.82)),9917,0x706959);
 extra.visible=false;
 return quality=>{extra.visible=quality==='high';near.visible=true;};
}

export function furniture(scene,at,length){
 const steel=new T.MeshStandardMaterial({color:'#7e858a',roughness:.32,metalness:.88,envMapIntensity:1.1}),rubber=new T.MeshStandardMaterial({color:'#151719',roughness:.94});
 const dummy=new T.Object3D();const tires=new T.InstancedMesh(new T.TorusGeometry(.38,.17,18,56),rubber,360);
 for(let i=0;i<360;i++){const a=at(.27+Math.floor(i/3)*.00055);dummy.position.copy(a.p).addScaledVector(a.n,-14.5);dummy.position.y+=.22+(i%3)*.3;dummy.rotation.set(Math.PI/2,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();tires.setMatrixAt(i,dummy.matrix);}tires.castShadow=tires.receiveShadow=true;scene.add(tires);
 const points=[];for(const side of [-1,1])for(let i=0;i<Math.floor(length/7);i++){const a=at(i/Math.floor(length/7)),b=at((i+1)/Math.floor(length/7));const p=a.p.clone().addScaledVector(a.n,side*17),q=b.p.clone().addScaledVector(b.n,side*17);points.push(p.clone().add(new T.Vector3(0,1,0)),p.clone().add(new T.Vector3(0,3.2,0)));for(const h of [1.3,1.8,2.3,2.8,3.2])points.push(p.clone().add(new T.Vector3(0,h,0)),q.clone().add(new T.Vector3(0,h,0)));}scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#7d8588',transparent:true,opacity:.56})));
 for(let i=0;i<14;i++){const a=at(i*.007),p=a.p.clone().addScaledVector(a.n,20);const pole=new T.Mesh(new T.CylinderGeometry(.09,.14,10,12),steel);pole.position.copy(p).y+=5;pole.castShadow=true;scene.add(pole);const lamp=new T.Mesh(new T.BoxGeometry(1.8,.18,.65),new T.MeshStandardMaterial({color:'#ededda',emissive:'#ffe4b0',emissiveIntensity:1.35,roughness:.34}));lamp.position.copy(p).y+=10;scene.add(lamp);}
}
