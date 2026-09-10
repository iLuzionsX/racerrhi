// Usage: node integration/prepare-g90.mjs /path/to/official-sketchfab-download.glb
// Retains authored geometry/normals/UVs, bakes transforms and batches by material.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {transformPrimitive,join,prune,dedup,textureCompress,draco} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import * as T from 'three';
const input=process.argv[2];
if(!input)throw Error('Supply the original BMW G90 M5 GLB downloaded from Sketchfab.');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.encoder':await draco3d.createEncoderModule()});
const doc=await io.read(input),root=doc.getRoot(),oldNodes=root.listNodes(),oldScenes=root.listScenes();
const scene=doc.createScene('G90'),assemblies=new Map();root.setDefaultScene(scene);
for(const name of ['body','wheel_FL','wheel_FR','wheel_RL','wheel_RR','caliper_FL','caliper_FR','caliper_RL','caliper_RR']){
 const mesh=doc.createMesh(name);scene.addChild(doc.createNode(name).setMesh(mesh));assemblies.set(name,mesh);
}
const hubs={FL:[.842,.413745,1.61285],FR:[-.842,.413745,1.61285],RL:[.810349,.413745,-1.39315],RR:[-.810491,.413745,-1.39315]};
let sourceTriangles=0,omittedTriangles=0;
for(const n of oldNodes){
 if(!n.getMesh())continue;
 const ancestry=[];for(let a=n;a;a=a.getParentNode())ancestry.push(a.getName());
 const wheel=ancestry.some(s=>/^WHEEL_(LF|RF|LR|RR)$/.test(s)),caliper=ancestry.some(s=>/^SUSP_(LF|RF|LR|RR)$/.test(s));
 for(const original of n.getMesh().listPrimitives()){
  const triangles=original.getIndices().getCount()/3;sourceTriangles+=triangles;
  // Closed hood: do not submit the invisible 55k-triangle engine every frame.
  if(ancestry.includes('Engine')||ancestry.includes('Hood_Engine')){omittedTriangles+=triangles;continue;}
  const p=original.clone();for(const semantic of p.listSemantics())p.setAttribute(semantic,p.getAttribute(semantic).clone());p.setIndices(p.getIndices().clone());
  transformPrimitive(p,n.getWorldMatrix());
  let assembly='body';const pos=p.getAttribute('POSITION'),box=new T.Box3();
  for(let i=0;i<pos.getCount();i++)box.expandByPoint(new T.Vector3().fromArray(pos.getElement(i,[])));
  const center=box.getCenter(new T.Vector3());
  if(wheel||caliper){
   // Some source rear rim parts are parented to WHEEL_RF. Route by physical
   // position, not that incorrect source parent, to prevent tumbling duplicates.
   const id=(center.z>0?'F':'R')+(center.x>0?'L':'R');assembly=(wheel?'wheel_':'caliper_')+id;
   const h=hubs[id];transformPrimitive(p,new T.Matrix4().makeTranslation(-h[0],-h[1],-h[2]).toArray());
  }else transformPrimitive(p,new T.Matrix4().makeTranslation(0,-.079745,-.24585).toArray());
  assemblies.get(assembly).addPrimitive(p);
 }
}
for(const n of oldNodes)n.dispose();for(const s of oldScenes)s.dispose();
// The exporter lost most shader settings. Assign explicit authored materials;
// never infer body paint from generic wheel materials containing "paint".
for(const m of root.listMaterials()){
 const name=m.getName();m.setDoubleSided(false);
 if(name==='0.005'){m.setName('G90_carpaint').setBaseColorFactor([.014,.105,.18,1]).setMetallicFactor(.7).setRoughnessFactor(.23);}
 else if(name==='window'||name==='glass_int'){m.setBaseColorFactor([.1,.15,.19,.36]).setAlphaMode('BLEND').setRoughnessFactor(.09).setMetallicFactor(.1).setDoubleSided(true);}
 else if(name==='glass_red'){m.setBaseColorFactor([.65,.012,.022,1]).setEmissiveFactor([.45,.002,.006]).setRoughnessFactor(.18);}
 else if(/lights|CSR2_Light/i.test(name)){m.setRoughnessFactor(.18).setEmissiveFactor([.35,.38,.42]);if(m.getBaseColorTexture())m.setEmissiveTexture(m.getBaseColorTexture());}
 else if(/metalicpaint|chrome|rotor|Brake_Disk|screw|brass/.test(name)){m.setMetallicFactor(.88).setRoughnessFactor(.28);}
 else if(name==='paint_orange_D72A03FF'){m.setBaseColorTexture(null).setBaseColorFactor([.12,.14,.16,1]).setMetallicFactor(.9).setRoughnessFactor(.24);}
 else if(name==='0.002'||name==='black1'){m.setBaseColorFactor([.009,.012,.015,1]).setRoughnessFactor(.55);}
 else if(name==='0.003'){m.setBaseColorFactor([.022,.025,.03,1]).setRoughnessFactor(.65);}
 if(name==='material')m.setDoubleSided(true);
}
await doc.transform(prune(),dedup(),join({keepMeshes:true}),textureCompress({encoder:sharp,targetFormat:'webp',quality:92}),draco({method:'edgebreaker',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:14}));
const dir=new URL('../dist/assets/g90/',import.meta.url);fs.mkdirSync(dir,{recursive:true});await io.write(new URL('bmw-m5-g90.glb',dir).pathname,doc);
const report={source:'https://sketchfab.com/3d-models/bmw-g90-m5-9dc9e5c88bec4faa94552fdd0b76ed21',author:'JUSTGAME',license:'CC-BY-4.0',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),sourceTriangles,omittedTriangles,renderTriangles:sourceTriangles-omittedTriangles,assemblies:root.listNodes().filter(n=>n.getMesh()).map(n=>({name:n.getName(),primitives:n.getMesh().listPrimitives().length})),bytes:fs.statSync(new URL('bmw-m5-g90.glb',dir)).size};
fs.writeFileSync(new URL('asset-info.json',dir),JSON.stringify(report,null,2)+'\n');console.log(report);
