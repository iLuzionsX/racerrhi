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
  assert(
    sim.analogSteeringInput >= 0 && sim.analogSteeringInput < digitalBeforeTouch,
    'touch takeover crossed center instead of first unwinding the outgoing keyboard command',
  );
  for(let i=0;i<8;i++) {
    stepCar(state,{
      digitalSteerDirection:1,
      analogSteerTarget:.5,
      analogSteerActive:true,
      throttle:.1,
    },M5_FIXED_DT);
  }
  assert(sim.analogSteeringInput < 0, 'Racerrhi touch sign was not converted to Racing26 +left convention after rate-limited handoff');
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

function endOfStepSupportWorld(sim:any,index:number) {
  const hardpoint = sim.vehicle.getHardpointsBody()[index];
  const supportBody = PhysicsMath.vec3(
    hardpoint.x,
    sim.vehicle.planarSupportBodyYByCorner[index],
    hardpoint.z,
  );
  return PhysicsMath.vec3Add(
    sim.vehicle.rigidBody.position,
    PhysicsMath.quatRotateVec3(sim.vehicle.rigidBody.orientation,supportBody),
  );
}

// Racerrhi renders each wheel from bridge hubWorldPos. Suspension contactPointWorld
// is a force-evaluation coordinate from the beginning of the fixed step; the bridge
// must instead expose the same support line reconstructed at the current t + dt
// chassis pose so fast motion cannot leave the wheel meshes one step behind.
function wheelSupportAlignment(turn:{state:any}) {
  const state = turn.state;
  const sim:any = state._m5;
  const decorated = sim.vehicle.getState();
  let maxDecoratedMigrationM = 0;
  let maxCurrentSupportErrorM = 0;
  let maxStaleContactLagM = 0;

  state.wheels.forEach((wheel:any,index:number)=>{
    const susp = sim.vehicle.suspension.states[index];
    const stalePhysical = susp.contactPointWorld;
    const currentSupport = endOfStepSupportWorld(sim,index);
    const bridgeError = Math.hypot(
      wheel.hubWorldPos.x - currentSupport.x,
      wheel.hubWorldPos.z - currentSupport.z,
    );
    maxCurrentSupportErrorM = Math.max(maxCurrentSupportErrorM, bridgeError);
    maxStaleContactLagM = Math.max(
      maxStaleContactLagM,
      Math.hypot(currentSupport.x-stalePhysical.x,currentSupport.z-stalePhysical.z),
    );
    assert(bridgeError < 1e-9, wheel.id+' rendered hub lagged the current chassis support line');
    assert(near(wheel.hubWorldPos.y,susp.hubPositionWorldY,1e-9), wheel.id+' rendered hub height diverged from unsprung state');
    assert(near(wheel.groundContactPos.x,currentSupport.x,1e-9));
    assert(near(wheel.groundContactPos.z,currentSupport.z,1e-9));

    const donorHub = decorated.wheels[index]?.hubWorldPos;
    if(donorHub) {
      maxDecoratedMigrationM = Math.max(
        maxDecoratedMigrationM,
        Math.hypot(donorHub.x-stalePhysical.x,donorHub.z-stalePhysical.z),
      );
    }
  });

  return { maxDecoratedMigrationM, maxCurrentSupportErrorM, maxStaleContactLagM };
}
const leftWheelSupport = wheelSupportAlignment(leftTurn);
const rightWheelSupport = wheelSupportAlignment(rightTurn);

// High-speed visual/physics transform probe: reproduce the reported 150+ km/h
// cornering regime and measure wheel-center drift in the renderer's yaw-local frame.
function highSpeedTurnProbe(direction:-1|1) {
  const state:any = newCar(0,0,0);
  setCarPose(state,0,0,0,160/3.6);
  let peakRollRad = 0;
  let peakPitchRad = 0;
  let peakYawRadS = 0;
  let peakSlipRad = 0;
  let maxLocalLateralDeviationM = 0;
  let maxLocalLongitudinalDeviationM = 0;
  let maxStaleContactLagM = 0;
  const staticById:any = {
    FL:{x:.842,z:1.367}, FR:{x:-.842,z:1.367},
    RL:{x:.830,z:-1.638}, RR:{x:-.830,z:-1.638},
  };

  for(let i=0;i<240;i++) {
    stepCar(state,{analogSteerTarget:direction*.16,analogSteerActive:true,throttle:.28},M5_FIXED_DT);
    peakRollRad = Math.max(peakRollRad,Math.abs(state.physicalPose.rollRad));
    peakPitchRad = Math.max(peakPitchRad,Math.abs(state.physicalPose.pitchRad));
    peakYawRadS = Math.max(peakYawRadS,Math.abs(state.yawRate));
    peakSlipRad = Math.max(peakSlipRad,Math.abs(state.slip));

    const cy=Math.cos(state.physicalPose.yawRad), sy=Math.sin(state.physicalPose.yawRad);
    for(const wheel of state.wheels) {
      const nominal=staticById[wheel.id];
      const dx=wheel.hubWorldPos.x-state.physicalPose.position.x;
      const dz=wheel.hubWorldPos.z-state.physicalPose.position.z;
      const localX=cy*dx-sy*dz;
      const localZ=sy*dx+cy*dz;
      maxLocalLateralDeviationM=Math.max(maxLocalLateralDeviationM,Math.abs(localX-nominal.x));
      maxLocalLongitudinalDeviationM=Math.max(maxLocalLongitudinalDeviationM,Math.abs(localZ-nominal.z));
      const stale=(state as any)._m5.vehicle.suspension.states[wheel.id==='FL'?0:wheel.id==='FR'?1:wheel.id==='RL'?2:3].contactPointWorld;
      maxStaleContactLagM=Math.max(maxStaleContactLagM,Math.hypot(wheel.hubWorldPos.x-stale.x,wheel.hubWorldPos.z-stale.z));
    }
  }

  return {
    peakRollRad,
    peakPitchRad,
    peakYawRadS,
    peakSlipRad,
    maxLocalLateralDeviationM,
    maxLocalLongitudinalDeviationM,
    maxStaleContactLagM,
    finalSpeedKmh:state.speed*3.6,
  };
}
const highSpeedLeft=highSpeedTurnProbe(1);
const highSpeedRight=highSpeedTurnProbe(-1);
for(const probe of [highSpeedLeft,highSpeedRight]) {
  assert(probe.finalSpeedKmh > 150, 'high-speed wheel sync probe fell below 150 km/h');
  assert(probe.maxLocalLongitudinalDeviationM < .08, 'rendered wheel centers still trail the chassis fore/aft above 150 km/h');
  assert(probe.maxLocalLateralDeviationM < .08, 'rendered wheel centers still leave the chassis laterally above 150 km/h');
  assert(probe.maxStaleContactLagM > .25, 'probe no longer demonstrates the beginning-of-step contact lag it is guarding against');
}

// -----------------------------------------------------------------------------
// 3) Sustained corner -> lift -> brake -> throttle exit remains progressive.
// -----------------------------------------------------------------------------
type PhaseMetric = {
  name:string;
  peakYawRadS:number;
  peakSlipRad:number;
  peakGripUtilization:number;
  maxWheelForceStepN:number;
  minNormalLoadN:number;
  endSlipRad:number;
  endYawRadS:number;
};

let drivePhases:PhaseMetric[]=[];
{
  const state:any=newCar(0,0,0);
  setCarPose(state,0,0,0,60/3.6);
  for(let i=0;i<30;i++) stepCar(state,{analogSteerTarget:0,analogSteerActive:true,throttle:.2},M5_FIXED_DT);

  let previousForces=state.wheels.map((w:any)=>Math.hypot(w.forceLongitudinalN,w.forceLateralN));
  const runPhase=(name:string,steps:number,input:any)=>{
    const metric:PhaseMetric={
      name,peakYawRadS:0,peakSlipRad:0,peakGripUtilization:0,maxWheelForceStepN:0,
      minNormalLoadN:Number.POSITIVE_INFINITY,endSlipRad:0,endYawRadS:0,
    };
    for(let i=0;i<steps;i++){
      stepCar(state,input,M5_FIXED_DT);
      assert(finiteState(state),name+' produced non-finite state');
      metric.peakYawRadS=Math.max(metric.peakYawRadS,Math.abs(state.yawRate));
      metric.peakSlipRad=Math.max(metric.peakSlipRad,Math.abs(state.slip));
      for(let w=0;w<state.wheels.length;w++){
        const wheel=state.wheels[w];
        metric.peakGripUtilization=Math.max(metric.peakGripUtilization,wheel.gripUtilization);
        metric.minNormalLoadN=Math.min(metric.minNormalLoadN,wheel.normalLoadN);
        const force=Math.hypot(wheel.forceLongitudinalN,wheel.forceLateralN);
        metric.maxWheelForceStepN=Math.max(metric.maxWheelForceStepN,Math.abs(force-previousForces[w]));
        previousForces[w]=force;
      }
    }
    metric.endSlipRad=state.slip;
    metric.endYawRadS=state.yawRate;
    drivePhases.push(metric);
    return metric;
  };

  const sustained=runPhase('sustained-corner',180,{analogSteerTarget:-.35,analogSteerActive:true,throttle:.28});
  const lift=runPhase('lift-off',60,{analogSteerTarget:-.35,analogSteerActive:true,throttle:0});
  const braking=runPhase('braking-in-corner',60,{analogSteerTarget:-.35,analogSteerActive:true,throttle:0,brake:.30});
  const exit=runPhase('throttle-exit-and-unwind',120,{analogSteerTarget:0,analogSteerActive:true,throttle:.38,brake:0});

  assert(sustained.peakYawRadS>.05,'sustained corner did not build measurable yaw response');
  for(const phase of [sustained,lift,braking,exit]){
    assert(phase.peakYawRadS<1.5,phase.name+' yaw response became unrecoverable');
    assert(phase.peakSlipRad<.45,phase.name+' sideslip became unrecoverable');
    assert(phase.minNormalLoadN>100,phase.name+' lost a tire contact under moderate loading');
    assert(phase.maxWheelForceStepN<12000,phase.name+' produced a discontinuous wheel-force step');
  }
  assert(Math.abs(exit.endSlipRad)<.10,'car did not settle sideslip after steering unwind and throttle exit');
}

// -----------------------------------------------------------------------------
// 4) A modest slide is catchable through donor digital countersteer.
// -----------------------------------------------------------------------------
let slideReport:any;
{
  const state:any=newCar(0,0,0);
  setCarPose(state,0,0,0,80/3.6);
  const sim:any=state._m5;
  const forward=80/3.6;
  sim.vehicle.rigidBody.velocity=PhysicsMath.vec3(-Math.tan(8*Math.PI/180)*forward,0,forward);
  sim.vehicle.rigidBody.angularVelocity=PhysicsMath.vec3(0,.45,0);
  refreshCarState(state);

  const initialSlip=Math.abs(state.slip);
  const initialYaw=Math.abs(state.yawRate);
  const initialError=initialSlip+initialYaw*.35;
  let bestError=initialError;
  let peakSlip=initialSlip;
  let peakYaw=initialYaw;
  for(let i=0;i<120;i++){
    stepCar(state,{digitalSteerDirection:-1,throttle:.12},M5_FIXED_DT);
    const error=Math.abs(state.slip)+Math.abs(state.yawRate)*.35;
    bestError=Math.min(bestError,error);
    peakSlip=Math.max(peakSlip,Math.abs(state.slip));
    peakYaw=Math.max(peakYaw,Math.abs(state.yawRate));
    assert(finiteState(state),'countersteer recovery produced non-finite state');
  }
  for(let i=0;i<60;i++) stepCar(state,{digitalSteerDirection:0,throttle:.15},M5_FIXED_DT);

  assert(bestError<initialError*.80,'modest slide did not respond to opposite-lock recovery');
  assert(peakSlip<.45,'modest slide snapped into excessive sideslip during recovery');
  assert(peakYaw<1.5,'modest slide snapped into excessive yaw rate during recovery');
  assert(Math.abs(state.slip)<initialSlip,'sideslip did not settle after catch and steering release');

  slideReport={
    initialSlipDeg:initialSlip*180/Math.PI,
    initialYawDegS:initialYaw*180/Math.PI,
    bestErrorRatio:bestError/initialError,
    finalSlipDeg:Math.abs(state.slip)*180/Math.PI,
    finalYawDegS:Math.abs(state.yawRate)*180/Math.PI,
  };
}

// -----------------------------------------------------------------------------
// 5) Stop, reverse signed motion, deliberate restart, and pause/resume semantics.
// -----------------------------------------------------------------------------
let stopReverseReport:any;
{
  const state:any=newCar(0,0,0);
  setCarPose(state,0,0,0,10);
  const sim:any=state._m5;
  for(let i=0;i<360;i++) stepCar(state,{digitalSteerDirection:0,brake:1},M5_FIXED_DT);
  const stoppedSpeed=state.speed;
  assert(stoppedSpeed<4,'sustained braking did not bring the M5 to a bounded near-stop');

  for(let i=0;i<15;i++) stepCar(state,{digitalSteerDirection:1,throttle:.1},M5_FIXED_DT);
  assert(sim.stepCount>0);
  setCarPose(state,1,2,0,-4);
  assert.equal(sim.stepCount,0,'deliberate restart did not reset donor simulation history');
  assert(state.localVelocityMs.forward<0,'reverse spawn lost signed forward velocity');
  assert.equal(state.slip,0,'straight reverse motion should not manufacture sideslip');

  const clock=createM5StepScheduler();
  let pauseSteps=0;
  consumeM5FrameTime(clock,M5_FIXED_DT*.5,()=>pauseSteps++);
  pauseM5StepScheduler(clock);
  consumeM5FrameTime(clock,M5_FIXED_DT,()=>pauseSteps++);
  assert.equal(pauseSteps,1,'pause/resume carried stale fractional simulation time');

  stopReverseReport={
    stoppedSpeedMs:stoppedSpeed,
    reverseForwardVelocityMs:state.localVelocityMs.forward,
    restartStepCount:sim.stepCount,
    resumedSteps:pauseSteps,
  };
}

// -----------------------------------------------------------------------------
// 6) Boundary response preserves simulation history and cannot inject speed energy.
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
  const postImpactStraightStepCount = sim.stepCount;
  let postImpactCornerPeakYaw = 0;
  let postImpactCornerPeakSlip = 0;
  for(let i=0;i<120;i++) {
    stepCar(state,{digitalSteerDirection:1,throttle:.18},M5_FIXED_DT);
    postImpactCornerPeakYaw = Math.max(postImpactCornerPeakYaw, Math.abs(state.yawRate));
    postImpactCornerPeakSlip = Math.max(postImpactCornerPeakSlip, Math.abs(state.slip));
  }
  assert.equal(postImpactStraightStepCount, stepCountBefore + 120, 'normal driving after contact did not continue the same simulation history');
  assert.equal(sim.stepCount, stepCountBefore + 240, 'post-impact cornering did not continue the same simulation history');
  assert(postImpactCornerPeakYaw > .04, 'post-impact steering no longer built normal cornering yaw');
  assert(postImpactCornerPeakYaw < 1.5, 'post-impact cornering became unstable');
  assert(postImpactCornerPeakSlip < .45, 'post-impact cornering retained excessive sideslip');
  assert(finiteState(state), 'post-boundary cornering produced non-finite state');

  boundaryReport = {
    legacyBoundaryWouldResetStepCountTo: 0,
    fixedStepCountBeforeContact: stepCountBefore,
    fixedStepCountAfterContact: state.boundaryContact.simulationStepCount,
    speedMsBeforeContact: Math.sqrt(speedSqBefore),
    speedMsAfterContact: Math.sqrt(speedSqAfter),
    outwardSpeedBeforeMs: firstContactTelemetry.outwardSpeedBeforeMs,
    outwardSpeedAfterMs: firstContactTelemetry.outwardSpeedAfterMs,
    postImpactCornerPeakYawDegS: postImpactCornerPeakYaw * 180 / Math.PI,
    postImpactCornerPeakSlipDeg: postImpactCornerPeakSlip * 180 / Math.PI,
  };
}

// -----------------------------------------------------------------------------
// 7) Snapshot interpolation: angle wrap, physical height and wheel identity.
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
// 8) One timing owner: deterministic 30/60/120 Hz render cadence + stall reporting.
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
  wheelSupportSync:{
    leftTurnDecoratedMigrationMm:leftWheelSupport.maxDecoratedMigrationM*1000,
    rightTurnDecoratedMigrationMm:rightWheelSupport.maxDecoratedMigrationM*1000,
    leftTurnCurrentSupportErrorMm:leftWheelSupport.maxCurrentSupportErrorM*1000,
    rightTurnCurrentSupportErrorMm:rightWheelSupport.maxCurrentSupportErrorM*1000,
    leftTurnStaleContactLagMm:leftWheelSupport.maxStaleContactLagM*1000,
    rightTurnStaleContactLagMm:rightWheelSupport.maxStaleContactLagM*1000,
  },
  highSpeedTurnProbe:{
    left:{
      peakRollDeg:highSpeedLeft.peakRollRad*180/Math.PI,
      peakPitchDeg:highSpeedLeft.peakPitchRad*180/Math.PI,
      supportBodyYByCornerM:(leftTurn.state as any)._m5.vehicle.planarSupportBodyYByCorner,
      peakYawDegS:highSpeedLeft.peakYawRadS*180/Math.PI,
      peakSideslipDeg:highSpeedLeft.peakSlipRad*180/Math.PI,
      maxLocalLateralDeviationMm:highSpeedLeft.maxLocalLateralDeviationM*1000,
      maxLocalLongitudinalDeviationMm:highSpeedLeft.maxLocalLongitudinalDeviationM*1000,
      staleContactLagMm:highSpeedLeft.maxStaleContactLagM*1000,
      finalSpeedKmh:highSpeedLeft.finalSpeedKmh,
    },
    right:{
      peakRollDeg:highSpeedRight.peakRollRad*180/Math.PI,
      peakPitchDeg:highSpeedRight.peakPitchRad*180/Math.PI,
      supportBodyYByCornerM:(rightTurn.state as any)._m5.vehicle.planarSupportBodyYByCorner,
      peakYawDegS:highSpeedRight.peakYawRadS*180/Math.PI,
      peakSideslipDeg:highSpeedRight.peakSlipRad*180/Math.PI,
      maxLocalLateralDeviationMm:highSpeedRight.maxLocalLateralDeviationM*1000,
      maxLocalLongitudinalDeviationMm:highSpeedRight.maxLocalLongitudinalDeviationM*1000,
      staleContactLagMm:highSpeedRight.maxStaleContactLagM*1000,
      finalSpeedKmh:highSpeedRight.finalSpeedKmh,
    },
    renderRollClampDeg:.20*180/Math.PI,
  },
  drivePhases:drivePhases.map(phase=>({
    name:phase.name,
    peakYawDegS:phase.peakYawRadS*180/Math.PI,
    peakSideslipDeg:phase.peakSlipRad*180/Math.PI,
    peakGripUtilization:phase.peakGripUtilization,
    maxWheelForceStepN:phase.maxWheelForceStepN,
    minNormalLoadN:phase.minNormalLoadN,
    endSideslipDeg:phase.endSlipRad*180/Math.PI,
  })),
  slideRecovery:slideReport,
  stopReverseRestart:stopReverseReport,
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
