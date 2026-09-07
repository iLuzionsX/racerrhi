import * as T from 'three';

// Rounded tyre profile: the outer radius remains the physics radius, 369 mm.
export function detailedWheel(side) {
 const group=new T.Group(),rubber=new T.MeshStandardMaterial({color:0x17191c,roughness:.88}),alloy=new T.MeshStandardMaterial({color:0xb0bac7,metalness:1,roughness:.23}),inner=new T.MeshStandardMaterial({color:0x252a32,metalness:.85,roughness:.34});
 const profile=[[.265,-.137],[.31,-.147],[.347,-.139],[.365,-.113],[.369,-.08],[.369,.08],[.365,.113],[.347,.139],[.31,.147],[.265,.137]].map(([r,y])=>new T.Vector2(r,y));
 const tyre=new T.Mesh(new T.LatheGeometry(profile,96),rubber);tyre.rotation.z=Math.PI/2;group.add(tyre);
 const ring=(radius,tube,x,material)=>{const m=new T.Mesh(new T.TorusGeometry(radius,tube,10,96),material);m.rotation.y=Math.PI/2;m.position.x=x;group.add(m);return m;};
 for(const x of [-.139,.139]){ring(.265,.008,x,alloy);ring(.318,.0015,x,rubber);}
 // Four circumferential channels and individual shoulder sipes.
 for(const x of [-.067,-.023,.023,.067])ring(.368,.0016,x,inner);
 const sipes=new T.InstancedMesh(new T.BoxGeometry(.035,.0018,.003),inner,192),dummy=new T.Object3D();
 for(let i=0;i<192;i++){const a=(i%96)/96*Math.PI*2;dummy.position.set(i<96?-.103:.103,Math.cos(a)*.365,Math.sin(a)*.365);dummy.rotation.x=a;dummy.updateMatrix();sipes.setMatrixAt(i,dummy.matrix);}group.add(sipes);
 const face=side*.147;
 const disc=new T.Mesh(new T.CylinderGeometry(.219,.219,.015,64),new T.MeshStandardMaterial({color:0x65686b,metalness:.9,roughness:.42}));disc.rotation.z=Math.PI/2;disc.position.x=side*.08;group.add(disc);
 const holes=new T.InstancedMesh(new T.CircleGeometry(.004,6),rubber,48);
 for(let i=0;i<48;i++){const a=i/24*Math.PI*2,r=i<24?.18:.202;dummy.position.set(side*.09,Math.cos(a)*r,Math.sin(a)*r);dummy.rotation.set(0,side*Math.PI/2,0);dummy.updateMatrix();holes.setMatrixAt(i,dummy.matrix);}group.add(holes);
 for(let i=0;i<10;i++){const a=i/10*Math.PI*2;const spoke=new T.Mesh(new T.BoxGeometry(.022,.19,.019),alloy);spoke.position.set(face,Math.cos(a)*.155,Math.sin(a)*.155);spoke.rotation.x=a;group.add(spoke);}
 const hub=new T.Mesh(new T.CylinderGeometry(.062,.062,.03,32),inner);hub.rotation.z=Math.PI/2;hub.position.x=face;group.add(hub);
 for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const bolt=new T.Mesh(new T.SphereGeometry(.008,8,6),alloy);bolt.position.set(face+side*.018,Math.cos(a)*.042,Math.sin(a)*.042);group.add(bolt);}
 group.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});return group;
}

export function upgradeCar(model){
 const cache=new Map(),reflective=[];
 model.traverse(o=>{if(!o.isMesh)return;const upgrade=old=>{if(cache.has(old))return cache.get(old);const name=(old.name||'').toLowerCase();let m=old;
 if(name==='carpaint'){m=new T.MeshPhysicalMaterial({name:old.name,color:0x174878,metalness:.78,roughness:.29,clearcoat:1,clearcoatRoughness:.075,envMapIntensity:1.15});}
 else if(name==='window'){m=new T.MeshPhysicalMaterial({name:old.name,color:0x101c26,metalness:.15,roughness:.055,clearcoat:1,clearcoatRoughness:.03,envMapIntensity:1.1});}
 else if(name.includes('chrome')||name.includes('mirror')){m=old.clone();m.metalness=1;m.roughness=.09;}
 if(m.roughness<.4)reflective.push(m);cache.set(old,m);return m;};o.material=Array.isArray(o.material)?o.material.map(upgrade):upgrade(o.material);});return reflective;
}

export function localReflections(renderer,scene,car,materials){
 let target,probe,last=-Infinity,high=true,captures=0;
 // Capture nearby solid scenery, excluding distant forests and tiny furniture.
 // The visible scene retains its full detail; the reflection scene shares geometry.
 const reflected=new T.Scene();reflected.background=scene.background;
 reflected.add(new T.HemisphereLight(0xdceeff,0x59684a,1.1));
 const sun=new T.DirectionalLight(0xffdda1,3);sun.position.set(-78,35,-60);reflected.add(sun);
 const proxies=[];scene.updateMatrixWorld(true);
 for(const source of scene.children){
  if(!source.isMesh||source.isInstancedMesh||source.material?.isShaderMaterial)continue;
  source.geometry.computeBoundingSphere();const radius=source.geometry.boundingSphere.radius;
  if(radius<1||radius>80)continue;
  const proxy=new T.Mesh(source.geometry,source.material);proxy.matrixAutoUpdate=false;proxy.matrix.copy(source.matrixWorld);reflected.add(proxy);proxies.push({proxy,source});
 }
 const floor=new T.Mesh(new T.PlaneGeometry(400,400),new T.MeshStandardMaterial({color:0x555957,roughness:.95}));floor.rotation.x=-Math.PI/2;reflected.add(floor);
 function quality(value){high=value==='high';target?.dispose();target=new T.WebGLCubeRenderTarget(high?128:64,{type:T.HalfFloatType,generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter});probe=new T.CubeCamera(.5,250,target);materials.forEach(m=>{m.envMap=target.texture;m.needsUpdate=true;});last=-Infinity;}
 quality('high');
 return {quality,update(time){if(time-last<(high?.3:1))return;last=time;probe.position.copy(car.position);probe.position.y+=1.15;floor.position.copy(car.position);floor.position.y-=.02;for(const {proxy,source} of proxies)proxy.visible=source.position.distanceToSquared(car.position)<180*180;probe.update(renderer,reflected);captures++;},get captures(){return captures;}};
}
