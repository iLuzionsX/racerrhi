import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  M5_FIXED_DT,
  setSurfaceSampler,
  newCar,
  setCarPose,
  refreshCarState,
  stepCar,
} from './m5-bridge';

const DEG = 180 / Math.PI;
setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

type RecoveryMode =
  | 'neutral'
  | 'keyboard-correct'
  | 'keyboard-incorrect'
  | 'touch-correct';

function run(mode: RecoveryMode, aidsOff = false) {
  const state: any = newCar(0, 0, 0);
  setCarPose(state, 0, 0, 0, 80 / 3.6);
  const sim: any = state._m5;
  if (aidsOff) {
    sim.setConfig({ ...sim.vehicle.config, absMode: 'OFF', tcsMode: 'OFF' });
  }
  const forward = 80 / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    -Math.tan(8 * Math.PI / 180) * forward,
    0,
    forward,
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0.45, 0);
  refreshCarState(state);

  const initialSlip = state.slip;
  const initialYaw = state.yawRate;
  const initialError = Math.abs(initialSlip) + Math.abs(initialYaw) * 0.35;
  const initialSpeedKmh = state.speed * 3.6;
  const initialSlipSign = Math.sign(initialSlip) || -1;
  const initialYawSign = Math.sign(initialYaw) || 1;
  let minSpeedKmh = initialSpeedKmh;
  let peakSlipDeg = Math.abs(initialSlip) * DEG;
  let peakYawDegS = Math.abs(initialYaw) * DEG;
  let oppositeSlipSnapDeg = 0;
  let oppositeYawOvershootDegS = 0;
  let bestErrorRatio = 1;
  let halfErrorMs: number | null = null;
  let quarterErrorMs: number | null = null;
  let absSteps = 0;
  let tcsSteps = 0;

  for (let i = 0; i < 120; i++) {
    const control =
      mode === 'neutral'
        ? { digitalSteerDirection: 0 as const, throttle: 0.12 }
        : mode === 'keyboard-correct'
          ? { digitalSteerDirection: -1 as const, throttle: 0.12 }
          : mode === 'keyboard-incorrect'
            ? { digitalSteerDirection: 1 as const, throttle: 0.12 }
            : { analogSteerTarget: 1, analogSteerActive: true, throttle: 0.12 };

    stepCar(state, control, M5_FIXED_DT);
    const error = Math.abs(state.slip) + Math.abs(state.yawRate) * 0.35;
    bestErrorRatio = Math.min(bestErrorRatio, error / initialError);
    if (halfErrorMs === null && error <= initialError * 0.5) {
      halfErrorMs = (i + 1) * M5_FIXED_DT * 1000;
    }
    if (quarterErrorMs === null && error <= initialError * 0.25) {
      quarterErrorMs = (i + 1) * M5_FIXED_DT * 1000;
    }

    const slipDeg = Math.abs(state.slip) * DEG;
    const yawDegS = Math.abs(state.yawRate) * DEG;
    peakSlipDeg = Math.max(peakSlipDeg, slipDeg);
    peakYawDegS = Math.max(peakYawDegS, yawDegS);
    if (Math.sign(state.slip) === -initialSlipSign) {
      oppositeSlipSnapDeg = Math.max(oppositeSlipSnapDeg, slipDeg);
    }
    if (Math.sign(state.yawRate) === -initialYawSign) {
      oppositeYawOvershootDegS = Math.max(oppositeYawOvershootDegS, yawDegS);
    }
    minSpeedKmh = Math.min(minSpeedKmh, state.speed * 3.6);
    if (state.absActive) absSteps++;
    if (state.tcsActive) tcsSteps++;
  }

  for (let i = 0; i < 72; i++) {
    stepCar(state, { digitalSteerDirection: 0, throttle: 0.15 }, M5_FIXED_DT);
    minSpeedKmh = Math.min(minSpeedKmh, state.speed * 3.6);
    if (state.absActive) absSteps++;
    if (state.tcsActive) tcsSteps++;
  }

  return {
    initialSpeedKmh,
    minSpeedKmh,
    speedLossKmh: initialSpeedKmh - minSpeedKmh,
    finalSpeedKmh: state.speed * 3.6,
    initialSlipDeg: Math.abs(initialSlip) * DEG,
    initialYawDegS: Math.abs(initialYaw) * DEG,
    halfErrorMs,
    quarterErrorMs,
    bestErrorRatio,
    peakSlipDeg,
    peakYawDegS,
    oppositeSlipSnapDeg,
    oppositeYawOvershootDegS,
    finalSlipDeg: Math.abs(state.slip) * DEG,
    finalYawDegS: Math.abs(state.yawRate) * DEG,
    absInterventionSteps: absSteps,
    tcsInterventionSteps: tcsSteps,
  };
}

const results = {
  neutral: run('neutral'),
  keyboardCorrect: run('keyboard-correct'),
  keyboardIncorrect: run('keyboard-incorrect'),
  touchCorrect: run('touch-correct'),
  keyboardCorrectAidsOff: run('keyboard-correct', true),
  touchCorrectAidsOff: run('touch-correct', true),
};

console.log(JSON.stringify({
  scenario: 'Racerrhi identical-disturbance driver recovery comparison',
  disturbance: { speedKmh: 80, sideslipDeg: 8, yawRateDegS: 0.45 * DEG },
  assistanceDiagnostic: {
    defaultGameplayModesPreserved: true,
    comparisonOnly: 'ABS/TCS OFF variants exist only in this diagnostic test',
  },
  stabilizationTelemetry: 'donor crash stabilizer is always in the step path but does not expose an intervention flag',
  results,
}, null, 2));

// Keep only invariants established before examining this richer trace. Once the
// neutral/wrong/touch/aids-off measurements are visible in CI, the final pass
// replaces these broad checks with behavior-specific comparative limits.
assert(results.keyboardCorrect.bestErrorRatio < 0.35, 'keyboard countersteer did not materially reduce slide error');
assert(results.keyboardCorrect.finalSlipDeg < 0.5, 'keyboard recovery left excessive final sideslip');
assert(results.keyboardCorrect.absInterventionSteps === 0, 'ABS unexpectedly drove a steering-only recovery');
assert(results.touchCorrect.absInterventionSteps === 0, 'ABS unexpectedly drove touch steering recovery');
