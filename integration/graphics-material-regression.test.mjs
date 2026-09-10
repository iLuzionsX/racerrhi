import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MeshStandardMaterial,ShaderLib,Scene,Object3D,DirectionalLight,Vector3,Texture,WebGLCoordinateSystem} from 'three';
import {foliageMaterial} from '../dist/visuals.js';
import {localReflections} from '../dist/graphics.mjs';
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
 assert(!/\bpatch\s*=/.test(shader.fragmentShader),'patch is a reserved GLSL identifier');
}
for(const id of ['FL','FR','RL','RR']){
 const min=[-.184,-.368,-.366],max=[.180,.369,.366],fit=g90WheelFitment(id,min,max);
 const lo=min.map((v,i)=>v*fit.scale[i]+fit.offset[i]),hi=max.map((v,i)=>v*fit.scale[i]+fit.offset[i]);
 assert(Math.abs((hi[0]-lo[0])-(id.startsWith('F')?.285:.295))<1e-12);
 assert(Math.abs(Math.max(hi[1]-lo[1],hi[2]-lo[2])-.738)<1e-12);
 assert(lo.every((v,i)=>Math.abs(v+hi[i])<1e-12),'wheel is not centred on its hub');
}
const game=fs.readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
const qualitySource=game.slice(game.indexOf('function quality()'),game.indexOf("addEventListener('apex:command'"));
assert(game.indexOf('let graphicsFrameMs=')<game.indexOf('function quality()'),'adaptive state must exist before startup quality()');
for(const mobile of [false,true])for(const value of ['balanced','high'])for(const scale of [1,.78,.68]){
 let dpr=0;const noop=()=>{},scope={mobile,config:{quality:value},graphicsScale:scale,devicePixelRatio:2,renderer:{setPixelRatio:n=>dpr=n},sunlight:{shadow:{mapSize:{setScalar:noop},map:null}},rallyDust:{quality:noop},environmentQuality:noop,rallyVisual:{quality:noop},reflections:null,trackDetailQuality:noop,runoffQualityReady:false};
 new Function(...Object.keys(scope),qualitySource+';quality();')(...Object.values(scope));
 const target=value==='high'?(mobile?1.5:1.65):(mobile?1.25:1.5);
 assert.equal(dpr,target*scale,'settings lost the current adaptive resolution cap');
}
const canopy=foliageMaterial(null),canopyShader={fragmentShader:ShaderLib.standard.fragmentShader};canopy.onBeforeCompile(canopyShader);
assert(canopyShader.fragmentShader.includes('normal=normalize(normal*.65+'));
const scene=new Scene(),car=new Object3D(),paint=new MeshStandardMaterial();
scene.userData.sunLight=new DirectionalLight();scene.userData.sunDirection=new Vector3(1,1,1).normalize();
let faces=0;const renderer={coordinateSystem:WebGLCoordinateSystem,xr:{enabled:false},getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:()=>{},render:()=>faces++};
const reflection=localReflections(renderer,scene,car,[paint]);reflection.update(0);assert.equal(faces,6);
const balanced=paint.envMap;reflection.quality('balanced');reflection.update(2);
assert.equal(paint.envMap,balanced,'unchanged tier must retain its GPU target');assert.equal(faces,6,'stationary scene was recaptured');
car.rotation.y=1;reflection.update(4);assert.equal(faces,6,'rotation does not change a world-aligned probe');
car.position.x=1;reflection.update(5);assert.equal(faces,12,'movement must refresh reflections');
car.position.x=2;reflection.update(5.5);assert.equal(faces,12,'movement must respect the probe budget');
reflection.update(7);assert.equal(faces,18);
reflection.quality('high');assert.notEqual(paint.envMap,balanced);reflection.update(7.1);assert.equal(faces,24,'tier switch must force refresh');
scene.environment=new Texture();reflection.update(9);assert.equal(faces,30,'changed lighting must refresh');
console.log('PASS dry material shader, G90 fitment, canopy lighting, reflection cache and resolution contracts');
