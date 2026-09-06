import { strict as assert } from 'node:assert';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  M5_FIXED_DT,
  newCar,
  refreshCarState,
  setCarPose,
  setSurfaceSampler,
  stepCar,
} from './m5-bridge';

const DEG = 180 / Math.PI;
const SAMPLE_TIMES = [0.25, 0.50, 1.00, 2.00];
const MAX_TIME_S = 8;

setSurfaceSampler((x, z) => ({
  p: { x, y: 0, z },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
  side: 0,
  t: 0,
}));

type SlideKind = {
  name: 'modest' | 'large';
  sideslipDeg: number;
  yawRateRadS: number;
};

const slides: SlideKind[] = [
  { name: 'modest', sideslipDeg: 8, yawRateRadS: 0.45 },
  { name: 'large', sideslipDeg: 35, yawRateRadS: 0.65 },
];

const brakeCases = [
  { name: 'coast', brake: 0 },
  { name: 'partial', brake: 0.35 },
  { name: 'full', brake: 1.0 },
] as const;

function wheelPatchTelemetry(sim: any, state: any, brakeInput: number) {
  const hardpoints = sim.vehicle.getHardpointsBody();
  const torques = sim.vehicle.brakes.calculateBrakeTorques(brakeInput, false).hydraulicTorques;

  return state.wheels.map((telemetry: any, i: number) => {
    const wheel = sim.vehicle.wheels[i];
    const hp = hardpoints[i];
    const support = PhysicsMath.vec3(
      hp.x,
      sim.vehicle.planarSupportBodyYByCorner[i],
      hp.z,
    );
    const vSupport = sim.vehicle.rigidBody.getPointVelocityBody(support);
    const c = Math.cos(wheel.steerAngle);
    const s = Math.sin(wheel.steerAngle);
    const longitudinalVelocity = vSupport.x * s + vSupport.z * c;
    const lateralVelocity = vSupport.x * c - vSupport.z * s;
    const wheelSurfaceSpeed = wheel.angularVelocity * wheel.radius;
    const patchLongSlipMs = wheelSurfaceSpeed - longitudinalVelocity;
    const patchLatSlipMs = -lateralVelocity;
    const patchSlipMs = Math.hypot(patchLongSlipMs, patchLatSlipMs);
    const forceN = Math.hypot(telemetry.forceLongitudinalN, telemetry.forceLateralN);
    const dissipativePowerW =
      telemetry.forceLongitudinalN * patchLongSlipMs +
      telemetry.forceLateralN * patchLatSlipMs;
    const alignment =
      forceN > 1 && patchSlipMs > 0.05
        ? dissipativePowerW / (forceN * patchSlipMs)
        : 1;

    return {
      id: telemetry.id,
      omegaRadS: telemetry.angularVelocityRadS,
      wheelSpeedMs: telemetry.wheelSpeedMs,
      slipRatio: telemetry.slipRatio,
      slipAngleDeg: telemetry.slipAngleRad * DEG,
      normalLoadN: telemetry.normalLoadN,
      brakeTorqueNm: torques[i],
      fxN: telemetry.forceLongitudinalN,
      fyN: telemetry.forceLateralN,
      forceN,
      frictionLimitN: telemetry.frictionLimitN,
      utilization: telemetry.frictionLimitN > 1 ? forceN / telemetry.frictionLimitN : 0,
      patchLongSlipMs,
      patchLatSlipMs,
      patchSlipMs,
      dissipativePowerW,
      forceVsSlipAlignment: alignment,
      absActive: telemetry.absActive,
    };
  });
}

function run(speedKmh: number, slide: SlideKind, brakeInput: number) {
  const state: any = newCar(0, 0, 0);
  const forwardMs = speedKmh / 3.6;
  setCarPose(state, 0, 0, 0, forwardMs);
  const sim: any = state._m5;

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(
    -Math.tan(slide.sideslipDeg / DEG) * forwardMs,
    0,
    forwardMs,
  );
  sim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, slide.yawRateRadS, 0);
  refreshCarState(state);

  const initial = {
    speedKmh: state.speed * 3.6,
    forwardMs: state.localVelocityMs.forward,
    lateralMs: state.localVelocityMs.lateral,
    sideslipDeg: state.slip * DEG,
    yawDegS: state.yawRate * DEG,
  };

  let previousSpeed = state.speed;
  let previousX = state.x;
  let previousZ = state.z;
  let distanceM = 0;
  let stopTimeS: number | null = null;
  let stopDistanceM: number | null = null;
  let peakDecelMs2 = 0;
  let decelSum = 0;
  let decelSamples = 0;
  let peakSideslipDeg = Math.abs(state.slip) * DEG;
  let peakYawDegS = Math.abs(state.yawRate) * DEG;
  let absSteps = 0;
  let grossSlideSamples = 0;
  let grossSlideUtilizationSum = 0;
  let grossSlideAlignmentMin = 1;
  let grossSlideDissipationW = 0;
  const samples: any[] = [];
  let nextSample = 0;

  const maxSteps = Math.ceil(MAX_TIME_S / M5_FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    stepCar(
      state,
      {
        digitalSteerDirection: 0,
        throttle: 0,
        brake: brakeInput,
      },
      M5_FIXED_DT,
    );

    const t = (i + 1) * M5_FIXED_DT;
    const dx = state.x - previousX;
    const dz = state.z - previousZ;
    distanceM += Math.hypot(dx, dz);
    previousX = state.x;
    previousZ = state.z;

    const decel = Math.max(0, (previousSpeed - state.speed) / M5_FIXED_DT);
    peakDecelMs2 = Math.max(peakDecelMs2, decel);
    if (t <= 1.0) {
      decelSum += decel;
      decelSamples++;
    }
    previousSpeed = state.speed;

    peakSideslipDeg = Math.max(peakSideslipDeg, Math.abs(state.slip) * DEG);
    peakYawDegS = Math.max(peakYawDegS, Math.abs(state.yawRate) * DEG);
    if (state.absActive) absSteps++;

    const wheels = wheelPatchTelemetry(sim, state, brakeInput);
    for (const w of wheels) {
      if (w.patchSlipMs > 2.0) {
        grossSlideSamples++;
        grossSlideUtilizationSum += w.utilization;
        grossSlideAlignmentMin = Math.min(grossSlideAlignmentMin, w.forceVsSlipAlignment);
        grossSlideDissipationW += Math.max(0, w.dissipativePowerW);
      }
    }

    while (nextSample < SAMPLE_TIMES.length && t + M5_FIXED_DT * 0.5 >= SAMPLE_TIMES[nextSample]) {
      samples.push({
        timeS: SAMPLE_TIMES[nextSample],
        speedKmh: state.speed * 3.6,
        forwardMs: state.localVelocityMs.forward,
        lateralMs: state.localVelocityMs.lateral,
        sideslipDeg: state.slip * DEG,
        yawDegS: state.yawRate * DEG,
        absActive: state.absActive,
        wheels,
      });
      nextSample++;
    }

    if (brakeInput > 0 && stopTimeS === null && state.speed < 0.5) {
      stopTimeS = t;
      stopDistanceM = distanceM;
      break;
    }
  }

  const finalWheels = wheelPatchTelemetry(sim, state, brakeInput);
  return {
    speedKmh,
    slide: slide.name,
    requestedSideslipDeg: slide.sideslipDeg,
    brakeInput,
    initial,
    meanDecelFirstSecondMs2: decelSamples ? decelSum / decelSamples : 0,
    peakDecelMs2,
    distanceM,
    stopTimeS,
    stopDistanceM,
    peakSideslipDeg,
    peakYawDegS,
    final: {
      speedKmh: state.speed * 3.6,
      forwardMs: state.localVelocityMs.forward,
      lateralMs: state.localVelocityMs.lateral,
      sideslipDeg: state.slip * DEG,
      yawDegS: state.yawRate * DEG,
    },
    absSteps,
    grossSlide: {
      samples: grossSlideSamples,
      meanUtilization: grossSlideSamples ? grossSlideUtilizationSum / grossSlideSamples : 0,
      minimumForceVsSlipAlignment: grossSlideAlignmentMin,
      dissipatedEnergyApproxJ: grossSlideDissipationW * M5_FIXED_DT,
    },
    samples,
    finalWheels,
  };
}

const results: any[] = [];
for (const speedKmh of [60, 80, 110]) {
  for (const slide of slides) {
    for (const brakeCase of brakeCases) {
      results.push(run(speedKmh, slide, brakeCase.brake));
    }
  }
}

const summary = {
  scenario: 'Racerrhi braking during identical injected slides',
  pinnedDonor: 'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  note: 'Diagnostic matrix: coast / 35% brake / full brake, modest and large slides, neutral steering.',
  results,
};

console.log(JSON.stringify(summary, null, 2));

assert.equal(results.length, 18);
for (const result of results) {
  assert(Number.isFinite(result.meanDecelFirstSecondMs2));
  assert(Number.isFinite(result.peakSideslipDeg));
  assert(Number.isFinite(result.peakYawDegS));
  assert(result.samples.length >= 1);
  for (const sample of result.samples) {
    for (const wheel of sample.wheels) {
      assert(Number.isFinite(wheel.slipRatio));
      assert(Number.isFinite(wheel.slipAngleDeg));
      assert(Number.isFinite(wheel.normalLoadN));
      assert(Number.isFinite(wheel.brakeTorqueNm));
      assert(Number.isFinite(wheel.fxN));
      assert(Number.isFinite(wheel.fyN));
      assert(Number.isFinite(wheel.forceVsSlipAlignment));
    }
  }
}


const findCase = (speedKmh: number, slide: string, brakeInput: number) => {
  const match = results.find(
    (result) =>
      result.speedKmh === speedKmh &&
      result.slide === slide &&
      Math.abs(result.brakeInput - brakeInput) < 1e-9
  );
  assert(match, `missing ${speedKmh} km/h ${slide} brake=${brakeInput} case`);
  return match;
};

// Frozen from current-main (4d4f794) before the deep-slide friction correction.
// These values document the reproduced defect: increasing brake demand could
// reduce gross-slide force utilization and make a sideways stop substantially longer.
const reproducedBaseline = {
  large80: {
    partialStopDistanceM: 75.0,
    fullStopDistanceM: 112.1,
    partialMeanSlideUtilization: 0.469,
    fullMeanSlideUtilization: 0.361,
  },
  large110: {
    partialStopDistanceM: 137.2,
    fullStoppedWithin8s: false,
    fullSpeedAfter8sKmh: 40.8,
    partialMeanSlideUtilization: 0.561,
    fullMeanSlideUtilization: 0.352,
  },
};

for (const speedKmh of [60, 80, 110]) {
  const modestPartial = findCase(speedKmh, 'modest', 0.35);
  const modestFull = findCase(speedKmh, 'modest', 1.0);
  assert(
    modestFull.meanDecelFirstSecondMs2 > modestPartial.meanDecelFirstSecondMs2,
    `${speedKmh} km/h modest slide lost progressive brake response`,
  );
  assert(
    modestFull.stopDistanceM !== null &&
      modestPartial.stopDistanceM !== null &&
      modestFull.stopDistanceM < modestPartial.stopDistanceM,
    `${speedKmh} km/h modest slide full braking no longer stops shorter than partial braking`,
  );

  const largePartial = findCase(speedKmh, 'large', 0.35);
  const largeFull = findCase(speedKmh, 'large', 1.0);
  assert(
    largePartial.stopDistanceM !== null && largeFull.stopDistanceM !== null,
    `${speedKmh} km/h large slide failed to dissipate enough energy to reach a stop`,
  );
  assert(
    largeFull.stopDistanceM <= largePartial.stopDistanceM * 1.05,
    `${speedKmh} km/h full braking became materially worse than partial braking in a large slide`,
  );
  assert(
    largeFull.grossSlide.meanUtilization >= 0.78,
    `${speedKmh} km/h full-brake gross-slide tire utilization fell back toward the ice-like baseline`,
  );
  assert(
    largeFull.grossSlide.minimumForceVsSlipAlignment >= 0.65,
    `${speedKmh} km/h large-slide tire force stopped opposing contact-patch motion`,
  );
}

const large80Partial = findCase(80, 'large', 0.35);
const large80Full = findCase(80, 'large', 1.0);
assert(
  large80Partial.stopDistanceM <= reproducedBaseline.large80.partialStopDistanceM * 0.80,
  '80 km/h partial-brake large-slide stopping distance did not improve enough',
);
assert(
  large80Full.stopDistanceM <= reproducedBaseline.large80.fullStopDistanceM * 0.55,
  '80 km/h full-brake large-slide stopping distance did not improve enough',
);
assert(
  large80Full.grossSlide.meanUtilization >=
    reproducedBaseline.large80.fullMeanSlideUtilization + 0.40,
  '80 km/h full-brake gross-slide utilization did not recover from the reproduced collapse',
);

const large110Full = findCase(110, 'large', 1.0);
assert(
  large110Full.stopDistanceM !== null && large110Full.stopDistanceM < 105,
  '110 km/h full-brake large slide still behaves like the reproduced eight-second ice slide',
);
assert(
  large110Full.grossSlide.meanUtilization >=
    reproducedBaseline.large110.fullMeanSlideUtilization + 0.40,
  '110 km/h full-brake gross-slide utilization did not recover from the reproduced collapse',
);

console.log(JSON.stringify({
  beforeAfter: {
    large80: {
      before: reproducedBaseline.large80,
      after: {
        partialStopDistanceM: large80Partial.stopDistanceM,
        fullStopDistanceM: large80Full.stopDistanceM,
        partialMeanSlideUtilization: large80Partial.grossSlide.meanUtilization,
        fullMeanSlideUtilization: large80Full.grossSlide.meanUtilization,
        partialPeakSideslipDeg: large80Partial.peakSideslipDeg,
        fullPeakSideslipDeg: large80Full.peakSideslipDeg,
        partialPeakYawDegS: large80Partial.peakYawDegS,
        fullPeakYawDegS: large80Full.peakYawDegS,
      },
    },
    large110: {
      before: reproducedBaseline.large110,
      after: {
        fullStopDistanceM: large110Full.stopDistanceM,
        fullMeanSlideUtilization: large110Full.grossSlide.meanUtilization,
        fullPeakSideslipDeg: large110Full.peakSideslipDeg,
        fullPeakYawDegS: large110Full.peakYawDegS,
      },
    },
  },
}, null, 2));
