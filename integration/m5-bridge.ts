import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import type { VehicleState } from '../.vendor/Racing26/src/types';
import { loadBundledM5Visual } from '../.vendor/Racing26/src/graphics/bundledM5Visual';
import { racerrhiSteeringTargetForM5 } from './m5-steering-adapter';
import { racerrhiSurfaceMaterialForDistance } from './m5-surface-adapter';
import { createRacerrhiM5Config, RACERRHI_M5_REFERENCE_LOADS } from './m5-config';

export const M5_PHYSICS_SOURCE = Object.freeze({
  repository: 'iLuzionsX/Racing26',
  commit: 'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  preset: '2025 BMW M5 (G90)',
  fixedStepHz: 120,
});

export const M5_FIXED_DT = 1 / M5_PHYSICS_SOURCE.fixedStepHz;
export const M5_MAX_CATCHUP_STEPS = 8;

const M5_CONFIG = createRacerrhiM5Config();
const WHEEL_IDS = ['FL', 'FR', 'RL', 'RR'] as const;

export type M5WheelId = typeof WHEEL_IDS[number];
export type M5ContactState = 'contact' | 'airborne';

export type M5Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type RoadSample = {
  p?: Partial<M5Vec3>;
  d?: Partial<M5Vec3>;
  distance?: number;
  side?: number;
  t?: number;
};

export type M5PhysicalPose = {
  position: M5Vec3;
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  heaveM: number;
};

export type M5WheelTelemetry = {
  id: M5WheelId;
  isFront: boolean;
  isLeft: boolean;
  steerAngleRad: number;
  rotationAngleRad: number;
  angularVelocityRadS: number;
  wheelSpeedMs: number;
  suspensionCompression: number;
  verticalTravelM: number;
  normalLoadN: number;
  contactState: M5ContactState;
  hubWorldPos: M5Vec3;
  groundContactPos: M5Vec3;
  surfaceType: string;
  surfaceFriction: number;
  slipAngleRad: number;
  slipRatio: number;
  forceLongitudinalN: number;
  forceLateralN: number;
  frictionLimitN: number;
  gripUtilization: number;
  temperatureC: number;
  wearPercent: number;
  absActive: boolean;
  tcsActive: boolean;
};

export type M5BoundaryContactTelemetry = {
  active: boolean;
  penetrationM: number;
  outwardSpeedBeforeMs: number;
  outwardSpeedAfterMs: number;
  tangentialRetention: number;
  simulationStepCount: number;
};

export type M5CarState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  yawRate: number;
  rollRate: number;
  pitchRate: number;
  slip: number;
  roll: number;
  pitch: number;
  heave: number;
  gear: number;
  rpm: number;
  lateralG: number;
  longitudinalG: number;
  verticalG: number;
  localVelocityMs: {
    lateral: number;
    vertical: number;
    forward: number;
  };
  physicalPose: M5PhysicalPose;
  presentationPose: {
    pitchRad: number;
    rollRad: number;
  };
  wheels: M5WheelTelemetry[];
  absActive: boolean;
  tcsActive: boolean;
  boundaryContact: M5BoundaryContactTelemetry;
};

export type M5ControlInput = {
  throttle?: number;
  brake?: number;
  handbrake?: boolean;
  /** Binary keyboard/button intent. +1 is donor left, -1 donor right. */
  digitalSteerDirection?: -1 | 0 | 1;
  /** Racerrhi on-screen hand-wheel target in [-1, 1]. */
  analogSteerTarget?: number;
  /** True while the touch wheel owns steering. Analog wins simultaneous input. */
  analogSteerActive?: boolean;
  /** Legacy compatibility path; treated as analog and should not be used by the game. */
  steer?: number;
};

export type M5BoundaryContact = {
  roadPoint: M5Vec3;
  roadNormal: M5Vec3;
  side: -1 | 1;
  distanceM: number;
  limitDistanceM: number;
};

export type M5RenderSnapshot = {
  x: number;
  y: number;
  z: number;
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  heaveM: number;
  speedMs: number;
  steerAngleRad: number;
  wheels: Array<{
    id: M5WheelId;
    steerAngleRad: number;
    rotationAngleRad: number;
    hubWorldPos: M5Vec3;
    contactState: M5ContactState;
  }>;
};

export type M5StepScheduler = {
  accumulatorS: number;
  droppedTimeS: number;
  totalInputTimeS: number;
  totalSimulatedTimeS: number;
  stepCount: number;
  lastDroppedTimeS: number;
};

let sampleRoad: (x: number, z: number) => RoadSample = () => ({
  p: { y: 0 },
  d: { x: 0, y: 0, z: 1 },
  distance: 0,
});

export function setSurfaceSampler(fn: (x: number, z: number) => RoadSample) {
  if (typeof fn === 'function') sampleRoad = fn;
}

function finite(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function vec3(raw: Partial<M5Vec3> | undefined): M5Vec3 {
  return {
    x: finite(raw?.x),
    y: finite(raw?.y),
    z: finite(raw?.z),
  };
}

function wheelId(raw: string): M5WheelId {
  if ((WHEEL_IDS as readonly string[]).includes(raw)) return raw as M5WheelId;
  throw new Error('Unexpected Racing26 wheel identity: ' + raw);
}

function surfaceFromRoad(x: number, z: number) {
  const road = sampleRoad(x, z) || {};
  const d = road.d || {};
  const dx = finite(d.x);
  const dy = finite(d.y);
  const dz = finite(d.z, 1);
  const horizontalSq = Math.max(1e-8, dx * dx + dz * dz);
  let nx = -dx * dy;
  let ny = horizontalSq;
  let nz = -dy * dz;
  const normalLength = Math.hypot(nx, ny, nz) || 1;
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;

  const distance = finite(road.distance);
  const material = racerrhiSurfaceMaterialForDistance(distance);
  const elevation = finite(road.p?.y);

  return {
    elevation,
    normal: PhysicsMath.vec3(nx, ny, nz),
    slopePitch: Math.atan2(dy, Math.sqrt(horizontalSq)),
    slopeRoll: 0,
    type: material.type,
    friction: material.friction,
    rollingResistance: material.rollingResistance,
    wetness: 0,
    isKerbRumble: material.isKerbRumble,
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
    sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
  }
}

function simulationFor(state: M5CarState): Simulation {
  const sim = (state as M5CarState & { _m5?: Simulation })._m5;
  if (!sim) throw new Error('M5 physics state is missing its Racing26 Simulation instance.');
  return sim;
}

function hydrate(target: M5CarState, sim: Simulation, raw: VehicleState = sim.vehicle.getState()) {
  const euler = sim.vehicle.rigidBody.getEuler();
  const lateralMs = finite(raw.vx);
  const verticalMs = finite(raw.vy);
  const forwardMs = finite(raw.vz);
  const localPlanarSpeed = Math.hypot(lateralMs, forwardMs);
  const sideslipRad =
    localPlanarSpeed > 0.5
      ? Math.atan2(lateralMs, Math.max(0.5, Math.abs(forwardMs)))
      : 0;

  target.x = finite(raw.x);
  target.y = finite(raw.y);
  target.z = finite(raw.z);
  target.heading = finite(euler.yaw, finite(raw.yaw));
  target.speed = finite(raw.speedMs);
  target.steer = finite(raw.actualSteerAngle);
  target.yawRate = finite(raw.yawRate);
  target.rollRate = finite(raw.rollRate);
  target.pitchRate = finite(raw.pitchRate);
  target.slip = sideslipRad;
  target.roll = finite(euler.roll);
  target.pitch = finite(euler.pitch);
  target.heave = finite(raw.heave);
  target.gear = Number.isFinite(raw.gear) ? raw.gear : 0;
  target.rpm = finite(raw.rpm);
  target.lateralG = finite(raw.lateralG);
  target.longitudinalG = finite(raw.longitudinalG);
  target.verticalG = finite(raw.verticalG);
  target.localVelocityMs = {
    lateral: lateralMs,
    vertical: verticalMs,
    forward: forwardMs,
  };
  target.physicalPose = {
    position: {
      x: finite(sim.vehicle.rigidBody.position.x),
      y: finite(sim.vehicle.rigidBody.position.y),
      z: finite(sim.vehicle.rigidBody.position.z),
    },
    yawRad: finite(euler.yaw),
    pitchRad: finite(euler.pitch),
    rollRad: finite(euler.roll),
    heaveM: finite(raw.heave),
  };
  target.presentationPose = {
    pitchRad: finite(raw.pitch),
    rollRad: finite(raw.roll),
  };
  target.absActive = Boolean(raw.absActive);
  target.tcsActive = Boolean(raw.tcsActive);
  target.wheels = raw.wheels.map((wheel) => ({
    id: wheelId(wheel.id),
    isFront: Boolean(wheel.isFront),
    isLeft: Boolean(wheel.isLeft),
    steerAngleRad: finite(wheel.steerAngle),
    rotationAngleRad: finite(wheel.rotationAngle),
    angularVelocityRadS: finite(wheel.angularVelocity),
    wheelSpeedMs: finite(wheel.angularVelocity) * M5_CONFIG.wheelRadius,
    suspensionCompression: finite(wheel.suspensionCompression),
    verticalTravelM: finite(wheel.verticalTravelM),
    normalLoadN: finite(wheel.forceVectorNorm),
    contactState: wheel.isAirborne ? 'airborne' : 'contact',
    hubWorldPos: vec3(wheel.hubWorldPos),
    groundContactPos: vec3(wheel.groundContactPos),
    surfaceType: String(wheel.surfaceType),
    surfaceFriction: finite(wheel.surfaceFriction),
    slipAngleRad: finite(wheel.slipAngle),
    slipRatio: finite(wheel.slipRatio),
    forceLongitudinalN: finite(wheel.forceVectorLong),
    forceLateralN: finite(wheel.forceVectorLat),
    frictionLimitN: finite(wheel.frictionLimitN),
    gripUtilization: finite(wheel.gripUtilization),
    temperatureC: finite(wheel.temperature),
    wearPercent: finite(wheel.tireWearPercent),
    absActive: Boolean(wheel.absActive),
    tcsActive: Boolean(wheel.tcsActive),
  }));
  return target;
}

function neutralBoundaryTelemetry(): M5BoundaryContactTelemetry {
  return {
    active: false,
    penetrationM: 0,
    outwardSpeedBeforeMs: 0,
    outwardSpeedAfterMs: 0,
    tangentialRetention: 1,
    simulationStepCount: 0,
  };
}

export function newCar(x: number, z: number, heading: number): M5CarState {
  const sim = new Simulation(M5_CONFIG, surfaceProvider);
  sim.vehicle.powertrain.isAutomatic = true;
  setRigidBodyPose(sim, x, z, heading, 0);

  const target = {} as M5CarState;
  Object.defineProperty(target, '_m5', {
    value: sim,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  target.boundaryContact = neutralBoundaryTelemetry();
  hydrate(target, sim, sim.vehicle.getState());
  target.boundaryContact = neutralBoundaryTelemetry();
  return target;
}

function steeringInputsForStep(sim: Simulation, input: M5ControlInput) {
  const analogOwnsSteering = Boolean(input.analogSteerActive);
  if (analogOwnsSteering) {
    return {
      analogSteerTarget: racerrhiSteeringTargetForM5(sim, finite(input.analogSteerTarget)),
    };
  }

  const direction = input.digitalSteerDirection;
  if (direction === -1 || direction === 0 || direction === 1) {
    if (direction === 0 && Math.abs(sim.analogSteeringInput) > 1e-5) {
      return { analogSteerTarget: 0 };
    }
    return { digitalSteerDirection: direction };
  }

  if (Number.isFinite(input.analogSteerTarget)) {
    return {
      analogSteerTarget: racerrhiSteeringTargetForM5(sim, finite(input.analogSteerTarget)),
    };
  }

  if (Number.isFinite(input.steer)) {
    return {
      analogSteerTarget: racerrhiSteeringTargetForM5(sim, finite(input.steer)),
    };
  }

  return { digitalSteerDirection: 0 as const };
}

export function stepCar(
  state: M5CarState,
  input: M5ControlInput,
  dt: number = M5_FIXED_DT,
  _road?: RoadSample
) {
  const sim = simulationFor(state);
  if (Math.abs(finite(dt, M5_FIXED_DT) - sim.fixedDt) > 1e-7) {
    throw new Error(
      'Racerrhi owns the fixed-step clock. stepCar must receive exactly one 120 Hz physics step.'
    );
  }

  const steering = steeringInputsForStep(sim, input || {});
  const raw = sim.stepExplicit({
    throttle: PhysicsMath.clamp(finite(input?.throttle), 0, 1),
    brake: PhysicsMath.clamp(finite(input?.brake), 0, 1),
    steer: 0,
    ...steering,
    handbrake: Boolean(input?.handbrake),
    shiftUp: false,
    shiftDown: false,
  }, 1);

  const previousBoundary = state.boundaryContact;
  hydrate(state, sim, raw);
  state.boundaryContact = previousBoundary.active
    ? { ...previousBoundary, active: false }
    : previousBoundary;
  return state;
}

/**
 * Guardrail/boundary contact response that deliberately does not reset Simulation.
 * Position correction is horizontal. An outward impact receives a low-restitution
 * normal impulse plus mild tangential scrape loss; inward motion is left untouched.
 */
export function resolveBoundaryContact(state: M5CarState, contact: M5BoundaryContact) {
  const sim = simulationFor(state);
  const body = sim.vehicle.rigidBody;
  const side = contact.side;
  const nx = finite(contact.roadNormal.x) * side;
  const nz = finite(contact.roadNormal.z) * side;
  const nLength = Math.hypot(nx, nz) || 1;
  const outward = PhysicsMath.vec3(nx / nLength, 0, nz / nLength);
  const tangent = PhysicsMath.vec3(-outward.z, 0, outward.x);
  const penetrationM = Math.max(0, finite(contact.distanceM) - finite(contact.limitDistanceM));

  const roadX = finite(contact.roadPoint.x);
  const roadZ = finite(contact.roadPoint.z);
  body.position.x = roadX + outward.x * finite(contact.limitDistanceM);
  body.position.z = roadZ + outward.z * finite(contact.limitDistanceM);

  const velocityBefore = body.velocity;
  const outwardSpeedBefore = PhysicsMath.vec3Dot(velocityBefore, outward);
  const tangentSpeedBefore = PhysicsMath.vec3Dot(velocityBefore, tangent);
  let outwardSpeedAfter = outwardSpeedBefore;
  let tangentialRetention = 1;

  if (outwardSpeedBefore > 0) {
    const restitution = 0.08;
    outwardSpeedAfter = -outwardSpeedBefore * restitution;
    const scrapeRetention = 0.985;
    tangentialRetention = scrapeRetention;

    const verticalSpeed = velocityBefore.y;
    const tangentSpeedAfter = tangentSpeedBefore * scrapeRetention;
    body.velocity = PhysicsMath.vec3(
      outward.x * outwardSpeedAfter + tangent.x * tangentSpeedAfter,
      verticalSpeed,
      outward.z * outwardSpeedAfter + tangent.z * tangentSpeedAfter
    );

    const beforeSq = PhysicsMath.vec3Dot(velocityBefore, velocityBefore);
    const afterSq = PhysicsMath.vec3Dot(body.velocity, body.velocity);
    if (afterSq > beforeSq + 1e-9) {
      const scale = beforeSq > 1e-12 ? Math.sqrt(beforeSq / afterSq) : 0;
      body.velocity = PhysicsMath.vec3Scale(body.velocity, scale);
    }
  }

  hydrate(state, sim, sim.vehicle.getState());
  state.boundaryContact = {
    active: true,
    penetrationM,
    outwardSpeedBeforeMs: outwardSpeedBefore,
    outwardSpeedAfterMs: outwardSpeedAfter,
    tangentialRetention,
    simulationStepCount: sim.stepCount,
  };
  return state;
}

/** Full simulation reset. Use only for deliberate restart/respawn. */
export function setCarPose(
  state: M5CarState,
  x: number,
  z: number,
  heading: number,
  speedMs = state.speed || 0
) {
  const sim = simulationFor(state);
  setRigidBodyPose(sim, x, z, heading, speedMs);
  hydrate(state, sim, sim.vehicle.getState());
  state.boundaryContact = neutralBoundaryTelemetry();
  return state;
}

export function refreshCarState(state: M5CarState) {
  const sim = simulationFor(state);
  hydrate(state, sim, sim.vehicle.getState());
  return state;
}

export function captureM5RenderSnapshot(state: M5CarState): M5RenderSnapshot {
  return {
    x: state.physicalPose.position.x,
    y: state.physicalPose.position.y,
    z: state.physicalPose.position.z,
    yawRad: state.physicalPose.yawRad,
    pitchRad: state.physicalPose.pitchRad,
    rollRad: state.physicalPose.rollRad,
    heaveM: state.physicalPose.heaveM,
    speedMs: state.speed,
    steerAngleRad: state.steer,
    wheels: state.wheels.map((wheel) => ({
      id: wheel.id,
      steerAngleRad: wheel.steerAngleRad,
      rotationAngleRad: wheel.rotationAngleRad,
      hubWorldPos: { ...wheel.hubWorldPos },
      contactState: wheel.contactState,
    })),
  };
}

function lerpAngle(a: number, b: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * alpha;
}

export function interpolateM5RenderSnapshots(
  previous: M5RenderSnapshot,
  current: M5RenderSnapshot,
  alpha: number
): M5RenderSnapshot {
  const t = PhysicsMath.clamp(finite(alpha), 0, 1);
  const previousById = new Map(previous.wheels.map((wheel) => [wheel.id, wheel]));

  return {
    x: PhysicsMath.lerp(previous.x, current.x, t),
    y: PhysicsMath.lerp(previous.y, current.y, t),
    z: PhysicsMath.lerp(previous.z, current.z, t),
    yawRad: lerpAngle(previous.yawRad, current.yawRad, t),
    pitchRad: lerpAngle(previous.pitchRad, current.pitchRad, t),
    rollRad: lerpAngle(previous.rollRad, current.rollRad, t),
    heaveM: PhysicsMath.lerp(previous.heaveM, current.heaveM, t),
    speedMs: PhysicsMath.lerp(previous.speedMs, current.speedMs, t),
    steerAngleRad: PhysicsMath.lerp(previous.steerAngleRad, current.steerAngleRad, t),
    wheels: current.wheels.map((wheel) => {
      const prior = previousById.get(wheel.id) || wheel;
      return {
        id: wheel.id,
        steerAngleRad: PhysicsMath.lerp(prior.steerAngleRad, wheel.steerAngleRad, t),
        rotationAngleRad: lerpAngle(prior.rotationAngleRad, wheel.rotationAngleRad, t),
        hubWorldPos: {
          x: PhysicsMath.lerp(prior.hubWorldPos.x, wheel.hubWorldPos.x, t),
          y: PhysicsMath.lerp(prior.hubWorldPos.y, wheel.hubWorldPos.y, t),
          z: PhysicsMath.lerp(prior.hubWorldPos.z, wheel.hubWorldPos.z, t),
        },
        contactState: t < 0.5 ? prior.contactState : wheel.contactState,
      };
    }),
  };
}

export function createM5StepScheduler(): M5StepScheduler {
  return {
    accumulatorS: 0,
    droppedTimeS: 0,
    totalInputTimeS: 0,
    totalSimulatedTimeS: 0,
    stepCount: 0,
    lastDroppedTimeS: 0,
  };
}

export function resetM5StepScheduler(clock: M5StepScheduler) {
  clock.accumulatorS = 0;
  clock.droppedTimeS = 0;
  clock.totalInputTimeS = 0;
  clock.totalSimulatedTimeS = 0;
  clock.stepCount = 0;
  clock.lastDroppedTimeS = 0;
  return clock;
}

export function consumeM5FrameTime(
  clock: M5StepScheduler,
  frameDeltaS: number,
  fixedStep: () => void
) {
  const rawDelta = Math.max(0, finite(frameDeltaS));
  const acceptedDelta = Math.min(rawDelta, 0.1);
  clock.totalInputTimeS += rawDelta;
  clock.lastDroppedTimeS = rawDelta - acceptedDelta;
  clock.accumulatorS += acceptedDelta;

  let steps = 0;
  const epsilon = 1e-10;
  while (
    clock.accumulatorS + epsilon >= M5_FIXED_DT &&
    steps < M5_MAX_CATCHUP_STEPS
  ) {
    fixedStep();
    clock.accumulatorS -= M5_FIXED_DT;
    if (Math.abs(clock.accumulatorS) < epsilon) clock.accumulatorS = 0;
    clock.totalSimulatedTimeS += M5_FIXED_DT;
    clock.stepCount++;
    steps++;
  }

  if (clock.accumulatorS + epsilon >= M5_FIXED_DT) {
    const wholeStepsToDrop = Math.floor((clock.accumulatorS + epsilon) / M5_FIXED_DT);
    const dropped = wholeStepsToDrop * M5_FIXED_DT;
    clock.accumulatorS = Math.max(0, clock.accumulatorS - dropped);
    clock.lastDroppedTimeS += dropped;
  }

  clock.droppedTimeS += clock.lastDroppedTimeS;
  return {
    steps,
    alpha: PhysicsMath.clamp(clock.accumulatorS / M5_FIXED_DT, 0, 1),
    droppedTimeS: clock.lastDroppedTimeS,
    totalDroppedTimeS: clock.droppedTimeS,
  };
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
    tireReferenceLoadFrontN: RACERRHI_M5_REFERENCE_LOADS.frontN,
    tireReferenceLoadRearN: RACERRHI_M5_REFERENCE_LOADS.rearN,
  };
}

export async function loadM5Visual() {
  return loadBundledM5Visual(M5_CONFIG);
}

export function advanceLap(lap: { elapsed: number; valid: boolean; next: number; previous: number; count: number }, t: number, onTrack: boolean, dt: number) {
  lap.elapsed += dt;
  if (!onTrack) lap.valid = false;
  const sector = Math.floor(t * 4);
  if (sector === lap.next && onTrack) lap.next += 1;
  let finish: number | null = null;
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
