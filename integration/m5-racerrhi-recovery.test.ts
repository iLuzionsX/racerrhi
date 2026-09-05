import * as THREE from 'three';
import { Simulation } from '../.vendor/Racing26/src/physics/Simulation';
import { PhysicsMath } from '../.vendor/Racing26/src/physics/math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../.vendor/Racing26/src/physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../.vendor/Racing26/src/physics/m5G90';

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as any;

const neutral = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const points = [
  new THREE.Vector3(-225, 13, -200),
  new THREE.Vector3(-225, 13, 50),
  new THREE.Vector3(-185, 16, 245),
  new THREE.Vector3(-55, 22, 325),
  new THREE.Vector3(100, 27, 265),
  new THREE.Vector3(155, 24, 115),
  new THREE.Vector3(290, 22, 65),
  new THREE.Vector3(300, 20, -65),
  new THREE.Vector3(170, 18, -110),
  new THREE.Vector3(85, 14, -225),
  new THREE.Vector3(185, 11, -320),
  new THREE.Vector3(70, 11, -385),
  new THREE.Vector3(-110, 12, -345),
];

const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
curve.arcLengthDivisions = 4000;
const N = 1400;

const samples = Array.from({ length: N }, (_, i) => {
  const t = i / N;
  const p = curve.getPointAt(t);
  const d = curve.getTangentAt(t).normalize();
  const n = new THREE.Vector3(d.z, 0, -d.x).normalize();
  return { p, d, n, t };
});

function at(t: number) {
  t = ((t % 1) + 1) % 1;
  const f = t * N;
  const i = Math.floor(f) % N;
  const a = samples[i];
  const b = samples[(i + 1) % N];
  const u = f - Math.floor(f);
  return {
    p: a.p.clone().lerp(b.p, u),
    d: a.d.clone().lerp(b.d, u).normalize(),
    n: a.n.clone().lerp(b.n, u).normalize(),
    t,
  };
}

function nearest(x: number, z: number) {
  let best = Infinity;
  let index = 0;
  for (let i = 0; i < N; i++) {
    const p = samples[i].p;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < best) {
      best = d2;
      index = i;
    }
  }
  const a = samples[index];
  const b = samples[(index + 1) % N];
  const abx = b.p.x - a.p.x;
  const abz = b.p.z - a.p.z;
  const len2 = Math.max(0.01, abx * abx + abz * abz);
  const u = THREE.MathUtils.clamp(
    ((x - a.p.x) * abx + (z - a.p.z) * abz) / len2,
    0,
    1,
  );
  const p = a.p.clone().lerp(b.p, u);
  const d = a.d.clone().lerp(b.d, u).normalize();
  const n = a.n.clone().lerp(b.n, u).normalize();
  const dx = x - p.x;
  const dz = z - p.z;
  return {
    p,
    d,
    n,
    distance: Math.hypot(dx, dz),
    side: dx * n.x + dz * n.z,
    t: (index + u) / N,
  };
}

const racerrhiSurfaceProvider = {
  sampleSurface(x: number, z: number) {
    const road = nearest(x, z);
    const dx = road.d.x;
    const dy = road.d.y;
    const dz = road.d.z;
    const horizontalSq = Math.max(1e-8, dx * dx + dz * dz);

    let nx = -dx * dy;
    let ny = horizontalSq;
    let nz = -dy * dz;
    const normalLength = Math.hypot(nx, ny, nz) || 1;
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;

    const onRoad = road.distance <= 7.7;
    const onKerb = road.distance > 7.0 && road.distance <= 8.25;

    return {
      elevation: road.p.y,
      normal: PhysicsMath.vec3(nx, ny, nz),
      slopePitch: Math.atan2(dy, Math.sqrt(horizontalSq)),
      slopeRoll: 0,
      type: onKerb ? 'kerb' : onRoad ? 'asphalt' : 'gravel',
      friction: onKerb ? 0.88 : onRoad ? 1.0 : 0.55,
      rollingResistance: onRoad ? 0.015 : 0.075,
      wetness: 0,
      isKerbRumble: onKerb,
    };
  },
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finiteVehicle(sim: Simulation) {
  const body = sim.vehicle.rigidBody;
  return [
    body.position.x, body.position.y, body.position.z,
    body.velocity.x, body.velocity.y, body.velocity.z,
    body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z,
    body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w,
    ...sim.vehicle.suspension.states.flatMap((state) => [
      state.displacement,
      state.hubPositionWorldY,
      state.hubVelocityWorldY,
      state.tireNormalForceN,
      state.chassisForceN,
    ]),
  ].every(Number.isFinite);
}

const station = at(0.006);
const yaw = Math.atan2(station.d.x, station.d.z);

function initialSim() {
  const sim = new Simulation(config, racerrhiSurfaceProvider as any);
  sim.reset(station.p.x, station.p.z, yaw);
  sim.vehicle.rigidBody.position.y = station.p.y + config.centerOfGravityHeight;
  sim.vehicle.suspension.reset();
  sim.suspensionKinematics.reset();
  for (let i = 0; i < 360; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function placeOnAsphaltPreservingState(sim: Simulation, speedMs: number) {
  const body = sim.vehicle.rigidBody;
  body.position = PhysicsMath.vec3(
    station.p.x,
    station.p.y + config.centerOfGravityHeight,
    station.p.z,
  );
  body.orientation = PhysicsMath.quatFromEuler(0, yaw, 0);
  body.velocity = PhysicsMath.quatRotateVec3(
    body.orientation,
    PhysicsMath.vec3(0, 0, speedMs),
  );
  body.angularVelocity = PhysicsMath.vec3(0, 0, 0);

  sim.vehicle.wheels.forEach((wheel) => {
    wheel.angularVelocity = speedMs / config.wheelRadius;
  });

  // Deliberately do not reset suspension, tire relaxation, temperature, wear,
  // powertrain, differential, ABS/TCS, or any other persistent M5 state.
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
}

function measureGrip(sim: Simulation) {
  let lateralN = 0;
  let normalN = 0;
  let asphaltWheelSamples = 0;
  let count = 0;

  for (let i = 0; i < 72; i++) {
    const state = sim.stepExplicit({ ...neutral, steer: 0.04 }, 1);
    if (i >= 24) {
      lateralN += Math.abs(
        state.wheels.reduce((sum, wheel) => sum + wheel.forceVectorLat, 0),
      );
      normalN += state.wheels.reduce((sum, wheel) => sum + wheel.forceVectorNorm, 0);
      asphaltWheelSamples += state.wheels.filter((wheel) => wheel.surfaceType === 'asphalt').length;
      count++;
    }
  }

  return {
    meanLateralForceN: lateralN / Math.max(1, count),
    meanNormalForceN: normalN / Math.max(1, count),
    asphaltFraction: asphaltWheelSamples / Math.max(1, count * 4),
  };
}

const fresh = initialSim();
placeOnAsphaltPreservingState(fresh, 15);
const freshGrip = measureGrip(fresh);

const disturbed = initialSim();
disturbed.vehicle.rigidBody.position = PhysicsMath.vec3(
  station.p.x,
  station.p.y + 2.0,
  station.p.z,
);
disturbed.vehicle.rigidBody.orientation = PhysicsMath.quatFromEuler(
  18 * Math.PI / 180,
  yaw,
  72 * Math.PI / 180,
);
disturbed.vehicle.suspension.reset();
disturbed.vehicle.rigidBody.velocity = PhysicsMath.quatRotateVec3(
  PhysicsMath.quatFromEuler(0, yaw, 0),
  PhysicsMath.vec3(12, -7.5, 20),
);
disturbed.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(3.5, 2.2, 5.4);
disturbed.vehicle.wheels.forEach((wheel) => wheel.reset(22));

for (let i = 0; i < 600; i++) {
  disturbed.stepExplicit(neutral, 1);
  assert(finiteVehicle(disturbed), 'disturbance produced non-finite M5 state');
}

placeOnAsphaltPreservingState(disturbed, 15);
const recoveredGrip = measureGrip(disturbed);
const ratio = recoveredGrip.meanLateralForceN / Math.max(1, freshGrip.meanLateralForceN);

assert(freshGrip.asphaltFraction > 0.95, 'fresh M5 left Racerrhi asphalt during grip probe');
assert(recoveredGrip.asphaltFraction > 0.95, 'recovered M5 left Racerrhi asphalt during grip probe');
assert(
  recoveredGrip.meanNormalForceN > freshGrip.meanNormalForceN * 0.90,
  'post-disturbance tire load failed to recover on Racerrhi asphalt',
);
assert(
  ratio > 0.85,
  'post-disturbance grip failed to recover on Racerrhi asphalt: ratio=' + ratio.toFixed(3),
);

console.log(JSON.stringify({
  track: 'racerrhi APEX / Côte d Azur',
  donorCommit: 'abff9f452e4c2b22ac1220a1414418ace3f36e0a',
  freshGrip,
  recoveredGrip,
  recoveredGripRatio: ratio,
  status: 'passed',
}, null, 2));
