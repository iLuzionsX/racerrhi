import assert from 'node:assert/strict';
import * as T from 'three';
import {sampleRallyFeedback,createRallyFeedback} from '../dist/rally-feedback.mjs';
import {createRallyDust,createGravelAudio} from '../dist/rally-effects.mjs';
const car={speed:16,heading:0,wheels:['FL','FR','RL','RR'].map((id,i)=>({id,isFront:i<2,surfaceType:'gravel',surfaceLooseness:.5,normalLoadN:6000,contactState:'contact',wheelSpeedMs:16,slipRatio:.02,slipAngleRad:.02,groundContactPos:{x:i%2?1:-1,y:0,z:i<2?1.5:-1.5},damperForceN:i<2?3000:-2000}))};
const copy=()=>structuredClone(car),zero=sample=>{assert.equal(sample.rolling,0);assert.equal(sample.scrub,0);assert(sample.sources.every(s=>s.rate===0));};
let c=copy();c.speed=0;c.wheels.forEach(w=>w.wheelSpeedMs=0);zero(sampleRallyFeedback(c));
c=copy();c.wheels.forEach(w=>w.surfaceType='asphalt');zero(sampleRallyFeedback(c));
c=copy();c.wheels.forEach(w=>{w.contactState='airborne';w.normalLoadN=0;w.slipRatio=1;});zero(sampleRallyFeedback(c));
const rolling=sampleRallyFeedback(car);c=copy();c.wheels.forEach(w=>{w.slipRatio=.4;w.slipAngleRad=.25;});const sliding=sampleRallyFeedback(c);assert(sliding.scrub>rolling.scrub);assert(sliding.sources[0].rate>rolling.sources[0].rate*2);
const before=JSON.stringify(car);for(const hz of [30,60,120]){const filter=createRallyFeedback();let out;for(let i=0;i<hz;i++)out=filter.update(car,1/hz);assert(Math.abs(out.cameraHeaveM-rolling.cameraHeaveM*(1-Math.exp(-8)))<1e-9);assert(Math.abs(out.cameraHeaveM)<=.024);assert(Math.abs(out.cameraPitchRad)<=.004);filter.reset();zero(filter.update({speed:0,wheels:[]},1/hz));}assert.equal(JSON.stringify(car),before,'feedback changed physical state');
const scene=new T.Scene(),dust=createRallyDust(scene);let stats;
for(let i=0;i<600;i++)stats=dust.update(1/60,sliding,car,540);assert(stats.active>0&&stats.active<=256);assert.equal(scene.children.length,1);const opacityVersion=dust.object.geometry.attributes.opacity.version;dust.quality('balanced');assert(dust.object.geometry.attributes.opacity.version>opacityVersion,'paused quality switch did not upload reduced particle visibility');for(let i=0;i<180;i++)stats=dust.update(1/60,sliding,car,540);assert(stats.active<=128);assert.equal(stats.capacity,128);
for(let i=0;i<180;i++)stats=dust.update(1/60,{sources:[]},car,540,false);assert.equal(stats.active,0);dust.reset();assert.equal(dust.object.visible,false);dust.dispose();assert.equal(scene.children.length,0);
// Audio scheduling/muting contract; actual WebAudio/WebGL are checked in CI.
const gains=[],parameter=()=>({value:0,setTargetAtTime(v){this.value=v;}}),node=()=>({connect(){return this;},disconnect(){}}),ctx={currentTime:0,sampleRate:8000,createBuffer:(_,length)=>({getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>({...node(),playbackRate:parameter(),start(){},stop(){}}),createBiquadFilter:()=>({...node(),frequency:parameter(),Q:parameter()}),createGain:()=>{const gain={...node(),gain:parameter()};gains.push(gain);return gain;},destination:{}};
const audio=createGravelAudio(ctx);audio.update(sliding,16,true);assert(gains.every(g=>g.gain.value>0&&g.gain.value<.1));audio.update(sliding,16,false);assert(gains.every(g=>g.gain.value===0));audio.dispose();
console.log(JSON.stringify({status:'passed',rolling:rolling.rolling,sliding:sliding.scrub,cameraHeaveM:rolling.cameraHeaveM,cameraPitchRad:rolling.cameraPitchRad,dustPool:256,balancedPool:128}));
