import * as T from 'three';
import {GLTFLoader} from './assets/GLTFLoader.js';
import {DRACOLoader} from './assets/DRACOLoader.js';
import {g90WheelFitment} from './g90-fitment.mjs';

export async function loadG90Visual(){
 const decoder=new DRACOLoader().setDecoderPath('./assets/');
 const loader=new GLTFLoader().setDRACOLoader(decoder);
 try{
  const gltf=await loader.loadAsync('./assets/g90/bmw-m5-g90.glb');
  const group=new T.Group(),wheelAssemblies={};group.name='BMW_M5_G90_full_detail';
  const body=gltf.scene.getObjectByName('body');if(!body)throw Error('Missing G90 body');group.add(body);
  for(const id of ['FL','FR','RL','RR']){
   const wheel=gltf.scene.getObjectByName('wheel_'+id),caliper=gltf.scene.getObjectByName('caliper_'+id);
   if(!wheel||!caliper)throw Error('Missing G90 wheel assembly '+id);
   // Calibrate axial width as well as radius; changing the physical track to
   // hide oversized source tyres would break chassis/hub alignment.
   const bounds=new T.Box3().setFromObject(wheel),fit=g90WheelFitment(id,bounds.min.toArray(),bounds.max.toArray());
   wheel.scale.fromArray(fit.scale);wheel.position.fromArray(fit.offset);
   caliper.scale.copy(wheel.scale);caliper.position.copy(wheel.position);
   wheel.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(m.name.includes('metalicpaint_lightsilver')){m.metalness=.92;m.roughness=.30;}
    if(m.map)m.map.anisotropy=8;
   }});
   wheelAssemblies[id]={wheel,caliper};
  }
  return {group,wheelAssemblies};
 }finally{decoder.dispose();}
}
