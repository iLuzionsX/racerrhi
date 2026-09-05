export type RacerrhiSurfaceKind = 'asphalt' | 'kerb' | 'gravel';

export interface RacerrhiSurfaceMaterial {
  type: RacerrhiSurfaceKind;
  friction: number;
  rollingResistance: number;
  isKerbRumble: boolean;
}

const ASPHALT_FRICTION = 1.0;
const KERB_FRICTION = 0.88;
const GRAVEL_FRICTION = 0.55;
const ASPHALT_RR = 0.015;
const KERB_RR = 0.022;
const GRAVEL_RR = 0.075;

function clamp01(value:number):number {
  return Math.max(0,Math.min(1,value));
}

function smoothstep01(value:number):number {
  const t=clamp01(value);
  return t*t*(3-2*t);
}

function lerp(a:number,b:number,t:number):number {
  return a+(b-a)*t;
}

/**
 * Racerrhi's visual road/kerb/gravel boundaries are still authoritative.
 *
 * A tire has a finite contact patch, however, so its available friction cannot
 * physically jump from one material's full coefficient to another's in a single
 * mathematical point. Blend over a few decimetres around each visual boundary.
 *
 * The categorical type remains tied to the original Racerrhi boundaries so HUD,
 * rumble, lap validity and presentation semantics do not change.
 */
export function racerrhiSurfaceMaterialForDistance(distanceM:number):RacerrhiSurfaceMaterial {
  const d=Math.max(0,Number.isFinite(distanceM)?distanceM:0);
  const type:RacerrhiSurfaceKind = d>8.25?'gravel':d>7.0?'kerb':'asphalt';
  const isKerbRumble=type==='kerb';

  // Inner road -> kerb transition: 30 cm total footprint blend around 7.0 m.
  const roadToKerb=smoothstep01((d-6.85)/(7.15-6.85));
  let friction=lerp(ASPHALT_FRICTION,KERB_FRICTION,roadToKerb);
  let rollingResistance=lerp(ASPHALT_RR,KERB_RR,roadToKerb);

  // Outer kerb -> gravel transition: 40 cm total footprint blend around 8.25 m.
  const kerbToGravel=smoothstep01((d-8.05)/(8.45-8.05));
  friction=lerp(friction,GRAVEL_FRICTION,kerbToGravel);
  rollingResistance=lerp(rollingResistance,GRAVEL_RR,kerbToGravel);

  return {type,friction,rollingResistance,isKerbRumble};
}
