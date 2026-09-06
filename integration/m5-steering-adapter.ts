import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import {
  digitalCountersteerRecoveryBlend,
  digitalSteeringTarget,
} from '../.vendor/Racing26/src/physics/DigitalSteeringInput';

/**
 * Touch steering is a hand-position control, so the same thumb position must
 * always mean the same requested rack position. Keep the mapping fixed across
 * speed, braking, throttle, yaw and sideslip.
 *
 * The polynomial has no deadzone and keeps the center deliberately gentle:
 *   0.30 x + 0.25 x^3 + 0.45 x^5
 * Full thumb travel still reaches full mechanical rack for parking, tight
 * corners and deliberate countersteer.
 */
export function racerrhiFixedTouchCurve(value: number): number {
  const raw = PhysicsMath.clamp(Number(value) || 0, -1, 1);
  const magnitude = Math.abs(raw);
  const shaped =
    0.30 * magnitude +
    0.25 * magnitude ** 3 +
    0.45 * magnitude ** 5;
  return Math.sign(raw) * shaped;
}

export function racerrhiSteeringTargetForM5(
  _sim: Simulation,
  racerrhiSteer: number
): number {
  // Racerrhi input sign is opposite Racing26's canonical +left convention.
  return PhysicsMath.clamp(-racerrhiFixedTouchCurve(racerrhiSteer), -1, 1);
}

function steeringContext(sim: Simulation) {
  const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
  const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localVelocity.x, localVelocity.z);
  const sideslipRad =
    speedMs > 0.5
      ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
      : 0;

  return {
    speedMs,
    localVelocity,
    context: {
      wheelbaseM: sim.vehicle.config.wheelbase,
      maxSteerAngleRad: sim.vehicle.config.maxSteerAngle,
      yawRateRadS: localAngularVelocity.y,
      sideslipRad,
      forwardSpeedMs: localVelocity.z,
    },
  };
}

export function racerrhiKeyboardTargetForM5(
  sim: Simulation,
  direction: -1 | 0 | 1
): number {
  const { speedMs, context } = steeringContext(sim);
  return digitalSteeringTarget(direction, speedMs, context);
}

function moveToward(current: number, target: number, maxStep: number): number {
  const error = target - current;
  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(current + Math.sign(error) * maxStep, -1, 1);
}

/**
 * Keyboard steering is a time-based driver request, not an instant rack target.
 *
 * The donor already computes a useful speed-dependent *amplitude* limit. Its
 * stock fixed rack-units-per-second slew, however, reaches a tiny high-speed
 * limit almost immediately. Racerrhi instead scales normal wind-on rate to the
 * current target magnitude so the time needed to reach the requested cornering
 * limit stays approximately constant at every road speed.
 *
 * Release and the unwind half of a reversal are intentionally quicker. Genuine
 * slide-recovery authority from the donor is retained, but it is still ramped
 * rather than injected as a gain jump.
 */
export function updateRacerrhiKeyboardSteeringInput(
  sim: Simulation,
  currentInput: number,
  direction: -1 | 0 | 1,
  dt: number
): number {
  const current = PhysicsMath.clamp(Number(currentInput) || 0, -1, 1);
  if (!(dt > 0)) return current;

  const { speedMs, context } = steeringContext(sim);
  const target = digitalSteeringTarget(direction, speedMs, context);
  const recoveryBlend = digitalCountersteerRecoveryBlend(
    direction,
    speedMs,
    context
  );

  if (Math.abs(target - current) <= 1e-12) return target;

  const reversing =
    direction !== 0 &&
    Math.sign(current) !== 0 &&
    Math.sign(target) !== Math.sign(current);

  // Reversal is explicitly two-stage: unwind first, then build the opposite
  // request. This prevents one fast slew step from blasting through center.
  if (reversing) {
    const unwindReference = Math.max(Math.abs(current), 0.12);
    const unwindRate = unwindReference / 0.16;
    const timeToCenter = Math.abs(current) / unwindRate;
    if (dt <= timeToCenter) {
      return moveToward(current, 0, unwindRate * dt);
    }

    const remainingDt = dt - timeToCenter;
    const windTime = PhysicsMath.lerp(0.58, 0.30, recoveryBlend);
    const windRate = Math.abs(target) / Math.max(0.05, windTime);
    return moveToward(0, target, windRate * remainingDt);
  }

  if (direction === 0) {
    // Quick, smooth release. The small reference floor avoids a long tail near
    // center without creating an input deadzone.
    const releaseRate = Math.max(Math.abs(current), 0.08) / 0.16;
    return moveToward(current, 0, releaseRate * dt);
  }

  // If acceleration or another state change lowers the useful envelope while a
  // key is held, trim toward the new target promptly but continuously.
  if (
    Math.sign(current) === Math.sign(target) &&
    Math.abs(current) > Math.abs(target)
  ) {
    const trimRate = Math.max(Math.abs(current), Math.abs(target), 0.08) / 0.20;
    return moveToward(current, target, trimRate * dt);
  }

  // Normal wind-on takes ~0.58 s from center to the current ordinary limit,
  // independent of whether that limit is 100% rack at parking speed or only a
  // few percent at 200 km/h. Severe recovery smoothly shortens that to 0.30 s.
  const windTime = PhysicsMath.lerp(0.58, 0.30, recoveryBlend);
  const windRate = Math.abs(target) / Math.max(0.05, windTime);
  return moveToward(current, target, windRate * dt);
}
