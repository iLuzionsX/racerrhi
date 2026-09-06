import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { racerrhiSteeringTargetForM5 } from './m5-steering-adapter';
import { newCar, setSurfaceSampler, stepCar, M5_FIXED_DT } from './m5-bridge';

setSurfaceSampler((x, z) => ({ p: { x, y: 0, z }, d: { x: 0, y: 0, z: 1 }, distance: 0, side: 0, t: 0 }));
const probe: any = newCar(0, 0, 0);
const sim = probe._m5;
function target(speed: number, hand: number) {
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speed / 3.6);
  return racerrhiSteeringTargetForM5(sim, hand);
}

// Sweep the complete range, including reverse. No deadzone, speed discontinuity,
// left/right asymmetry, or steering gain increase as speed rises is acceptable.
let previous = 1;
let maxGainChangePerKmh = 0;
for (let speed = 0; speed <= 300; speed += 0.25) {
  const lock = Math.abs(target(speed, 1));
  assert(lock <= previous + 1e-12);
  maxGainChangePerKmh = Math.max(maxGainChangePerKmh, (previous - lock) / 0.25);
  previous = lock;
  let prior = 0;
  for (const hand of [0, 0.001, 0.05, 0.25, 0.5, 0.75, 1]) {
    const right = target(speed, hand), left = target(speed, -hand);
    assert(Math.abs(left + right) < 1e-12);
    assert(Math.abs(target(-speed, hand) - right) < 1e-12);
    assert(Math.abs(right) >= prior);
    if (hand > 0) assert(Math.abs(right) > 0);
    prior = Math.abs(right);
  }
}
// Preserve the proven low/mid-speed transition's maximum gain slope.
assert(maxGainChangePerKmh < 0.030, 'braking unlocks steering too abruptly');
assert.equal(Math.abs(target(20, 1)), 1, 'parking lock lost');
assert(Math.abs(Math.abs(target(100, 1)) - 0.3) < 1e-12);
assert(Math.abs(target(200, 1)) < Math.abs(target(150, 1)));
assert(Math.abs(target(200, 0.1)) < 0.025, 'high-speed corrections remain too sensitive');
for (const speed of [80, 150, 220]) {
  for (const direction of [-1, 1]) {
    sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(-direction * Math.tan(18 * Math.PI / 180) * speed / 3.6, 0, speed / 3.6);
    sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, direction * 1.05, 0);
    assert(Math.abs(racerrhiSteeringTargetForM5(sim, direction)) > 0.99, 'severe opposite lock lost');
  }
}
sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0, 0);

// Drive the production bridge in both directions at high speed. Compare a small
// half-second hand ramp with the previously shipped fixed .3 rack ratio, then
// release. This checks actual yaw response and neutral return, not just the map.
function drive(speed: number, sign: number, legacy: boolean) {
  const state: any = newCar(0, 0, 0);
  for (let i = 0; i < 240; i++) stepCar(state, { digitalSteerDirection: 0 }, M5_FIXED_DT);
  // Accelerate naturally so gearbox, wheel speed and suspension are settled.
  for (let i = 0; state.speed * 3.6 < speed && i < 6000; i++) {
    stepCar(state, { digitalSteerDirection: 0, throttle: 1 }, M5_FIXED_DT);
  }
  assert(state.speed * 3.6 >= speed, 'failed to reach test speed');
  let peakYaw = 0, peakSlip = 0;
  for (let i = 0; i < 360; i++) {
    const raw = i < 180 ? sign * 0.25 * Math.min(1, (i + 1) / 60) : 0;
    if (legacy) {
      state._m5.stepExplicit({ throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, analogSteerTarget: -raw * 0.3 }, 1);
    } else {
      stepCar(state, { analogSteerActive: i < 180, analogSteerTarget: raw, digitalSteerDirection: 0 }, M5_FIXED_DT);
    }
    const telemetry = state._m5.vehicle.getState();
    peakYaw = Math.max(peakYaw, Math.abs(telemetry.yawRate));
    const v = state._m5.vehicle.rigidBody.getLocalVelocity();
    peakSlip = Math.max(peakSlip, Math.abs(Math.atan2(v.x, Math.abs(v.z))));
    assert(Number.isFinite(peakYaw) && Number.isFinite(peakSlip));
  }
  assert(Math.abs(state._m5.analogSteeringInput) < 1e-5, 'release left steering latched');
  return { peakYaw, peakSlip };
}
const cases = [];
for (const speed of [150, 200]) for (const sign of [-1, 1]) {
  const legacy = drive(speed, sign, true), revised = drive(speed, sign, false);
  assert(revised.peakYaw > 0.02, 'high-speed steering lost useful response');
  assert(revised.peakYaw < legacy.peakYaw * 0.95, 'small correction did not become calmer');
  assert(revised.peakSlip < 10 * Math.PI / 180, 'small correction caused a slide: ' + JSON.stringify({ speed, sign, legacy, revised }));
  cases.push({ speed, sign, legacy, revised });
}
console.log(JSON.stringify({ status: 'passed', maxGainChangePerKmh, cases }, null, 2));
