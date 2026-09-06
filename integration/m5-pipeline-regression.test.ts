import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  stepCar,
  setCarPose,
  refreshCarState,
  resolveBoundaryContact,
  captureM5RenderSnapshot,
  interpolateM5RenderSnapshots,
  createM5StepScheduler,
  pauseM5StepScheduler,
  consumeM5FrameTime,
} from './m5-bridge';

setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

const near = (a:number,b:number,eps=1e-9) => Math.abs(a-b) <= eps;
const finiteState = (state:any) => [
  state.x,state.y,state.z,state.heading,state.speed,state.steer,state.yawRate,state.slip,
  state.localVelocityMs.lateral,state.localVelocityMs.vertical,state.localVelocityMs.forward,
  ...state.wheels.flatMap((wheel:any)=>[
    wheel.normalLoadN,wheel.slipAngleRad,wheel.slipRatio,wheel.forceLongitudinalN,
    wheel.forceLateralN,wheel.gripUtilization,wheel.hubWorldPos.x,wheel.hubWorldPos.y,
    wheel.hubWorldPos.z,wheel.angularVelocityRadS,wheel.temperatureC,wheel.wearPercent,
  ]),
].every(Number.isFinite);

// -----------------------------------------------------------------------------
// 1) Typed/signed state contract: donor getState() exports vx/vy/vz.
// -----------------------------------------------------------------------------
{
  const state:any = newCar(0,0,0);
  const sim:any = state._m5;

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(2, 0, 10);
  refreshCarState(state);
  assert(near(state.localVelocityMs.lateral, 2));
  assert(near(state.localVelocityMs.forward, 10));
  assert(near(state.slip, Math.atan2(2,10), 1e-12));

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(2, 0, -10);
  refreshCarState(state);
  assert(near(state.localVelocityMs.lateral, 2));
  assert(near(state.localVelocityMs.forward, -10));
  assert(near(state.slip, Math.atan2(2,10), 1e-12));

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0.2, 0, 0.2);
  refreshCarState(state);
  assert.equal(state.slip, 0, 'low-speed sideslip should be suppressed below the donor threshold');

  sim.vehicle.rigidBody.position.y = 1.42;
  refreshCarState(state);
  const snapshot = captureM5RenderSnapshot(state);
  assert(near(snapshot.y, 1.42), 'physical CG height was not carried into render state');
  assert.equal(new Set(state.wheels.map((wheel:any)=>wheel.id)).size, 4);
  assert.deepEqual(state.wheels.map((wheel:any)=>wheel.id), ['FL','FR','RL','RR']);
  assert(state.wheels.every((wheel:any)=>Number.isFinite(wheel.hubWorldPos.y)));
}

// -----------------------------------------------------------------------------
// 2) Input ownership: donor digital steering for keys, analog for held touch wheel.
// -----------------------------------------------------------------------------
{
  const state:any = newCar(0,0,0);
  setCarPose(state,0,0,0,25);
  const sim:any = state._m5;

  for(let i=0;i<10;i++) {
    stepCar(state,{digitalSteerDirection:1,analogSteerActive:false,throttle:.1},M5_FIXED_DT);
  }
  assert(sim.digitalSteeringInput > 0, 'keyboard left did not enter Racing26 digital steering');
  assert.equal(sim.analogSteeringInput, 0);

  const digitalBeforeTouch = sim.digitalSteeringInput;
  stepCar(state,{
    digitalSteerDirection:1,
    analogSteerTarget:.5,
    analogSteerActive:true,
    throttle:.1,
  },M5_FIXED_DT);
  assert.equal(sim.digitalSteeringInput, 0, 'held touch wheel did not take precedence');
  assert(sim.analogSteeringInput < 0, 'Racerrhi touch sign was not converted to Racing26 +left convention');
  assert(digitalBeforeTouch > 0);

  const analogBeforeRelease = Math.abs(sim.analogSteeringInput);
  stepCar(state,{digitalSteerDirection:0,analogSteerActive:false},M5_FIXED_DT);
  assert(Math.abs(sim.analogSteeringInput) < analogBeforeRelease, 'released analog wheel did not unwind before digital idle');
}

// Left/right first-turn symmetry through the actual digital controller.
function digitalTurn(direction:-1|1) {
  const state:any = newCar(0,0,0);
  setCarPose(state,0,0,0,80/3.6);
  let peakYaw = 0;
  let peakSlip = 0;
  for(let i=0;i<120;i++) {
    stepCar(state,{digitalSteerDirection:direction,throttle:.35},M5_FIXED_DT);
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate));
    peakSlip = Math.max(peakSlip, Math.abs(state.slip));
  }
  return { state, peakYaw, peakSlip };
}
const leftTurn = digitalTurn(1);
const rightTurn = digitalTurn(-1);
assert(leftTurn.state.heading * rightTurn.state.heading < 0, 'left/right digital turns did not yaw in opposite directions');
assert(leftTurn.peakYaw < 1.4 && rightTurn.peakYaw < 1.4, 'first-turn yaw response ran away');
assert(leftTurn.peakSlip < .45 && rightTurn.peakSlip < .45, 'first-turn sideslip ran away');
assert(Math.abs(leftTurn.peakYaw-rightTurn.peakYaw) / Math.max(.01,leftTurn.peakYaw,rightTurn.peakYaw) < .15,
  'left/right yaw response lost symmetry');

// -----------------------------------------------------------------------------
// 3) Boundary response preserves simulation history and cannot inject speed energy.
// -----------------------------------------------------------------------------
let boundaryReport:any;
{
  const state:any = newCar(0,0,0);
  setCarPose(state,14.8,0,0,22);
  const sim:any = state._m5;

  for(let i=0;i<90;i++) {
    stepCar(state,{digitalSteerDirection:1,throttle:.25},M5_FIXED_DT);
  }

  sim.vehicle.rigidBody.position.x = 14.8;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(8, .3, 20);
  refreshCarState(state);

  const stepCountBefore = sim.stepCount;
  const totalSimTimeBefore = sim.totalSimTime;
  const engineRpmBefore = sim.vehicle.powertrain.engineRpm;
  const tireHistoryBefore = sim.vehicle.wheels.map((wheel:any)=>({
    temperature: wheel.temperature,
    wear: wheel.wearPercent,
    relaxationSlipAngle: wheel.relaxationSlipAngle,
    relaxationSlipRatio: wheel.relaxationSlipRatio,
  }));
  const suspensionHistoryBefore = sim.vehicle.suspension.states.map((corner:any)=>({
    displacement: corner.displacement,
    hubVelocityWorldY: corner.hubVelocityWorldY,
  }));
  const velocityBefore = sim.vehicle.rigidBody.velocity;
  const speedSqBefore = PhysicsMath.vec3Dot(velocityBefore, velocityBefore);

  resolveBoundaryContact(state,{
    roadPoint:{x:0,y:0,z:0},
    roadNormal:{x:1,y:0,z:0},
    side:1,
    distanceM:14.8,
    limitDistanceM:14.4,
  });

  const velocityAfter = sim.vehicle.rigidBody.velocity;
  const speedSqAfter = PhysicsMath.vec3Dot(velocityAfter, velocityAfter);
  assert.equal(sim.stepCount, stepCountBefore, 'boundary contact reset or advanced simulation');
  assert.equal(sim.totalSimTime, totalSimTimeBefore, 'boundary contact reset simulation time');
  assert.equal(sim.vehicle.powertrain.engineRpm, engineRpmBefore, 'boundary contact reset drivetrain history');
  assert.deepEqual(sim.vehicle.wheels.map((wheel:any)=>({
    temperature: wheel.temperature,
    wear: wheel.wearPercent,
    relaxationSlipAngle: wheel.relaxationSlipAngle,
    relaxationSlipRatio: wheel.relaxationSlipRatio,
  })), tireHistoryBefore, 'boundary contact reset tire history');
  assert.deepEqual(sim.vehicle.suspension.states.map((corner:any)=>({
    displacement: corner.displacement,
    hubVelocityWorldY: corner.hubVelocityWorldY,
  })), suspensionHistoryBefore, 'boundary contact reset suspension history');
  assert(speedSqAfter <= speedSqBefore + 1e-9, 'boundary contact injected translational energy');
  assert(near(sim.vehicle.rigidBody.position.x,14.4,1e-9), 'boundary projection did not stop at the guardrail limit');
  assert(state.boundaryContact.active);
  assert.equal(state.boundaryContact.simulationStepCount, stepCountBefore);
  assert(state.boundaryContact.outwardSpeedBeforeMs > 0);
  assert(state.boundaryContact.outwardSpeedAfterMs <= 0);
  const firstContactTelemetry = { ...state.boundaryContact };

  const repeatedBefore = PhysicsMath.vec3Dot(sim.vehicle.rigidBody.velocity, sim.vehicle.rigidBody.velocity);
  resolveBoundaryContact(state,{
    roadPoint:{x:0,y:0,z:0},
    roadNormal:{x:1,y:0,z:0},
    side:1,
    distanceM:14.6,
    limitDistanceM:14.4,
  });
  const repeatedAfter = PhysicsMath.vec3Dot(sim.vehicle.rigidBody.velocity, sim.vehicle.rigidBody.velocity);
  assert(repeatedAfter <= repeatedBefore + 1e-9, 'repeated boundary correction injected energy');

  for(let i=0;i<120;i++) stepCar(state,{digitalSteerDirection:0,throttle:.2},M5_FIXED_DT);
  assert.equal(sim.stepCount, stepCountBefore + 120, 'normal driving after contact did not continue the same simulation history');
  assert(finiteState(state), 'post-boundary driving produced non-finite state');

  boundaryReport = {
    legacyBoundaryWouldResetStepCountTo: 0,
    fixedStepCountBeforeContact: stepCountBefore,
    fixedStepCountAfterContact: state.boundaryContact.simulationStepCount,
    speedMsBeforeContact: Math.sqrt(speedSqBefore),
    speedMsAfterContact: Math.sqrt(speedSqAfter),
    outwardSpeedBeforeMs: firstContactTelemetry.outwardSpeedBeforeMs,
    outwardSpeedAfterMs: firstContactTelemetry.outwardSpeedAfterMs,
  };
}

// -----------------------------------------------------------------------------
// 4) Snapshot interpolation: angle wrap, physical height and wheel identity.
// -----------------------------------------------------------------------------
{
  const d = Math.PI/180;
  const previous:any = {
    x:0,y:1,z:0,yawRad:179*d,pitchRad:0,rollRad:0,heaveM:0,speedMs:10,steerAngleRad:0,
    wheels:[
      {id:'FL',steerAngleRad:0,rotationAngleRad:179*d,hubWorldPos:{x:1,y:.5,z:2},contactState:'contact'},
      {id:'FR',steerAngleRad:0,rotationAngleRad:0,hubWorldPos:{x:-1,y:.5,z:2},contactState:'contact'},
      {id:'RL',steerAngleRad:0,rotationAngleRad:0,hubWorldPos:{x:1,y:.5,z:-2},contactState:'contact'},
      {id:'RR',steerAngleRad:0,rotationAngleRad:0,hubWorldPos:{x:-1,y:.5,z:-2},contactState:'contact'},
    ]
  };
  const current:any = {
    x:2,y:2,z:4,yawRad:-179*d,pitchRad:.2,rollRad:-.1,heaveM:.1,speedMs:12,steerAngleRad:.1,
    wheels:[
      {id:'RR',steerAngleRad:0,rotationAngleRad:0,hubWorldPos:{x:-3,y:.7,z:-4},contactState:'contact'},
      {id:'RL',steerAngleRad:0,rotationAngleRad:0,hubWorldPos:{x:3,y:.7,z:-4},contactState:'contact'},
      {id:'FR',steerAngleRad:.1,rotationAngleRad:0,hubWorldPos:{x:-3,y:.7,z:4},contactState:'contact'},
      {id:'FL',steerAngleRad:.1,rotationAngleRad:-179*d,hubWorldPos:{x:3,y:.7,z:4},contactState:'contact'},
    ]
  };
  const mid = interpolateM5RenderSnapshots(previous,current,.5);
  assert(Math.abs(Math.abs(mid.yawRad)-Math.PI) < 1e-8, 'yaw interpolation crossed the long way through zero');
  const fl = mid.wheels.find((wheel:any)=>wheel.id==='FL')!;
  assert(near(fl.hubWorldPos.x,2), 'wheel interpolation matched by array index instead of identity');
  assert(near(fl.hubWorldPos.z,3));
  assert(Math.abs(Math.abs(fl.rotationAngleRad)-Math.PI) < 1e-8, 'wheel spin angle did not wrap coherently');
}

// -----------------------------------------------------------------------------
// 5) One timing owner: deterministic 30/60/120 Hz render cadence + stall reporting.
// -----------------------------------------------------------------------------
function runCadence(fps:number) {
  const state:any = newCar(0,0,0);
  setCarPose(state,0,0,0,15);
  const clock = createM5StepScheduler();
  let inputStep = 0;
  const frameCount = fps * 2;
  for(let frame=0;frame<frameCount;frame++) {
    consumeM5FrameTime(clock,1/fps,()=>{
      let digitalSteerDirection:-1|0|1=0;
      let throttle=.15,brake=0;
      if(inputStep<60){digitalSteerDirection=1;throttle=.35;}
      else if(inputStep<120){digitalSteerDirection=0;throttle=.25;}
      else if(inputStep<180){digitalSteerDirection=-1;throttle=.1;brake=.2;}
      stepCar(state,{digitalSteerDirection,throttle,brake},M5_FIXED_DT);
      inputStep++;
    });
  }
  return {state,clock,inputStep};
}

const c30=runCadence(30),c60=runCadence(60),c120=runCadence(120);
for(const c of [c30,c60,c120]) {
  assert.equal(c.inputStep,240,'render cadence changed fixed-step count');
  assert.equal(c.clock.stepCount,240);
  assert(c.clock.droppedTimeS < 1e-9);
}
for(const key of ['x','y','z','heading','speed','yawRate','slip'] as const) {
  assert(near(c30.state[key],c60.state[key],1e-8),key+' diverged at 30 vs 60 Hz');
  assert(near(c60.state[key],c120.state[key],1e-8),key+' diverged at 60 vs 120 Hz');
}

{
  const clock=createM5StepScheduler();
  let stallSteps=0;
  const stall=consumeM5FrameTime(clock,.2,()=>stallSteps++);
  assert.equal(stallSteps,8,'catch-up was not bounded to 8 fixed steps');
  assert(stall.droppedTimeS > .13 && stall.droppedTimeS < .14,'stall dropped-time reporting mismatch: '+stall.droppedTimeS);
  assert(clock.accumulatorS < M5_FIXED_DT);

  const paused=createM5StepScheduler();
  let steps=0;
  consumeM5FrameTime(paused,M5_FIXED_DT*.5,()=>steps++);
  assert.equal(steps,0);
  pauseM5StepScheduler(paused);
  consumeM5FrameTime(paused,M5_FIXED_DT,()=>steps++);
  assert.equal(steps,1,'pause/resume carried stale fractional time into the next frame');
}

// Integrated game-path guardrails: the shipped path must exercise the repaired APIs.
{
  const game=fs.readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
  assert(game.includes('resolveBoundaryContact(state,{'));
  assert(!game.includes('setCarPose(state,state.x,state.z,state.heading,state.speed)'));
  assert(game.includes('analogSteerActive:touchInput.held'));
  assert(game.includes('digitalSteerDirection=keyLeft===keyRight?0:keyLeft?1:-1'));
  assert(game.includes('consumeM5FrameTime(physicsClock,rawDt'));
  assert(game.includes('interpolateM5RenderSnapshots(renderPrevious,renderCurrent,timing.alpha)'));
  assert(game.includes('wheelStateById.get(w.userData.id)'));
  assert(game.includes('ws.hubWorldPos.y-car.position.y'));
}

console.log(JSON.stringify({
  scenario:'Racerrhi M5 physics pipeline integration repair',
  donorCommit:'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  stateContract:{
    signedLocalVelocity:'vx/vy/vz',
    lowSpeedSideslipThresholdMs:.5,
    wheelIdentity:['FL','FR','RL','RR'],
  },
  firstTurn:{
    leftPeakYawDegS:leftTurn.peakYaw*180/Math.PI,
    rightPeakYawDegS:rightTurn.peakYaw*180/Math.PI,
    leftPeakSideslipDeg:leftTurn.peakSlip*180/Math.PI,
    rightPeakSideslipDeg:rightTurn.peakSlip*180/Math.PI,
  },
  boundary:boundaryReport,
  cadence:{
    steps30Hz:c30.clock.stepCount,
    steps60Hz:c60.clock.stepCount,
    steps120Hz:c120.clock.stepCount,
    positionDelta30to120M:Math.hypot(c30.state.x-c120.state.x,c30.state.z-c120.state.z),
    headingDelta30to120Rad:Math.abs(c30.state.heading-c120.state.heading),
  },
  status:'passed',
},null,2));
