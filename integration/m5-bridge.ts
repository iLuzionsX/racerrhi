import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../.vendor/Racing26/src/physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../.vendor/Racing26/src/physics/m5G90';
import { loadBundledM5Visual } from '../.vendor/Racing26/src/graphics/bundledM5Visual';
import { digitalCountersteerRecoveryBlend } from '../.vendor/Racing26/src/physics/DigitalSteeringInput';

export const M5_PHYSICS_SOURCE = Object.freeze({
  repository: 'iLuzionsX/Racing26',
  commit: 'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  preset: '2025 BMW M5 (G90)',
  fixedStepHz: 120,
});

const M5_CONFIG: any = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
};

// Racerrhi's on-screen wheel is deliberately compact: +/-135 deg from center.
// Racing26's M5 mobile steering was calibrated around a road-car-like 900 deg
// lock-to-lock wheel (+/-450 deg). Feeding Racerrhi's normalized value directly
// into the M5 rack therefore made a normal-looking 60-90 deg hand movement command
// roughly 2.5-3.3x too much road-wheel angle at corner-entry speed.
const RACERRHI_HAND_WHEEL_ONE_WAY_DEG = 135;
const M5_HAND_WHEEL_ONE_WAY_DEG = 450;
const ROAD_SPEED_HAND_TO_RACK_SCALE =
  RACERRHI_HAND_WHEEL_ONE_WAY_DEG / M5_HAND_WHEEL_ONE_WAY_DEG; // 0.30

function smoothstep01(value: number): number {
  const t = PhysicsMath.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function racerrhiSteeringTargetForM5(sim: Simulation, racerrhiSteer: number): number {
  const raw = PhysicsMath.clamp(Number(racerrhiSteer) || 0, -1, 1);
  if (Math.abs(raw) < 1e-9) return 0;

  // Bridge sign convention: Racerrhi +steer is visually/right-hand positive while
  // Racing26 canonical +steer is vehicle-left.
  const physicalDirectionTarget = -raw;

  const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
  const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localVelocity.x, localVelocity.z);
  const sideslipRad =
    speedMs > 0.5
      ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
      : 0;

  // Keep tight maneuvering/hairpin authority at low speed, then transition to the
  // M5's realistic hand-wheel/rack relationship before normal first-corner speeds.
  const roadSpeedBlend = smoothstep01((speedMs - 9) / 10);
  let scale = PhysicsMath.lerp(1.0, ROAD_SPEED_HAND_TO_RACK_SCALE, roadSpeedBlend);

  // Do not make the realistic road-speed ratio prevent catching a real slide.
  // Racing26's state-aware recovery gate only unlocks authority when the driver's
  // requested direction genuinely opposes both yaw and oversteer sideslip.
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

type RoadSample = {
  p?: { x?: number; y?: number; z?: number };
  d?: { x?: number; y?: number; z?: number };
  distance?: number;
};

let sampleRoad: (x: number, z: number) => RoadSample = () => ({
  p: { y: 0 },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
});

export function setSurfaceSampler(fn: (x: number, z: number) => RoadSample) {
  if (typeof fn === 'function') sampleRoad = fn;
}

function surfaceFromRoad(x: number, z: number) {
  const road = sampleRoad(x, z) || {};
  const d = road.d || {};
  const dx = Number(d.x) || 0;
  const dy = Number(d.y) || 0;
  const dz = Number(d.z) || 1;
  const horizontalSq = Math.max(1e-8, dx * dx + dz * dz);
  let nx = -dx * dy;
  let ny = horizontalSq;
  let nz = -dy * dz;
  const normalLength = Math.hypot(nx, ny, nz) || 1;
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;

  const distance = Number(road.distance) || 0;
  const onRoad = distance <= 7.7;
  const onKerb = distance > 7.0 && distance <= 8.25;
  const elevation = Number(road.p?.y) || 0;

  return {
    elevation,
    normal: PhysicsMath.vec3(nx, ny, nz),
    slopePitch: Math.atan2(dy, Math.sqrt(horizontalSq)),
    slopeRoll: 0,
    type: onKerb ? 'kerb' : onRoad ? 'asphalt' : 'gravel',
    friction: onKerb ? 0.88 : onRoad ? 1.0 : 0.55,
    rollingResistance: onRoad ? 0.015 : 0.075,
    wetness: 0,
    isKerbRumble: onKerb,
  };
}

const surfaceProvider = {
  sampleSurface(x: number, z: number) {
    return surfaceFromRoad(x, z);
  },
};

function setRigidBodyPose(sim: Simulation, x: number, z: number, yaw: number, speedMs = 0) {
  sim.reset(x, z, yaw);
  const surface = surfaceFromRoad(x, z);
  sim.vehicle.rigidBody.position.y = surface.elevation + M5_CONFIG.centerOfGravityHeight;
  sim.vehicle.suspension.reset();
  sim.suspensionKinematics.reset();

  if (Math.abs(speedMs) > 1e-6) {
    const velocity = PhysicsMath.quatRotateVec3(
      sim.vehicle.rigidBody.orientation,
      PhysicsMath.vec3(0, 0, speedMs)
    );
    sim.vehicle.rigidBody.velocity = velocity;
    sim.vehicle.wheels.forEach((wheel: any) => wheel.reset(speedMs));
  }
}

function hydrate(target: any, raw: any) {
  target.x = Number(raw.x) || 0;
  target.z = Number(raw.z) || 0;
  target.heading = Number(raw.yaw) || 0;
  target.speed = Number(raw.speedMs) || 0;
  target.steer = Number(raw.actualSteerAngle) || 0;
  target.yawRate = Number(raw.yawRate) || 0;
  target.roll = Number(raw.roll) || 0;
  target.pitch = Number(raw.pitch) || 0;
  target.slip = Math.atan2(
    Number(raw.lateralVelocityMs) || 0,
    Math.max(0.1, Math.abs(Number(raw.longitudinalVelocityMs) || target.speed))
  );
  target.gear = Number.isFinite(raw.gear) ? raw.gear : 0;
  target.rpm = Number(raw.rpm) || 0;
  target.wheels = Array.isArray(raw.wheels)
    ? raw.wheels.map((wheel: any) => ({
        id: wheel.id,
        isFront: Boolean(wheel.isFront),
        isLeft: Boolean(wheel.isLeft),
        steerAngle: Number(wheel.steerAngle) || 0,
        rotationAngle: Number(wheel.rotationAngle) || 0,
        verticalTravelM: Number(wheel.verticalTravelM) || 0,
      }))
    : [];
  return target;
}

export function newCar(x: number, z: number, heading: number) {
  const sim = new Simulation(M5_CONFIG, surfaceProvider as any);
  sim.vehicle.powertrain.isAutomatic = true;
  setRigidBodyPose(sim, x, z, heading, 0);

  const target: any = {
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    steer: 0,
    yawRate: 0,
    slip: 0,
    roll: 0,
    pitch: 0,
    gear: 0,
    rpm: 0,
  };

  Object.defineProperty(target, '_m5', {
    value: sim,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return hydrate(target, sim.vehicle.getState());
}

export function stepCar(state: any, input: any, dt: number, _road?: RoadSample) {
  const sim: Simulation = state._m5;
  if (!sim) throw new Error('M5 physics state is missing its Racing26 Simulation instance.');

  const steps = Math.max(1, Math.round(Math.max(sim.fixedDt, Number(dt) || sim.fixedDt) / sim.fixedDt));
  const raw = sim.stepExplicit({
    throttle: Math.max(0, Math.min(1, Number(input?.throttle) || 0)),
    brake: Math.max(0, Math.min(1, Number(input?.brake) || 0)),
    steer: 0,
    analogSteerTarget: racerrhiSteeringTargetForM5(sim, Number(input?.steer) || 0),
    handbrake: Boolean(input?.handbrake),
    shiftUp: false,
    shiftDown: false,
  } as any, steps);

  return hydrate(state, raw);
}

export function setCarPose(state: any, x: number, z: number, heading: number, speedMs = state.speed || 0) {
  const sim: Simulation = state._m5;
  if (!sim) return state;
  setRigidBodyPose(sim, x, z, heading, speedMs);
  return hydrate(state, sim.vehicle.getState());
}

export function getM5PhysicsMetadata() {
  return {
    ...M5_PHYSICS_SOURCE,
    massKg: M5_CONFIG.mass,
    wheelbaseM: M5_CONFIG.wheelbase,
    frontTrackM: M5_CONFIG.trackWidthFront,
    rearTrackM: M5_CONFIG.trackWidthRear,
    drivetrain: M5_CONFIG.drivetrain,
    tireModel: 'Racing26 four-wheel transient tire model',
  };
}

export async function loadM5Visual() {
  return loadBundledM5Visual(M5_CONFIG);
}

export function advanceLap(lap: any, t: number, onTrack: boolean, dt: number) {
  lap.elapsed += dt;
  if (!onTrack) lap.valid = false;
  const sector = Math.floor(t * 4);
  if (sector === lap.next && onTrack) lap.next += 1;
  let finish = null;
  if (lap.previous > 0.90 && t < 0.10) {
    if (lap.valid && lap.next === 4) finish = lap.elapsed;
    lap.elapsed = 0;
    lap.next = 1;
    lap.valid = true;
    lap.count += 1;
  }
  lap.previous = t;
  return finish;
}
