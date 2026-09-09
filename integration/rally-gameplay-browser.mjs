import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
let url=process.env.RACERRHI_SMOKE_URL,server;
if(url&&!url.startsWith('https://'))throw Error('Public rally browser check requires HTTPS');
if(!url){
 const root=path.resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'};
 server=http.createServer((req,res)=>{const file=path.resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port+'/';
}
const hook=`
globalThis.__rallyGameplay={
 seed(){mode='drive';session='practice';paused=true;countdown=0;lap=resetLap();keys.clear();clearInput();rallyDust.reset();rallyFeedback.reset();state=newCar(-182,-194,Math.PI/2);testSetCarPose(state,-182,-194,Math.PI/2,8);lastRoad=drivingSurface(state.x,state.z);beginLapReward(true);$('intro').hidden=true;$('hud').hidden=false;$('mode').textContent='FREE PRACTICE';document.body.classList.add('playing');sessionVisible(true);camera.position.set(-192,18,-194);lastCameraTarget.set(-175,14,-194);camera.lookAt(lastCameraTarget);resetM5StepScheduler(physicsClock);renderPrevious=renderCurrent=captureM5RenderSnapshot(state);},
 advance(count){let maxStep=0,contacts=0,dust;const sim=state._m5,startX=state.x;for(let i=0;i<count;i++){const x=state.x,z=state.z;simulate(M5_FIXED_DT);feedbackSignal=rallyFeedback.update(state,M5_FIXED_DT,true);dust=rallyDust.update(M5_FIXED_DT,feedbackSignal,state,renderer.domElement.height,true);maxStep=Math.max(maxStep,Math.hypot(state.x-x,state.z-z));if(state.boundaryContact.active)contacts++;}renderPrevious=renderCurrent=captureM5RenderSnapshot(state);return {x:state.x,z:state.z,startX,maxStep,contacts,rally:lastRoad.rally,sameSimulation:sim===state._m5,stepCount:sim.stepCount,speed:state.speed,loads:state.wheels.map(w=>w.normalLoadN),looseness:state.wheels.map(w=>w.surfaceLooseness),steer:state.steer,feedback:{rolling:feedbackSignal.rolling,scrub:feedbackSignal.scrub,cameraHeaveM:feedbackSignal.cameraHeaveM,dust}};},
 resume(){paused=false;prev=performance.now();},
 freezeWhenRendered(){if(Math.hypot(car.position.x-state.x,car.position.z-state.z)<1){paused=true;const f=V(Math.sin(state.heading),0,Math.cos(state.heading));camera.position.copy(car.position).addScaledVector(f,-9).add(V(0,4,0));lastCameraTarget.copy(car.position).addScaledVector(f,5).add(V(0,1,0));camera.lookAt(lastCameraTarget);return true;}return false;},
 freeze(){paused=true;return {x:state.x,z:state.z,rally:lastRoad.rally,carX:car.position.x,carZ:car.position.z};},
 audioStatus(){return {enabled:audioOn,contextState:audioCtx?.state,graph:!!gravelAudio};},
 async audioRender(enabled){const context=new OfflineAudioContext(1,24000,24000),sound=createGravelAudio(context);sound.update(feedbackSignal,state.speed,enabled);const rendered=await context.startRendering(),samples=rendered.getChannelData(0);let energy=0;for(const sample of samples)energy+=sample*sample;return Math.sqrt(energy/samples.length);}
};`;
const browser=await chromium.launch({headless:false,args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1,hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{globalThis.__racerrhiDiagnostics={};localStorage.setItem('apex-controls-v2',JSON.stringify({quality:'high',show:true,sound:false}));});
 await page.route('**/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:"import {setCarPose as testSetCarPose} from './physics.mjs?v=5';\n"+await response.text()+hook});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__rallyGameplay&&!document.getElementById('drive').disabled,null,{timeout:90000});
 const build=process.env.RACERRHI_EXPECTED_COMMIT?await page.evaluate(async()=>await (await fetch('./build-info.json',{cache:'no-store'})).json()):{commit:'local-ci'};
 if(process.env.RACERRHI_EXPECTED_COMMIT)assert.equal(build.commit,process.env.RACERRHI_EXPECTED_COMMIT);
 await page.evaluate(()=>globalThis.__rallyGameplay.seed());
 await page.keyboard.down('w');
 const entry=await page.evaluate(()=>globalThis.__rallyGameplay.advance(180));
 await page.keyboard.up('w');
 assert(entry.x>-170,'car did not drive past entrance');assert(entry.maxStep<.3,'car jumped back toward the circuit');assert.equal(entry.contacts,0);assert(entry.rally&&entry.sameSimulation);assert(entry.loads.every(Number.isFinite));
 assert(entry.feedback.dust.active>0&&entry.feedback.rolling>0,'driven dirt produced no feedback');assert(entry.looseness.every(x=>x>0));assert(Math.abs(entry.feedback.cameraHeaveM)<=.024);
 await page.evaluate(()=>globalThis.__rallyGameplay.resume());
 await page.waitForFunction(()=>globalThis.__rallyGameplay.freezeWhenRendered(),null,{timeout:30000});
 const rendered=await page.evaluate(()=>globalThis.__rallyGameplay.freeze());
 assert(Math.abs(rendered.x-rendered.carX)<1&&Math.abs(rendered.z-rendered.carZ)<1,'visual chassis did not follow rally physics');
 assert.equal(await page.locator('#surface').textContent(),'RALLY LOOP · DIRT / GRAVEL');
 fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/rally-gameplay-entry.png',timeout:90000});
 // Trusted, simultaneous multi-touch on the actual dirt route, then release and
 // keyboard handoff. UI events are not replaced with direct physics inputs.
 await page.evaluate(()=>globalThis.__rallyGameplay.seed());
 const client=await page.context().newCDPSession(page),wheel=await page.locator('#wheel').boundingBox(),gas=await page.locator('#gas').boundingBox();assert(wheel&&gas);
 const point=(id,x,y)=>({id,x,y,radiusX:3,radiusY:3,force:1}),w=point(1,wheel.x+wheel.width*.5,wheel.y+wheel.height*.5),g=point(2,gas.x+gas.width*.5,gas.y+gas.height*.5);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[w]});
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[w,g]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...w,x:w.x+wheel.width*.08},g]});
 const touch=await page.evaluate(()=>({run:globalThis.__rallyGameplay.advance(60),input:globalThis.__racerrhiDiagnostics.lastPhysicsInput}));
 assert(touch.input.analogSteerActive&&touch.input.throttle===1&&Math.abs(touch.run.steer)>.01,'touch steering/throttle did not reach dirt physics');assert(touch.run.contacts===0&&touch.run.rally);
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.keyboard.down('a');const handoff=await page.evaluate(()=>{globalThis.__rallyGameplay.advance(24);return globalThis.__racerrhiDiagnostics.lastPhysicsInput;});await page.keyboard.up('a');assert(!handoff.analogSteerActive&&handoff.digitalSteerDirection===1&&handoff.throttle===0);
 const released=await page.evaluate(()=>{globalThis.__rallyGameplay.advance(30);return globalThis.__racerrhiDiagnostics.lastPhysicsInput;});assert(!released.analogSteerActive&&released.digitalSteerDirection===0&&released.throttle===0);
 await page.evaluate(()=>{const q=document.getElementById('quality');q.value='balanced';q.dispatchEvent(new Event('change',{bubbles:true}));});const balanced=await page.evaluate(()=>globalThis.__rallyGameplay.advance(1));assert.equal(balanced.feedback.dust.capacity,128);
 // Create the real WebAudio graph from a user-gesture click. No auto-playing audio.
 await page.locator('#settings-button').count().then(async count=>{if(count)await page.locator('#settings-button').click();else await page.evaluate(()=>document.getElementById('settings').showModal());});
 await page.locator('#engine-sound').check();
 await page.waitForFunction(()=>globalThis.__rallyGameplay.audioStatus().contextState==='running',null,{timeout:10000});
 const audio=await page.evaluate(()=>globalThis.__rallyGameplay.audioStatus());assert(audio.enabled&&audio.graph);
 audio.rms=await page.evaluate(()=>globalThis.__rallyGameplay.audioRender(true));audio.mutedRms=await page.evaluate(()=>globalThis.__rallyGameplay.audioRender(false));assert(audio.rms>1e-5&&audio.rms<.15);assert.equal(audio.mutedRms,0);
 await page.locator('#engine-sound').uncheck();await page.locator('#close-settings').click();
 assert.equal((await page.evaluate(()=>globalThis.__rallyGameplay.audioStatus())).enabled,false);
 assert.deepEqual(errors,[]);const report={status:'passed',url,build,entry,rendered,touch,handoff,released,balanced:balanced.feedback,audio,errors,renderer:'SwiftShader software WebGL; not hardware performance'};fs.writeFileSync('artifacts/rally-gameplay-public.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
