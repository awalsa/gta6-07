// pedestrians.js — 16 pedestrians walking the sidewalks of ISLA BRASA 3D.
//
// Low-poly humanoids with a simple wander AI: each ped walks toward a
// random sidewalk waypoint (snapped beside a road-grid line), idles briefly
// on arrival, then picks a new waypoint. Legs swing while walking.
//
// They flee — running away from the threat at full speed — when a gunshot
// goes off nearby or the player is attacking right next to them. Flee
// signals come from ctx.state: combat records the most recent shot in
// ctx.state.lastGunshot { x, z, t } (t = performance.now()/1000 seconds),
// and the player module sets ctx.state.playerAttacking / playerFiring
// while the player is attacking.
//
// init(ctx) / update(dt, ctx). Attaches:
//   ctx.pedestrians = { list, count: 16 }

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const COUNT = 16;
const GRID = Config.ROAD_SPACING ?? 40;
const EXTENT = (Config.WORLD_SIZE ?? 400) / 2 - 20;
const WALK_SPEED = 1.6;
const FLEE_SPEED = 6.5;
const FLEE_RADIUS = 28;   // gunshot flee radius
const ATTACK_RADIUS = 12; // player-attack flee radius
const SHOT_MEMORY = 3;    // seconds a gunshot keeps peds fleeing

const SHIRT_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1];
const PANTS_COLORS = [0x2c3e50, 0x34495e, 0x5d4037, 0x1a1a2e];
const SKIN_COLORS = [0xd9a066, 0xc98d5a, 0x8d5524, 0xe8b98a];

let T = null;
let ctxRef = null;
const list = [];

function makeHumanoid(shirtColor, pantsColor, skinColor) {
  const group = new T.Group();
  const shirtMat = new T.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 });
  const pantsMat = new T.MeshStandardMaterial({ color: pantsColor, roughness: 0.8 });
  const skinMat = new T.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });

  const body = new T.Mesh(new T.CapsuleGeometry(0.32, 0.55, 4, 8), shirtMat);
  body.position.y = 1.05;
  group.add(body);
  const head = new T.Mesh(new T.SphereGeometry(0.22, 10, 8), skinMat);
  head.position.y = 1.62;
  group.add(head);
  // Simple swinging legs (animated in update via userData).
  const legGeo = new T.BoxGeometry(0.16, 0.6, 0.16);
  const legL = new T.Mesh(legGeo, pantsMat);
  legL.geometry.translate(0, -0.3, 0);
  legL.position.set(-0.12, 0.62, 0);
  const legR = new T.Mesh(legGeo, pantsMat);
  legR.geometry.translate(0, -0.3, 0);
  legR.position.set(0.12, 0.62, 0);
  group.add(legL);
  group.add(legR);
  // Simple arms.
  const armGeo = new T.BoxGeometry(0.11, 0.5, 0.11);
  const armL = new T.Mesh(armGeo, shirtMat);
  armL.position.set(-0.42, 1.15, 0);
  const armR = new T.Mesh(armGeo, shirtMat);
  armR.position.set(0.42, 1.15, 0);
  group.add(armL);
  group.add(armR);
  group.userData.legL = legL;
  group.userData.legR = legR;
  group.userData.armL = armL;
  group.userData.armR = armR;
  return group;
}

// A point on a sidewalk: beside a road-grid line, offset ~7 units from the
// road centre (roads are ~9 wide, sidewalks hug their edge).
function randomSidewalkPoint() {
  const lines = [];
  for (let v = -EXTENT; v <= EXTENT; v += GRID) lines.push(v);
  const along = (Math.random() * 2 - 1) * EXTENT;
  const line = lines[Math.floor(Math.random() * lines.length)];
  const side = Math.random() < 0.5 ? -7 : 7;
  if (Math.random() < 0.5) return { x: along, z: line + side };
  return { x: line + side, z: along };
}

function playerPos(ctx) {
  const c = ctx || ctxRef;
  const s = c && c.state;
  if (s && Array.isArray(s.playerPos)) {
    return { x: s.playerPos[0] || 0, z: s.playerPos[2] || 0 };
  }
  return { x: 0, z: 0 };
}

function lastShotInfo(ctx) {
  const c = ctx || ctxRef;
  const s = c && c.state;
  const shot = s && s.lastGunshot;
  if (!shot) return null;
  const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
  const t = typeof shot.t === 'number' ? shot.t : 0;
  if (now - t > SHOT_MEMORY) return null;
  return { x: shot.x || 0, z: shot.z || 0 };
}

export function init(ctx) {
  ctxRef = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (!T || !ctx || !ctx.scene) return;
  ctx.state = ctx.state || {};
  for (let i = 0; i < COUNT; i++) {
    const mesh = makeHumanoid(
      SHIRT_COLORS[i % SHIRT_COLORS.length],
      PANTS_COLORS[i % PANTS_COLORS.length],
      SKIN_COLORS[i % SKIN_COLORS.length],
    );
    const start = randomSidewalkPoint();
    mesh.position.set(start.x, 0, start.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    ctx.scene.add(mesh);
    list.push({
      mesh,
      target: randomSidewalkPoint(),
      speed: WALK_SPEED * (0.8 + Math.random() * 0.5),
      fleeing: false,
      fleeX: 0,
      fleeZ: 0,
      walkPhase: Math.random() * Math.PI * 2,
      idleTimer: Math.random() * 2,
    });
  }
  ctx.pedestrians = { list, count: COUNT };
}

export function update(dt, ctx) {
  if (!list.length) return;
  const step = Math.min(dt, 0.05);
  const pp = playerPos(ctx);
  const shot = lastShotInfo(ctx);
  const s = (ctx || ctxRef) && (ctx || ctxRef).state;
  const attacking = !!(s && (s.playerAttacking || s.playerFiring));

  for (const ped of list) {
    const m = ped.mesh;
    const px = m.position.x;
    const pz = m.position.z;

    // --- Threat check: gunshot nearby, or the player attacking close by.
    let threatX = 0;
    let threatZ = 0;
    let threat = false;
    if (shot) {
      const d = Math.hypot(px - shot.x, pz - shot.z);
      if (d < FLEE_RADIUS) { threat = true; threatX = shot.x; threatZ = shot.z; }
    }
    if (!threat && attacking) {
      const d = Math.hypot(px - pp.x, pz - pp.z);
      if (d < ATTACK_RADIUS) { threat = true; threatX = pp.x; threatZ = pp.z; }
    }
    if (threat) {
      ped.fleeing = true;
      ped.fleeX = threatX;
      ped.fleeZ = threatZ;
    } else if (ped.fleeing) {
      // Keep fleeing until well clear of the threat point.
      const d = Math.hypot(px - ped.fleeX, pz - ped.fleeZ);
      if (d > FLEE_RADIUS + 15) ped.fleeing = false;
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = 0;
    if (ped.fleeing) {
      // Run directly away from the threat.
      let dx = px - ped.fleeX;
      let dz = pz - ped.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      moveX = dx / d;
      moveZ = dz / d;
      speed = FLEE_SPEED;
    } else if (ped.idleTimer > 0) {
      ped.idleTimer -= step;
    } else {
      const dx = ped.target.x - px;
      const dz = ped.target.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        ped.idleTimer = 1 + Math.random() * 3;
        ped.target = randomSidewalkPoint();
      } else {
        moveX = dx / d;
        moveZ = dz / d;
        speed = ped.speed;
      }
    }

    if (speed > 0) {
      m.position.x += moveX * speed * step;
      m.position.z += moveZ * speed * step;
      // Face the direction of travel.
      m.rotation.y = Math.atan2(moveX, moveZ);
      // Walk-cycle: legs and arms swing opposite each other.
      ped.walkPhase += step * speed * 4;
      const swing = Math.sin(ped.walkPhase) * 0.55;
      if (m.userData.legL) m.userData.legL.rotation.x = swing;
      if (m.userData.legR) m.userData.legR.rotation.x = -swing;
      if (m.userData.armL) m.userData.armL.rotation.x = -swing * 0.7;
      if (m.userData.armR) m.userData.armR.rotation.x = swing * 0.7;
    }
  }
}

export default { init, update };
