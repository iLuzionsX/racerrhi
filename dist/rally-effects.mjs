import * as T from 'three';

// One bounded, pooled point draw. No downloaded sprites, per-frame allocations of
// render objects, post-processing, or fog-sized opaque clouds in front of the car.
export function createRallyDust(scene){
 const capacity=256,positions=new Float32Array(capacity*3),sizes=new Float32Array(capacity),opacity=new Float32Array(capacity),particles=Array.from({length:capacity},()=>({life:0,total:1,vx:0,vy:0,vz:0,size:0})),carry=new Map();
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('size',new T.BufferAttribute(sizes,1).setUsage(T.DynamicDrawUsage));geometry.setAttribute('opacity',new T.BufferAttribute(opacity,1).setUsage(T.DynamicDrawUsage));
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,fog:true,uniforms:T.UniformsUtils.merge([T.UniformsLib.fog,{pointScale:{value:350},dustColor:{value:new T.Color('#9b805d')}}]),vertexShader:`
  #include <common>
  #include <fog_pars_vertex>
  attribute float size;attribute float opacity;uniform float pointScale;varying float alpha;
  void main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;gl_PointSize=opacity>0.0?clamp(size*pointScale/max(1.0,-mvPosition.z),1.0,90.0):0.0;alpha=opacity;
  #include <fog_vertex>
  }`,fragmentShader:`
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 dustColor;varying float alpha;
  void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=dot(p,p);if(r>1.0||alpha<0.001)discard;float feather=(1.0-r)*(1.0-r);gl_FragColor=vec4(dustColor,alpha*feather);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  }`});
 const points=new T.Points(geometry,material);points.frustumCulled=false;points.renderOrder=2;points.visible=false;points.userData.excludeFromReflection=true;scene.add(points);
 let cursor=0,limit=capacity,seed=47,totalEmitted=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function reset(){for(const p of particles)p.life=0;opacity.fill(0);carry.clear();points.visible=false;geometry.attributes.opacity.needsUpdate=true;}
 return {
  object:points,reset,
  quality(value){limit=value==='high'?capacity:128;for(let i=limit;i<capacity;i++){particles[i].life=0;opacity[i]=0;}cursor%=limit;},
  update(dt,signal,car,viewportHeight,enabled=true){
   const step=Math.max(0,Math.min(.06,dt));material.uniforms.pointScale.value=viewportHeight*.85;
   if(enabled)for(const source of signal.sources){
    if(!source.position||source.rate<=0){carry.set(source.id,0);continue;}
    let amount=(carry.get(source.id)||0)+source.rate*step*(limit/capacity);
    while(amount>=1){amount--;const i=cursor++%limit,p=particles[i],j=i*3;totalEmitted++;p.total=p.life=1.05+random()*.55;p.size=.25+random()*.25+source.scrub*.35;
     positions[j]=source.position.x+(random()-.5)*.22;positions[j+1]=source.position.y+.12;positions[j+2]=source.position.z+(random()-.5)*.22;
     const forwardX=Math.sin(car.heading),forwardZ=Math.cos(car.heading),travelSign=Math.sign(car.speed)||1;
     p.vx=-forwardX*travelSign*(.4+source.scrub*2)+(random()-.5)*.7;p.vz=-forwardZ*travelSign*(.4+source.scrub*2)+(random()-.5)*.7;p.vy=.28+random()*.3;
    }carry.set(source.id,amount);
   }
   let active=0;
   for(let i=0;i<capacity;i++){const p=particles[i];if(p.life<=0){opacity[i]=0;continue;}p.life=Math.max(0,p.life-step);const age=1-p.life/p.total,j=i*3;positions[j]+=p.vx*step;positions[j+1]+=p.vy*step;positions[j+2]+=p.vz*step;const drag=Math.exp(-step*1.3);p.vx*=drag;p.vz*=drag;p.vy*=Math.exp(-step*.35);sizes[i]=p.size+age*.85;opacity[i]=Math.min(1,age*8)*Math.max(0,1-age)*.22;active++;}
   for(const name of ['position','size','opacity'])geometry.attributes[name].needsUpdate=true;points.visible=active>0;
   return {active,capacity:limit,totalEmitted};
  },
  dispose(){scene.remove(points);geometry.dispose();material.dispose();}
 };
}

// Seeded filtered noise: the existing Sound preference and user-gesture audio
// unlock own this graph. Two voices distinguish rolling gravel from tyre scrub.
export function createGravelAudio(context){
 const buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=buffer.getChannelData(0);let seed=29,low=0;
 for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;low=.92*low+.08*white;data[i]=white*.35+low*1.4;}
 const nodes=[];
 function voice(type,frequency,q){const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.value=0;source.connect(filter).connect(gain).connect(context.destination);source.start();nodes.push(source,filter,gain);return {source,filter,gain};}
 const roll=voice('lowpass',1050,.5),scrub=voice('bandpass',1700,.65);
 return {update(signal,speed,enabled){const now=context.currentTime;roll.gain.gain.setTargetAtTime(enabled?Math.min(.085,signal.rolling*.085):0,now,.055);scrub.gain.gain.setTargetAtTime(enabled?Math.min(.075,signal.scrub*.075):0,now,.04);roll.filter.frequency.setTargetAtTime(550+Math.min(35,Math.abs(speed))*32,now,.1);scrub.filter.frequency.setTargetAtTime(1200+signal.scrub*1200,now,.06);roll.source.playbackRate.setTargetAtTime(.8+Math.min(35,Math.abs(speed))*.018,now,.1);},dispose(){roll.source.stop();scrub.source.stop();for(const node of nodes)node.disconnect();}};
}
