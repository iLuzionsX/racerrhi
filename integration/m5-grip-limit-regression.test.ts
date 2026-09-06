import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  stepCar,
  setCarPose,
  refreshCarState,
} from './m5-bridge';

const DEG = 180 / Math.PI;

setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

type Variant = {
  name: string;
  config: Record<string, number>;
};

const variants: Variant[] = [
  { name: 'baseline', config: {} },
  { name: 'latRelax035', config: { relaxationLength: 0.35 } },
  { name: 'latRelax025', config: { relaxationLength: 0.25 } },
  { name: 'slide090', config: { slideFrictionMultiplier: 0.90 } },
  {
    name: 'combinedSoft',
    config: {
      tireCombinedSlipLongitudinalB: 3.8,
      tireCombinedSlipLateralB: 3.4,
    },
  },
];

function makeState(speedMs: number, overrides: Record<string, number> = {}) {
  const state: any = newCar(0, 0, 0);
  const sim: any = state._m5;
  if (Object.keys(overrides).length) {
    sim.setConfig({ ...sim.vehicle.config, ...overrides });
  }
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

function stepResponse(overrides: Record<string, number>) {
  const { state } = makeState(90 / 3.6, overrides);
  for (let i = 0; i < 36; i++) {
    stepCar(state, { analogSteerTarget: 0, analogSteerActive: true, throttle: 0.16 }, M5_FIXED_DT);
  }

  const yaw: number[] = [];
  const frontFy: number[] = [];
  let maxForceStepN = 0;
  let previous = state.wheels.map(forceMagnitude);
  let minNormalLoadN = Number.POSITIVE_INFINITY;
  let peakGripUtilization = 0;

  for (let i = 0; i < 120; i++) {
    stepCar(state, { analogSteerTarget: -0.32, analogSteerActive: true, throttle: 0.20 }, M5_FIXED_DT);
    assert(finiteState(state));
    yaw.push(Math.abs(state.yawRate));
    frontFy.push(Math.abs(state.wheels[0].forceLateralN + state.wheels[1].forceLateralN));
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
    peakBodySlipDeg: Math.max(...yaw.map((_, i) => i >= 0 ? 0 : 0), Math.abs(state.slip) * DEG),
    yaw90Ms: yaw90 < 0 ? null : yaw90 * M5_FIXED_DT * 1000,
    frontFy90Ms: fy90 < 0 ? null : fy90 * M5_FIXED_DT * 1000,
    unwindYaw20Ms: yaw20 < 0 ? null : yaw20 * M5_FIXED_DT * 1000,
    unwindFy20Ms: fy20 < 0 ? null : fy20 * M5_FIXED_DT * 1000,
    maxForceStepN,
    minNormalLoadN,
    peakGripUtilization,
  };
}

function reversalDecomposition(overrides: Record<string, number>) {
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
  };

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

  for (let i = 0; i < 120; i++) {
    stepCar(state, { digitalSteerDirection: -1, throttle: 0.12 }, M5_FIXED_DT);
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
    stepCar(state, { digitalSteerDirection: 0, throttle: 0.15 }, M5_FIXED_DT);
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

const report: Record<string, any> = {};
for (const variant of variants) {
  report[variant.name] = {
    config: variant.config,
    step: stepResponse(variant.config),
    reversal: reversalDecomposition(variant.config),
    trailBrake: trailBrake(variant.config),
    throttleExit: throttleExit(variant.config),
    slideRecovery: slideRecovery(variant.config),
  };
}

const baseline = report.baseline;
assert(baseline.step.peakYawDegS > 3, 'baseline steering step did not build yaw');
assert(baseline.step.minNormalLoadN > 100, 'baseline moderate corner unloaded a tire');
assert(baseline.trailBrake.peakGripUtilization <= 1.001, 'combined-slip envelope exceeded its bound');
assert(baseline.slideRecovery.bestErrorRatio < 0.80, 'baseline slide did not respond to countersteer');
assert(baseline.slideRecovery.peakSlipDeg < 30, 'baseline slide recovery ran away');
assert(Object.values(report).every((entry: any) => Number.isFinite(entry.step.maxForceStepN)));

console.log(JSON.stringify({
  scenario: 'Racerrhi M5 grip-limit diagnostic sweep',
  fixedStepHz: 1 / M5_FIXED_DT,
  report,
}, null, 2));
