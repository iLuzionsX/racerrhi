export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function stepCar(s,input,dt,road){
 const v=s.speed,off=road.distance>7.7,grip=off?4.1:11.5;
 const steerLimit=.50/(1+Math.abs(v)*.038);
 const target=input.steer*steerLimit;
 s.steer+=(target-s.steer)*(1-Math.exp(-dt*9));
 let acceleration=input.throttle*(7.8/(1+Math.abs(v)/48))-input.brake*(v>0?15:0);
 if(v<.2&&input.brake&&!input.throttle)acceleration=-3;
 if(v<0&&input.throttle)acceleration=8;
 acceleration-=Math.sign(v)*(.12+.0028*v*v+(off?Math.abs(v)*.20:0));
 s.speed=clamp(v+acceleration*dt,-7,82);
 if(!input.throttle&&!input.brake&&Math.abs(s.speed)<.04)s.speed=0;
 const requested=s.speed/2.65*Math.tan(s.steer);
 const available=grip*Math.sqrt(Math.max(.35,1-Math.pow(Math.min(1,input.brake*.75),2)));
 const yawLimit=available/Math.max(3,Math.abs(s.speed));
 const targetYaw=yawLimit*Math.tanh(requested/yawLimit);
 s.yawRate+=(targetYaw-s.yawRate)*(1-Math.exp(-dt*7));
 s.heading+=s.yawRate*dt;
 const lateral=clamp(requested-targetYaw,-1,1)*Math.min(Math.abs(v)/45,1)*.09;
 s.slip+=(lateral-s.slip)*(1-Math.exp(-dt*4));
 s.x+=Math.sin(s.heading-s.slip)*s.speed*dt;
 s.z+=Math.cos(s.heading-s.slip)*s.speed*dt;
 s.roll+=(-s.yawRate*s.speed*.003-s.roll)*(1-Math.exp(-dt*6));
 s.pitch+=(acceleration*.003-s.pitch)*(1-Math.exp(-dt*5));
 return s;
}
export function newCar(x,z,heading){return {x,z,heading,speed:0,steer:0,yawRate:0,slip:0,roll:0,pitch:0};}
export function advanceLap(lap,t,onTrack,dt){
 lap.elapsed+=dt;
 if(!onTrack)lap.valid=false;
 const sector=Math.floor(t*4);
 if(sector===lap.next&&onTrack)lap.next++;
 let finish=null;
 if(lap.previous>.90&&t<.10&&lap.next===4){if(lap.valid)finish=lap.elapsed;lap.elapsed=0;lap.next=1;lap.valid=true;lap.count++;}
 lap.previous=t;return finish;
}
