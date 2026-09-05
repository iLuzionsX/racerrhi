export function clamp01(value){
  return Math.max(0,Math.min(1,value));
}

export function smoothstep01(value){
  const t=clamp01(value);
  return t*t*(3-2*t);
}

/**
 * High-speed chase-camera profile.
 *
 * The original Racerrhi camera used a fixed world-space follow rate. A target
 * moving at highway/race speed therefore accumulated a large steady-state gap:
 * velocity / followRate. At 200 km/h and rate=4, that's roughly 14 m of extra lag
 * before the intentional chase distance is even counted.
 *
 * Keep a little speed sensation through modest pull-back/FOV growth, but cap the
 * world-space lag so the car never shrinks into the distance.
 */
export function chaseCameraProfile(speedMs){
  const speed=Math.max(0,Math.abs(Number(speedMs)||0));
  const kph=speed*3.6;
  const speedBlend=smoothstep01((kph-40)/(180-40));

  return {
    distanceM:8.5+0.9*speedBlend,
    fovDeg:53+4.5*speedBlend,
    followRate:Math.min(12,4+speed*0.18),
    maxWorldLagM:2.6,
    lookAheadM:5,
  };
}

/**
 * Useful for deterministic regression checks against the old fixed-rate camera.
 */
export function estimatedSteadyStateLagM(speedMs,followRate){
  const speed=Math.max(0,Math.abs(Number(speedMs)||0));
  const rate=Math.max(1e-6,Number(followRate)||0);
  return speed/rate;
}
