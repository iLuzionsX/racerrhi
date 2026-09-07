import * as T from 'three';
import {GLTFLoader} from './assets/GLTFLoader.js';
import {DRACOLoader} from './assets/DRACOLoader.js';

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
   // Authored tyres are larger than the simulation's 369mm radius. Normalize
   // radial dimensions only, keeping the wheel hub at the exact physics origin.
   const bounds=new T.Box3().setFromObject(wheel),size=bounds.getSize(new T.Vector3());
   const radialScale=.738/Math.max(size.y,size.z);wheel.scale.set(1,radialScale,radialScale);caliper.scale.copy(wheel.scale);
   wheelAssemblies[id]={wheel,caliper};
  }
  return {group,wheelAssemblies};
 }finally{decoder.dispose();}
}
