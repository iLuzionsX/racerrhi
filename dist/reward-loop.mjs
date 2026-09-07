export const SKILL_POINTS=Object.freeze({
  apex:220,
  sector:160,
  driftSave:260,
  nearMiss:180
});

export const CHALLENGES=Object.freeze({
  doubleClean:{id:'double-clean',label:'DOUBLE CLEAN',detail:'Apex and clean-sector score ×2'},
  ghostRival:{id:'ghost-rival',label:'GHOST RIVAL',detail:'Beat your best-lap trace'}
});

export function createRewardState(){
  return {
    score:0,
    displayScore:0,
    flow:0,
    multiplier:1,
    lastEvent:'',
    challenge:null,
    wallCooldown:0
  };
}

export function chooseChallenge({hasGhost=false,random=Math.random}={}){
  const pool=hasGhost?[CHALLENGES.doubleClean,CHALLENGES.ghostRival]:[CHALLENGES.doubleClean];
  const index=Math.max(0,Math.min(pool.length-1,Math.floor(random()*pool.length)));
  return pool[index];
}

export function multiplierForFlow(flow){
  return 1+Math.max(0,Math.min(100,flow))/50;
}

export function awardSkill(reward,kind,challenge=null){
  const base=SKILL_POINTS[kind]||0;
  if(!base)return 0;
  const cleanBonus=challenge?.id==='double-clean'&&(kind==='apex'||kind==='sector')?2:1;
  reward.multiplier=multiplierForFlow(reward.flow);
  const points=Math.round(base*cleanBonus*reward.multiplier);
  reward.score+=points;
  reward.flow=Math.min(100,reward.flow+(kind==='apex'?24:kind==='driftSave'?28:18));
  reward.multiplier=multiplierForFlow(reward.flow);
  reward.lastEvent=kind;
  return points;
}

export function stepFlow(reward,{dt=0,cleanDriving=false,wallContact=false}={}){
  reward.wallCooldown=Math.max(0,reward.wallCooldown-dt);
  if(wallContact&&reward.wallCooldown<=0){
    const broken=reward.flow>8;
    reward.flow=0;
    reward.multiplier=1;
    reward.wallCooldown=.8;
    return {broken};
  }
  if(cleanDriving)reward.flow=Math.min(100,reward.flow+dt*1.7);
  else reward.flow=Math.max(0,reward.flow-dt*2.8);
  reward.multiplier=multiplierForFlow(reward.flow);
  return {broken:false};
}

export function rollDisplayScore(reward,dt){
  const gap=reward.score-reward.displayScore;
  if(Math.abs(gap)<.5)reward.displayScore=reward.score;
  else reward.displayScore+=gap*(1-Math.exp(-Math.max(0,dt)*10));
  return Math.round(reward.displayScore);
}

export function formatScore(value){
  return String(Math.max(0,Math.round(value))).padStart(6,'0');
}

export function interpolateGhostTime(trace,progress){
  if(!Array.isArray(trace)||trace.length<2)return null;
  const p=Math.max(0,Math.min(1,progress));
  let lo=trace[0],hi=trace[trace.length-1];
  for(let i=1;i<trace.length;i++){
    if(trace[i].p>=p){hi=trace[i];lo=trace[i-1];break;}
  }
  const span=Math.max(1e-6,hi.p-lo.p);
  const f=Math.max(0,Math.min(1,(p-lo.p)/span));
  return lo.t+(hi.t-lo.t)*f;
}

export function ghostDelta(trace,progress,elapsed){
  const target=interpolateGhostTime(trace,progress);
  return target===null?null:elapsed-target;
}

export function formatDelta(delta){
  if(delta===null||!Number.isFinite(delta))return '—';
  const sign=delta<=0?'−':'+';
  return sign+Math.abs(delta).toFixed(3);
}
