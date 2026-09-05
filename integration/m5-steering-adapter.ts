import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { digitalCountersteerRecoveryBlend } from '../.vendor/Racing26/src/physics/DigitalSteeringInput';

// Racerrhi's on-screen wheel is deliberately compact: +/-135 deg from center.
// Racing26's M5 mobile steering is calibrated around 900 deg lock-to-lock
// (+/-450 deg). The adapter converts Racerrhi hand travel into the M5 rack scale.
export const RACERRHI_HAND_WHEEL_ONE_WAY_DEG = 135;
export const M5_HAND_WHEEL_ONE_WAY_DEG = 450;
export const ROAD_SPEED_HAND_TO_RACK_SCALE =
  RACERRHI_HAND_WHEEL_ONE_WAY_DEG / M5_HAND_WHEEL_ONE_WAY_DEG;

function smoothstep01(value: number): number {
  const t = PhysicsMath.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function racerrhiSteeringTargetForM5(sim: Simulation, racerrhiSteer: number): number {
  const raw = PhysicsMath.clamp(Number(racerrhiSteer) || 0, -1, 1);
  if (Math.abs(raw) < 1e-9) return 0;

  // Racerrhi input sign is opposite Racing26's canonical +left convention.
  const physicalDirectionTarget = -raw;

  const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
  const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localVelocity.x, localVelocity.z);
  const sideslipRad =
    speedMs > 0.5
      ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
      : 0;

  // Preserve tight maneuvering/hairpin authority below ~32 km/h. By ~68 km/h,
  // use the road-car-like 900-degree hand-wheel/rack relationship.
  const roadSpeedBlend = smoothstep01((speedMs - 9) / 10);
  let scale = PhysicsMath.lerp(1.0, ROAD_SPEED_HAND_TO_RACK_SCALE, roadSpeedBlend);

  // Severe opposite-lock recovery may temporarily unlock more rack authority.
  const direction = Math.sign(physicalDirectionTarget) as -1 | 1;
  const recoveryBlend = digitalCountersteerRecoveryBlend(direction, speedMs, {
    wheelbaseM: sim.vehicle.config.wheelbase,
    maxSteerAngleRad: sim.vehicle.config.maxSteerAngle,
    yawRateRadS: localAngularVelocity.y,
    sideslipRad,
    forwardSpeedMs: localVelocity.z,
  });
  scale = PhysicsMath.lerp(scale, 1.0, recoveryBlend);

  return PhysicsMath.clamp(physicalDirectionTarget * scale, -1, 1);
}
