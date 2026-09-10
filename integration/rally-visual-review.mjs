// CI-only matching-camera review. The hook is injected by this local HTTP server,
// never shipped to players or enabled on the public game.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
const root=process.cwd();
const hook=`
globalThis.__reviewPose=(view)=>{
 paused=true;mode='drive';countdown=0;$('intro').hidden=true;$('loading').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');
 // Match actual drawing-buffer resolution, not just CSS viewport and quality.
 graphicsScale=1;graphicsTuneAt=Infinity;renderer.setPixelRatio(1);
 const p=nearest(-225,-191).p;car.position.set(-225,p.y+.035,-191);car.rotation.set(0,0,0);body.rotation.set(0,0,0);
 wheels.forEach(w=>{const id=w.userData.id;w.position.set(id.endsWith('L')?(id.startsWith('F')?.842:.830):(id.startsWith('F')?-.842:-.830),.334,id.startsWith('F')?1.367:-1.638);w.rotation.set(0,0,0);w.userData.spinPivot.rotation.set(0,0,0);});
 const poses={close:[[8,3,7],[0,1,0]],rear:[[3.6,1.8,-6],[0,.8,-.7]],chase:[[0,3.7,-10],[0,1,11]],trackside:[[38,20,-32],[14,2,12]],rally:[[180,230,-140],[185,15,200]],dirt:[[0,3.5,-9],[0,1,10]]};
 if(view==='dirt'){
  const a=rally.paths[1].samples[65];car.position.set(a.p.x,rally.roadHeight(a.p.x,a.p.z)+.035,a.p.z);car.rotation.y=Math.atan2(a.d.x,a.d.z);body.rotation.x=-Math.atan2(a.d.y,Math.hypot(a.d.x,a.d.z));
  // Stage each wheel against its own point on the grade, not one horizontal
  // axle plane; otherwise the review itself would create floating rear tyres.
  for(const w of wheels){const p=w.position.clone().applyAxisAngle(V(0,1,0),car.rotation.y).add(car.position),road=drivingSurface(p.x,p.z);w.position.y=wheelVisualHubY(road.p.y+.349,road,car.rotation.y)-car.position.y;}
 }
 const [eye,aim]=poses[view],rotation=car.rotation.y;camera.position.copy(car.position).add(V(...eye).applyAxisAngle(V(0,1,0),rotation));camera.lookAt(car.position.clone().add(V(...aim).applyAxisAngle(V(0,1,0),rotation)));camera.fov=48;camera.updateProjectionMatrix();
 sunlight.target.position.copy(car.position);sunlight.position.copy(car.position).addScaledVector(sunDir,120);scene.updateMatrixWorld(true);reflections.update(performance.now()/1000+2);renderer.render(scene,camera);
 const widths=wheels.map(w=>{const b=new T.Box3().setFromObject(w.userData.spinPivot.children[0]);return {id:w.userData.id,width:b.max.x-b.min.x};});
 return {triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,drawingBuffer:[renderer.domElement.width,renderer.domElement.height],widths};
};`;
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean),variant=parts.shift();
 const base=path.join(root,variant==='before'?'baseline/dist':'dist'),file=path.resolve(base,parts.join('/')||'index.html');
 if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(file.endsWith('/game.js')?data.toString()+hook:data);});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:false,args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
fs.mkdirSync('artifacts/rally-review',{recursive:true});const report={renderer:'GitHub Actions Chromium SwiftShader software rendering; not device FPS',views:{}};
try{
 for(const variant of ['before','after']){
  const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});const start=Date.now();
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+variant+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(globalThis.__reviewPose)&&!document.getElementById('drive').disabled,null,{timeout:90000});
  const loadMs=Date.now()-start;
  await page.evaluate(()=>{const q=document.getElementById('quality');q.value='high';q.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(8000);
  report.views[variant]={loadMs,views:{}};
  for(const view of ['close','rear','chase','trackside','rally','dirt']){
   const stats=await page.evaluate(v=>globalThis.__reviewPose(v),view);
   await page.screenshot({path:'artifacts/rally-review/'+variant+'-'+view+'.png',timeout:90000});
   report.views[variant].views[view]=stats;
   if(variant==='after'&&view==='rear')for(const wheel of stats.widths){const expected=wheel.id.startsWith('F')?.285:.295;if(Math.abs(wheel.width-expected)>.001)throw Error('Actual loaded wheel width is wrong: '+JSON.stringify(wheel));}
  }
  report.views[variant].frameTimes=await page.evaluate(()=>new Promise(resolve=>{let last=performance.now(),values=[];const tick=now=>{values.push(now-last);last=now;if(values.length<10)requestAnimationFrame(tick);else{values.sort((a,b)=>a-b);resolve({meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)],view:'dirt',samples:values.length});}};requestAnimationFrame(tick);}));
  report.views[variant].transferBytes=await page.evaluate(()=>performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.transferSize,0));
  if(errors.length)throw Error(variant+' browser errors: '+errors.join(' | '));
  await context.close();
 }
 fs.writeFileSync('artifacts/rally-review/metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
