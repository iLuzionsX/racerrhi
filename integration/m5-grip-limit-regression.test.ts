import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { updateDigitalSteeringInput } from '../.vendor/Racing26/src/physics/DigitalSteeringInput';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  stepCar,
  setCarPose,
  refreshCarState,
} from './m5-bridge';
import {
  RACING26_M5_LATERAL_RELAXATION_LENGTH_M,
  RACERRHI_M5_LATERAL_RELAXATION_LENGTH_M,
} from './m5-config';

const DEG = 180 / Math.PI;
const BASELINE = { relaxationLength: RACING26_M5_LATERAL_RELAXATION_LENGTH_M };
const CORRECTED = { relaxationLength: RACERRHI_M5_LATERAL_RELAXATION_LENGTH_M };

setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

function makeState(speedMs: number, overrides: Record<string, number>) {
  const state: any = newCar(0, 0, 0);
  const sim: any = state._m5;
  sim.setConfig({ ...sim.vehicle.config, ...overrides });
  setCarPose(state, 0, 0, 0, speedMs);
  return { state, sim };
}

function finiteState(state: any) {
  return [
    state.x,
    state.y,
    state.z,
    state.heading,
    state.speed,
    state.yawRate,
    state.slip,
    ...state.wheels.flatMap((w: any) => [
      w.normalLoadN,
      w.slipAngleRad,
      w.slipRatio,
      w.forceLongitudinalN,
      w.forceLateralN,
      w.gripUtilization,
    ]),
  ].every(Number.isFinite);
}

function forceMagnitude(w: any) {
  return Math.hypot(w.forceLongitudinalN, w.forceLateralN);
}

function frontInternal(sim: any, state: any) {
  let rawSlip = 0;
  let relaxedSlip = 0;
  let actualFy = 0;
  let targetFy = 0;
  for (let i = 0; i < 2; i++) {
    const wheel: any = sim.vehicle.wheels[i];
    const susp: any = sim.vehicle.suspension.states[i];
    const telemetry: any = state.wheels[i];
    rawSlip += wheel.rawSlipAngle * 0.5;
    relaxedSlip += wheel.relaxationSlipAngle * 0.5;
    actualFy += telemetry.forceLateralN;

    // Diagnostic-only access to the donor tire target lets this regression
    // separate slip-state lag from the second force-state relaxation stage.
    const tireModel: any = wheel.tireModel;
    const tempError = Math.abs(wheel.temperature - wheel.tireConfig.optimalTemp);
    const thermalGrip = PhysicsMath.clamp(1.02 - tempError * 0.0018, 0.88, 1.02);
    const wearGrip = PhysicsMath.clamp(1 - wheel.wearPercent * 0.0022, 0.70, 1.0);
    const target = tireModel.calculate({
      slipRatio: wheel.relaxationSlipRatio,
      slipAngle: wheel.relaxationSlipAngle,
      verticalLoad: susp.tireNormalForceN,
      camberDeg: susp.dynamicCamberDeg,
      surfaceFriction: telemetry.surfaceFriction,
      gripScale: thermalGrip * wearGrip,
      isLeft: wheel.isLeft,
    });
    targetFy += target.fy;
  }
  return { rawSlip, relaxedSlip, targetFy, actualFy };
}

function firstIndexAtOrAbove(values: number[], threshold: number) {
  return values.findIndex((value) => value >= threshold);
}

function steeringStep(overrides: Record<string, number>) {
  const { state } = makeState(90 / 3.6, overrides);
  for (let i = 0; i < 36; i++) {
    stepCar(state, { analogSteerTarget: 0, analogSteerActive: true, throttle: 0.16 }, M5_FIXED_DT);
  }

  const yaw: number[] = [];
  const frontFy: number[] = [];
  let peakBodySlip = 0;
  let maxForceStepN = 0;
  let previous = state.wheels.map(forceMagnitude);
  let minNormalLoadN = Number.POSITIVE_INFINITY;
  let peakGripUtilization = 0;

  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: -0.32, analogSteerActive: true, throttle: 0.20 }, M5_FIXED_DT);
    assert(finiteState(state));
    yaw.push(Math.abs(state.yawRate));
    frontFy.push(Math.abs(state.wheels[0].forceLateralN + state.wheels[1].forceLateralN));
    peakBodySlip = Math.max(peakBodySlip, Math.abs(state.slip));
    state.wheels.forEach((wheel: any, index: number) => {
      minNormalLoadN = Math.min(minNormalLoadN, wheel.normalLoadN);
      peakGripUtilization = Math.max(peakGripUtilization, wheel.gripUtilization);
      const force = forceMagnitude(wheel);
      maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previous[index]));
      previous[index] = force;
    });
  }

  const peakYaw = Math.max(...yaw);
  const peakFrontFy = Math.max(...frontFy);
  const yaw90 = firstIndexAtOrAbove(yaw, peakYaw * 0.90);
  const fy90 = firstIndexAtOrAbove(frontFy, peakFrontFy * 0.90);

  const unwindYaw: number[] = [];
  const unwindFy: number[] = [];
  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: 0, analogSteerActive: true, throttle: 0.18 }, M5_FIXED_DT);
    unwindYaw.push(Math.abs(state.yawRate));
    unwindFy.push(Math.abs(state.wheels[0].forceLateralN + state.wheels[1].forceLateralN));
  }
  const yaw20 = unwindYaw.findIndex((value) => value <= peakYaw * 0.20);
  const fy20 = unwindFy.findIndex((value) => value <= peakFrontFy * 0.20);

  return {
    peakYawDegS: peakYaw * DEG,
    peakFrontLateralForceN: peakFrontFy,
    peakBodySlipDeg: peakBodySlip * DEG,
    yaw90Ms: yaw90 < 0 ? null : yaw90 * M5_FIXED_DT * 1000,
    frontFy90Ms: fy90 < 0 ? null : fy90 * M5_FIXED_DT * 1000,
    unwindYaw20Ms: yaw20 < 0 ? null : yaw20 * M5_FIXED_DT * 1000,
    unwindFy20Ms: fy20 < 0 ? null : fy20 * M5_FIXED_DT * 1000,
    maxForceStepN,
    minNormalLoadN,
    peakGripUtilization,
  };
}

function steeringReversal(overrides: Record<string, number>) {
  const { state, sim } = makeState(65 / 3.6, overrides);
  for (let i = 0; i < 84; i++) {
    stepCar(state, { analogSteerTarget: -0.30, analogSteerActive: true, throttle: 0.18 }, M5_FIXED_DT);
  }

  const before = frontInternal(sim, state);
  const oldRawSign = Math.sign(before.rawSlip) || 1;
  const oldRelaxedSign = Math.sign(before.relaxedSlip) || oldRawSign;
  const oldTargetSign = Math.sign(before.targetFy) || 1;
  const oldActualSign = Math.sign(before.actualFy) || oldTargetSign;

  const reversal = {
    rawSlipMs: null as number | null,
    relaxedSlipMs: null as number | null,
    targetFyMs: null as number | null,
    actualFyMs: null as number | null,
    maxRawRelaxDeltaDeg: 0,
    maxTargetActualDeltaN: 0,
    maxForceStepN: 0,
  };
  let previous = state.wheels.map(forceMagnitude);

  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: 0.30, analogSteerActive: true, throttle: 0.18 }, M5_FIXED_DT);
    const sample = frontInternal(sim, state);
    reversal.maxRawRelaxDeltaDeg = Math.max(
      reversal.maxRawRelaxDeltaDeg,
      Math.abs(sample.rawSlip - sample.relaxedSlip) * DEG,
    );
    reversal.maxTargetActualDeltaN = Math.max(
      reversal.maxTargetActualDeltaN,
      Math.abs(sample.targetFy - sample.actualFy),
    );
    state.wheels.forEach((wheel: any, index: number) => {
      const force = forceMagnitude(wheel);
      reversal.maxForceStepN = Math.max(reversal.maxForceStepN, Math.abs(force - previous[index]));
      previous[index] = force;
    });
    const ms = (i + 1) * M5_FIXED_DT * 1000;
    if (reversal.rawSlipMs === null && Math.sign(sample.rawSlip) === -oldRawSign && Math.abs(sample.rawSlip) > 1e-4) reversal.rawSlipMs = ms;
    if (reversal.relaxedSlipMs === null && Math.sign(sample.relaxedSlip) === -oldRelaxedSign && Math.abs(sample.relaxedSlip) > 1e-4) reversal.relaxedSlipMs = ms;
    if (reversal.targetFyMs === null && Math.sign(sample.targetFy) === -oldTargetSign && Math.abs(sample.targetFy) > 100) reversal.targetFyMs = ms;
    if (reversal.actualFyMs === null && Math.sign(sample.actualFy) === -oldActualSign && Math.abs(sample.actualFy) > 100) reversal.actualFyMs = ms;
  }

  return {
    ...reversal,
    slipRelaxationAddedDelayMs:
      reversal.rawSlipMs !== null && reversal.relaxedSlipMs !== null
        ? reversal.relaxedSlipMs - reversal.rawSlipMs
        : null,
    forceRelaxationAddedDelayMs:
      reversal.targetFyMs !== null && reversal.actualFyMs !== null
        ? reversal.actualFyMs - reversal.targetFyMs
        : null,
  };
}

function slalom(overrides: Record<string, number>) {
  const { state } = makeState(80 / 3.6, overrides);
  let positivePeakYaw = 0;
  let negativePeakYaw = 0;
  let peakSlip = 0;
  let maxForceStepN = 0;
  let previous = state.wheels.map(forceMagnitude);

  for (let i = 0; i < 360; i++) {
    const direction = Math.floor(i / 45) % 2 === 0 ? -1 : 1;
    stepCar(state, {
      analogSteerTarget: direction * 0.30,
      analogSteerActive: true,
      throttle: 0.20,
    }, M5_FIXED_DT);
    assert(finiteState(state));
    positivePeakYaw = Math.max(positivePeakYaw, state.yawRate);
    negativePeakYaw = Math.min(negativePeakYaw, state.yawRate);
    peakSlip = Math.max(peakSlip, Math.abs(state.slip));
    state.wheels.forEach((wheel: any, index: number) => {
      const force = forceMagnitude(wheel);
      maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previous[index]));
      previous[index] = force;
    });
  }

  for (let i = 0; i < 90; i++) {
    stepCar(state, { analogSteerTarget: 0, analogSteerActive: true, throttle: 0.16 }, M5_FIXED_DT);
  }

  const left = Math.abs(positivePeakYaw);
  const right = Math.abs(negativePeakYaw);
  return {
    leftPeakYawDegS: left * DEG,
    rightPeakYawDegS: right * DEG,
    yawSymmetryError: Math.abs(left - right) / Math.max(0.01, left, right),
    peakBodySlipDeg: peakSlip * DEG,
    maxForceStepN,
    settledSlipDeg: Math.abs(state.slip) * DEG,
    settledYawDegS: Math.abs(state.yawRate) * DEG,
  };
}

function constantRadiusSweep(overrides: Record<string, number>) {
  const targetRadiusM = 90;
  const speedsKmh = [50, 70, 90, 110];
  return speedsKmh.map((speedKmh) => {
    const targetSpeed = speedKmh / 3.6;
    const { state } = makeState(targetSpeed, overrides);
    let steerCommand = 0.14;
    let maxForceStepN = 0;
    let previous = state.wheels.map(forceMagnitude);
    const radiusSamples: number[] = [];
    const slipSamples: number[] = [];
    const gripSamples: number[] = [];

    for (let i = 0; i < 480; i++) {
      const targetYaw = Math.max(0.03, state.speed / targetRadiusM);
      const yawError = targetYaw - Math.abs(state.yawRate);
      steerCommand = PhysicsMath.clamp(steerCommand + yawError * 0.70 * M5_FIXED_DT, 0.03, 0.62);
      const speedError = targetSpeed - state.speed;
      const throttle = PhysicsMath.clamp(0.16 + speedError * 0.08, 0, 0.72);
      const brake = PhysicsMath.clamp(-speedError * 0.05, 0, 0.25);

      stepCar(state, {
        analogSteerTarget: -steerCommand,
        analogSteerActive: true,
        throttle,
        brake,
      }, M5_FIXED_DT);
      assert(finiteState(state));

      state.wheels.forEach((wheel: any, index: number) => {
        const force = forceMagnitude(wheel);
        maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previous[index]));
        previous[index] = force;
      });

      if (i >= 360 && Math.abs(state.yawRate) > 0.03) {
        radiusSamples.push(state.speed / Math.abs(state.yawRate));
        slipSamples.push(Math.abs(state.slip));
        gripSamples.push(Math.max(...state.wheels.map((w: any) => w.gripUtilization)));
      }
    }

    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    return {
      speedKmh,
      targetRadiusM,
      meanRadiusM: mean(radiusSamples),
      radiusErrorRatio: Math.abs(mean(radiusSamples) - targetRadiusM) / targetRadiusM,
      meanBodySlipDeg: mean(slipSamples) * DEG,
      meanPeakWheelGripUtilization: mean(gripSamples),
      finalSteerCommand: steerCommand,
      maxForceStepN,
    };
  });
}

function trailBrake(overrides: Record<string, number>) {
  const { state } = makeState(85 / 3.6, overrides);
  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: -0.31, analogSteerActive: true, throttle: 0.20 }, M5_FIXED_DT);
  }

  const entryLateral = Math.abs(state.wheels.reduce((sum: number, w: any) => sum + w.forceLateralN, 0));
  let peakLongitudinal = 0;
  let minLateral = entryLateral;
  let peakGrip = 0;
  let peakSlip = Math.abs(state.slip);
  let maxForceStepN = 0;
  let previous = state.wheels.map(forceMagnitude);

  for (let i = 0; i < 84; i++) {
    const brake = 0.62 * (i / 83);
    stepCar(state, { analogSteerTarget: -0.31, analogSteerActive: true, throttle: 0, brake }, M5_FIXED_DT);
    assert(finiteState(state));
    const lateral = Math.abs(state.wheels.reduce((sum: number, w: any) => sum + w.forceLateralN, 0));
    const longitudinal = Math.abs(state.wheels.reduce((sum: number, w: any) => sum + w.forceLongitudinalN, 0));
    minLateral = Math.min(minLateral, lateral);
    peakLongitudinal = Math.max(peakLongitudinal, longitudinal);
    peakSlip = Math.max(peakSlip, Math.abs(state.slip));
    state.wheels.forEach((wheel: any, index: number) => {
      peakGrip = Math.max(peakGrip, wheel.gripUtilization);
      const force = forceMagnitude(wheel);
      maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previous[index]));
      previous[index] = force;
    });
  }

  return {
    entryLateralN: entryLateral,
    minLateralRetention: entryLateral > 1 ? minLateral / entryLateral : 0,
    peakLongitudinalN: peakLongitudinal,
    peakGripUtilization: peakGrip,
    peakBodySlipDeg: peakSlip * DEG,
    maxForceStepN,
  };
}

function throttleExit(overrides: Record<string, number>) {
  const { state } = makeState(75 / 3.6, overrides);
  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: -0.30, analogSteerActive: true, throttle: 0.18 }, M5_FIXED_DT);
  }

  let peakRearSlip = 0;
  let peakBodySlip = Math.abs(state.slip);
  let peakGrip = 0;
  for (let i = 0; i < 96; i++) {
    const t = i / 95;
    const throttle = 0.18 + 0.62 * t;
    const steer = -0.30 * (1 - t);
    stepCar(state, { analogSteerTarget: steer, analogSteerActive: true, throttle }, M5_FIXED_DT);
    peakRearSlip = Math.max(
      peakRearSlip,
      Math.abs(state.wheels[2].slipRatio),
      Math.abs(state.wheels[3].slipRatio),
    );
    peakBodySlip = Math.max(peakBodySlip, Math.abs(state.slip));
    state.wheels.forEach((w: any) => {
      peakGrip = Math.max(peakGrip, w.gripUtilization);
    });
  }
  for (let i = 0; i < 72; i++) {
    stepCar(state, { analogSteerTarget: 0, analogSteerActive: true, throttle: 0.30 }, M5_FIXED_DT);
  }

  return {
    peakRearSlipRatio: peakRearSlip,
    peakBodySlipDeg: peakBodySlip * DEG,
    peakGripUtilization: peakGrip,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
  };
}

function slideRecovery(overrides: Record<string, number>) {
  const { state, sim } = makeState(80 / 3.6, overrides);
  const forward = 80 / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    -Math.tan(8 * Math.PI / 180) * forward,
    0,
    forward,
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0.45, 0);
  refreshCarState(state);

  const initialSlip = Math.abs(state.slip);
  const initialYaw = Math.abs(state.yawRate);
  const initialError = initialSlip + initialYaw * 0.35;
  let bestError = initialError;
  let halfErrorMs: number | null = null;
  let peakSlip = initialSlip;
  let peakYaw = initialYaw;
  let maxForceStepN = 0;
  let previous = state.wheels.map(forceMagnitude);

  // This regression protects the tire-relaxation calibration, not Racerrhi's
  // current keyboard policy. Replay the pinned donor's original digital steering
  // law directly so its historical baseline/corrected A/B remains comparable.
  let donorDigitalSteer = 0;
  const donorKeyboardStep = (direction: -1 | 0 | 1, throttle: number) => {
    const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
    const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
    const speedMs = Math.hypot(localVelocity.x, localVelocity.z);
    const sideslipRad =
      speedMs > 0.5
        ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
        : 0;
    donorDigitalSteer = updateDigitalSteeringInput(
      donorDigitalSteer,
      direction,
      speedMs,
      M5_FIXED_DT,
      {
        wheelbaseM: sim.vehicle.config.wheelbase,
        maxSteerAngleRad: sim.vehicle.config.maxSteerAngle,
        yawRateRadS: localAngularVelocity.y,
        sideslipRad,
        forwardSpeedMs: localVelocity.z,
      },
    );
    sim.stepExplicit({
      throttle,
      brake: 0,
      steer: donorDigitalSteer,
      handbrake: false,
      shiftUp: false,
      shiftDown: false,
    }, 1);
    refreshCarState(state);
  };

  for (let i = 0; i < 120; i++) {
    donorKeyboardStep(-1, 0.12);
    const error = Math.abs(state.slip) + Math.abs(state.yawRate) * 0.35;
    bestError = Math.min(bestError, error);
    if (halfErrorMs === null && error <= initialError * 0.5) {
      halfErrorMs = (i + 1) * M5_FIXED_DT * 1000;
    }
    peakSlip = Math.max(peakSlip, Math.abs(state.slip));
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate));
    state.wheels.forEach((wheel: any, index: number) => {
      const force = forceMagnitude(wheel);
      maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previous[index]));
      previous[index] = force;
    });
  }
  for (let i = 0; i < 72; i++) {
    donorKeyboardStep(0, 0.15);
  }

  return {
    initialSlipDeg: initialSlip * DEG,
    initialYawDegS: initialYaw * DEG,
    halfErrorMs,
    bestErrorRatio: bestError / initialError,
    peakSlipDeg: peakSlip * DEG,
    peakYawDegS: peakYaw * DEG,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
    maxForceStepN,
  };
}

function run(overrides: Record<string, number>) {
  return {
    steeringStep: steeringStep(overrides),
    steeringReversal: steeringReversal(overrides),
    slalom: slalom(overrides),
    constantRadius: constantRadiusSweep(overrides),
    trailBrake: trailBrake(overrides),
    throttleExit: throttleExit(overrides),
    slideRecovery: slideRecovery(overrides),
  };
}

const baseline = run(BASELINE);
const corrected = run(CORRECTED);

// Acceptance criteria were fixed from the donor-baseline trace before applying
// the Racerrhi calibration. They deliberately protect useful cornering force and
// combined-slip behavior while requiring a real improvement in reversal/recovery.
assert(corrected.steeringStep.peakYawDegS >= baseline.steeringStep.peakYawDegS * 0.95,
  'steering response lost more than 5% peak yaw');
assert(corrected.steeringStep.peakFrontLateralForceN >= baseline.steeringStep.peakFrontLateralForceN * 0.97,
  'steering response lost more than 3% front lateral force');
assert((corrected.steeringStep.frontFy90Ms ?? Infinity) <= (baseline.steeringStep.frontFy90Ms ?? 0),
  'front cornering force builds more slowly than baseline');
assert(corrected.steeringStep.minNormalLoadN > 100,
  'moderate steering step unloaded a wheel');

assert((corrected.steeringReversal.forceRelaxationAddedDelayMs ?? Infinity) <=
  (baseline.steeringReversal.forceRelaxationAddedDelayMs ?? 0) * 0.55,
  'second-stage lateral force reversal lag was not cut by at least 45%');
assert(corrected.steeringReversal.maxTargetActualDeltaN <= baseline.steeringReversal.maxTargetActualDeltaN * 0.82,
  'stale target/actual lateral force mismatch was not reduced by at least 18%');

assert(corrected.slalom.yawSymmetryError < 0.12, 'left/right slalom response lost symmetry');
assert(corrected.slalom.peakBodySlipDeg < 12, 'slalom produced excessive body sideslip');
assert(corrected.slalom.maxForceStepN <= baseline.slalom.maxForceStepN * 1.05,
  'slalom force continuity regressed');
assert(corrected.slalom.settledSlipDeg < 0.5 && corrected.slalom.settledYawDegS < 1,
  'slalom did not settle after steering release');

for (let i = 0; i < corrected.constantRadius.length; i++) {
  const b = baseline.constantRadius[i];
  const c = corrected.constantRadius[i];
  assert(c.radiusErrorRatio < 0.22, 'constant-radius controller failed at ' + c.speedKmh + ' km/h');
  assert(c.maxForceStepN <= b.maxForceStepN * 1.08,
    'constant-radius force continuity regressed at ' + c.speedKmh + ' km/h');
}
for (let i = 1; i < corrected.constantRadius.length; i++) {
  assert(corrected.constantRadius[i].meanPeakWheelGripUtilization >=
    corrected.constantRadius[i - 1].meanPeakWheelGripUtilization * 0.93,
    'increasing-speed constant-radius test did not progress toward tire saturation');
}

assert(corrected.trailBrake.entryLateralN >= baseline.trailBrake.entryLateralN * 0.97,
  'trail-brake entry lateral force lost more than 3%');
assert(corrected.trailBrake.peakGripUtilization <= 1.001,
  'combined-slip envelope exceeded its bound under trail braking');
assert(corrected.trailBrake.peakBodySlipDeg <= baseline.trailBrake.peakBodySlipDeg + 0.5,
  'trail braking added excessive body sideslip');
assert(corrected.trailBrake.maxForceStepN <= baseline.trailBrake.maxForceStepN * 1.05,
  'trail-brake force continuity regressed');

assert(corrected.throttleExit.peakRearSlipRatio <= baseline.throttleExit.peakRearSlipRatio * 1.15,
  'power-on exit added excessive rear longitudinal slip');
assert(corrected.throttleExit.peakBodySlipDeg <= baseline.throttleExit.peakBodySlipDeg * 1.08,
  'power-on exit added excessive body sideslip');
assert(corrected.throttleExit.finalSlipDeg < 0.2 && corrected.throttleExit.finalYawDegS < 0.5,
  'power-on exit did not settle after unwind');

assert((corrected.slideRecovery.halfErrorMs ?? Infinity) <=
  (baseline.slideRecovery.halfErrorMs ?? 0) + M5_FIXED_DT * 1000 + 1e-6,
  'countersteer recovery became slower');
assert(corrected.slideRecovery.maxForceStepN <= baseline.slideRecovery.maxForceStepN * 0.85,
  'countersteer force spike was not reduced by at least 15%');
assert(corrected.slideRecovery.peakSlipDeg <= baseline.slideRecovery.peakSlipDeg + 0.25,
  'modest slide snapped to more sideslip');
assert(corrected.slideRecovery.bestErrorRatio < 0.30,
  'modest slide did not materially recover');
assert(corrected.slideRecovery.finalSlipDeg < 0.2 && corrected.slideRecovery.finalYawDegS < 0.5,
  'modest slide did not settle after catch/release');

console.log(JSON.stringify({
  scenario: 'Racerrhi M5 progressive grip-limit baseline vs corrected relaxation',
  fixedStepHz: 1 / M5_FIXED_DT,
  calibration: {
    donorBaselineLateralRelaxationLengthM: RACING26_M5_LATERAL_RELAXATION_LENGTH_M,
    racerrhiCorrectedLateralRelaxationLengthM: RACERRHI_M5_LATERAL_RELAXATION_LENGTH_M,
  },
  acceptanceCriteria: {
    peakYawRetention: '>=95% baseline',
    frontLateralForceRetention: '>=97% baseline',
    secondStageForceReversalLag: '<=55% baseline',
    targetActualForceMismatch: '<=82% baseline',
    slalomForceStep: '<=105% baseline',
    constantRadiusError: '<22%',
    trailBrakeForceStep: '<=105% baseline',
    countersteerForceStep: '<=85% baseline',
    settledSlipDeg: '<0.2 slide / <0.5 slalom',
  },
  baseline,
  corrected,
}, null, 2));
