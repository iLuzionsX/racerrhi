import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  probeChassisContact,
  stabilizeVehicleAfterImpact,
} from '../.vendor/Racing26/src/physics/CrashStability';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  setCarPose,
  refreshCarState,
  stepCar,
} from './m5-bridge';
import { racerrhiSteeringTargetForM5 } from './m5-steering-adapter';

const DEG = 180 / Math.PI;
const DT_MS = M5_FIXED_DT * 1000;

type SteeringKind = 'keyboard' | 'touch';
type DriverPlan = {
  name: string;
  kind: SteeringKind;
  reactionMs: number;
  amplitude: number;
  holdMs: number;
  unwindMs: number;
  incorrect?: boolean;
  tapPeriodMs?: number;
  tapOnMs?: number;
};

type Disturbance = {
  speedKmh: number;
  slipDeg: number;
  yawDegS: number;
};

const flatRoad = (x: number, z: number) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
});

setSurfaceSampler(flatRoad);

function wrapPi(angle: number) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function finite(value: unknown, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function driverInput(plan: DriverPlan, directionSign: 1 | -1, elapsedMs: number) {
  const correctKeyboardDirection = (-directionSign) as -1 | 1;
  const keyboardDirection = (plan.incorrect ? -correctKeyboardDirection : correctKeyboardDirection) as -1 | 1;
  const correctTouchSign = directionSign;
  const touchSign = plan.incorrect ? -correctTouchSign : correctTouchSign;

  if (elapsedMs < plan.reactionMs) {
    return { digitalSteerDirection: 0 as const, throttle: 0.12 };
  }

  const afterReaction = elapsedMs - plan.reactionMs;
  const afterHold = afterReaction - plan.holdMs;

  if (plan.kind === 'keyboard') {
    if (afterReaction < plan.holdMs) {
      return { digitalSteerDirection: keyboardDirection, throttle: 0.12 };
    }
    if (afterHold < plan.unwindMs && plan.unwindMs > 0) {
      const period = Math.max(DT_MS, plan.tapPeriodMs ?? 75);
      const onMs = Math.min(period, plan.tapOnMs ?? 25);
      const phase = ((afterHold % period) + period) % period;
      return {
        digitalSteerDirection: phase < onMs ? keyboardDirection : 0 as const,
        throttle: 0.12,
      };
    }
    return { digitalSteerDirection: 0 as const, throttle: 0.14 };
  }

  if (afterReaction < plan.holdMs) {
    return {
      analogSteerTarget: touchSign * plan.amplitude,
      analogSteerActive: true,
      throttle: 0.12,
    };
  }

  if (afterHold < plan.unwindMs && plan.unwindMs > 0) {
    const fraction = Math.max(0, 1 - afterHold / plan.unwindMs);
    return {
      analogSteerTarget: touchSign * plan.amplitude * fraction,
      analogSteerActive: true,
      throttle: 0.12,
    };
  }

  return {
    digitalSteerDirection: 0 as const,
    throttle: 0.14,
  };
}

function frontInternal(state: any) {
  const sim: any = state._m5;
  let rawSlip = 0;
  let relaxedSlip = 0;
  let appliedFy = 0;
  let targetFy = 0;
  for (let i = 0; i < 2; i++) {
    const wheel: any = sim.vehicle.wheels[i];
    const susp: any = sim.vehicle.suspension.states[i];
    rawSlip += wheel.rawSlipAngle * 0.5;
    relaxedSlip += wheel.relaxationSlipAngle * 0.5;
    appliedFy += state.wheels[i].forceLateralN;

    const tireModel: any = wheel.tireModel;
    const tempError = Math.abs(wheel.temperature - wheel.tireConfig.optimalTemp);
    const thermalGrip = PhysicsMath.clamp(1.02 - tempError * 0.0018, 0.88, 1.02);
    const wearGrip = PhysicsMath.clamp(1 - wheel.wearPercent * 0.0022, 0.70, 1.0);
    const target = tireModel.calculate({
      slipRatio: wheel.relaxationSlipRatio,
      slipAngle: wheel.relaxationSlipAngle,
      verticalLoad: susp.tireNormalForceN,
      camberDeg: susp.dynamicCamberDeg,
      surfaceFriction: state.wheels[i].surfaceFriction,
      gripScale: thermalGrip * wearGrip,
      isLeft: wheel.isLeft,
    });
    targetFy += target.fy;
  }
  return { rawSlip, relaxedSlip, targetFy, appliedFy };
}

function runInjected(
  directionSign: 1 | -1,
  disturbance: Disturbance,
  plan: DriverPlan,
) {
  const state: any = newCar(0, 0, 0);
  setCarPose(state, 0, 0, 0, disturbance.speedKmh / 3.6);
  const sim: any = state._m5;
  const forward = disturbance.speedKmh / 3.6;
  const slipRad = disturbance.slipDeg / DEG;
  const yawRadS = disturbance.yawDegS / DEG;

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    -directionSign * Math.tan(slipRad) * forward,
    0,
    forward,
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, directionSign * yawRadS, 0);
  refreshCarState(state);

  const initialHeading = state.heading;
  const initialX = state.x;
  const initialError = Math.abs(state.slip) + Math.abs(state.yawRate) * 0.35;
  const initialSpeedKmh = state.speed * 3.6;

  let minSpeedKmh = initialSpeedKmh;
  let bestErrorRatio = 1;
  let halfErrorMs: number | null = null;
  let quarterErrorMs: number | null = null;
  let settledMs: number | null = null;
  let settleStreak = 0;
  let oppositeYawPeakDegS = 0;
  let oppositeSlipPeakDeg = 0;
  let peakHeadingErrorDeg = 0;
  let maxPathDeviationM = 0;
  let maxForceStepN = 0;
  let maxTargetAppliedFyDeltaN = 0;
  let maxRawRelaxedSlipDeltaDeg = 0;
  let maxRoadWheelDeg = 0;
  let maxEffectiveSteering = 0;
  let absSteps = 0;
  let tcsSteps = 0;
  let chassisContactSamples = 0;
  const initialYawSign = Math.sign(state.yawRate) || directionSign;
  const initialSlipSign = Math.sign(state.slip) || -directionSign;
  let previousForces = state.wheels.map((wheel: any) =>
    Math.hypot(wheel.forceLongitudinalN, wheel.forceLateralN)
  );

  const totalMs = Math.max(
    1800,
    plan.reactionMs + plan.holdMs + plan.unwindMs + 900,
  );
  const steps = Math.ceil(totalMs / DT_MS);

  for (let i = 0; i < steps; i++) {
    const elapsedMs = i * DT_MS;
    const input = driverInput(plan, directionSign, elapsedMs);
    const preProbe = probeChassisContact(sim.vehicle);
    if (preProbe.contactCount > 0) chassisContactSamples++;

    stepCar(state, input, M5_FIXED_DT);

    const postProbe = probeChassisContact(sim.vehicle);
    if (postProbe.contactCount > 0) chassisContactSamples++;

    const error = Math.abs(state.slip) + Math.abs(state.yawRate) * 0.35;
    const ratio = error / Math.max(1e-9, initialError);
    bestErrorRatio = Math.min(bestErrorRatio, ratio);
    if (halfErrorMs === null && ratio <= 0.5) halfErrorMs = (i + 1) * DT_MS;
    if (quarterErrorMs === null && ratio <= 0.25) quarterErrorMs = (i + 1) * DT_MS;

    const slipDeg = Math.abs(state.slip) * DEG;
    const yawDegS = Math.abs(state.yawRate) * DEG;
    if (Math.sign(state.yawRate) === -initialYawSign) {
      oppositeYawPeakDegS = Math.max(oppositeYawPeakDegS, yawDegS);
    }
    if (Math.sign(state.slip) === -initialSlipSign) {
      oppositeSlipPeakDeg = Math.max(oppositeSlipPeakDeg, slipDeg);
    }

    const headingErrorDeg = Math.abs(wrapPi(state.heading - initialHeading)) * DEG;
    peakHeadingErrorDeg = Math.max(peakHeadingErrorDeg, headingErrorDeg);
    maxPathDeviationM = Math.max(maxPathDeviationM, Math.abs(state.x - initialX));
    minSpeedKmh = Math.min(minSpeedKmh, state.speed * 3.6);
    maxRoadWheelDeg = Math.max(maxRoadWheelDeg, Math.abs(state.steer) * DEG);
    maxEffectiveSteering = Math.max(
      maxEffectiveSteering,
      Math.abs(sim.analogSteeringInput),
      Math.abs(sim.digitalSteeringInput),
    );

    const internal = frontInternal(state);
    maxTargetAppliedFyDeltaN = Math.max(
      maxTargetAppliedFyDeltaN,
      Math.abs(internal.targetFy - internal.appliedFy),
    );
    maxRawRelaxedSlipDeltaDeg = Math.max(
      maxRawRelaxedSlipDeltaDeg,
      Math.abs(internal.rawSlip - internal.relaxedSlip) * DEG,
    );

    state.wheels.forEach((wheel: any, index: number) => {
      const force = Math.hypot(wheel.forceLongitudinalN, wheel.forceLateralN);
      maxForceStepN = Math.max(maxForceStepN, Math.abs(force - previousForces[index]));
      previousForces[index] = force;
    });

    if (state.absActive) absSteps++;
    if (state.tcsActive) tcsSteps++;

    const settledNow =
      Math.abs(state.slip) * DEG < 1.0 &&
      Math.abs(state.yawRate) * DEG < 5.0 &&
      Math.abs(state.steer) * DEG < 1.5;
    settleStreak = settledNow ? settleStreak + 1 : 0;
    if (settledMs === null && settleStreak >= 15) {
      settledMs = (i + 1 - 14) * DT_MS;
    }
  }

  const finalHeadingErrorDeg = Math.abs(wrapPi(state.heading - initialHeading)) * DEG;
  const finalPathDeviationM = Math.abs(state.x - initialX);
  const finalSlipDeg = Math.abs(state.slip) * DEG;
  const finalYawDegS = Math.abs(state.yawRate) * DEG;
  const success =
    settledMs !== null &&
    finalSlipDeg < 1.0 &&
    finalYawDegS < 5.0 &&
    finalHeadingErrorDeg < 18.0 &&
    (initialSpeedKmh - minSpeedKmh) < 12.0;

  return {
    direction: directionSign > 0 ? 'left-yaw' : 'right-yaw',
    disturbance,
    plan: plan.name,
    kind: plan.kind,
    success,
    halfErrorMs,
    quarterErrorMs,
    settledMs,
    bestErrorRatio,
    speedLossKmh: initialSpeedKmh - minSpeedKmh,
    finalSpeedKmh: state.speed * 3.6,
    finalSlipDeg,
    finalYawDegS,
    peakHeadingErrorDeg,
    finalHeadingErrorDeg,
    maxPathDeviationM,
    finalPathDeviationM,
    oppositeSlipPeakDeg,
    oppositeYawPeakDegS,
    maxRoadWheelDeg,
    maxEffectiveSteering,
    maxRawRelaxedSlipDeltaDeg,
    maxTargetAppliedFyDeltaN,
    maxForceStepN,
    absSteps,
    tcsSteps,
    chassisContactSamples,
  };
}

function stepWithCrashTelemetry(
  state: any,
  input: any,
  applyStabilizer: boolean,
) {
  const sim: any = state._m5;
  let donorInput: any;
  if (input.analogSteerActive) {
    donorInput = {
      ...input,
      analogSteerTarget: racerrhiSteeringTargetForM5(sim, finite(input.analogSteerTarget)),
    };
  } else {
    donorInput = input;
  }

  const fixedInputs = (sim as any).inputsForFixedStep({
    throttle: PhysicsMath.clamp(finite(donorInput.throttle), 0, 1),
    brake: PhysicsMath.clamp(finite(donorInput.brake), 0, 1),
    steer: 0,
    ...donorInput,
    handbrake: Boolean(donorInput.handbrake),
    shiftUp: false,
    shiftDown: false,
  });

  sim.vehicle.step(fixedInputs, M5_FIXED_DT);
  const beforeProbe = probeChassisContact(sim.vehicle);
  const beforeV = { ...sim.vehicle.rigidBody.velocity };
  const beforeW = { ...sim.vehicle.rigidBody.angularVelocity };
  if (applyStabilizer) stabilizeVehicleAfterImpact(sim.vehicle, M5_FIXED_DT);
  const afterV = sim.vehicle.rigidBody.velocity;
  const afterW = sim.vehicle.rigidBody.angularVelocity;
  const afterProbe = probeChassisContact(sim.vehicle);
  sim.totalSimTime += M5_FIXED_DT;
  sim.stepCount++;
  refreshCarState(state);

  return {
    beforeProbe,
    afterProbe,
    linearDeltaMs: PhysicsMath.vec3Length(PhysicsMath.vec3Sub(afterV, beforeV)),
    angularDeltaRadS: PhysicsMath.vec3Length(PhysicsMath.vec3Sub(afterW, beforeW)),
  };
}

function runCrashContributionDiagnostic(directionSign: 1 | -1, applyStabilizer: boolean) {
  const disturbance: Disturbance = { speedKmh: 80, slipDeg: 8, yawDegS: 25.78 };
  const plan: DriverPlan = {
    name: 'touch-progressive',
    kind: 'touch',
    reactionMs: 180,
    amplitude: 0.33,
    holdMs: 260,
    unwindMs: 300,
  };
  const state: any = newCar(0, 0, 0);
  setCarPose(state, 0, 0, 0, disturbance.speedKmh / 3.6);
  const sim: any = state._m5;
  const forward = disturbance.speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    -directionSign * Math.tan(disturbance.slipDeg / DEG) * forward,
    0,
    forward,
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, directionSign * disturbance.yawDegS / DEG, 0);
  refreshCarState(state);

  let interventionSteps = 0;
  let maxLinearChangeMs = 0;
  let maxAngularChangeRadS = 0;
  let maxPenetrationM = 0;

  for (let i = 0; i < 220; i++) {
    const input = driverInput(plan, directionSign, i * DT_MS);
    const telemetry = stepWithCrashTelemetry(state, input, applyStabilizer);
    maxPenetrationM = Math.max(
      maxPenetrationM,
      telemetry.beforeProbe.maxPenetrationM,
      telemetry.afterProbe.maxPenetrationM,
    );
    maxLinearChangeMs = Math.max(maxLinearChangeMs, telemetry.linearDeltaMs);
    maxAngularChangeRadS = Math.max(maxAngularChangeRadS, telemetry.angularDeltaRadS);
    if (
      telemetry.beforeProbe.contactCount > 0 ||
      telemetry.linearDeltaMs > 1e-9 ||
      telemetry.angularDeltaRadS > 1e-9
    ) {
      interventionSteps++;
    }
  }

  return {
    direction: directionSign > 0 ? 'left-yaw' : 'right-yaw',
    applyStabilizer,
    interventionSteps,
    maxLinearChangeMs,
    maxAngularChangeRadS,
    maxPenetrationM,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
    finalHeadingDeg: Math.abs(wrapPi(state.heading)) * DEG,
    finalX: state.x,
    finalSpeedKmh: state.speed * 3.6,
  };
}

function runNaturalProvocation(kind: 'lift-off' | 'trail-brake' | 'throttle-exit', directionSign: 1 | -1) {
  setSurfaceSampler(flatRoad);
  const state: any = newCar(0, 0, 0);
  const startSpeedKmh = kind === 'throttle-exit' ? 62 : 82;
  setCarPose(state, 0, 0, 0, startSpeedKmh / 3.6);

  let peakSlipDeg = 0;
  let peakYawDegS = 0;
  let peakGripUtilization = 0;
  let minSpeedKmh = startSpeedKmh;
  let interventionSteps = 0;

  for (let i = 0; i < 300; i++) {
    const t = i * M5_FIXED_DT;
    let steer = 0;
    let throttle = 0.18;
    let brake = 0;

    if (t < 0.55) {
      steer = directionSign * 0.44;
      throttle = 0.22;
    } else if (t < 1.05) {
      steer = directionSign * 0.48;
      if (kind === 'lift-off') throttle = 0;
      if (kind === 'trail-brake') {
        throttle = 0;
        brake = 0.42 * (1 - (t - 0.55) / 0.50);
      }
      if (kind === 'throttle-exit') throttle = 0.92;
    } else if (t < 1.42) {
      const unwind = Math.max(0, 1 - (t - 1.05) / 0.37);
      steer = directionSign * 0.48 * unwind;
      throttle = kind === 'throttle-exit' ? 0.55 : 0.10;
    } else {
      throttle = 0.16;
    }

    stepCar(state, {
      analogSteerTarget: steer,
      analogSteerActive: true,
      throttle,
      brake,
    }, M5_FIXED_DT);

    peakSlipDeg = Math.max(peakSlipDeg, Math.abs(state.slip) * DEG);
    peakYawDegS = Math.max(peakYawDegS, Math.abs(state.yawRate) * DEG);
    peakGripUtilization = Math.max(
      peakGripUtilization,
      ...state.wheels.map((wheel: any) => wheel.gripUtilization),
    );
    minSpeedKmh = Math.min(minSpeedKmh, state.speed * 3.6);
    if (state.absActive || state.tcsActive) interventionSteps++;
  }

  return {
    kind,
    direction: directionSign > 0 ? 'left' : 'right',
    peakSlipDeg,
    peakYawDegS,
    peakGripUtilization,
    speedLossKmh: startSpeedKmh - minSpeedKmh,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
    finalHeadingDeg: Math.abs(wrapPi(state.heading)) * DEG,
    absOrTcsSteps: interventionSteps,
  };
}

function runKerbTransition(directionSign: 1 | -1) {
  setSurfaceSampler((x, z) => ({
    p: { x, y: 0, z },
    d: { x: 0, y: 0, z: 1 },
    distance: Math.abs(x) < 1.4 ? 6.7 : Math.abs(x) < 2.0 ? 7.35 : 8.4,
    side: Math.sign(x) || 1,
    t: 0,
  }));
  const state: any = newCar(0, 0, 0);
  setCarPose(state, 0, 0, 0, 70 / 3.6);

  let peakSlipDeg = 0;
  let peakYawDegS = 0;
  let minFriction = 1;
  let maxFrictionStep = 0;
  let previousFriction = state.wheels.map((w: any) => w.surfaceFriction);

  for (let i = 0; i < 360; i++) {
    const t = i * M5_FIXED_DT;
    const hand =
      t < 0.9
        ? directionSign * 0.58
        : t < 1.45
          ? directionSign * 0.58 * Math.max(0, 1 - (t - 0.9) / 0.55)
          : 0;
    stepCar(state, {
      analogSteerTarget: hand,
      analogSteerActive: true,
      throttle: t < 1.2 ? 0.28 : 0.12,
    }, M5_FIXED_DT);
    peakSlipDeg = Math.max(peakSlipDeg, Math.abs(state.slip) * DEG);
    peakYawDegS = Math.max(peakYawDegS, Math.abs(state.yawRate) * DEG);
    state.wheels.forEach((wheel: any, index: number) => {
      minFriction = Math.min(minFriction, wheel.surfaceFriction);
      maxFrictionStep = Math.max(maxFrictionStep, Math.abs(wheel.surfaceFriction - previousFriction[index]));
      previousFriction[index] = wheel.surfaceFriction;
    });
  }

  setSurfaceSampler(flatRoad);
  return {
    kind: 'kerb-transition',
    direction: directionSign > 0 ? 'left' : 'right',
    peakSlipDeg,
    peakYawDegS,
    minFriction,
    maxFrictionStep,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
    finalHeadingDeg: Math.abs(wrapPi(state.heading)) * DEG,
  };
}

const disturbances: Disturbance[] = [
  { speedKmh: 70, slipDeg: 6, yawDegS: 20 },
  { speedKmh: 80, slipDeg: 8, yawDegS: 25.78 },
  { speedKmh: 92, slipDeg: 8, yawDegS: 28 },
];

const usefulPlans: DriverPlan[] = [
  {
    name: 'keyboard-early-release',
    kind: 'keyboard',
    reactionMs: 120,
    amplitude: 1,
    holdMs: 250,
    unwindMs: 0,
  },
  {
    name: 'keyboard-balanced-release',
    kind: 'keyboard',
    reactionMs: 200,
    amplitude: 1,
    holdMs: 300,
    unwindMs: 0,
  },
  {
    name: 'keyboard-tap-unwind',
    kind: 'keyboard',
    reactionMs: 180,
    amplitude: 1,
    holdMs: 250,
    unwindMs: 260,
    tapPeriodMs: 75,
    tapOnMs: 25,
  },
  {
    name: 'touch-third-progressive',
    kind: 'touch',
    reactionMs: 180,
    amplitude: 0.33,
    holdMs: 250,
    unwindMs: 300,
  },
  {
    name: 'touch-45-progressive',
    kind: 'touch',
    reactionMs: 220,
    amplitude: 0.45,
    holdMs: 220,
    unwindMs: 340,
  },
];

const adversePlans: DriverPlan[] = [
  {
    name: 'keyboard-too-late',
    kind: 'keyboard',
    reactionMs: 520,
    amplitude: 1,
    holdMs: 420,
    unwindMs: 0,
  },
  {
    name: 'keyboard-sustained-opposite-lock',
    kind: 'keyboard',
    reactionMs: 120,
    amplitude: 1,
    holdMs: 950,
    unwindMs: 0,
  },
  {
    name: 'touch-late-release',
    kind: 'touch',
    reactionMs: 180,
    amplitude: 0.50,
    holdMs: 620,
    unwindMs: 120,
  },
  {
    name: 'touch-incorrect',
    kind: 'touch',
    reactionMs: 180,
    amplitude: 0.40,
    holdMs: 360,
    unwindMs: 220,
    incorrect: true,
  },
];

const injectedResults: any[] = [];
for (const direction of [1, -1] as const) {
  for (const disturbance of disturbances) {
    for (const plan of [...usefulPlans, ...adversePlans]) {
      injectedResults.push(runInjected(direction, disturbance, plan));
    }
  }
}

const baselineLead = injectedResults.filter(
  (result) =>
    result.disturbance.speedKmh === 80 &&
    result.disturbance.slipDeg === 8 &&
    (result.plan === 'keyboard-balanced-release' || result.plan === 'touch-third-progressive')
);

const usefulResults = injectedResults.filter((result) =>
  usefulPlans.some((plan) => plan.name === result.plan)
);
const adverseResults = injectedResults.filter((result) =>
  adversePlans.some((plan) => plan.name === result.plan)
);

const crashDiagnostics = [
  runCrashContributionDiagnostic(1, true),
  runCrashContributionDiagnostic(-1, true),
  runCrashContributionDiagnostic(1, false),
  runCrashContributionDiagnostic(-1, false),
];

const naturalResults = [];
for (const direction of [1, -1] as const) {
  naturalResults.push(runNaturalProvocation('lift-off', direction));
  naturalResults.push(runNaturalProvocation('trail-brake', direction));
  naturalResults.push(runNaturalProvocation('throttle-exit', direction));
  naturalResults.push(runKerbTransition(direction));
}

const summary = {
  scenario: 'Racerrhi slide recovery and steering unwind diagnostic matrix',
  pinnedDonor: 'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  useful: {
    total: usefulResults.length,
    success: usefulResults.filter((result) => result.success).length,
    successRate: usefulResults.filter((result) => result.success).length / usefulResults.length,
  },
  adverse: {
    total: adverseResults.length,
    success: adverseResults.filter((result) => result.success).length,
    successRate: adverseResults.filter((result) => result.success).length / adverseResults.length,
  },
  baselineLead,
  crashDiagnostics,
  naturalResults,
  injectedResults,
};

console.log(JSON.stringify(summary, null, 2));

// Diagnostic-only first pass: lock only invariants that must hold before any tuning.
assert.equal(injectedResults.length, 54, 'unexpected recovery matrix size');
assert(usefulResults.some((result) => result.success), 'no useful driver plan recovered any modest slide');
assert(adverseResults.some((result) => !result.success), 'adverse inputs no longer retain a handling consequence');
for (const result of injectedResults) {
  assert(Number.isFinite(result.finalSlipDeg));
  assert(Number.isFinite(result.finalYawDegS));
  assert(Number.isFinite(result.finalHeadingErrorDeg));
  assert(Number.isFinite(result.maxForceStepN));
}
for (const result of crashDiagnostics.filter((entry) => entry.applyStabilizer)) {
  assert(result.interventionSteps === 0, 'upright modest slide unexpectedly invoked crash stabilization');
}
