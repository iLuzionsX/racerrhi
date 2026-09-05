import { strict as assert } from 'node:assert';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  createRacerrhiM5Config,
  RACERRHI_M5_REFERENCE_LOADS,
} from './m5-config';

const surface = {
  sampleSurface(_x:number,_z:number) {
    return {
      elevation: 0,
      normal: PhysicsMath.vec3(0,1,0),
      slopePitch: 0,
      slopeRoll: 0,
      type: 'asphalt',
      friction: 1.0,
      rollingResistance: 0.015,
      wetness: 0,
      isKerbRumble: false,
    };
  },
};

const config = createRacerrhiM5Config();

assert(Math.abs(RACERRHI_M5_REFERENCE_LOADS.frontN - 6367.123393537501) < 1e-6);
assert(Math.abs(RACERRHI_M5_REFERENCE_LOADS.rearN - 5315.6718239625) < 1e-6);
assert(RACERRHI_M5_REFERENCE_LOADS.frontN > RACERRHI_M5_REFERENCE_LOADS.rearN);

function makeSim() {
  const sim = new Simulation(config, surface as any);
  sim.reset(0,0,0);
  sim.vehicle.rigidBody.position.y = config.centerOfGravityHeight;
  sim.vehicle.suspension.reset();
  sim.suspensionKinematics.reset();
  return sim;
}

function internalReferenceLoads(sim: Simulation) {
  return sim.vehicle.wheels.map((wheel:any) => ({
    configured: Number(wheel.tireModel?.config?.referenceLoadN),
    inferred: Number(wheel.tireModel?.inferredReferenceLoadN),
  }));
}

function assertPinned(loads:{configured:number;inferred:number}[]) {
  const expected = [
    RACERRHI_M5_REFERENCE_LOADS.frontN,
    RACERRHI_M5_REFERENCE_LOADS.frontN,
    RACERRHI_M5_REFERENCE_LOADS.rearN,
    RACERRHI_M5_REFERENCE_LOADS.rearN,
  ];
  loads.forEach((load,i) => {
    assert(Number.isFinite(load.configured));
    assert(Number.isFinite(load.inferred));
    assert(Math.abs(load.configured - expected[i]) < 1e-6);
    assert(Math.abs(load.inferred - expected[i]) < 1e-6);
  });
}

const calm = makeSim();
for (let i=0;i<320;i++) {
  calm.stepExplicit({throttle:0,brake:0,steer:0,analogSteerTarget:0,handbrake:false,shiftUp:false,shiftDown:false} as any,1);
}
const calmLoads = internalReferenceLoads(calm);
assertPinned(calmLoads);

const aggressive = makeSim();
for (let i=0;i<320;i++) {
  const firstHalf = i < 160;
  aggressive.stepExplicit({
    throttle: firstHalf ? 1 : 0.55,
    brake: 0,
    steer: 0,
    analogSteerTarget: firstHalf ? -0.42 : 0.30,
    handbrake: false,
    shiftUp: false,
    shiftDown: false,
  } as any,1);
}
const aggressiveLoads = internalReferenceLoads(aggressive);
assertPinned(aggressiveLoads);

for (let i=0;i<4;i++) {
  assert(Math.abs(calmLoads[i].inferred - aggressiveLoads[i].inferred) < 1e-9);
}

console.log(JSON.stringify({
  scenario: 'Racerrhi deterministic M5 tire reference-load baseline',
  frontReferenceLoadN: RACERRHI_M5_REFERENCE_LOADS.frontN,
  rearReferenceLoadN: RACERRHI_M5_REFERENCE_LOADS.rearN,
  calmLoads,
  aggressiveLoads,
  status: 'passed',
}, null, 2));
