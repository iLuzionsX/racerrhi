import { strict as assert } from 'node:assert';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { digitalSteeringTarget } from '../.vendor/Racing26/src/physics/DigitalSteeringInput';
import { createRacerrhiM5Config } from './m5-config';
import { racerrhiSteeringTargetForM5 } from './m5-steering-adapter';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  setCarPose,
  stepCar,
  captureM5RenderSnapshot,
  rebaseM5RenderSnapshotPose,
} from './m5-bridge';

const DEG = 180 / Math.PI;
const SPEED_MS = 70 / 3.6;
const TOUCH_LEFT = -0.40;
const TOUCH_RIGHT = 0.40;

const surface = {
  elevation: 0,
  normal: PhysicsMath.vec3(0, 1, 0),
  slopePitch: 0,
  slopeRoll: 0,
  type: 'asphalt',
  friction: 1,
  rollingResistance: 0.015,
  wetness: 0,
  isKerbRumble: false,
};

setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

type Control = {
  digitalSteerDirection?: -1 | 0 | 1;
  analogSteerTarget?: number;
  analogSteerActive?: boolean;
};

type Context = {
  sim: Simulation;
  state?: any;
  corrected: boolean;
};

function makeContext(corrected: boolean): Context {
  if (corrected) {
    const state: any = newCar(0, 0, 0);
    setCarPose(state, 0, 0, 0, SPEED_MS);
    return { sim: state._m5, state, corrected };
  }

  const config: any = createRacerrhiM5Config();
  const sim = new Simulation(config, { sampleSurface: () => surface } as any);
  sim.vehicle.powertrain.isAutomatic = true;
  sim.reset(0, 0, 0);
  sim.vehicle.rigidBody.position.y = config.centerOfGravityHeight;
  sim.vehicle.suspension.reset();
  sim.suspensionKinematics.reset();
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, SPEED_MS);
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(SPEED_MS));
  return { sim, corrected };
}

function digitalRequest(sim: Simulation, direction: -1 | 0 | 1) {
  const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
  const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localVelocity.x, localVelocity.z);
  const sideslipRad =
    speedMs > 0.5
      ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
      : 0;
  return digitalSteeringTarget(direction, speedMs, {
    wheelbaseM: sim.vehicle.config.wheelbase,
    maxSteerAngleRad: sim.vehicle.config.maxSteerAngle,
    yawRateRadS: localAngularVelocity.y,
    sideslipRad,
    forwardSpeedMs: localVelocity.z,
  });
}

function requested(sim: Simulation, control: Control) {
  if (control.analogSteerActive) {
    return racerrhiSteeringTargetForM5(sim, Number(control.analogSteerTarget) || 0);
  }
  const direction = control.digitalSteerDirection ?? 0;
  if (direction === 0 && Math.abs(sim.analogSteeringInput) > 1e-5) return 0;
  return digitalRequest(sim, direction);
}

function legacyStep(ctx: Context, control: Control) {
  const sim = ctx.sim;
  let steering: any;
  if (control.analogSteerActive) {
    steering = {
      analogSteerTarget: racerrhiSteeringTargetForM5(
        sim,
        Number(control.analogSteerTarget) || 0,
      ),
    };
  } else {
    const direction = control.digitalSteerDirection ?? 0;
    if (direction === 0 && Math.abs(sim.analogSteeringInput) > 1e-5) {
      steering = { analogSteerTarget: 0 };
    } else {
      steering = { digitalSteerDirection: direction };
    }
  }

  sim.stepExplicit({
    throttle: 0.18,
    brake: 0,
    steer: 0,
    ...steering,
    handbrake: false,
    shiftUp: false,
    shiftDown: false,
  }, 1);
}

function doStep(ctx: Context, control: Control) {
  const request = requested(ctx.sim, control);
  if (ctx.corrected) {
    stepCar(ctx.state, { ...control, throttle: 0.18 }, M5_FIXED_DT);
  } else {
    legacyStep(ctx, control);
  }
  return { ...sample(ctx), requested: request };
}

function sample(ctx: Context) {
  const raw: any = ctx.corrected ? ctx.state : ctx.sim.vehicle.getState();
  const vx = Number(raw.localVelocityMs?.lateral ?? raw.vx) || 0;
  const vz = Number(raw.localVelocityMs?.forward ?? raw.vz) || 0;
  const speed = Math.hypot(vx, vz);
  const slip = ctx.corrected
    ? Number(raw.slip) || 0
    : speed > 0.5
      ? Math.atan2(vx, Math.max(0.5, Math.abs(vz)))
      : 0;
  const effective =
    Math.abs(ctx.sim.analogSteeringInput) > 1e-8
      ? ctx.sim.analogSteeringInput
      : ctx.sim.digitalSteeringInput;
  return {
    effective,
    actualRoadWheelRad: Number(raw.steer ?? raw.actualSteerAngle) || 0,
    yawRateRadS: Number(raw.yawRate) || 0,
    sideslipRad: slip,
  };
}

function warm(ctx: Context, control: Control, steps = 72) {
  let out: any = null;
  for (let i = 0; i < steps; i++) out = doStep(ctx, control);
  return out;
}

function transition(start: Control, next: Control) {
  const legacy = makeContext(false);
  const corrected = makeContext(true);
  warm(legacy, start);
  warm(corrected, start);
  const legacyBefore = sample(legacy);
  const correctedBefore = sample(corrected);
  const legacyAfter = doStep(legacy, next);
  const correctedAfter = doStep(corrected, next);

  const metric = (before: any, after: any) => ({
    requested: after.requested,
    beforeEffective: before.effective,
    afterEffective: after.effective,
    effectiveJump: Math.abs(after.effective - before.effective),
    actualRoadWheelJumpDeg: Math.abs(after.actualRoadWheelRad - before.actualRoadWheelRad) * DEG,
    yawRateJumpDegS: Math.abs(after.yawRateRadS - before.yawRateRadS) * DEG,
    sideslipJumpDeg: Math.abs(after.sideslipRad - before.sideslipRad) * DEG,
  });

  return {
    legacy: metric(legacyBefore, legacyAfter),
    corrected: metric(correctedBefore, correctedAfter),
  };
}

const scenarios = {
  sameDirectionTouchTakeover: transition(
    { digitalSteerDirection: 1 },
    { digitalSteerDirection: 1, analogSteerTarget: TOUCH_LEFT, analogSteerActive: true },
  ),
  oppositeDirectionTouchTakeover: transition(
    { digitalSteerDirection: 1 },
    { digitalSteerDirection: 1, analogSteerTarget: TOUCH_RIGHT, analogSteerActive: true },
  ),
  sameDirectionKeyboardReturn: transition(
    { analogSteerTarget: TOUCH_LEFT, analogSteerActive: true },
    { digitalSteerDirection: 1 },
  ),
  oppositeDirectionKeyboardReturn: transition(
    { analogSteerTarget: TOUCH_LEFT, analogSteerActive: true },
    { digitalSteerDirection: -1 },
  ),
  releaseTouchToNeutral: transition(
    { analogSteerTarget: TOUCH_LEFT, analogSteerActive: true },
    { digitalSteerDirection: 0, analogSteerActive: false },
  ),
  keyboardCountersteer: transition(
    { digitalSteerDirection: 1 },
    { digitalSteerDirection: -1 },
  ),
};

assert(
  scenarios.sameDirectionTouchTakeover.corrected.effectiveJump <=
    scenarios.sameDirectionTouchTakeover.legacy.effectiveJump * 0.35,
  'same-direction keyboard-to-touch handoff still drops too much effective steering',
);
assert(
  scenarios.sameDirectionKeyboardReturn.corrected.effectiveJump <=
    scenarios.sameDirectionKeyboardReturn.legacy.effectiveJump * 0.35,
  'same-direction touch-to-keyboard handoff still drops too much effective steering',
);

for (const key of ['oppositeDirectionTouchTakeover', 'oppositeDirectionKeyboardReturn'] as const) {
  const c = scenarios[key].corrected;
  const l = scenarios[key].legacy;
  assert(
    c.beforeEffective * c.afterEffective > 0,
    key + ' crossed steering center in one fixed step instead of rate-limited reversal',
  );
  assert(
    l.beforeEffective * l.afterEffective < 0,
    key + ' legacy trace no longer reproduces the ownership discontinuity',
  );
}

assert(
  scenarios.releaseTouchToNeutral.corrected.effectiveJump <=
    scenarios.releaseTouchToNeutral.legacy.effectiveJump + 1e-9,
  'touch release-to-neutral became less continuous',
);
assert(
  scenarios.keyboardCountersteer.corrected.beforeEffective *
    scenarios.keyboardCountersteer.corrected.afterEffective > 0,
  'keyboard countersteer crossed center in one fixed step',
);
assert(
  scenarios.keyboardCountersteer.corrected.effectiveJump > 0,
  'opposite keyboard input did not begin unwinding immediately',
);
assert(
  scenarios.keyboardCountersteer.corrected.effectiveJump <
    scenarios.keyboardCountersteer.legacy.effectiveJump,
  'time-normalized keyboard reversal is not more progressive than the legacy fixed-rack slew',
);

// Chassis/wheel coherence: a presentation-only pose change must preserve each
// wheel's chassis-local hub offset exactly instead of retaining stale world hubs.
const poseState: any = newCar(4, -3, 0.27);
setCarPose(poseState, 4, -3, 0.27, 12);
for (let i = 0; i < 12; i++) {
  stepCar(
    poseState,
    { analogSteerTarget: -0.25, analogSteerActive: true, throttle: 0.1 },
    M5_FIXED_DT,
  );
}
const source = captureM5RenderSnapshot(poseState);
const staged = rebaseM5RenderSnapshotPose(source, {
  x: 120,
  y: 8.5,
  z: -65,
  yawRad: -1.1,
  pitchRad: 0,
  rollRad: 0,
  speedMs: 0,
});

function localHub(snapshot: any, wheel: any) {
  const dx = wheel.hubWorldPos.x - snapshot.x;
  const dz = wheel.hubWorldPos.z - snapshot.z;
  const c = Math.cos(snapshot.yawRad);
  const s = Math.sin(snapshot.yawRad);
  return {
    x: c * dx - s * dz,
    y: wheel.hubWorldPos.y - snapshot.y,
    z: s * dx + c * dz,
  };
}
for (const wheel of source.wheels) {
  const moved = staged.wheels.find((candidate: any) => candidate.id === wheel.id);
  assert(moved, 'rebased snapshot lost wheel ' + wheel.id);
  const before = localHub(source, wheel);
  const after = localHub(staged, moved);
  assert(Math.abs(before.x - after.x) < 1e-9, wheel.id + ' local hub X changed');
  assert(Math.abs(before.y - after.y) < 1e-9, wheel.id + ' local hub Y changed');
  assert(Math.abs(before.z - after.z) < 1e-9, wheel.id + ' local hub Z changed');
  assert.equal(moved.steerAngleRad, wheel.steerAngleRad);
  assert.equal(moved.rotationAngleRad, wheel.rotationAngleRad);
}

console.log(JSON.stringify({
  scenario: 'Racerrhi mixed steering ownership and staged-pose coherence',
  speedKmh: SPEED_MS * 3.6,
  touchTargets: { left: TOUCH_LEFT, right: TOUCH_RIGHT },
  measurements: scenarios,
  stagedPoseWheelLocalOffsetsPreserved: true,
}, null, 2));
