import fs from 'node:fs';
import * as T from 'three';
import {createRallyRoute,rallyEntrance} from '../dist/rally-route.mjs';
import {nearestRoadProjection} from '../dist/road-projection.mjs';
import {stepCar,resolveBoundaryContact} from './m5-bridge';

// Execute the shipped gameplay integration and terrain functions, not a second
// approximation which could omit the circuit boundary correction.
export function rallyGameplayFixture(){
 const game=fs.readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
 const pointSource=game.match(/const points=\[(.*?)\];/)![1];
 const points=[...pointSource.matchAll(/V\(([^)]+)\)/g)].map(m=>new T.Vector3(...m[1].split(',').map(Number) as [number,number,number]));
 const curve=new T.CatmullRomCurve3(points,true,'centripetal');curve.arcLengthDivisions=4000;
 const samples=Array.from({length:1400},(_,i)=>({p:curve.getPointAt(i/1400),d:curve.getTangentAt(i/1400).normalize()}));
 const rally=createRallyRoute(),clamp=T.MathUtils.clamp;
 function nearest(x:number,z:number,stride=1){const {index,fraction}=nearestRoadProjection(samples,x,z,stride),a=samples[index],b=samples[(index+1)%samples.length],p=a.p.clone().lerp(b.p,fraction),d=a.d.clone().lerp(b.d,fraction).normalize(),n=new T.Vector3(d.z,0,-d.x).normalize();return {p,d,n,t:(index+fraction)/samples.length,distance:Math.hypot(x-p.x,z-p.z),side:(x-p.x)*n.x+(z-p.z)*n.z};}
 const terrainSource=game.slice(game.indexOf('function baseGround('),game.indexOf('const rallyVisual='));
 const ground=new Function('nearest','rally','T','clamp',terrainSource+';return ground;')(nearest,rally,T,clamp);
 const sample=(x:number,z:number)=>rally.surface(x,z,nearest(x,z),ground);
 const start=game.indexOf('  lastRoad=',game.indexOf('  const input={',game.indexOf('function simulate(')));
 const end=game.indexOf('  if(lastRoad.rally)lap.valid=false;',start);
 if(start<0||end<start)throw Error('Unable to locate actual gameplay physics block');
 const tick=new Function('state','input','dt','nearest','drivingSurface','stepCar','resolveBoundaryContact','rallyEntrance','let lastRoad,lap={valid:true};\n'+game.slice(start,end)+'\nreturn {road:lastRoad,lap};');
 return {game,rally,samples,nearest,ground,sample,tick:(state:any,input:any,dt:number)=>tick(state,input,dt,nearest,sample,stepCar,resolveBoundaryContact,rallyEntrance)};
}
