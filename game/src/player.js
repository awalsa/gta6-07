// ISLA BRASA 3D — player character (third-person, on foot).
//
// Owns the on-foot character AND the third-person follow camera (dist 8).
// This module is the single camera owner on foot and in a car: after it
// positions the camera it sets ctx.cameraHandled = true, so main.js's own
// follow camera (dist 11) is skipped and the two cameras can never fight.
// While the player is flying the plane, player.update returns early and the
// plane module owns the camera instead; while inside an interior it also
// leaves the camera alone.
//
// Public contract (other modules read these off ctx.player):
//   ctx.player = { mesh, position, pos, inCar, speed, health,
//                  damage(), heal(), respawn(), setOutfit(),
//                  enterCar(), exitCar(), getPosition(), setPosition(),
//                  getHeading() }
//   state.playerPos / ctx.playerHeading are synced every frame, so the HUD,
//   minimap and main camera all agree on where the player is.

import { THREE } from './three.js';
import {
  PLAYER_WALK_SPEED,
  PLAYER_RUN_SPEED,
  PLAYER_MAX_HEALTH,
  PLAYER_JUMP_SPEED,
  GRAVITY,
  PLAYER_SPAWN,
  OUTFITS,
} from './config.js';

// Camera follow distance (the one and only follow distance — see header).
const CAM_DIST = 8;
const CAM_HEIGHT = 3.6;
const WORLD_BOUND = 195;

let TH = null; // THREE namespace, resolved in init (ctx.THREE wins).
let prevE = false;
let prevF = false;

function keysOf(ctx) {
  const inp = (ctx && ctx.input) || {};
  return inp.keys || null;
}

function keyDown(ctx, ...codes) {
  const keys = keysOf(ctx);
  if (!keys || typeof keys.has !== 'function') return false;
  return codes.some((c) => keys.has(c));
}

function notify(ctx, msg) {
  if (!msg) return;
  if (ctx && typeof ctx.notify === 'function') { ctx.notify(msg); return; }
  if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') ctx.hud.showMessage(msg);
}

// Normalise a building record to an AABB. world.js stores buildings as
// { minX, maxX, minZ, maxZ, height }; accept a couple of other shapes too.
export function buildingAABB(b) {
  if (!b) return null;
  if (typeof b.minX === 'number' && typeof b.maxX === 'number') return b;
  if (typeof b.x === 'number' && typeof b.w === 'number') {
    return { minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 };
  }
  if (typeof b.x === 'number' && typeof b.half === 'number') {
    return { minX: b.x - b.half, maxX: b.x + b.half, minZ: b.z - b.half, maxZ: b.z + b.half };
  }
  return null;
}

// Push a circle (pos, radius r) out of every building AABB it overlaps.
export function pushOutOfBuildings(pos, buildings, r) {
  if (!buildings || !buildings.length) return;
  for (const raw of buildings) {
    const b = buildingAABB(raw);
    if (!b) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * r;
      pos.z = cz + (dz / d) * r;
    } else {
      // Centre is inside the box: shove out along the smallest penetration.
      const pl = pos.x - b.minX;
      const pr = b.maxX - pos.x;
      const pt = pos.z - b.minZ;
      const pb = b.maxZ - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = b.minX - r;
      else if (m === pr) pos.x = b.maxX + r;
      else if (m === pt) pos.z = b.minZ - r;
      else pos.z = b.maxZ + r;
    }
  }
}

function syncSharedPos(ctx, x, y, z, heading) {
  if (ctx.state) {
    ctx.state.playerPos = [x, y, z];
    ctx.state.playerHeading = heading;
  }
  ctx.playerHeading = heading;
}

function makeLimb(mat, w, h, d, pivotY) {
  // A limb group pivoted at its top joint; the box hangs below the pivot so
  // rotation.x swings it like a real arm/leg.
  const pivot = new TH.Group();
  pivot.position.y = pivotY;
  const box = new TH.Mesh(new TH.BoxGeometry(w, h, d), mat);
  box.position.y = -h / 2;
  pivot.add(box);
  return pivot;
}

function buildPlayerMesh(ctx) {
  const outfit = (OUTFITS && OUTFITS.default) || {
    shirt: 0x2e86c1, pants: 0x2c3e50, sleeves: 0x2e86c1, shoes: 0x1a1a1a, hair: 0x2b1d12,
  };
  const shirtMat = new TH.MeshLambertMaterial({ color: outfit.shirt });
  const pantsMat = new TH.MeshLambertMaterial({ color: outfit.pants });
  const skinMat = new TH.MeshLambertMaterial({ color: 0xd9a066 });
  const hairMat = new TH.MeshLambertMaterial({ color: outfit.hair });
  const shoeMat = new TH.MeshLambertMaterial({ color: outfit.shoes });

  const mesh = new TH.Group();

  const torso = new TH.Mesh(new TH.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  torso.position.y = 1.08;
  mesh.add(torso);

  const head = new TH.Mesh(new TH.BoxGeometry(0.36, 0.38, 0.34), skinMat);
  head.position.y = 1.66;
  mesh.add(head);

  const hair = new TH.Mesh(new TH.BoxGeometry(0.38, 0.14, 0.36), hairMat);
  hair.position.y = 1.88;
  mesh.add(hair);

  // Nose cap so the facing direction reads at a glance.
  const cap = new TH.Mesh(new TH.BoxGeometry(0.4, 0.08, 0.38), shirtMat);
  cap.position.set(0, 1.82, 0.02);
  mesh.add(cap);

  const armL = makeLimb(shirtMat, 0.18, 0.62, 0.18, 1.38);
  armL.position.x = -0.42;
  mesh.add(armL);
  const armR = makeLimb(shirtMat, 0.18, 0.62, 0.18, 1.38);
  armR.position.x = 0.42;
  mesh.add(armR);

  const legL = makeLimb(pantsMat, 0.22, 0.7, 0.22, 0.72);
  legL.position.x = -0.17;
  mesh.add(legL);
  const legR = makeLimb(pantsMat, 0.22, 0.7, 0.22, 0.72);
  legR.position.x = 0.17;
  mesh.add(legR);

  const shoeL = new TH.Mesh(new TH.BoxGeometry(0.24, 0.1, 0.36), shoeMat);
  shoeL.position.set(-0.17, 0.05, 0.04);
  mesh.add(shoeL);
  const shoeR = new TH.Mesh(new TH.BoxGeometry(0.24, 0.1, 0.36), shoeMat);
  shoeR.position.set(0.17, 0.05, 0.04);
  mesh.add(shoeR);

  mesh.position.set(PLAYER_SPAWN.x || 0, 0, PLAYER_SPAWN.z || 8);
  mesh.traverse((child) => { if (child.isMesh) child.castShadow = false; });
  return { mesh, mats: { shirt: shirtMat, pants: pantsMat, hair: hairMat, shoe: shoeMat } };
}

let player = null;

export function init(ctx) {
  TH = (ctx && ctx.THREE) || THREE;
  const built = buildPlayerMesh(ctx);
  const mesh = built.mesh;
  const mats = built.mats;
  ctx.scene.add(mesh);

  player = {
    mesh,
    position: mesh.position, // live alias: other modules read this directly
    pos: mesh.position,
    inCar: false,
    driving: false,
    speed: 0,
    _car: null,
    _walkPhase: 0,
    _camYaw: null,
    _vy: 0,
    _grounded: true,
    _mats: mats,

    get health() { return ctx.state ? ctx.state.health : PLAYER_MAX_HEALTH; },
    set health(v) {
      if (ctx.state) ctx.state.health = Math.max(0, Math.min(PLAYER_MAX_HEALTH, v));
    },

    damage(amount) {
      if (!ctx.state || amount <= 0) return false;
      let left = amount;
      if (ctx.state.armor > 0) {
        const absorbed = Math.min(ctx.state.armor, left);
        ctx.state.armor -= absorbed;
        left -= absorbed;
      }
      if (left > 0) ctx.state.health = Math.max(0, ctx.state.health - left);
      if (ctx.state.health <= 0) {
        notify(ctx, 'You were wasted! Respawning at Plaza Tower...');
        this.respawn();
        return true;
      }
      return false;
    },

    heal(amount) {
      if (!ctx.state || amount <= 0) return;
      ctx.state.health = Math.min(PLAYER_MAX_HEALTH, ctx.state.health + amount);
    },

    respawn() {
      if (ctx.state) {
        ctx.state.health = PLAYER_MAX_HEALTH;
        ctx.state.armor = 0;
        if (ctx.state.wanted > 2) ctx.state.wanted = 2;
      }
      if (this._car) this.exitCar();
      mesh.position.set(PLAYER_SPAWN.x || 0, 0, PLAYER_SPAWN.z || 8);
      mesh.rotation.y = 0;
      mesh.visible = true;
      this._camYaw = null;
      syncSharedPos(ctx, mesh.position.x, 0, mesh.position.z, 0);
    },

    setOutfit(name) {
      const o = OUTFITS && OUTFITS[name];
      if (!o) return false;
      mats.shirt.color.setHex(o.shirt);
      mats.pants.color.setHex(o.pants);
      mats.hair.color.setHex(o.hair);
      mats.shoe.color.setHex(o.shoes);
      if (ctx.state) {
        ctx.state.outfit = name;
        ctx.state.currentOutfit = name;
      }
      return true;
    },

    enterCar(car) {
      if (!car) return false;
      this._car = car;
      this.inCar = true;
      this.driving = true;
      if (ctx.cars) ctx.cars.current = car;
      if (ctx.state) ctx.state.currentCar = car.type;
      mesh.visible = false; // the driver sits inside the car mesh
      syncSharedPos(ctx, car.pos.x, 0, car.pos.z, car.heading);
      return true;
    },

    exitCar() {
      const car = this._car || (ctx.cars && ctx.cars.current);
      this._car = null;
      this.inCar = false;
      this.driving = false;
      if (ctx.cars) ctx.cars.current = null;
      if (ctx.state) ctx.state.currentCar = null;
      if (car && car.pos) {
        // Step out on the driver's side, clear of the car body.
        const sideX = car.pos.x + Math.cos(car.heading) * 2.2;
        const sideZ = car.pos.z - Math.sin(car.heading) * 2.2;
        mesh.position.set(sideX, 0, sideZ);
        mesh.rotation.y = car.heading;
      }
      mesh.visible = true;
      this._vy = 0;
      syncSharedPos(ctx, mesh.position.x, 0, mesh.position.z, mesh.rotation.y);
      return true;
    },

    getPosition() { return mesh.position.clone(); },
    setPosition(v) {
      if (!v) return;
      mesh.position.set(v.x || 0, v.y || 0, v.z || 0);
      syncSharedPos(ctx, mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.y);
    },
    getHeading() { return mesh.rotation.y; },
  };

  // Apply a saved outfit, if the loaded state wears one.
  if (ctx.state && ctx.state.outfit && ctx.state.outfit !== 'default') {
    player.setOutfit(ctx.state.outfit);
  }
  if (ctx.state && Array.isArray(ctx.state.playerPos) && ctx.state.playerPos.length >= 3) {
    const [x, , z] = ctx.state.playerPos;
    if (typeof x === 'number' && typeof z === 'number' && (x !== 0 || z !== 8)) {
      mesh.position.set(x, 0, z);
    }
  }

  ctx.player = player;
  syncSharedPos(ctx, mesh.position.x, 0, mesh.position.z, mesh.rotation.y);
  return player;
}

// Position the follow camera behind the current anchor (player on foot, or
// the driven car) and claim it so main.js does not also drive it.
function driveCamera(dt, ctx, anchorX, anchorY, anchorZ, heading, moving) {
  const camera = ctx.camera;
  if (!camera) return;
  if (player._camYaw === null) player._camYaw = heading + Math.PI;
  // Arrow keys orbit the camera around the player.
  if (keyDown(ctx, 'ArrowLeft')) player._camYaw += 2.2 * dt;
  if (keyDown(ctx, 'ArrowRight')) player._camYaw -= 2.2 * dt;
  // Auto-follow behind the facing direction while moving.
  if (moving && !keyDown(ctx, 'ArrowLeft', 'ArrowRight')) {
    const targetYaw = heading + Math.PI;
    let d = targetYaw - player._camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    player._camYaw += d * Math.min(1, 2.5 * dt);
  }
  const cx = anchorX + Math.sin(player._camYaw) * CAM_DIST;
  const cz = anchorZ + Math.cos(player._camYaw) * CAM_DIST;
  camera.position.set(cx, anchorY + CAM_HEIGHT, cz);
  camera.lookAt(anchorX, anchorY + 1.5, anchorZ);
  // Single camera owner: main.js skips its own follow camera while this is set.
  ctx.cameraHandled = true;
}

export function update(dt, ctx) {
  if (!player) return;
  const mesh = player.mesh;
  const state = ctx.state || {};
  const input = ctx.input || {};

  // Flying the plane: the plane module owns the camera and the position.
  if (ctx.plane && ctx.plane.inPlane) return;
  // Inside an interior: that module owns the camera; do not fight it.
  if (state.insideInterior) {
    syncSharedPos(ctx, mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.y);
    return;
  }

  const uiOpen = state.uiOpen || ctx.uiOpen;
  const eDown = keyDown(ctx, 'KeyE');
  const fDown = keyDown(ctx, 'KeyF');
  const ePressed = eDown && !prevE;
  const fPressed = fDown && !prevF;
  prevE = eDown;
  prevF = fDown;

  // --- In a car: no on-foot movement; camera follows the car. The car
  // module (cars.drive) moves the car and syncs this mesh every frame. ---
  const car = (ctx.cars && ctx.cars.current) || player._car;
  if (player.inCar || car) {
    player.inCar = true;
    player._car = car || null;
    const cx = car && car.pos ? car.pos.x : mesh.position.x;
    const cz = car && car.pos ? car.pos.z : mesh.position.z;
    const heading = car ? car.heading : mesh.rotation.y;
    // Belt-and-braces sync: the mesh must never stale while driving.
    if (car && car.pos) {
      mesh.position.set(car.pos.x, 0, car.pos.z);
      mesh.rotation.y = car.heading;
    }
    syncSharedPos(ctx, mesh.position.x, 0, mesh.position.z, heading);
    if (!uiOpen) driveCamera(dt, ctx, cx, 0, cz, heading, Math.abs((car && car.speed) || 0) > 0.5);
    if (ePressed && !uiOpen) player.exitCar();
    return;
  }

  // --- On foot ---
  if (uiOpen) {
    // Frozen by an overlay: idle breathing only, position still shared.
    syncSharedPos(ctx, mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.y);
    return;
  }

  const fwd = keyDown(ctx, 'KeyW', 'ArrowUp') ? 1 : 0;
  const back = keyDown(ctx, 'KeyS', 'ArrowDown') ? 1 : 0;
  const left = keyDown(ctx, 'KeyA') ? 1 : 0;
  const right = keyDown(ctx, 'KeyD') ? 1 : 0;
  const running = keyDown(ctx, 'ShiftLeft', 'ShiftRight');

  // Camera-relative movement: forward is away from the camera.
  const yaw = player._camYaw === null ? mesh.rotation.y + Math.PI : player._camYaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let mx = fx * (fwd - back) + rx * (right - left);
  let mz = fz * (fwd - back) + rz * (right - left);
  const mLen = Math.hypot(mx, mz);
  if (mLen > 0) { mx /= mLen; mz /= mLen; }

  const speed = running ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
  player.speed = mLen > 0 ? speed : 0;
  mesh.position.x += mx * speed * dt;
  mesh.position.z += mz * speed * dt;

  // Face the movement direction.
  if (mLen > 0) {
    const target = Math.atan2(mx, mz);
    let d = target - mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    mesh.rotation.y += d * Math.min(1, 14 * dt);
  }

  // Jump + gravity.
  if (keyDown(ctx, 'Space') && player._grounded) {
    player._vy = PLAYER_JUMP_SPEED;
    player._grounded = false;
  }
  if (!player._grounded || mesh.position.y > 0) {
    player._vy -= GRAVITY * dt;
    mesh.position.y += player._vy * dt;
    if (mesh.position.y <= 0) {
      mesh.position.y = 0;
      player._vy = 0;
      player._grounded = true;
    }
  }

  // Stay in the city and out of buildings.
  mesh.position.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, mesh.position.x));
  mesh.position.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, mesh.position.z));
  if (ctx.world && ctx.world.buildings) pushOutOfBuildings(mesh.position, ctx.world.buildings, 0.55);

  // Walk/run limb swing.
  player._walkPhase += dt * (mLen > 0 ? (running ? 13 : 9) : 0);
  const swing = mLen > 0 ? (running ? 0.85 : 0.55) : 0;
  const s = Math.sin(player._walkPhase) * swing;
  const parts = mesh.children;
  // children: 0 torso, 1 head, 2 hair, 3 cap, 4 armL, 5 armR, 6 legL, 7 legR, 8 shoeL, 9 shoeR
  if (parts[4] && parts[5] && parts[6] && parts[7]) {
    parts[6].rotation.x = s;
    parts[7].rotation.x = -s;
    parts[4].rotation.x = -s * 0.8;
    parts[5].rotation.x = s * 0.8;
    if (parts[0]) parts[0].position.y = 1.08 + Math.abs(Math.cos(player._walkPhase)) * 0.04 * (swing / 0.85 || 0);
  }

  syncSharedPos(ctx, mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.y);
  driveCamera(dt, ctx, mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.y, mLen > 0);

  // E: enter the nearest car. F: interact (dialogue / NPC hook).
  if (ePressed && ctx.cars && typeof ctx.cars.getNearbyCar === 'function') {
    const near = ctx.cars.getNearbyCar(mesh.position);
    if (near) player.enterCar(near);
  }
  if (fPressed && typeof ctx.onInteract === 'function') {
    try { ctx.onInteract(mesh.position); } catch (e) { /* hook is optional */ }
  }

  // Keep the input layer's mouse state honest for combat (click = attack).
  if (input.mouse) player._mouseDown = !!input.mouse.down;
}

export { OUTFITS };
export default player;
