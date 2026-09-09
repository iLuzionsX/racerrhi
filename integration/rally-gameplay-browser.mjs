import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.RACERRHI_SMOKE_URL;
if(!url?.startsWith('https://'))throw Error('Rally browser check requires deployed HTTPS preview');
const hook=`
globalThis.__rallyGameplay={
 seed(){mode='drive';session='practice';paused=true;countdown=0;lap=resetLap();keys.clear();clearInput();state=newCar(-182,-194,Math.PI/2);testSetCarPose(state,-182,-194,Math.PI/2,8);lastRoad=drivingSurface(state.x,state.z);beginLapReward(true);$('intro').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');resetM5StepScheduler(physicsClock);renderPrevious=renderCurrent=captureM5RenderSnapshot(state);},
 advance(count){let maxStep=0,contacts=0;const sim=state._m5,startX=state.x;for(let i=0;i<count;i++){const x=state.x,z=state.z;simulate(M5_FIXED_DT);maxStep=Math.max(maxStep,Math.hypot(state.x-x,state.z-z));if(state.boundaryContact.active)contacts++;}renderPrevious=renderCurrent=captureM5RenderSnapshot(state);return {x:state.x,z:state.z,startX,maxStep,contacts,rally:lastRoad.rally,sameSimulation:sim===state._m5,stepCount:sim.stepCount,speed:state.speed,loads:state.wheels.map(w=>w.normalLoadN)};},
 resume(){paused=false;prev=performance.now();},
 freezeWhenRendered(){if(Math.hypot(car.position.x-state.x,car.position.z-state.z)<1){paused=true;return true;}return false;},
 freeze(){paused=true;return {x:state.x,z:state.z,rally:lastRoad.rally,carX:car.position.x,carZ:car.position.z};}
};`;
const browser=await chromium.launch({headless:false,args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:"import {setCarPose as testSetCarPose} from './physics.mjs?v=4';\n"+await response.text()+hook});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__rallyGameplay&&!document.getElementById('drive').disabled,null,{timeout:90000});
 const build=await page.evaluate(async()=>await (await fetch('./build-info.json',{cache:'no-store'})).json());
 assert.equal(build.commit,process.env.RACERRHI_EXPECTED_COMMIT);
 await page.evaluate(()=>globalThis.__rallyGameplay.seed());
 await page.keyboard.down('w');
 const entry=await page.evaluate(()=>globalThis.__rallyGameplay.advance(180));
 await page.keyboard.up('w');
 assert(entry.x>-170,'car did not drive past entrance');assert(entry.maxStep<.3,'car jumped back toward the circuit');assert.equal(entry.contacts,0);assert(entry.rally&&entry.sameSimulation);assert(entry.loads.every(Number.isFinite));
 await page.evaluate(()=>globalThis.__rallyGameplay.resume());
 await page.waitForFunction(()=>globalThis.__rallyGameplay.freezeWhenRendered(),null,{timeout:30000});
 const rendered=await page.evaluate(()=>globalThis.__rallyGameplay.freeze());
 assert(Math.abs(rendered.x-rendered.carX)<1&&Math.abs(rendered.z-rendered.carZ)<1,'visual chassis did not follow rally physics');
 assert.equal(await page.locator('#surface').textContent(),'RALLY LOOP · DIRT / GRAVEL');
 fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/rally-gameplay-entry.png',timeout:90000});
 assert.deepEqual(errors,[]);const report={status:'passed',url,build,entry,rendered,errors,renderer:'SwiftShader software WebGL; not hardware performance'};fs.writeFileSync('artifacts/rally-gameplay-public.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
