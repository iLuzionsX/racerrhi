import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import * as THREE from 'three';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { SuspensionSystem } from '../.vendor/Racing26/src/physics/Suspension';
import { createRacerrhiM5Config } from './m5-config';
import { newCar, stepCar, setSurfaceSampler, resolveBoundaryContact } from './m5-bridge';

const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = createRacerrhiM5Config();
const baseline = process.env.RACERRHI_EXPECT_LEGACY_LOAD_BUG === '1';

// A steady translated road/chassis/hub must have the same tire compression and
// load as the stationary case. Capture the real M5 suspension configuration,
// then isolate the suspension solve from tire shear, aero and driver feedback.
const sim = new Simulation(config, { sampleSurface: () => ({ elevation: 0, normal: { x: 0, y: 1, z: 0 }, slopePitch: 0, slopeRoll: 0, type: 'asphalt', friction: 1, rollingResistance: .015, wetness: 0, isKerbRumble: false }) } as any);
sim.reset(0, 0, 0);
for (let i = 0; i < 600; i++) sim.stepExplicit(neutral, 1);
let captured: any[] = [];
let initialStates: any;
const suspension = sim.vehicle.suspension;
const originalUpdate = suspension.update.bind(suspension);
suspension.update = (...args: any[]) => {
  captured = args;
  initialStates = structuredClone(suspension.states);
  return (originalUpdate as any)(...args);
};
sim.stepExplicit(neutral, 1);
function translatedLoads(verticalSpeed: number) {
  const test = new SuspensionSystem();
  Object.assign(test, structuredClone(Object.fromEntries(Object.entries(suspension).filter(([, value]) => typeof value !== 'function'))));
  test.states = structuredClone(initialStates);
  // The local wrapper above is not part of the copied own state.
  delete (test as any).update;
  test.states.forEach(s => { s.hubVelocityWorldY += verticalSpeed; });
  const args = [...captured];
  args[3] = { ...args[3], z: 30, y: args[3].y + verticalSpeed };
  args[5] = () => ({ elevation: 0, normal: { x: 0, y: 1, z: -verticalSpeed / 30 } });
  (test.update as any)(...args);
  return test.states.map(s => s.tireNormalForceN);
}
const stationary = translatedLoads(0);
const translating = [-1.5, -.5, .5, 1.5].map(verticalSpeed => ({ verticalSpeed, loads: translatedLoads(verticalSpeed) }));
for (const c of translating) {
  const error = Math.max(...c.loads.map((load, i) => Math.abs(load - stationary[i])));
  if (baseline) assert(error > 100, 'legacy timing defect no longer reproduced');
  else assert(error < 1e-6, `steady grade invented/lost tire load: ${JSON.stringify(c)}`);
}

// Execute the track sampling code shipped in game.js so this test includes the
// actual first uphill corner and cannot silently become a flat skidpad test.
const game = fs.readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');
const start = game.indexOf('const points=');
const end = game.indexOf('setSurfaceSampler(', start);
assert(start >= 0 && end > start, 'could not find production track definition');
const { at, nearest, length, N } = new Function('T', 'V', 'clamp', '$', game.slice(start, end) + '\nreturn {at,nearest,length,N};')(
  THREE, (x: number, y: number, z: number) => new THREE.Vector3(x, y, z), THREE.MathUtils.clamp, () => ({ textContent: '' }),
);

function driveCorner(lookaheadM: number, flatten: boolean) {
  setSurfaceSampler((x, z) => {
    const road = nearest(x, z);
    if (flatten) { road.p.y = 0; road.d.y = 0; }
    return road;
  });
  const start = at(2 / N);
  const car: any = newCar(start.p.x, start.p.z, Math.atan2(start.d.x, start.d.z));
  let peakSlipDeg = 0, peakYawDegS = 0, minLoadN = Infinity, contacts = 0;
  let maxDistanceM = 0, firstSpin: any = null, station = 0, cornerEntryKmh = 0;
  let stabilizerSteps = 0;
  let preStabilizer: any;
  const body = car._m5.vehicle.rigidBody;
  const vehicleStep = car._m5.vehicle.step.bind(car._m5.vehicle);
  car._m5.vehicle.step = (...args: any[]) => {
    vehicleStep(...args);
    preStabilizer = { p: { ...body.position }, v: { ...body.velocity }, w: { ...body.angularVelocity } };
  };
  for (let i = 0; i < 3000; i++) {
    const road = nearest(car.x, car.z);
    const target = at(road.t + lookaheadM / length).p;
    const angle = Math.atan2(target.x - car.x, target.z - car.z) - car.heading;
    // Test-only pure pursuit driver: ordinary analog steering through the actual
    // bridge, no pose/velocity edits, no grip assist, and a 119 km/h speed target.
    const raw = -Math.atan2(2 * config.wheelbase * Math.sin(angle), lookaheadM) / config.maxSteerAngle / .3;
    stepCar(car, { digitalSteerDirection: 0, analogSteerActive: true, analogSteerTarget: raw, throttle: THREE.MathUtils.clamp((119 - car.speed * 3.6) * .5, 0, 1) });
    if (['x', 'y', 'z'].some(k => body.position[k] !== preStabilizer.p[k] || body.velocity[k] !== preStabilizer.v[k] || body.angularVelocity[k] !== preStabilizer.w[k])) stabilizerSteps++;
    const after = nearest(car.x, car.z);
    station = after.t;
    if (!cornerEntryKmh && station >= .18) cornerEntryKmh = car.speed * 3.6;
    const slipDeg = Math.abs(car.slip) * 180 / Math.PI;
    peakSlipDeg = Math.max(peakSlipDeg, slipDeg);
    peakYawDegS = Math.max(peakYawDegS, Math.abs(car.yawRate) * 180 / Math.PI);
    minLoadN = Math.min(minLoadN, ...car.wheels.map((w: any) => w.normalLoadN));
    maxDistanceM = Math.max(maxDistanceM, after.distance);
    if (!firstSpin && slipDeg > 17) firstSpin = { timeS: i / 120, station, speedKmh: car.speed * 3.6, distanceM: after.distance, allAsphalt: car.wheels.every((w: any) => w.surfaceFriction === 1), contacts };
    if (after.distance > 14.5) {
      contacts++;
      resolveBoundaryContact(car, { roadPoint: after.p, roadNormal: after.n, side: after.side >= 0 ? 1 : -1, distanceM: after.distance, limitDistanceM: 14.4 });
    }
    if (station > .25) break;
  }
  return { lookaheadM, flatten, cornerEntryKmh, peakSlipDeg, peakYawDegS, minLoadN, maxDistanceM, contacts, firstSpin, station, stabilizerSteps };
}
const runs = [10, 15, 20, 30].map(lookahead => driveCorner(lookahead, false));
runs.push(driveCorner(20, true));
for (const run of runs) {
  assert(run.station > .25, 'did not complete first corner');
  assert(run.cornerEntryKmh > 118 && run.cornerEntryKmh < 120, 'wrong corner entry speed');
  assert.equal(run.stabilizerSteps, 0, 'crash stabilization masked the first-corner result');
  if (baseline && !run.flatten) {
    assert(run.peakSlipDeg > 60 && run.firstSpin?.allAsphalt && run.firstSpin.contacts === 0, 'legacy asphalt spin not reproduced');
  } else {
    assert(run.peakSlipDeg < 4, `first uphill corner spins: ${JSON.stringify(run)}`);
    assert(run.peakYawDegS < 22, 'first corner yaw ran away');
    assert(run.minLoadN > 1500, 'first corner lost tire load');
    assert(run.maxDistanceM < 3, 'first corner left the usable road');
    assert.equal(run.contacts, 0, 'first corner required a barrier correction');
  }
}
console.log(JSON.stringify({ scenario: '119 km/h actual first uphill corner and grade load invariance', baseline, stationary, translating, runs, status: 'passed' }, null, 2));
