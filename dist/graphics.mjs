import * as T from 'three';

const copyMaps=old=>({
 map:old.map||null,normalMap:old.normalMap||null,roughnessMap:old.roughnessMap||null,
 metalnessMap:old.metalnessMap||null,aoMap:old.aoMap||null,emissiveMap:old.emissiveMap||null
});

// Rounded 369 mm tyre with denser sidewall/tread geometry and less blocky wheel faces.
export function detailedWheel(side){
 const group=new T.Group();
 const rubber=new T.MeshPhysicalMaterial({color:0x111315,roughness:.86,metalness:0,clearcoat:.08,clearcoatRoughness:.72});
 const alloy=new T.MeshPhysicalMaterial({color:0xc0c7d0,metalness:1,roughness:.18,clearcoat:.45,clearcoatRoughness:.11,envMapIntensity:1.55});
 const inner=new T.MeshStandardMaterial({color:0x20242a,metalness:.82,roughness:.31,envMapIntensity:1.2});
 const profile=[[.258,-.137],[.292,-.146],[.326,-.146],[.350,-.134],[.365,-.108],[.369,-.070],[.369,.070],[.365,.108],[.350,.134],[.326,.146],[.292,.146],[.258,.137]].map(([r,y])=>new T.Vector2(r,y));
 const tyre=new T.Mesh(new T.LatheGeometry(profile,128),rubber);tyre.rotation.z=Math.PI/2;group.add(tyre);
 const ring=(radius,tube,x,material,radial=14,tubular=128)=>{const m=new T.Mesh(new T.TorusGeometry(radius,tube,radial,tubular),material);m.rotation.y=Math.PI/2;m.position.x=x;group.add(m);return m;};
 for(const x of [-.139,.139]){ring(.265,.0075,x,alloy);ring(.319,.0012,x,rubber,8,128);}
 // Longitudinal tread channels plus staggered shoulder sipes keep the tyre round in silhouette.
 for(const x of [-.071,-.024,.024,.071])ring(.368,.0018,x,inner,8,128);
 const sipes=new T.InstancedMesh(new T.BoxGeometry(.034,.0016,.004),inner,256),dummy=new T.Object3D();
 for(let i=0;i<256;i++){const a=(i%128)/128*Math.PI*2;dummy.position.set(i<128?-.108:.108,Math.cos(a)*.365,Math.sin(a)*.365);dummy.rotation.x=a+(i%2?.028:-.028);dummy.updateMatrix();sipes.setMatrixAt(i,dummy.matrix);}group.add(sipes);
 const face=side*.147;
 const discMat=new T.MeshStandardMaterial({color:0x74787b,metalness:.92,roughness:.36,envMapIntensity:1.1});
 const disc=new T.Mesh(new T.CylinderGeometry(.221,.221,.013,96),discMat);disc.rotation.z=Math.PI/2;disc.position.x=side*.079;group.add(disc);
 const hat=new T.Mesh(new T.CylinderGeometry(.075,.075,.017,48),inner);hat.rotation.z=Math.PI/2;hat.position.x=side*.082;group.add(hat);
 const holes=new T.InstancedMesh(new T.CircleGeometry(.0037,8),rubber,56);
 for(let i=0;i<56;i++){const a=i/28*Math.PI*2,r=i<28?.183:.204;dummy.position.set(side*.09,Math.cos(a)*r,Math.sin(a)*r);dummy.rotation.set(0,side*Math.PI/2,0);dummy.updateMatrix();holes.setMatrixAt(i,dummy.matrix);}group.add(holes);
 // Five paired sculpted spokes read much closer to a production alloy than rectangular bars.
 const spokeGeo=new T.CapsuleGeometry(.0105,.145,5,10);
 for(let i=0;i<5;i++)for(const delta of [-.035,.035]){const a=i/5*Math.PI*2+delta;const spoke=new T.Mesh(spokeGeo,alloy);spoke.position.set(face,Math.cos(a)*.154,Math.sin(a)*.154);spoke.rotation.x=a;spoke.scale.set(1,1.05,1);group.add(spoke);}
 const hub=new T.Mesh(new T.CylinderGeometry(.062,.062,.031,48),inner);hub.rotation.z=Math.PI/2;hub.position.x=face;group.add(hub);
 for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const bolt=new T.Mesh(new T.SphereGeometry(.008,12,8),alloy);bolt.position.set(face+side*.018,Math.cos(a)*.042,Math.sin(a)*.042);group.add(bolt);}
 // Batch static wheel parts by material instead of submitting every spoke/ring.
 const batches=new Map();
 for(const part of [...group.children]){if(!part.isMesh||part.isInstancedMesh)continue;part.updateMatrix();const geo=(part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone()).applyMatrix4(part.matrix);if(!batches.has(part.material))batches.set(part.material,[]);batches.get(part.material).push(geo);group.remove(part);}
 for(const [material,geometries] of batches){const merged=new T.BufferGeometry();for(const key of ['position','normal','uv']){const size=key==='uv'?2:3;const total=geometries.reduce((sum,g)=>sum+(g.attributes[key]?.count||g.attributes.position.count)*size,0);const data=new Float32Array(total);let offset=0;for(const g of geometries){const a=g.attributes[key];if(a){data.set(a.array,offset);offset+=a.array.length;}}merged.setAttribute(key,new T.BufferAttribute(data,size));}group.add(new T.Mesh(merged,material));geometries.forEach(g=>g.dispose());}
 group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return group;
}

export function upgradeCar(model){
 const cache=new Map(),reflective=[];
 const makePhysical=(old,opts)=>new T.MeshPhysicalMaterial({
   name:old.name,color:opts.color??old.color?.clone()??new T.Color(0xffffff),
   ...copyMaps(old),side:old.side,transparent:old.transparent,opacity:old.opacity,
   alphaTest:old.alphaTest||0,depthWrite:old.depthWrite!==false,
   roughness:opts.roughness,metalness:opts.metalness,
   clearcoat:opts.clearcoat??0,clearcoatRoughness:opts.clearcoatRoughness??.1,
   envMapIntensity:opts.envMapIntensity??1
 });
 model.traverse(o=>{
  if(!o.isMesh)return;
  const upgrade=old=>{
   if(cache.has(old))return cache.get(old);
   const tag=((old.name||'')+' '+(o.name||'')).toLowerCase();
   let m=old;
   if(tag.includes('carpaint')||tag.includes('bodycolor')||tag.includes('body_color')){
    m=makePhysical(old,{color:new T.Color(0x153e63),metalness:.72,roughness:.29,clearcoat:1,clearcoatRoughness:.065,envMapIntensity:1.05});
   }else if(tag.includes('window')||tag.includes('glass_int')||tag.includes('windscreen')){
    m=makePhysical(old,{metalness:.10,roughness:.055,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.1});
    m.opacity=.55;
   }else if(tag.includes('chrome')||tag.includes('mirror')||tag.includes('trim')){
    m=old.clone();m.metalness=1;m.roughness=Math.min(.10,m.roughness??.1);m.envMapIntensity=1.65;
   }else if(old.isMeshStandardMaterial||old.isMeshPhysicalMaterial){
    m=old.clone();
    if((m.metalness??0)>.35)m.roughness=Math.max(.12,(m.roughness??.5)*.86);
    m.envMapIntensity=Math.max(1.15,m.envMapIntensity||0);
   }
   if('envMapIntensity'in m&&((m.roughness??1)<.48||(m.metalness??0)>.45))reflective.push(m);
   cache.set(old,m);return m;
  };
  o.material=Array.isArray(o.material)?o.material.map(upgrade):upgrade(o.material);
 });
 return [...new Set(reflective)];
}

export function localReflections(renderer,scene,car,materials){
 let target,probe,last=-Infinity,high=true,captures=0;
 const reflected=new T.Scene();reflected.background=scene.background;reflected.environment=scene.environment;
 reflected.environmentIntensity=scene.environmentIntensity;reflected.backgroundIntensity=scene.backgroundIntensity;
 reflected.add(new T.HemisphereLight('#dce9f2','#57513d',.22));
 const sun=scene.userData.sunLight.clone();sun.castShadow=false;sun.position.copy(scene.userData.sunDirection).multiplyScalar(120);reflected.add(sun);
 const proxies=[];scene.updateMatrixWorld(true);
 for(const source of scene.children){
  if(!source.isMesh||source.material?.isShaderMaterial||source.material?.transparent||source.material?.alphaTest>0)continue;
  if(source.isInstancedMesh&&source.count>240)continue;
  source.geometry.computeBoundingSphere();const radius=source.geometry.boundingSphere.radius;
  if(radius<.8||radius>140)continue;
  const proxy=source.isInstancedMesh?source.clone():new T.Mesh(source.geometry,source.material);proxy.matrixAutoUpdate=false;proxy.matrix.copy(source.matrixWorld);reflected.add(proxy);proxies.push({proxy,source});
 }
 const floor=new T.Mesh(new T.PlaneGeometry(520,520),new T.MeshStandardMaterial({color:0x555a55,roughness:.9}));floor.rotation.x=-Math.PI/2;reflected.add(floor);
 // Reflect a bounded set of the actual nearby tree cards. The old radius filter
 // excluded the entire instanced forest, leaving generic sky in every window.
 const forest=scene.getObjectByName('coastal-tree-canopies'),treeMatrix=new T.Matrix4(),treeColor=new T.Color(),treePositions=[];
 const localTrees=forest?new T.InstancedMesh(forest.geometry,forest.material,72):null;
 if(localTrees){for(let i=0;i<forest.count;i+=3){forest.getMatrixAt(i,treeMatrix);treePositions.push({i,p:new T.Vector3().setFromMatrixPosition(treeMatrix).applyMatrix4(forest.matrixWorld)});}reflected.add(localTrees);}
 function quality(value){
  high=value==='high';target?.dispose();
  target=new T.WebGLCubeRenderTarget(high?128:64,{type:T.HalfFloatType,generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter});
  probe=new T.CubeCamera(.35,320,target);
  materials.forEach(m=>{m.userData.reflectionStrength??=m.envMapIntensity||1;m.envMap=target.texture;m.envMapIntensity=m.userData.reflectionStrength*(high?1:.85);m.needsUpdate=true;});
  last=-Infinity;
 }
 quality('balanced');
 return {quality,update(time){
  if(time-last<(high?.8:1.2))return;last=time;
  probe.position.copy(car.position);probe.position.y+=1.05;floor.position.copy(car.position);floor.position.y-=.03;
  const radius=high?245:165,radius2=radius*radius;
  const world=new T.Vector3();for(const {proxy,source} of proxies){source.updateMatrixWorld();proxy.matrix.copy(source.matrixWorld);if(source.isInstancedMesh){source.computeBoundingSphere();world.copy(source.boundingSphere.center).applyMatrix4(source.matrixWorld);proxy.visible=world.distanceToSquared(car.position)<(radius+source.boundingSphere.radius)**2;}else proxy.visible=source.getWorldPosition(world).distanceToSquared(car.position)<radius2;}
  reflected.background=scene.background;reflected.environment=scene.environment;
  if(localTrees){let count=0;const near=treePositions.map(t=>({...t,d:t.p.distanceToSquared(car.position)})).filter(t=>t.d<radius2).sort((a,b)=>a.d-b.d).slice(0,high?24:12);
   for(const tree of near)for(let k=0;k<3;k++){forest.getMatrixAt(tree.i+k,treeMatrix);treeMatrix.premultiply(forest.matrixWorld);localTrees.setMatrixAt(count,treeMatrix);forest.getColorAt(tree.i+k,treeColor);localTrees.setColorAt(count++,treeColor);}
   localTrees.count=count;localTrees.instanceMatrix.needsUpdate=true;if(localTrees.instanceColor)localTrees.instanceColor.needsUpdate=true;localTrees.computeBoundingSphere();
  }
  probe.update(renderer,reflected);captures++;
 },get captures(){return captures;}};
}
