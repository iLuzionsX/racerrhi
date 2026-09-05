import { DEFAULT_VEHICLE_CONFIG } from '../.vendor/Racing26/src/physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../.vendor/Racing26/src/physics/m5G90';

export const RACERRHI_STANDARD_GRAVITY_MS2 = 9.81;

/**
 * Racing26 can infer tire reference load from the first 240 loaded tire samples
 * when no explicit reference is supplied. In Racerrhi those samples begin only
 * after the countdown, so a launch, steering input, curb touch, or early weight
 * transfer can permanently bias that session's load-sensitivity baseline.
 *
 * Pin the M5 tire reference loads to its static axle weights instead. This keeps
 * the donor's tire curve, grip coefficients, temperature/wear model, suspension,
 * differential, and driver aids intact; it only removes startup-history dependence.
 */
export function createRacerrhiM5Config(): any {
  const config: any = {
    ...DEFAULT_VEHICLE_CONFIG,
    ...BMW_M5_2025_OVERRIDES,
  };

  const massKg = Math.max(1, Number(config.mass) || 1);
  const frontShare = Math.max(0.05, Math.min(0.95, Number(config.weightDistributionFront) || 0.5));
  const totalStaticWeightN = massKg * RACERRHI_STANDARD_GRAVITY_MS2;

  config.tireReferenceLoadFrontN = totalStaticWeightN * frontShare * 0.5;
  config.tireReferenceLoadRearN = totalStaticWeightN * (1 - frontShare) * 0.5;

  return config;
}

const referenceConfig = createRacerrhiM5Config();

export const RACERRHI_M5_REFERENCE_LOADS = Object.freeze({
  frontN: referenceConfig.tireReferenceLoadFrontN as number,
  rearN: referenceConfig.tireReferenceLoadRearN as number,
});
