// Presentation-only signals: never fed back into tyres, controls or chassis forces.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
export function sampleRallyFeedback(car){
 const speed=Math.abs(car.speed||0),motion=clamp((speed-.6)/4),sources=[];
 let rolling=0,scrub=0,frontDamper=0,rearDamper=0,coverage=0;
 for(const w of car.wheels||[]){
  const dirt=w.surfaceType==='gravel'&&w.contactState==='contact'&&w.normalLoadN>50;
  const loose=clamp(w.surfaceLooseness),load=clamp(w.normalLoadN/6000,0,1.8);
  // Convert slip to a contact-speed proxy, with the small elastic adhesion band
  // removed. Slow stationary steering must not emit a plume or gravel roar.
  const slipSpeed=Math.hypot(Math.max(0,Math.abs(w.slipRatio||0)-.035)*Math.max(speed,Math.abs(w.wheelSpeedMs||0)),Math.max(0,Math.abs(w.slipAngleRad||0)-.025)*speed);
  const contactMotion=clamp((Math.max(speed,Math.abs(w.wheelSpeedMs||0))-.6)/4);
  const roll=dirt?motion*clamp(speed/26)*Math.sqrt(load)*(.35+.65*loose):0;
  const shear=dirt?contactMotion*clamp(slipSpeed/8)*Math.sqrt(load):0;
  const rate=dirt?(roll*7+shear*25):0;
  sources.push({id:w.id,rate,rolling:roll,scrub:shear,slipSpeedMs:slipSpeed,position:w.groundContactPos,looseness:loose});
  rolling+=roll*.25;scrub+=shear*.25;
  if(dirt){coverage+=.25;if(w.isFront)frontDamper+=clamp(w.damperForceN,-12000,12000)*.5;else rearDamper+=clamp(w.damperForceN,-12000,12000)*.5;}
 }
 return {sources,rolling,scrub,coverage,cameraHeaveM:Math.tanh((frontDamper+rearDamper)/7000)*.024*motion,cameraPitchRad:Math.tanh((rearDamper-frontDamper)/7000)*.004*motion};
}

export function createRallyFeedback(){
 let rolling=0,scrub=0,heave=0,pitch=0;
 return {
  reset(){rolling=scrub=heave=pitch=0;},
  update(car,dt,enabled=true){
   const raw=sampleRallyFeedback(enabled?car:{speed:0,wheels:[]}),step=clamp(dt,0,.1),audioAlpha=1-Math.exp(-step*10),cameraAlpha=1-Math.exp(-step*8);
   rolling+=(raw.rolling-rolling)*audioAlpha;scrub+=(raw.scrub-scrub)*audioAlpha;heave+=(raw.cameraHeaveM-heave)*cameraAlpha;pitch+=(raw.cameraPitchRad-pitch)*cameraAlpha;
   return {...raw,rolling,scrub,cameraHeaveM:heave,cameraPitchRad:pitch};
  }
 };
}
