import assert from 'node:assert/strict';
import {MeshStandardMaterial,ShaderLib} from 'three';
import {groundMaterial} from '../dist/ground-material.mjs';
import {g90WheelFitment} from '../dist/g90-fitment.mjs';

for(const kind of ['asphalt','soil','grass','rock']){
 const m=groundMaterial(new MeshStandardMaterial(),{kind,feather:kind==='soil'}),shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 m.onBeforeCompile(shader);
 assert.equal((shader.fragmentShader.match(/float roughnessFactor=/g)||[]).length,1,'replacement chunk must declare the factor consumed by physical lighting');
 assert(shader.fragmentShader.includes('roughnessFactor=max(roughnessFactor,'));
 assert(shader.vertexShader.includes('groundPosition=instanceMatrix*groundPosition'),'instanced rocks must use their actual world position');
 assert(!shader.fragmentShader.includes('#include <map_fragment>'));
 assert(shader.fragmentShader.includes('groundSample(map)'));
 assert(shader.fragmentShader.includes('nb.xy=nb.xy*groundRotation'));
}
for(const id of ['FL','FR','RL','RR']){
 const min=[-.184,-.368,-.366],max=[.180,.369,.366],fit=g90WheelFitment(id,min,max);
 const lo=min.map((v,i)=>v*fit.scale[i]+fit.offset[i]),hi=max.map((v,i)=>v*fit.scale[i]+fit.offset[i]);
 assert(Math.abs((hi[0]-lo[0])-(id.startsWith('F')?.285:.295))<1e-12);
 assert(Math.abs(Math.max(hi[1]-lo[1],hi[2]-lo[2])-.738)<1e-12);
 assert(lo.every((v,i)=>Math.abs(v+hi[i])<1e-12),'wheel is not centred on its hub');
}
console.log('PASS dry physical material shader contract and G90 assembly fitment');
