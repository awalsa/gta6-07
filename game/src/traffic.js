// ISLA BRASA 3D — traffic AI.
//
// 8 AI cars driving the road grid, adding life to the roads. Each car owns
// one road line and drives along it; at intersections it sometimes turns
// onto the cross street. Cars slow/stop for the car ahead, for the player's
// car, and for the player on foot, and wrap around at the edge of the city.
//
// Public contract (other modules read this off ctx.traffic):
//   ctx.traffic = { list }   // list of { mesh, pos, heading, speed, ... }

import { THREE } from './three.js';
import { ROAD_LINES, ROAD_WIDTH } from './config.js';

const TRAFFIC_COUNT = 8;
const WORLD_BOUND = 195;
const LANE_OFFSET = 2; // right-hand traffic: offset from the road centre

let TH = null;
let ctxRef = null;

const COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0x16a085, 0xe67e22, 0x2c3e50];

function makeTrafficCar(color) {
  const group = new TH.Group();
  const bodyMat = new TH.MeshLambertMaterial({ color });
  const darkMat = new TH.MeshLambertMaterial({ color: 0x111111 });
  const glassMat = new TH.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x1a3a4a });

  const body = new TH.Mesh(new TH.BoxGeometry(2.0, 0.55, 3.8), bodyMat);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new TH.Mesh(new TH.BoxGeometry(1.7, 0.5, 1.9), glassMat);
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);
  const headMat = new TH.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffdf5e });
  for (const x of [-0.6, 0.6]) {
    const h = new TH.Mesh(new TH.BoxGeometry(0.3, 0.14, 0.06), headMat);
    h.position.set(x, 0.55, 1.92);
    group.add(h);
  }
  for (const [x, z] of [[-0.95, 1.25], [0.95, 1.25], [-0.95, -1.25], [0.95, -1.25]]) {
    const w = new TH.Mesh(new TH.CylinderGeometry(0.32, 0.32, 0.24, 10), darkMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.32, z);
    group.add(w);
  }
  group.traverse((child) => { if (child.isMesh) child.castShadow = false; });
  return group;
}

function roadLines() {
  if (Array.isArray(ROAD_LINES) && ROAD_LINES.length) return ROAD_LINES;
  return [-160, -120, -80, -40, 0, 40, 80, 120, 160];
}

function nearestLine(lines, v) {
  let best = lines[0];
  let bestD = Infinity;
  for (const l of lines) {
    const d = Math.abs(l - v);
    if (d < bestD) { bestD = d; best = l; }
  }
  return { line: best, dist: bestD };
}

// Heading for a car travelling along `axis` in direction `dir`.
// Model forward is +Z, so rotation.y = atan2(fx, fz).
function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

// World position of a traffic car from its road state.
function placeOnRoad(car) {
  const off = car.dir > 0 ? LANE_OFFSET : -LANE_OFFSET;
  if (car.axis === 'x') {
    car.pos.set(car.along, 0, car.line + off);
  } else {
    car.pos.set(car.line + off, 0, car.along);
  }
  car.heading = headingFor(car.axis, car.dir);
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
}

function spawnCar(i, lines) {
  const axis = i % 2 === 0 ? 'x' : 'z';
  const line = lines[Math.floor(Math.random() * lines.length)];
  const dir = Math.random() < 0.5 ? 1 : -1;
  const along = (Math.random() * 2 - 1) * 170;
  const mesh = makeTrafficCar(COLORS[i % COLORS.length]);
  const car = {
    mesh,
    pos: mesh.position, // live alias
    heading: 0,
    axis,
    line,
    dir,
    along,
    speed: 8 + Math.random() * 6, // 8–14 u/s cruise
    baseSpeed: 0,
    turnCooldown: 2 + Math.random() * 3,
  };
  car.baseSpeed = car.speed;
  placeOnRoad(car);
  return car;
}

function respawn(car, lines) {
  car.axis = Math.random() < 0.5 ? 'x' : 'z';
  car.line = lines[Math.floor(Math.random() * lines.length)];
  car.dir = Math.random() < 0.5 ? 1 : -1;
  car.along = -car.dir * 190;
  car.speed = 8 + Math.random() * 6;
  car.baseSpeed = car.speed;
  car.turnCooldown = 2;
  placeOnRoad(car);
}

function forwardOf(car) {
  // Unit forward vector from heading (model forward +Z).
  return { x: Math.sin(car.heading), z: Math.cos(car.heading) };
}

function playerWorldPos(ctx) {
  if (ctx.player) {
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (ctx.player.pos) return ctx.player.pos;
    if (ctx.player.position) return ctx.player.position;
  }
  if (ctx.cars && ctx.cars.current && ctx.cars.current.pos) return ctx.cars.current.pos;
  if (ctx.state && Array.isArray(ctx.state.playerPos)) {
    const p = ctx.state.playerPos;
    return { x: p[0] || 0, y: p[1] || 0, z: p[2] || 0 };
  }
  return null;
}

const list = [];

export function init(ctx) {
  TH = (ctx && ctx.THREE) || THREE;
  ctxRef = ctx;
  const lines = roadLines();
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const car = spawnCar(i, lines);
    if (ctx.scene) ctx.scene.add(car.mesh);
    list.push(car);
  }
  ctx.traffic = { list };
  return ctx.traffic;
}

export function update(dt, ctx) {
  if (!ctxRef) ctxRef = ctx;
  if (!list.length) return;
  const lines = roadLines();
  const playerPos = playerWorldPos(ctx);
  const playerCar = ctx.cars && ctx.cars.current;

  for (const car of list) {
    car.turnCooldown -= dt;

    // --- Collision avoidance: slow/stop for whatever is ahead. ---
    let targetSpeed = car.baseSpeed;
    const fwd = forwardOf(car);
    const aheadX = car.pos.x + fwd.x * 7;
    const aheadZ = car.pos.z + fwd.z * 7;

    // Another traffic car ahead on the same road?
    for (const other of list) {
      if (other === car) continue;
      if (other.axis !== car.axis || other.line !== car.line || other.dir !== car.dir) continue;
      const gap = (other.along - car.along) * car.dir;
      if (gap > 0 && gap < 11) {
        targetSpeed = gap < 5.5 ? 0 : Math.min(targetSpeed, other.speed);
      }
    }

    // The player's car ahead on the same road?
    if (playerCar && playerCar.pos) {
      const dx = playerCar.pos.x - car.pos.x;
      const dz = playerCar.pos.z - car.pos.z;
      const aheadDist = dx * fwd.x + dz * fwd.z;
      const lateral = Math.abs(dx * fwd.z - dz * fwd.x);
      if (aheadDist > 0 && aheadDist < 12 && lateral < 4) {
        targetSpeed = aheadDist < 6 ? 0 : Math.min(targetSpeed, 4);
      }
    }

    // The player on foot right in front of the car? Stop.
    if (playerPos && !(playerCar)) {
      const dx = playerPos.x - car.pos.x;
      const dz = playerPos.z - car.pos.z;
      const aheadDist = dx * fwd.x + dz * fwd.z;
      const lateral = Math.abs(dx * fwd.z - dz * fwd.x);
      if (aheadDist > 0 && aheadDist < 7 && lateral < 2.5) targetSpeed = 0;
    }

    // Ease toward the target speed (no instant stops/starts).
    const rate = targetSpeed < car.speed ? 6 : 2.5;
    car.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - car.speed));

    // --- Drive along the road. ---
    car.along += car.dir * car.speed * dt;

    // --- Intersection turns: sometimes turn onto the cross street. ---
    if (car.turnCooldown <= 0 && car.speed > 1) {
      const near = nearestLine(lines, car.along);
      if (near.dist < 1.5 && Math.random() < 0.35) {
        const oldAxis = car.axis;
        const oldLine = car.line;
        car.axis = oldAxis === 'x' ? 'z' : 'x';
        car.line = near.line;
        car.along = oldLine;
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.turnCooldown = 4 + Math.random() * 4;
      } else if (near.dist < 1.5) {
        car.turnCooldown = 0.6; // don't re-roll every frame in the crossing
      }
    }

    // --- Wrap around at the city edge (respawn fresh on a new road). ---
    if (Math.abs(car.along) > WORLD_BOUND) {
      respawn(car, lines);
      continue;
    }

    placeOnRoad(car);
  }
}

export { TRAFFIC_COUNT };
export default { list };
