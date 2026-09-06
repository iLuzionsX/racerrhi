import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  racerrhiFixedTouchCurve,
  racerrhiKeyboardTargetForM5,
  racerrhiSteeringTargetForM5,
  updateRacerrhiKeyboardSteeringInput,
} from './m5-steering-adapter';
import {
  newCar,
  setCarPose,
  setSurfaceSampler,
  stepCar,
  M5_FIXED_DT,
} from './m5-bridge';

const DEG = 180 / Math.PI;
setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

function setLocalMotion(sim: any, speedKmh: number, sideslipDeg = 0, yawRate = 0) {
  const speed = speedKmh / 3.6;
  const beta = sideslipDeg / DEG;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    Math.tan(beta) * speed,
    0,
    speed
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, yawRate, 0);
}

function smoothstep01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

// Reconstruct the previously shipped ordinary touch map only for A/B evidence.
function legacyOrdinaryTouchTarget(speedKmh: number, rawInput: number) {
  const raw = Math.max(-1, Math.min(1, rawInput));
  const speedMs = Math.abs(speedKmh) / 3.6;
  const roadBlend = smoothstep01((speedMs - 9) / 10);
  let scale = 1 + (0.30 - 1) * roadBlend;
  const highBlend = smoothstep01((Math.abs(speedKmh) - 100) / 120);
  scale = scale + (0.12 - scale) * highBlend;
  const precisionBlend = 0.25 * highBlend;
  const shaped = raw + (raw ** 3 - raw) * precisionBlend;
  return -shaped * scale;
}

const probe: any = newCar(0, 0, 0);
const sim = probe._m5;

// Touch: fixed mapping, symmetry, no deadzone, useful fine control, full endpoint.
const touchSpeeds = [0, 50, 80, 120, 150, 200];
const touchInputs = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
const touchMatrix: any[] = [];
for (const raw of touchInputs) {
  const baseline = racerrhiSteeringTargetForM5(sim, raw);
  let previousMagnitude = 0;
  for (const speed of touchSpeeds) {
    setLocalMotion(sim, speed, speed >= 80 ? 7 : 0, speed >= 80 ? 0.45 : 0);
    const right = racerrhiSteeringTargetForM5(sim, raw);
    const left = racerrhiSteeringTargetForM5(sim, -raw);
    assert(Math.abs(right - baseline) < 1e-12, 'touch target changed with vehicle state');
    assert(Math.abs(left + right) < 1e-12, 'touch map lost left/right symmetry');
    assert(Math.abs(right) > 0, 'touch map introduced a deadzone');
    if (speed === 0) {
      assert(Math.abs(right) >= previousMagnitude);
      previousMagnitude = Math.abs(right);
    }
  }
  touchMatrix.push({
    raw,
    shaped: racerrhiFixedTouchCurve(raw),
    fixedTarget: baseline,
    legacy: Object.fromEntries(touchSpeeds.map((speed) => [
      speed,
      legacyOrdinaryTouchTarget(speed, raw),
    ])),
  });
}
assert.equal(racerrhiFixedTouchCurve(1), 1);
assert.equal(racerrhiFixedTouchCurve(-1), -1);
assert(Math.abs(racerrhiFixedTouchCurve(0.1)) < 0.04, 'center shaping is not fine enough');
assert(Math.abs(racerrhiFixedTouchCurve(0.5)) > 0.18, 'midrange steering became unusably weak');
assert(
  Math.abs(legacyOrdinaryTouchTarget(200, 0.25) - legacyOrdinaryTouchTarget(50, 0.25)) > 0.1,
  'legacy A/B no longer demonstrates speed-dependent held-input gain'
);

// Keyboard: normal hold time should remain roughly constant even as the useful
// amplitude envelope gets much smaller at road speed.
function keyboardWindTime(speedKmh: number, direction: -1 | 1) {
  setLocalMotion(sim, speedKmh, 0, 0);
  const target = racerrhiKeyboardTargetForM5(sim, direction);
  let current = 0;
  let steps = 0;
  for (; steps < 1000 && Math.abs(current - target) > 1e-10; steps++) {
    setLocalMotion(sim, speedKmh, 0, 0);
    current = updateRacerrhiKeyboardSteeringInput(
      sim,
      current,
      direction,
      M5_FIXED_DT
    );
  }
  return { target, current, seconds: steps * M5_FIXED_DT, steps };
}

function keyboardTapFraction(speedKmh: number, direction: -1 | 1, seconds = 0.10) {
  setLocalMotion(sim, speedKmh, 0, 0);
  const target = racerrhiKeyboardTargetForM5(sim, direction);
  let current = 0;
  const steps = Math.round(seconds / M5_FIXED_DT);
  for (let i = 0; i < steps; i++) {
    setLocalMotion(sim, speedKmh, 0, 0);
    current = updateRacerrhiKeyboardSteeringInput(
      sim,
      current,
      direction,
      M5_FIXED_DT
    );
  }
  return { target, current, fraction: Math.abs(current / target) };
}

const keyboardMatrix: any[] = [];
for (const speed of [0, 50, 80, 120, 150, 200]) {
  const left = keyboardWindTime(speed, 1);
  const right = keyboardWindTime(speed, -1);
  assert(Math.abs(left.target + right.target) < 1e-12, 'keyboard target lost symmetry');
  assert(left.seconds >= 0.55 && left.seconds <= 0.61, 'keyboard wind-on time drifted: ' + JSON.stringify({ speed, left }));
  assert(Math.abs(left.seconds - right.seconds) <= M5_FIXED_DT, 'keyboard timing lost direction symmetry');

  const tap = keyboardTapFraction(speed, 1);
  assert(tap.fraction > 0.15 && tap.fraction < 0.20, 'short key tap is not repeatable across speed: ' + JSON.stringify({ speed, tap }));

  // Release should be much faster than wind-on.
  setLocalMotion(sim, speed, 0, 0);
  let released = left.target;
  let releaseSteps = 0;
  for (; releaseSteps < 240 && Math.abs(released) > 1e-6; releaseSteps++) {
    setLocalMotion(sim, speed, 0, 0);
    released = updateRacerrhiKeyboardSteeringInput(sim, released, 0, M5_FIXED_DT);
  }
  assert(releaseSteps * M5_FIXED_DT < 0.25, 'keyboard release is too slow');

  // Opposite input must unwind immediately, cross center quickly, then ramp the
  // other direction rather than teleporting through center.
  let reversed = left.target;
  let crossedAt = null as number | null;
  let previous = reversed;
  for (let i = 0; i < 240; i++) {
    setLocalMotion(sim, speed, 0, 0);
    reversed = updateRacerrhiKeyboardSteeringInput(sim, reversed, -1, M5_FIXED_DT);
    if (i === 0) assert(Math.abs(reversed) < Math.abs(previous), 'opposite key did not begin unwinding immediately');
    if (crossedAt === null && reversed <= 0) crossedAt = (i + 1) * M5_FIXED_DT;
    previous = reversed;
  }
  assert(crossedAt !== null && crossedAt < 0.22, 'keyboard reversal took too long to cross center');

  keyboardMatrix.push({
    speedKmh: speed,
    leftTarget: left.target,
    windSeconds: left.seconds,
    tap100msFractionOfLimit: tap.fraction,
    releaseSeconds: releaseSteps * M5_FIXED_DT,
    reversalCenterCrossSeconds: crossedAt,
  });
}

// Severe recovery keeps full keyboard authority, but the new adapter ramps it
// rather than injecting a state-dependent steering jump.
const recoveryMatrix: any[] = [];
for (const speed of [80, 120, 150, 200]) {
  for (const direction of [-1, 1] as const) {
    setLocalMotion(sim, speed, direction * 18, -direction * 1.05);
    const target = racerrhiKeyboardTargetForM5(sim, direction);
    assert(Math.abs(target) > 0.99, 'severe countersteer authority was lost');
    let current = 0;
    let maxStep = 0;
    let steps = 0;
    for (; steps < 240 && Math.abs(current - target) > 1e-8; steps++) {
      setLocalMotion(sim, speed, direction * 18, -direction * 1.05);
      const next = updateRacerrhiKeyboardSteeringInput(sim, current, direction, M5_FIXED_DT);
      maxStep = Math.max(maxStep, Math.abs(next - current));
      current = next;
    }
    assert(steps * M5_FIXED_DT >= 0.28, 'recovery steering arrived as an abrupt gain jump');
    assert(steps * M5_FIXED_DT <= 0.34, 'recovery steering became too slow');
    recoveryMatrix.push({ speedKmh: speed, direction, target, seconds: steps * M5_FIXED_DT, maxStep });
  }
}

// Actual bridge/vehicle response with identical small input requests. These are
// not "lower yaw wins" assertions; they verify finite, symmetric, recoverable
// response while recording mapped target, effective steering, road-wheel angle,
// speed, yaw and sideslip at the requested road speeds.
function runVehicleCase(
  speedKmh: number,
  kind: 'touch' | 'keyboard',
  sign: -1 | 1,
  pedals: { throttle?: number; brake?: number } = {}
) {
  const state: any = newCar(0, 0, 0);
  setCarPose(state, 0, 0, 0, speedKmh / 3.6);
  const trace: any[] = [];
  let peakYaw = 0;
  let peakSlip = 0;
  for (let i = 0; i < 96; i++) {
    const active = i < 24;
    const control: any = {
      throttle: pedals.throttle || 0,
      brake: pedals.brake || 0,
      digitalSteerDirection: 0,
    };
    let raw = 0;
    let mapped = 0;
    if (kind === 'touch') {
      raw = active ? sign * 0.08 : 0;
      control.analogSteerActive = active;
      control.analogSteerTarget = raw;
      mapped = racerrhiSteeringTargetForM5(state._m5, raw);
    } else {
      control.digitalSteerDirection = active ? sign : 0;
      mapped = racerrhiKeyboardTargetForM5(state._m5, active ? sign : 0);
      raw = active ? sign : 0;
    }
    stepCar(state, control, M5_FIXED_DT);
    const effective = kind === 'touch'
      ? state._m5.analogSteeringInput
      : state._m5.digitalSteeringInput;
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate));
    peakSlip = Math.max(peakSlip, Math.abs(state.slip));
    if (i % 12 === 0 || i === 23 || i === 24 || i === 95) {
      trace.push({
        step: i + 1,
        raw,
        mappedTarget: mapped,
        effectiveSteer: effective,
        roadWheelAngleRad: state.steer,
        speedKmh: state.speed * 3.6,
        yawRateRadS: state.yawRate,
        sideslipRad: state.slip,
      });
    }
    for (const value of [
      effective,
      state.steer,
      state.speed,
      state.yawRate,
      state.slip,
    ]) assert(Number.isFinite(value));
  }
  assert(peakSlip < 12 / DEG, 'small correction became an unrecoverable slide');
  return { peakYaw, peakSlip, finalSlip: state.slip, trace };
}

const responseMatrix: any[] = [];
for (const speed of [50, 80, 120, 150, 200]) {
  for (const kind of ['touch', 'keyboard'] as const) {
    const left = runVehicleCase(speed, kind, 1);
    const right = runVehicleCase(speed, kind, -1);
    const yawSymmetry = Math.abs(left.peakYaw - right.peakYaw) / Math.max(0.02, left.peakYaw, right.peakYaw);
    assert(yawSymmetry < 0.18, 'left/right vehicle response lost symmetry: ' + JSON.stringify({ speed, kind, left: left.peakYaw, right: right.peakYaw }));
    responseMatrix.push({
      speedKmh: speed,
      kind,
      left,
      right,
      yawSymmetry,
    });
  }
}

// Held touch position must retain the same mapped target while pedals change the
// vehicle state. Physical yaw/sideslip may differ naturally; control gain may not.
const pedalCases = [
  { name: 'coast', pedals: {} },
  { name: 'partial-brake', pedals: { brake: 0.45 } },
  { name: 'throttle', pedals: { throttle: 0.65 } },
].map(({ name, pedals }) => ({
  name,
  ...runVehicleCase(120, 'touch', 1, pedals),
}));
const fixedPedalTarget = racerrhiSteeringTargetForM5(sim, 0.08);
for (const item of pedalCases) {
  for (const sample of item.trace.filter((x: any) => x.raw !== 0)) {
    assert(Math.abs(sample.mappedTarget - fixedPedalTarget) < 1e-12, 'pedal state changed held touch mapping');
  }
}

console.log(JSON.stringify({
  status: 'passed',
  scenario: 'fixed touch mapping and time-normalized keyboard steering',
  touchMatrix,
  keyboardMatrix,
  recoveryMatrix,
  responseMatrix,
  pedalCases,
}, null, 2));
