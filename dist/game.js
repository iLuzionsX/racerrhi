import * as T from 'three';
import {GLTFLoader} from './assets/GLTFLoader.js';
import {DRACOLoader} from './assets/DRACOLoader.js';
import {clamp,wrapAngle,stepCar,newCar,advanceLap} from './physics.mjs';

const $=id=>document.getElementById(id),TAU=Math.PI*2,V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const mobile=matchMedia('(pointer:coarse)').matches;
const defaults={wheelX:17,wheelY:76,wheelScale:1,pedalX:87,pedalY:78,pedalScale:1,steerSensitivity:1,quality:mobile?'balanced':'high'};
let prefs={...defaults};
try{prefs={...defaults,...JSON.parse(localStorage.getItem('apex-settings-v2')||'{}')};}catch{}
const savePrefs=()=>{try{localStorage.setItem('apex-settings-v2',JSON.stringify(prefs));}catch{}};

let renderer;
try{
  renderer=new T.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance',alpha:false,stencil:false});
}catch(e){
  $('loadtext').textContent='This drive needs WebGL 2. Try a current browser with hardware acceleration enabled.';
  throw e;
}
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.06;

const scene=new T.Scene();
scene.fog=new T.FogExp2('#a6aaa0',.00112);
const camera=new T.PerspectiveCamera(48,innerWidth/innerHeight,.12,6500);

let seed=715;
const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const sunDir=V(-.78,.19,-.60).normalize();

const skyMat=new T.ShaderMaterial({
  side:T.BackSide,depthWrite:false,
  uniforms:{sun:{value:sunDir}},
  vertexShader:'varying vec3 pos;void main(){pos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`varying vec3 pos;uniform vec3 sun;
  void main(){
    vec3 d=normalize(pos);
    float h=clamp(d.y*.52+.5,0.,1.);
    vec3 zenith=vec3(.16,.31,.42);
    vec3 upper=vec3(.31,.49,.57);
    vec3 horizon=vec3(.83,.66,.48);
    vec3 low=vec3(.61,.60,.51);
    vec3 c=mix(low,horizon,smoothstep(.42,.53,h));
    c=mix(c,upper,smoothstep(.52,.70,h));
    c=mix(c,zenith,smoothstep(.72,1.,h));
    float sd=max(dot(d,sun),0.);
    c+=vec3(1.0,.49,.17)*pow(sd,13.)*.34;
    c+=vec3(2.7,1.75,.82)*pow(sd,110.)*.48;
    c+=vec3(8.0,5.0,2.2)*smoothstep(.9995,.99988,sd);
    gl_FragColor=vec4(c,1.);
  }`
});
scene.add(new T.Mesh(new T.SphereGeometry(4000,48,24),skyMat));

const envScene=new T.Scene();
envScene.add(new T.Mesh(new T.SphereGeometry(500,32,16),skyMat.clone()));
const pmrem=new T.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(envScene,.06,.1,1000).texture;
pmrem.dispose();

function radialTexture(stops,size=256){
  const c=document.createElement('canvas');c.width=c.height=size;
  const x=c.getContext('2d'),g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  for(const [p,col] of stops)g.addColorStop(p,col);
  x.fillStyle=g;x.fillRect(0,0,size,size);
  const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx;
}
const sunGlow=new T.Sprite(new T.SpriteMaterial({
  map:radialTexture([[0,'rgba(255,244,202,1)'],[.08,'rgba(255,209,130,.95)'],[.28,'rgba(255,150,73,.28)'],[1,'rgba(255,120,50,0)']]),
  transparent:true,depthWrite:false,blending:T.AdditiveBlending
}));
sunGlow.position.copy(sunDir).multiplyScalar(2600);sunGlow.scale.set(430,430,1);scene.add(sunGlow);

function cloudTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=256;const x=c.getContext('2d');
  for(let i=0;i<22;i++){
    const px=40+rand()*430,py=65+rand()*120,r=30+rand()*70;
    const g=x.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,'rgba(238,225,205,.34)');g.addColorStop(1,'rgba(238,225,205,0)');
    x.fillStyle=g;x.fillRect(px-r,py-r,r*2,r*2);
  }
  const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx;
}
const cloudTex=cloudTexture();
for(let i=0;i<11;i++){
  const s=new T.Sprite(new T.SpriteMaterial({map:cloudTex,transparent:true,opacity:.25+rand()*.22,depthWrite:false}));
  s.position.set(-900+rand()*2500,210+rand()*230,-1350+rand()*2700);s.scale.set(430+rand()*650,130+rand()*170,1);scene.add(s);
}

scene.add(new T.HemisphereLight('#dbe6e7','#4f5945',1.45));
const sunlight=new T.DirectionalLight('#ffd7a0',4.15);
sunlight.castShadow=true;
Object.assign(sunlight.shadow.camera,{left:-62,right:62,top:62,bottom:-62,near:1,far:300});
sunlight.shadow.bias=-.00012;sunlight.shadow.normalBias=.06;sunlight.shadow.radius=2;
scene.add(sunlight,sunlight.target);

function applyQuality(){
  const q=prefs.quality;
  const cap=q==='performance'?1:q==='balanced'?(mobile?1.35:1.65):(mobile?1.65:2.15);
  renderer.setPixelRatio(Math.min(devicePixelRatio,cap));
  const shadow=q==='performance'?1024:q==='balanced'?2048:(mobile?2048:4096);
  if(sunlight.shadow.mapSize.x!==shadow){
    sunlight.shadow.mapSize.set(shadow,shadow);
    if(sunlight.shadow.map){sunlight.shadow.map.dispose();sunlight.shadow.map=null;}
  }
}
applyQuality();

const mat=(color,roughness=.85,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
const terrainMat=mat('#6c7854',.98),rockMat=mat('#928b77',.94),dark=mat('#1c2928',.78,.05),concrete=mat('#aaa995',.92),metal=mat('#9ca7a3',.34,.78),white=mat('#e8e3d4',.82),red=mat('#a92c20',.75);
function mesh(geo,material,x=0,y=0,z=0){const m=new T.Mesh(geo,material);m.position.set(x,y,z);m.receiveShadow=true;scene.add(m);return m;}
function box(w,h,d,material,x,y,z,rotation=0){const m=mesh(new T.BoxGeometry(w,h,d),material,x,y,z);m.rotation.y=rotation;m.castShadow=true;return m;}

function surfaceTexture(kind,data=false){
  const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d'),im=x.createImageData(512,512);
  for(let i=0;i<im.data.length;i+=4){
    const n=rand(),grain=rand();
    let r,g,b;
    if(kind==='road'){const a=70+n*31+grain*8;r=a;g=a*1.015;b=a*1.02;}
    else if(kind==='roadData'){const a=105+n*70;r=g=b=a;}
    else{r=129+n*56;g=r*.91;b=r*.72;}
    im.data[i]=r;im.data[i+1]=g;im.data[i+2]=b;im.data[i+3]=255;
  }
  x.putImageData(im,0,0);
  if(kind==='road'){
    x.globalAlpha=.14;x.strokeStyle='#151818';x.lineWidth=1;
    for(let i=0;i<20;i++){x.beginPath();x.moveTo(rand()*512,rand()*512);x.lineTo(rand()*512,rand()*512);x.stroke();}
  }
  const tx=new T.CanvasTexture(c);tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
  if(!data)tx.colorSpace=T.SRGBColorSpace;
  return tx;
}
const roadMat=mat('#a1a4a0',.86);roadMat.map=surfaceTexture('road');roadMat.bumpMap=surfaceTexture('roadData',true);roadMat.bumpScale=.095;
const gravel=mat('#b5a486',.98);gravel.map=surfaceTexture('gravel');

const points=[V(-225,13,-200),V(-225,13,50),V(-185,16,245),V(-55,22,325),V(100,27,265),V(155,24,115),V(290,22,65),V(300,20,-65),V(170,18,-110),V(85,14,-225),V(185,11,-320),V(70,11,-385),V(-110,12,-345)];
const curve=new T.CatmullRomCurve3(points,true,'centripetal');curve.arcLengthDivisions=4000;
const length=curve.getLength(),N=1400;
$('length').textContent=(length/1000).toFixed(2);
const samples=Array.from({length:N},(_,i)=>{const t=i/N,p=curve.getPointAt(t),d=curve.getTangentAt(t).normalize(),n=V(d.z,0,-d.x).normalize();return {p,d,n,t};});
function at(t){t=((t%1)+1)%1;const i=t*N,a=samples[Math.floor(i)%N],b=samples[(Math.floor(i)+1)%N],f=i%1;return {p:a.p.clone().lerp(b.p,f),d:a.d.clone().lerp(b.d,f).normalize(),n:a.n.clone().lerp(b.n,f).normalize(),t};}
function nearest(x,z,stride=1){
  let best=Infinity,index=0;
  for(let i=0;i<N;i+=stride){const p=samples[i].p,d=(p.x-x)**2+(p.z-z)**2;if(d<best){best=d;index=i;}}
  const a=samples[index],b=samples[(index+1)%N];
  let u=clamp(((x-a.p.x)*(b.p.x-a.p.x)+(z-a.p.z)*(b.p.z-a.p.z))/Math.max(.01,(b.p.x-a.p.x)**2+(b.p.z-a.p.z)**2),0,1);
  if(stride>1)u=0;
  const p=a.p.clone().lerp(b.p,u),n=a.n.clone().lerp(b.n,u),dx=x-p.x,dz=z-p.z;
  return {p,n,d:a.d,t:(index+u)/N,distance:Math.hypot(dx,dz),side:dx*n.x+dz*n.z};
}
function ribbon(offset,width,material,height=.02,colorCurbs=false){
  const positions=[],uv=[],indices=[],colors=[];
  for(let i=0;i<=N;i++){
    const a=samples[i%N];
    for(const side of [-1,1]){
      const p=a.p.clone().addScaledVector(a.n,offset+side*width/2);
      positions.push(p.x,p.y+height,p.z);uv.push(side===-1?0:width/5,i*length/N/4.2);
      if(colorCurbs){const c=new T.Color(Math.floor(i*length/N/3.6)%2?'#eee8d8':'#ae3225');colors.push(c.r,c.g,c.b);}
    }
    if(i<N){const j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);
  if(colorCurbs){g.setAttribute('color',new T.Float32BufferAttribute(colors,3));material=mat('#ffffff',.78);material.vertexColors=true;}
  g.computeVertexNormals();return mesh(g,material);
}
ribbon(0,34,gravel,-.10);ribbon(0,15,roadMat);ribbon(-7.7,.92,white,.048,true);ribbon(7.7,.92,white,.048,true);ribbon(-7.19,.13,white,.061);ribbon(7.19,.13,white,.061);
const rubber=new T.MeshStandardMaterial({color:'#111615',transparent:true,opacity:.2,depthWrite:false,roughness:1});
ribbon(-1.15,.55,rubber,.038);ribbon(1.15,.55,rubber,.038);

function rail(offset,h){
  const ps=[],ix=[];
  for(let i=0;i<=N;i++){
    const a=samples[i%N],p=a.p.clone().addScaledVector(a.n,offset);
    ps.push(p.x,p.y+h-.13,p.z,p.x,p.y+h+.13,p.z);
    if(i<N){const j=i*2;ix.push(j,j+1,j+2,j+1,j+3,j+2);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setIndex(ix);g.computeVertexNormals();
  const m=metal.clone();m.side=T.DoubleSide;mesh(g,m);
}
const dummy=new T.Object3D();
for(const side of [-1,1]){
  for(const h of [.62,1.06])rail(side*16,h);
  const count=Math.floor(length/4.5),posts=new T.InstancedMesh(new T.BoxGeometry(.13,1.3,.13),metal,count);
  for(let i=0;i<count;i++){const a=at(i/count);dummy.position.copy(a.p).addScaledVector(a.n,side*16);dummy.position.y+=.58;dummy.rotation.y=Math.atan2(a.d.x,a.d.z);dummy.scale.set(1,1,1);dummy.updateMatrix();posts.setMatrixAt(i,dummy.matrix);}
  scene.add(posts);
}
const reflectorMat=new T.MeshStandardMaterial({color:'#f6d16d',emissive:'#b5771c',emissiveIntensity:1.7,roughness:.5});
const reflectorCount=Math.floor(length/11),reflectors=new T.InstancedMesh(new T.BoxGeometry(.22,.12,.05),reflectorMat,reflectorCount*2);
let ri=0;
for(const side of [-1,1])for(let i=0;i<reflectorCount;i++){
  const a=at(i/reflectorCount);dummy.position.copy(a.p).addScaledVector(a.n,side*15.86);dummy.position.y+=.92;dummy.rotation.y=Math.atan2(a.d.x,a.d.z);dummy.scale.set(1,1,1);dummy.updateMatrix();reflectors.setMatrixAt(ri++,dummy.matrix);
}
scene.add(reflectors);

const landGeo=new T.PlaneGeometry(1550,1550,150,150);landGeo.rotateX(-Math.PI/2);
const lp=landGeo.attributes.position,landColors=[];
function ground(x,z){
  let r=nearest(x,z,10);if(r.distance<60)r=nearest(x,z);
  const base=r.p.y-.68,dist=r.distance;
  let y=base+(Math.sin(x*.019)*Math.cos(z*.023)*4.2+Math.sin(z*.047)*1.15)*clamp((dist-23)/60,0,1);
  y+=Math.pow(Math.max(0,(x-310)/400),1.6)*110;y-=Math.max(0,(-x-275))*.37;
  return Math.max(-12,y);
}
for(let i=0;i<lp.count;i++){
  const x=lp.getX(i),z=lp.getZ(i);lp.setY(i,ground(x,z));
  const c=new T.Color().setHSL(.19+rand()*.024,.17+rand()*.13,.29+rand()*.105);landColors.push(c.r,c.g,c.b);
}
landGeo.setAttribute('color',new T.Float32BufferAttribute(landColors,3));landGeo.computeVertexNormals();terrainMat.vertexColors=true;mesh(landGeo,terrainMat);

const waterMat=new T.ShaderMaterial({
  uniforms:{time:{value:0},sun:{value:sunDir},fogColor:{value:new T.Color('#a6aaa0')}},
  vertexShader:'varying vec3 w;void main(){w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}',
  fragmentShader:`uniform float time;uniform vec3 sun;uniform vec3 fogColor;varying vec3 w;
  void main(){
    vec3 v=normalize(cameraPosition-w);
    float a=sin(w.x*.35+time*.9)+sin(w.z*.29-time*.6)+sin((w.x+w.z)*.7+time);
    vec3 n=normalize(vec3(cos(w.x*.35+time)*.075,1.,cos(w.z*.29-time*.6)*.06));
    float f=pow(1.-max(dot(n,v),0.),3.);
    float spec=pow(max(dot(reflect(-sun,n),v),0.),150.);
    vec3 c=mix(vec3(.035,.18,.23),vec3(.38,.49,.47),f)+vec3(1.,.64,.27)*spec*1.65+a*.005;
    c=mix(c,fogColor,1.-exp(-distance(cameraPosition,w)*.00058));
    gl_FragColor=vec4(c,1.);
  }`
});
const ocean=mesh(new T.PlaneGeometry(7000,7000,1,1),waterMat,-1300,-2,0);ocean.rotation.x=-Math.PI/2;

function mountain(x,z,h,r){
  const g=new T.ConeGeometry(r,h,40,9,false);const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const px=p.getX(i),py=p.getY(i),pz=p.getZ(i),t=(py+h/2)/h;
    const wobble=1+Math.sin(px*.041+pz*.029+i*.31)*(.06+.13*(1-t))+Math.sin(i*1.71)*.025;
    p.setX(i,px*wobble);p.setZ(i,pz*wobble);p.setY(i,py+Math.sin(px*.018+pz*.021)*h*.018*(1-t));
  }
  g.computeVertexNormals();
  const m=mesh(g,mat(new T.Color().setHSL(.19,.07,.36+rand()*.09),1),x,h/2-20,z);m.rotation.y=rand()*TAU;return m;
}
for(let j=0;j<14;j++)mountain(620+rand()*920,-1350+rand()*2700,155+rand()*310,180+rand()*190);

const treePositions=[];
for(let i=0;i<2600&&treePositions.length<(mobile?420:680);i++){
  const x=-330+rand()*1110,z=-720+rand()*1450,r=nearest(x,z,9);
  if(r.distance<24||x<-285||ground(x,z)<2)continue;
  treePositions.push({x,z,y:ground(x,z),s:3.8+rand()*7});
}
const trunks=new T.InstancedMesh(new T.CylinderGeometry(.18,.31,1,8),mat('#4c4232',1),treePositions.length);
const foliageMat=new T.MeshStandardMaterial({color:'#2f4937',roughness:.98});
const foliage=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),foliageMat,treePositions.length*4);
treePositions.forEach((p,i)=>{
  dummy.position.set(p.x,p.y+p.s*.38,p.z);dummy.scale.set(1,p.s*.8,1);dummy.rotation.set(0,rand()*TAU,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
  for(let k=0;k<4;k++){
    const angle=rand()*TAU,rad=k===0?0:rand()*p.s*.16,sz=p.s*(.25+rand()*.10);
    dummy.position.set(p.x+Math.cos(angle)*rad,p.y+p.s*(.58+k*.075)+rand()*.45,p.z+Math.sin(angle)*rad);
    dummy.scale.set(sz*(.9+rand()*.25),sz*(.78+rand()*.26),sz*(.9+rand()*.25));
    dummy.rotation.set(rand()*.25,rand()*TAU,rand()*.2);dummy.updateMatrix();foliage.setMatrixAt(i*4+k,dummy.matrix);
  }
});
trunks.castShadow=foliage.castShadow=true;trunks.receiveShadow=foliage.receiveShadow=true;scene.add(trunks,foliage);

if(!mobile){
  const grassMat=new T.MeshStandardMaterial({color:'#60704b',side:T.DoubleSide,roughness:1});
  const grass=new T.InstancedMesh(new T.PlaneGeometry(.22,1.15),grassMat,900);
  let gi=0;
  while(gi<900){
    const x=-330+rand()*1060,z=-700+rand()*1400,r=nearest(x,z,8);
    if(r.distance<18||r.distance>58||ground(x,z)<2)continue;
    dummy.position.set(x,ground(x,z)+.55,z);dummy.rotation.set(0,rand()*TAU,0);const s=.7+rand()*1.8;dummy.scale.set(s,s,s);dummy.updateMatrix();grass.setMatrixAt(gi++,dummy.matrix);
  }
  scene.add(grass);
}

const rocks=new T.InstancedMesh(new T.IcosahedronGeometry(1,2),rockMat,150);
for(let i=0;i<150;i++){
  const x=-295-rand()*34,z=-600+rand()*1200;dummy.position.set(x,ground(x,z),z);dummy.scale.set(2+rand()*7,2+rand()*8,2+rand()*6);dummy.rotation.set(rand(),rand(),rand());dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
}
rocks.castShadow=true;scene.add(rocks);

function sign(text,w=10,h=2,bg='#152523',fg='#e5efd9'){
  const c=document.createElement('canvas');c.width=1024;c.height=256;const x=c.getContext('2d');
  x.fillStyle=bg;x.fillRect(0,0,1024,256);x.fillStyle=fg;x.textAlign='center';x.textBaseline='middle';x.font='700 88px Arial';x.fillText(text,512,136,940);
  const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshStandardMaterial({map:tx,side:T.DoubleSide,roughness:.62,metalness:.08}));
}
function trackObject(t,offset,obj,lift=0){
  const a=at(t);obj.position.copy(a.p).addScaledVector(a.n,offset);obj.position.y+=lift;obj.rotation.y=Math.atan2(a.d.x,a.d.z);scene.add(obj);return obj;
}

const start=at(0),yaw=Math.atan2(start.d.x,start.d.z);
for(const side of [-1,1])trackObject(0,side*10,new T.Mesh(new T.BoxGeometry(.55,7,.55),dark),3.5);
trackObject(0,0,new T.Mesh(new T.BoxGeometry(21,2,.6),dark),6.5);
trackObject(.0004,0,sign('APEX / COTE D’AZUR',19,1.4,'#13221f','#d8ff63'),6.5);
for(let a=0;a<16;a++)for(let b=0;b<2;b++){
  const m=new T.Mesh(new T.PlaneGeometry(.9,.9),a%2===b?white:dark),p=start.p.clone().addScaledVector(start.n,-7.2+a*.9).addScaledVector(start.d,b*.9);
  m.position.copy(p);m.position.y+=.062;m.rotation.set(-Math.PI/2,0,-yaw);scene.add(m);
}
for(let i=1;i<=10;i++){
  const a=at(i*.006);for(const side of [-1,1]){
    const m=new T.Mesh(new T.PlaneGeometry(2.5,.12),white),p=a.p.clone().addScaledVector(a.n,side*3.4);
    m.position.copy(p);m.position.y+=.066;m.rotation.set(-Math.PI/2,0,-Math.atan2(a.d.x,a.d.z));scene.add(m);
  }
}

const glassmat=mat('#173536',.18,.65);
const pitDark=mat('#3a403d',.82,.08);
for(let i=0;i<9;i++){
  const t=.014+i*.005,a=at(t),p=a.p.clone().addScaledVector(a.n,28),ang=Math.atan2(a.d.x,a.d.z);
  box(15,5.5,9,concrete,p.x,p.y+2.65,p.z,ang);box(15.6,.3,9.5,dark,p.x,p.y+5.6,p.z,ang);
  box(.2,1.55,7.2,glassmat,p.x-7.6*a.n.x,p.y+4.1,p.z-7.6*a.n.z,ang);
  box(.18,2.45,5.8,pitDark,p.x-7.6*a.n.x,p.y+1.22,p.z-7.6*a.n.z,ang);
  const awning=box(2.2,.18,8.6,red,p.x-8.3*a.n.x,p.y+2.65,p.z-8.3*a.n.z,ang);awning.castShadow=true;
}
for(const t of [.145,.30,.445,.61,.735,.845]){
  for(let i=0;i<3;i++)trackObject(t+i*.016,-11,sign(String(150-i*50),1.3,1.7,'#efeadb','#132220'),1.3);
  trackObject(t+.026,16.2,sign('APEX / DRIVE THE COAST',12,1.1,'#112421','#d8ff63'),1.8);
}
for(let i=0;i<10;i++){
  const t=.09+i*.006,a=at(t),p=a.p.clone().addScaledVector(a.n,28),ang=Math.atan2(a.d.x,a.d.z);
  for(let j=0;j<5;j++)box(2,.7,9,mat(j%2?'#aeb3a5':'#2d4540',.9),p.x+j*1.25*a.n.x,p.y+.8+j*.75,p.z+j*1.25*a.n.z,ang);
}
for(const t of [.04,.055,.07,.085]){
  const a=at(t),p=a.p.clone().addScaledVector(a.n,20),ang=Math.atan2(a.d.x,a.d.z);
  const pole=box(.12,6,.12,metal,p.x,p.y+3,p.z,ang);
  const lampMat=new T.MeshStandardMaterial({color:'#f3e8c8',emissive:'#ffcc7a',emissiveIntensity:3.2,roughness:.3});
  const lamp=box(1.5,.12,.28,lampMat,p.x,p.y+6,p.z,ang);pole.castShadow=lamp.castShadow=false;
}

$('loadbar').style.width='68%';$('loadtext').textContent='Loading Ferrari 458 Italia...';
const car=new T.Group(),body=new T.Group();car.add(body);scene.add(car);
let wheels=[];
const draco=new DRACOLoader();draco.setDecoderPath('./assets/');
const loader=new GLTFLoader();loader.setDRACOLoader(draco);
try{
  const gltf=await loader.loadAsync('./assets/ferrari.glb'),model=gltf.scene;
  model.rotation.y=Math.PI;model.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(V()),scale=4.53/size.z;
  model.scale.setScalar(scale);model.position.y=-bounds.min.y*scale;body.add(model);
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material.envMapIntensity=1.55;o.material.needsUpdate=true;}}});
  const paint=new T.MeshPhysicalMaterial({color:'#c31912',metalness:.58,roughness:.20,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:1.8});
  const paintObj=model.getObjectByName('body');if(paintObj)paintObj.material=paint;
  for(const name of ['rim_fl','rim_fr','rim_rl','rim_rr','trim']){const m=model.getObjectByName(name);if(m)m.material=mat('#171a19',.27,.9);}
  const glass=model.getObjectByName('glass');if(glass)glass.material=new T.MeshPhysicalMaterial({color:'#455f5d',metalness:.15,roughness:.06,transparent:true,opacity:.63,envMapIntensity:1.7});
  wheels=['wheel_fl','wheel_fr','wheel_rl','wheel_rr'].map(n=>model.getObjectByName(n)).filter(Boolean);
}catch(e){
  $('loadtext').textContent='The car could not load. Reload to retry.';console.error(e);throw e;
}
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=256;
const sc=shadowCanvas.getContext('2d'),gradient=sc.createRadialGradient(64,128,5,64,128,108);gradient.addColorStop(0,'rgba(0,0,0,.7)');gradient.addColorStop(1,'rgba(0,0,0,0)');
sc.fillStyle=gradient;sc.fillRect(0,0,128,256);
const shadow=new T.Mesh(new T.PlaneGeometry(3.2,5.6),new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=.03;car.add(shadow);

let state=newCar(start.p.x,start.p.z,yaw),mode='intro',paused=false,cam=0,demoT=.022,clock=0,accumulator=0,prev=performance.now(),toastEnd=0,lap,best=0;
try{best=Number(localStorage.getItem('apex-best-v1'))||0;}catch{}
const keys=new Set(),resetLap=()=>({elapsed:0,next:1,previous:0,valid:true,count:1});
lap=resetLap();
const fmt=n=>{const m=Math.floor(n/60),s=Math.floor(n%60),ms=Math.floor(n%1*1000);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;};
function syncBest(){const s=best?fmt(best):'—';$('best').textContent=s;$('intro-best').textContent=best?s:'NO TIME';}
syncBest();
function toast(s){$('toast').textContent=s;$('toast').classList.add('visible');toastEnd=clock+2.8;}
function reset(){state=newCar(start.p.x,start.p.z,yaw);lap=resetLap();keys.clear();touchSteer=0;camera.position.copy(start.p).add(V(-5,5,-9));if(mode==='drive')toast('Fresh lap / tires ready');}
function updateCamLabel(){$('camera').textContent='CAMERA / '+['CHASE','BONNET','CINEMA'][cam];}
function startMode(next){
  mode=next;paused=false;$('paused').hidden=true;$('intro').hidden=true;$('hud').hidden=false;
  document.body.classList.add('playing');$('mode').textContent=next==='demo'?'CINEMATIC':'TIME ATTACK';$('pause').textContent='PAUSE';
  if(next==='drive'){cam=0;reset();}else{cam=2;demoT=.02;}
  updateCamLabel();
}
function togglePause(){
  if(mode==='intro'||layoutEditing)return;
  paused=!paused;keys.clear();wheelPointer=null;$('paused').hidden=!paused;$('pause').textContent=paused?'RESUME':'PAUSE';
}
function exitToIntro(){
  mode='intro';paused=false;keys.clear();touchSteer=0;$('paused').hidden=true;$('hud').hidden=true;$('intro').hidden=false;document.body.classList.remove('playing');
}

$('drive').onclick=()=>startMode('drive');
$('showcase').onclick=()=>startMode('demo');
$('camera').onclick=()=>{cam=(cam+1)%3;updateCamLabel();};
$('reset').onclick=()=>{if(mode==='demo')demoT=0;else reset();};
$('pause').onclick=togglePause;
$('resume').onclick=togglePause;
$('pause-reset').onclick=()=>{reset();togglePause();};
$('exit').onclick=exitToIntro;

addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();
  if(e.repeat)return;
  if(e.key.toLowerCase()==='c')$('camera').click();
  else if(e.key.toLowerCase()==='r'&&mode==='drive')reset();
  else if(e.key==='Escape')togglePause();
  else keys.add(e.key.toLowerCase());
});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
addEventListener('blur',()=>{keys.clear();wheelPointer=null;if(mode!=='intro'&&!paused)togglePause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();wheelPointer=null;if(mode!=='intro'&&!paused)togglePause();}});

for(const btn of document.querySelectorAll('[data-key]')){
  const k=btn.dataset.key.toLowerCase();
  btn.onpointerdown=e=>{if(layoutEditing)return;e.preventDefault();btn.setPointerCapture(e.pointerId);keys.add(k);btn.classList.add('active');};
  const release=()=>{keys.delete(k);btn.classList.remove('active');};
  btn.onpointerup=release;btn.onpointercancel=release;btn.onlostpointercapture=release;
}

let touchSteer=0,wheelPointer=null,wheelStartAngle=0,wheelStartSteer=0,layoutEditing=false;
const wheel=$('steering-wheel');
const angleFor=e=>{const r=wheel.getBoundingClientRect();return Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2));};
const angleDelta=(a,b)=>{let d=a-b;while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d;};
wheel.onpointerdown=e=>{
  if(layoutEditing)return;
  e.preventDefault();wheelPointer=e.pointerId;wheel.setPointerCapture(e.pointerId);wheelStartAngle=angleFor(e);wheelStartSteer=touchSteer;wheel.classList.add('active');
};
wheel.onpointermove=e=>{
  if(layoutEditing||e.pointerId!==wheelPointer)return;
  const d=angleDelta(angleFor(e),wheelStartAngle);
  touchSteer=clamp(wheelStartSteer+d/(Math.PI*.72)*prefs.steerSensitivity,-1,1);
};
const releaseWheel=e=>{if(e.pointerId!==undefined&&wheelPointer!==e.pointerId)return;wheelPointer=null;wheel.classList.remove('active');};
wheel.onpointerup=releaseWheel;wheel.onpointercancel=releaseWheel;wheel.onlostpointercapture=releaseWheel;

function applyControlLayout(){
  const ww=$('wheel-wrap'),pw=$('pedals-wrap');
  ww.style.left=prefs.wheelX+'%';ww.style.top=prefs.wheelY+'%';ww.style.setProperty('--wheel-scale',prefs.wheelScale);
  pw.style.left=prefs.pedalX+'%';pw.style.top=prefs.pedalY+'%';pw.style.setProperty('--pedal-scale',prefs.pedalScale);
  $('wheel-size').value=Math.round(prefs.wheelScale*100);$('wheel-size-value').value=Math.round(prefs.wheelScale*100)+'%';
  $('pedal-size').value=Math.round(prefs.pedalScale*100);$('pedal-size-value').value=Math.round(prefs.pedalScale*100)+'%';
  $('steer-sensitivity').value=Math.round(prefs.steerSensitivity*100);$('steer-sensitivity-value').value=Math.round(prefs.steerSensitivity*100)+'%';
  $('quality').value=prefs.quality;
}
applyControlLayout();

function makeLayoutDraggable(el,xKey,yKey){
  let pid=null;
  el.addEventListener('pointerdown',e=>{
    if(!layoutEditing)return;
    e.preventDefault();e.stopPropagation();pid=e.pointerId;el.setPointerCapture(pid);
  },true);
  el.addEventListener('pointermove',e=>{
    if(!layoutEditing||e.pointerId!==pid)return;
    prefs[xKey]=clamp(e.clientX/innerWidth*100,7,93);prefs[yKey]=clamp(e.clientY/innerHeight*100,12,92);applyControlLayout();
  });
  const end=e=>{if(pid!==null&&(e.pointerId===undefined||e.pointerId===pid)){pid=null;savePrefs();}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);el.addEventListener('lostpointercapture',end);
}
makeLayoutDraggable($('wheel-wrap'),'wheelX','wheelY');
makeLayoutDraggable($('pedals-wrap'),'pedalX','pedalY');

function openSettings(){if(mode!=='intro'&&!paused)togglePause();applyControlLayout();$('settingsdialog').showModal();}
$('open-settings').onclick=openSettings;$('pause-settings').onclick=openSettings;
$('close-settings').onclick=()=>$('settingsdialog').close();
$('wheel-size').oninput=e=>{prefs.wheelScale=Number(e.target.value)/100;applyControlLayout();savePrefs();};
$('pedal-size').oninput=e=>{prefs.pedalScale=Number(e.target.value)/100;applyControlLayout();savePrefs();};
$('steer-sensitivity').oninput=e=>{prefs.steerSensitivity=Number(e.target.value)/100;applyControlLayout();savePrefs();};
$('quality').onchange=e=>{prefs.quality=e.target.value;applyQuality();savePrefs();toast('Graphics / '+prefs.quality.toUpperCase());};
$('reset-layout').onclick=()=>{prefs={...prefs,wheelX:defaults.wheelX,wheelY:defaults.wheelY,wheelScale:1,pedalX:defaults.pedalX,pedalY:defaults.pedalY,pedalScale:1,steerSensitivity:1};applyControlLayout();savePrefs();};
$('edit-layout').onclick=()=>{$('settingsdialog').close();layoutEditing=true;document.body.classList.add('layout-editing');$('layout-editor').hidden=false;};
$('layout-done').onclick=()=>{layoutEditing=false;document.body.classList.remove('layout-editing');$('layout-editor').hidden=true;savePrefs();};

$('credits').onclick=()=>{if(mode!=='intro'&&!paused)togglePause();$('creditdialog').showModal();};
$('closecredits').onclick=()=>$('creditdialog').close();

let audioCtx,engineOsc,engineGain,filter,audioOn=false;
async function audioToggle(){
  audioOn=!audioOn;
  if(!audioCtx){
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();engineOsc=audioCtx.createOscillator();engineOsc.type='sawtooth';
    filter=audioCtx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=600;engineGain=audioCtx.createGain();engineGain.gain.value=0;
    engineOsc.connect(filter).connect(engineGain).connect(audioCtx.destination);engineOsc.start();
  }
  await audioCtx.resume();$('sound').textContent=audioOn?'SOUND ON':'SOUND OFF';$('sound').setAttribute('aria-label',audioOn?'Mute engine sound':'Enable engine sound');
}
$('sound').onclick=audioToggle;

const mapCtx=$('map').getContext('2d');
function drawMap(t){
  mapCtx.clearRect(0,0,260,210);mapCtx.lineCap='round';
  mapCtx.lineWidth=8;mapCtx.strokeStyle='rgba(0,0,0,.35)';mapCtx.beginPath();
  samples.forEach((a,i)=>{const x=(a.p.x+330)*.245+22,y=(a.p.z+430)*.215+8;i?mapCtx.lineTo(x,y):mapCtx.moveTo(x,y);});mapCtx.closePath();mapCtx.stroke();
  mapCtx.lineWidth=3;mapCtx.strokeStyle='rgba(225,232,225,.56)';mapCtx.stroke();
  const p=at(t).p;mapCtx.fillStyle='#d8ff63';mapCtx.beginPath();mapCtx.arc((p.x+330)*.245+22,(p.z+430)*.215+8,4.5,0,TAU);mapCtx.fill();
}

let lastRoad=nearest(state.x,state.z),lastCameraTarget=V(),wheelSpin=0;
function simulate(dt){
  if(mode==='drive'){
    const keyboardSteer=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0);
    const input={
      steer:clamp(keyboardSteer+touchSteer,-1,1),
      throttle:keys.has('arrowup')||keys.has('w')?1:0,
      brake:keys.has('arrowdown')||keys.has('s')||keys.has(' ')?1:0
    };
    lastRoad=nearest(state.x,state.z);stepCar(state,input,dt,lastRoad);lastRoad=nearest(state.x,state.z);
    if(lastRoad.distance>14.5){
      const side=Math.sign(lastRoad.side);state.x=lastRoad.p.x+lastRoad.n.x*side*14.4;state.z=lastRoad.p.z+lastRoad.n.z*side*14.4;state.speed*=.65;
      state.heading+=wrapAngle(Math.atan2(lastRoad.d.x,lastRoad.d.z)-state.heading)*.15;lap.valid=false;
    }
    const finish=advanceLap(lap,lastRoad.t,lastRoad.distance<9,Math.abs(state.speed)>.5||lap.elapsed>0?dt:0);
    if(finish!==null){
      if(!best||finish<best){best=finish;try{localStorage.setItem('apex-best-v1',String(best));}catch{}syncBest();toast('PERSONAL BEST / '+fmt(best));}
      else toast('LAP COMPLETE / '+fmt(finish));
    }
  }else{
    const here=at(demoT),ahead=at(demoT+.012),turn=here.d.angleTo(ahead.d),targetSpeed=clamp(39-turn*70,17,39);
    state.speed+=(targetSpeed-state.speed)*(1-Math.exp(-dt*2));demoT=(demoT+state.speed*dt/length)%1;
    const a=at(demoT);state.x=a.p.x;state.z=a.p.z;state.heading=Math.atan2(a.d.x,a.d.z);state.roll=-turn*.08;state.pitch=0;lastRoad={...a,distance:0};
  }
}

function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min((now-prev)/1000,.06);prev=now;clock+=dt;
  if(wheelPointer===null&&!layoutEditing)touchSteer*=Math.exp(-dt*7.5);
  wheel.style.setProperty('--wheel-angle',(touchSteer*125).toFixed(1)+'deg');wheel.setAttribute('aria-valuenow',String(Math.round(touchSteer*100)));

  if(!paused){
    accumulator+=dt;while(accumulator>=1/120){simulate(1/120);accumulator-=1/120;}
    const road=lastRoad;
    car.position.set(state.x,road.p.y+.035,state.z);car.rotation.y=state.heading;
    const grade=Math.atan2(road.d.y,Math.hypot(road.d.x,road.d.z));body.rotation.x=-grade+state.pitch;body.rotation.z=clamp(state.roll,-.06,.06);
    wheelSpin+=state.speed*dt/.34;for(const w of wheels)w.rotation.x=-wheelSpin;

    const f=V(Math.sin(state.heading),0,Math.cos(state.heading)),right=V(f.z,0,-f.x),target=car.position.clone().add(V(0,1.0,0));
    let desired;
    if(mode==='intro'){
      desired=target.clone().addScaledVector(f,8.8).addScaledVector(right,-8.3).add(V(0,3.0,0));target.addScaledVector(right,-3.0);camera.fov=45;
    }else if(cam===0){
      desired=target.clone().addScaledVector(f,-8.7-Math.abs(state.speed)*.038).addScaledVector(right,touchSteer*.15).add(V(0,3.25,0));target.addScaledVector(f,5.4);camera.fov=51+Math.abs(state.speed)*.17;
    }else if(cam===1){
      desired=car.position.clone().addScaledVector(f,1.15).add(V(0,1.18,0));target.addScaledVector(f,24);target.y+=grade*15;camera.fov=67;
    }else{
      const phase=Math.floor(clock/8)%3;
      if(phase===0)desired=target.clone().addScaledVector(f,8).addScaledVector(right,-7).add(V(0,2.5,0));
      else if(phase===1)desired=target.clone().addScaledVector(f,-9).addScaledVector(right,5).add(V(0,4,0));
      else desired=target.clone().addScaledVector(f,-13).addScaledVector(right,-8).add(V(0,12,0));
      camera.fov=46;
    }
    camera.position.lerp(desired,1-Math.exp(-dt*(cam===1&&mode!=='intro'?30:4.6)));
    lastCameraTarget.lerp(target,1-Math.exp(-dt*6.5));camera.lookAt(lastCameraTarget);camera.updateProjectionMatrix();

    sunlight.target.position.copy(car.position);sunlight.position.copy(car.position).addScaledVector(sunDir,120);
    waterMat.uniforms.time.value=clock;
  }

  if(toastEnd<clock)$('toast').classList.remove('visible');
  const kph=Math.round(Math.abs(state.speed)*3.6),gear=state.speed<-.2?'R':kph<1?'N':Math.min(7,1+Math.floor(kph/43));
  $('speed').textContent=kph;$('gear').textContent=gear;$('rpm').style.width=(20+(kph%43)/43*80)+'%';
  $('timer').textContent=mode==='demo'?fmt(demoT*length/32):fmt(lap.elapsed);$('lap').textContent='LAP '+String(lap.count).padStart(2,'0');
  $('sector').textContent='S'+Math.min(3,1+Math.floor(lastRoad.t*3));
  const names=['PIT STRAIGHT','LA CORNICHE','BEAUSOLEIL','MISTRAL ESSES','CAP MARTIN','RIVIERA HAIRPIN'];
  $('surface').textContent=mode==='demo'?'CINEMATIC RUN':!lap.valid?'LAP INVALID':lastRoad.distance>7.7?'RUNOFF / LOW GRIP':names[Math.min(5,Math.floor(lastRoad.t*6))];
  $('traction').textContent=!lap.valid?'INVALID':lastRoad.distance>7.7?'LOW GRIP':'GRIP';
  drawMap(lastRoad.t);

  if(audioCtx){
    const rpm=gear==='N'?900:1600+(kph%43)/43*6500;engineOsc.frequency.setTargetAtTime(45+rpm/35,audioCtx.currentTime,.08);
    engineGain.gain.setTargetAtTime(audioOn&&!paused?.02:0,audioCtx.currentTime,.1);filter.frequency.setTargetAtTime(420+rpm*.14,audioCtx.currentTime,.1);
  }
  renderer.render(scene,camera);
}

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);applyQuality();applyControlLayout();
});
$('loadbar').style.width='100%';$('loading').hidden=true;$('intro').hidden=false;
const initial=at(demoT);car.position.copy(initial.p);camera.position.copy(initial.p).add(V(-10,5,9));lastCameraTarget.copy(initial.p);
requestAnimationFrame(frame);
