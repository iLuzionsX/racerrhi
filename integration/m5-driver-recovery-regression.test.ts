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
  | 'touch-quarter'
  | 'touch-third'
  | 'touch-two-fifths'
  | 'touch-half'
  | 'touch-full';

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
    const touchMagnitude =
      mode === 'touch-quarter'
        ? 0.25
        : mode === 'touch-third'
          ? 0.33
          : mode === 'touch-two-fifths'
          ? 0.40
          : mode === 'touch-half'
            ? 0.5
            : mode === 'touch-full'
              ? 1
              : 0;
    const control =
      mode === 'neutral'
        ? { digitalSteerDirection: 0 as const, throttle: 0.12 }
        : mode === 'keyboard-correct'
          ? { digitalSteerDirection: -1 as const, throttle: 0.12 }
          : mode === 'keyboard-incorrect'
            ? { digitalSteerDirection: 1 as const, throttle: 0.12 }
            : { analogSteerTarget: touchMagnitude, analogSteerActive: true, throttle: 0.12 };

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
  touchQuarterDiagnostic: run('touch-quarter'),
  touchCorrect: run('touch-two-fifths'),
  touchHalfDiagnostic: run('touch-half'),
  touchExcessive: run('touch-full'),
  keyboardCorrectAidsOff: run('keyboard-correct', true),
  touchCorrectAidsOff: run('touch-two-fifths', true),
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

// Behavior-specific acceptance limits are pinned to the measured baseline above.
// They distinguish useful driver control from mere eventual stabilization.
assert.equal(results.neutral.halfErrorMs, null, 'neutral steering unexpectedly halved the disturbance error');
assert(results.neutral.bestErrorRatio > 0.80, 'neutral steering now recovers too strongly to remain a useful control case');
assert(results.neutral.finalSlipDeg > 2.0, 'neutral case unexpectedly self-corrected to a tiny final slip');

assert(results.keyboardCorrect.halfErrorMs !== null && results.keyboardCorrect.halfErrorMs <= 500,
  'correct keyboard countersteer is no longer prompt enough');
assert(results.keyboardCorrect.quarterErrorMs !== null && results.keyboardCorrect.quarterErrorMs <= 600,
  'correct keyboard countersteer no longer reaches quarter error promptly');
assert(results.keyboardCorrect.bestErrorRatio < 0.30, 'correct keyboard countersteer did not materially reduce slide error');
assert(results.keyboardCorrect.speedLossKmh < 4.0, 'keyboard recovery is hiding behind excessive speed loss');
assert(results.keyboardCorrect.finalSlipDeg < 0.10, 'keyboard recovery left excessive final sideslip');

assert.equal(results.keyboardIncorrect.halfErrorMs, null, 'incorrect keyboard steering unexpectedly recovered the disturbance');
assert(results.keyboardIncorrect.bestErrorRatio > 0.95, 'incorrect steering is no longer clearly worse than correct countersteer');
assert(results.keyboardIncorrect.finalSlipDeg > 5.0, 'incorrect steering no longer has a clear handling consequence');
assert(results.keyboardIncorrect.speedLossKmh > results.neutral.speedLossKmh,
  'incorrect steering no longer loses more speed than neutral');

assert(results.touchCorrect.halfErrorMs !== null && results.touchCorrect.halfErrorMs <= 700,
  'fixed-map touch countersteer is no longer prompt enough');
assert(results.touchCorrect.quarterErrorMs !== null && results.touchCorrect.quarterErrorMs <= 900,
  'fixed-map touch countersteer no longer reaches quarter error');
assert(results.touchCorrect.bestErrorRatio < 0.30, 'touch-wheel countersteer did not materially reduce slide error');
assert(results.touchCorrect.speedLossKmh < 4.5, 'touch recovery is hiding behind excessive speed loss');
assert(results.touchCorrect.finalSlipDeg < 0.10, 'touch recovery left excessive final sideslip');
assert(results.touchCorrect.oppositeSlipSnapDeg < 1.0, 'useful touch countersteer now creates excessive opposite slip snap');
assert(results.touchCorrect.oppositeYawOvershootDegS < 25.0, 'useful touch countersteer now creates excessive yaw overshoot');

assert.equal(results.touchExcessive.halfErrorMs, null, 'sustained full touch opposite lock unexpectedly behaves like a clean recovery');
assert(results.touchExcessive.speedLossKmh > 8.0, 'excessive touch input no longer carries a meaningful speed-loss consequence');
assert(results.touchExcessive.oppositeSlipSnapDeg > 10.0, 'excessive touch input no longer produces the measured opposite-direction snap');
assert(results.touchExcessive.oppositeYawOvershootDegS > 45.0, 'excessive touch input no longer produces the measured yaw overshoot');

for (const [normal, aidsOff, label] of [
  [results.keyboardCorrect, results.keyboardCorrectAidsOff, 'keyboard'],
  [results.touchCorrect, results.touchCorrectAidsOff, 'touch'],
] as const) {
  assert(Math.abs(normal.bestErrorRatio - aidsOff.bestErrorRatio) < 1e-9, label + ' recovery changed when ABS/TCS were disabled');
  assert(Math.abs(normal.speedLossKmh - aidsOff.speedLossKmh) < 1e-9, label + ' speed loss changed when ABS/TCS were disabled');
  assert(Math.abs(normal.finalSlipDeg - aidsOff.finalSlipDeg) < 1e-9, label + ' final slip changed when ABS/TCS were disabled');
  assert.equal(normal.absInterventionSteps, 0, 'ABS unexpectedly drove ' + label + ' steering recovery');
  assert.equal(normal.tcsInterventionSteps, 0, 'TCS unexpectedly drove ' + label + ' steering recovery');
}
