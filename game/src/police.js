// police.js — ISLA BRASA 3D: wanted level, police pursuit, REAL roadblocks,
// CONDOR-1 helicopter.
//
// Wanted is 0-5 stars in state.wanted. It rises when the player harms NPCs
// (combat.js adds a star on first hit per enemy), steals a car (missions.js
// sets state.stoleCar) or when another module sets state.offence /
// state.harmedNpc. It decays one star at a time after the player stays
// unseen for a while. Police cars chase and ram.
//
// At 3+ stars: two REAL roadblocks (police-car barricades across the road
// ahead of the player, with collision — they stop cars and push the player
// out) plus the CONDOR-1 helicopter (low-poly heli mesh, spinning rotor,
// searchlight cone + spotlight tracking the player). While the heli is up
// the player counts as seen, so the wanted level cannot decay.
//
// Contract: exports init(ctx), update(dt, ctx), getWanted(ctx) and
// playerPos(ctx); attaches ctx.police =
//   {
//     wanted, addWanted(n), setWanted(n), clearWanted(),
//     roadblocks, heli, heliActive, policeCars, isHidden,
//   }

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const LANDMARKS = (Config && Config.LANDMARKS) || {};
const WORLD_SIZE = (Config && Config.WORLD_SIZE) || 400;
const ROAD_SPACING = (Config && Config.ROAD_SPACING) || 40;
const ROADBLOCK_WANTED = (Config && Config.ROADBLOCK_WANTED) || 3;

const MAX_WANTED = 5;
const MAX_POLICE_CARS = 5;
const HIDE_DECAY_BASE = 15;
const HIDE_DECAY_PER_STAR = 3;
const SIGHT_RANGE = 45;
const POLICE_SPAWN_DIST = 55;
const POLICE_DESPAWN_DIST = 130;
const ROADBLOCK_COUNT = 2;
const ROADBLOCK_REPLACE_SECONDS = 18;
const ROADBLOCK_RADIUS = 7;

let T = null;
let boundCtx = null;
let policeCars = []; // { group, speed, heading, ramCooldown, lightTimer, lightL, lightR }
let roadblocks = []; // { group, cars:[group, group], anchor:{x,z}, heading }
let heli = null; // { group, rotor, cone, light, leaving, leaveTimer }
let hiddenTime = 0;
let roadblockTimer = 0;
let sirenOn = false;

function stateOf(ctx) {
  const c = ctx || boundCtx;
  return (c && c.state) || {};
}

export function getWanted(ctx) {
  return stateOf(ctx).wanted || 0;
}

export function playerPos(ctx) {
  const s = stateOf(ctx);
  if (Array.isArray(s.playerPos)) {
    return { x: s.playerPos[0] || 0, y: s.playerPos[1] || 0, z: s.playerPos[2] || 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

function playerHeading(ctx) {
  const c = ctx || boundCtx;
  if (c && typeof c.playerHeading === 'number') return c.playerHeading;
  const s = stateOf(ctx);
  return typeof s.playerHeading === 'number' ? s.playerHeading : 0;
}

function playerInCar(ctx) {
  return !!stateOf(ctx).currentCar;
}

function setPlayerPos(ctx, pos) {
  const c = ctx || boundCtx;
  const s = stateOf(ctx);
  if (Array.isArray(s.playerPos)) {
    s.playerPos[0] = pos.x;
    s.playerPos[1] = pos.y || 0;
    s.playerPos[2] = pos.z;
  }
  // If the player is driving, the car itself must move too — push the
  // current car out the same way (duck-typed, every shape guarded).
  try {
    const cars = c && (c.cars || c.vehicles);
    const cur = cars && (cars.currentCar || cars.current || cars.activeCar);
    if (cur) {
      if (cur.pos) { cur.pos.x = pos.x; cur.pos.z = pos.z; }
      if (cur.group && cur.group.position) {
        cur.group.position.x = pos.x;
        cur.group.position.z = pos.z;
      }
      if (cur.mesh && cur.mesh.position) {
        cur.mesh.position.x = pos.x;
        cur.mesh.position.z = pos.z;
      }
    }
  } catch (e) { /* car push-out is best-effort */ }
}

function damagePlayer(ctx, amount) {
  const s = stateOf(ctx);
  s.health = Math.max(0, (s.health || 100) - amount);
  if (s.health <= 0) {
    // Busted: hospital bill, wanted cleared, back on your feet.
    s.health = 100;
    s.cash = Math.max(0, (s.cash || 0) - 200);
    s.wanted = 0;
    showMessage(ctx, 'BUSTED! Hospital bill $200 — wanted cleared.');
  }
}

function playSfx(ctx, name) {
  const c = ctx || boundCtx;
  if (c && c.audio && typeof c.audio.playSfx === 'function') {
    try { c.audio.playSfx(name); } catch (e) { /* audio is optional */ }
  }
}

function setSiren(ctx, on) {
  if (on === sirenOn) return;
  sirenOn = on;
  const c = ctx || boundCtx;
  if (c && c.audio) {
    try {
      if (typeof c.audio.setSiren === 'function') c.audio.setSiren(on);
      else if (on) playSfx(ctx, 'siren');
    } catch (e) { /* audio is optional */ }
  }
}

function showMessage(ctx, text) {
  const c = ctx || boundCtx;
  if (c && c.hud && typeof c.hud.showMessage === 'function') {
    try { c.hud.showMessage(text); } catch (e) { /* optional */ }
  }
}

// --- Mesh builders ---------------------------------------------------------
function makePoliceCarMesh() {
  const group = new T.Group();
  const white = new T.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35, metalness: 0.3 });
  const black = new T.MeshStandardMaterial({ color: 0x14181d, roughness: 0.5, metalness: 0.2 });
  const glass = new T.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.15, metalness: 0.6 });

  const body = new T.Mesh(new T.BoxGeometry(2.0, 0.55, 4.4), white);
  body.position.y = 0.55;
  group.add(body);
  const stripe = new T.Mesh(new T.BoxGeometry(2.02, 0.22, 4.42), black);
  stripe.position.y = 0.62;
  group.add(stripe);
  const cabin = new T.Mesh(new T.BoxGeometry(1.7, 0.5, 2.2), glass);
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);
  // Light bar: red left, blue right, flashed in update().
  const lightLMat = new T.MeshStandardMaterial({
    color: 0xaa0000, emissive: 0xff0000, emissiveIntensity: 1.5,
  });
  const lightRMat = new T.MeshStandardMaterial({
    color: 0x0000aa, emissive: 0x0000ff, emissiveIntensity: 0.2,
  });
  const lightL = new T.Mesh(new T.BoxGeometry(0.45, 0.18, 0.3), lightLMat);
  lightL.position.set(-0.45, 1.38, -0.2);
  const lightR = new T.Mesh(new T.BoxGeometry(0.45, 0.18, 0.3), lightRMat);
  lightR.position.set(0.45, 1.38, -0.2);
  group.add(lightL);
  group.add(lightR);
  const wheelGeo = new T.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new T.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.36, wz);
    group.add(w);
  }
  return { group, lightLMat, lightRMat };
}

function makeHeliMesh() {
  const group = new T.Group();
  const bodyMat = new T.MeshStandardMaterial({ color: 0x1a3a6b, roughness: 0.4, metalness: 0.4 });
  const darkMat = new T.MeshStandardMaterial({ color: 0x0e1a2e, roughness: 0.3, metalness: 0.5 });
  const body = new T.Mesh(new T.BoxGeometry(2.2, 1.6, 4.2), bodyMat);
  body.position.y = 0;
  group.add(body);
  const nose = new T.Mesh(new T.SphereGeometry(1.0, 10, 8), darkMat);
  nose.position.set(0, -0.1, 2.2);
  nose.scale.set(1, 0.8, 1);
  group.add(nose);
  const tail = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 4.5), bodyMat);
  tail.position.set(0, 0.3, -4.0);
  group.add(tail);
  const fin = new T.Mesh(new T.BoxGeometry(0.2, 1.4, 0.8), bodyMat);
  fin.position.set(0, 0.9, -6.0);
  group.add(fin);
  // Main rotor (spins in update) + mast.
  const mast = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.8, 8), darkMat);
  mast.position.y = 1.1;
  group.add(mast);
  const rotor = new T.Group();
  rotor.position.y = 1.5;
  const bladeGeo = new T.BoxGeometry(9, 0.08, 0.45);
  const bladeMat = new T.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  rotor.add(new T.Mesh(bladeGeo, bladeMat));
  const blade2 = new T.Mesh(bladeGeo, bladeMat);
  blade2.rotation.y = Math.PI / 2;
  rotor.add(blade2);
  group.add(rotor);
  // Searchlight cone (additive, semi-transparent) pointing down.
  const coneMat = new T.MeshBasicMaterial({
    color: 0xfff6c0, transparent: true, opacity: 0.18,
    blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
  });
  const cone = new T.Mesh(new T.ConeGeometry(6, 30, 16, 1, true), coneMat);
  cone.position.y = -15;
  cone.rotation.x = Math.PI; // apex up at the heli, wide end down
  group.add(cone);
  const light = new T.SpotLight(0xfff2b0, 2.2, 90, 0.35, 0.4, 1);
  light.position.set(0, -1, 0);
  group.add(light);
  return { group, rotor, cone, light };
}

// --- Wanted helpers --------------------------------------------------------
function addWanted(n, ctx) {
  const s = stateOf(ctx);
  const before = s.wanted || 0;
  s.wanted = Math.max(0, Math.min(MAX_WANTED, before + n));
  if (s.wanted >= 3 && before < 3) {
    showMessage(ctx, `Wanted level ${s.wanted} — roadblocks ahead! CONDOR-1 is on you!`);
  } else if (s.wanted > before) {
    showMessage(ctx, `Wanted level ${s.wanted} — the police are after you!`);
  }
  return s.wanted;
}

function setWanted(n, ctx) {
  const s = stateOf(ctx);
  s.wanted = Math.max(0, Math.min(MAX_WANTED, Math.floor(n)));
  hiddenTime = 0;
  return s.wanted;
}

function clearWanted(ctx) {
  const s = stateOf(ctx);
  s.wanted = 0;
  hiddenTime = 0;
  return 0;
}

// Snap a coordinate to the nearest road-grid line.
function snapToRoad(v) {
  return Math.round(v / ROAD_SPACING) * ROAD_SPACING;
}

function spawnPoliceCar(ctx, nearPos) {
  const c = ctx || boundCtx;
  if (!c || !c.scene || !T) return null;
  const built = makePoliceCarMesh();
  // Spawn on a road near the player: pick an axis, snap it to the grid.
  const angle = Math.random() * Math.PI * 2;
  let x = nearPos.x + Math.cos(angle) * POLICE_SPAWN_DIST;
  let z = nearPos.z + Math.sin(angle) * POLICE_SPAWN_DIST;
  if (Math.random() < 0.5) x = snapToRoad(x);
  else z = snapToRoad(z);
  x = Math.max(-WORLD_SIZE / 2 + 10, Math.min(WORLD_SIZE / 2 - 10, x));
  z = Math.max(-WORLD_SIZE / 2 + 10, Math.min(WORLD_SIZE / 2 - 10, z));
  built.group.position.set(x, 0, z);
  c.scene.add(built.group);
  const car = {
    group: built.group,
    lightLMat: built.lightLMat,
    lightRMat: built.lightRMat,
    speed: 0,
    heading: Math.atan2(nearPos.x - x, nearPos.z - z),
    ramCooldown: 0,
    lightTimer: Math.random(),
  };
  policeCars.push(car);
  return car;
}

function removePoliceCar(ctx, car) {
  const c = ctx || boundCtx;
  if (c && c.scene) c.scene.remove(car.group);
  const i = policeCars.indexOf(car);
  if (i >= 0) policeCars.splice(i, 1);
}

function spawnHeli(ctx, nearPos) {
  const c = ctx || boundCtx;
  if (!c || !c.scene || !T) return null;
  const built = makeHeliMesh();
  built.group.position.set(nearPos.x + 25, 38, nearPos.z - 25);
  c.scene.add(built.group);
  heli = {
    group: built.group,
    rotor: built.rotor,
    cone: built.cone,
    light: built.light,
    leaving: false,
    leaveTimer: 0,
    orbitAngle: 0,
  };
  showMessage(ctx, 'CONDOR-1 helicopter is tracking you!');
  return heli;
}

function removeHeli(ctx) {
  const c = ctx || boundCtx;
  if (heli && c && c.scene) c.scene.remove(heli.group);
  heli = null;
}

// Place one roadblock across the road ahead of the player: two police cars
// parked side by side, perpendicular to the road, plus a barrier between
// them. The anchor is where collision is tested.
function placeRoadblock(ctx, anchorPos, heading) {
  const c = ctx || boundCtx;
  if (!c || !c.scene || !T) return null;
  const group = new T.Group();
  // Barricade runs perpendicular to the player's travel direction.
  const perp = heading + Math.PI / 2;
  const px = Math.sin(perp);
  const pz = Math.cos(perp);
  const cars = [];
  for (const offset of [-3.2, 3.2]) {
    const built = makePoliceCarMesh();
    built.group.position.set(anchorPos.x + px * offset, 0, anchorPos.z + pz * offset);
    built.group.rotation.y = perp;
    group.add(built.group);
    cars.push(built.group);
  }
  const barrierMat = new T.MeshStandardMaterial({ color: 0xff7722, roughness: 0.6 });
  const stripeMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  for (const offset of [-1.2, 1.2]) {
    const bar = new T.Mesh(new T.BoxGeometry(2.2, 0.9, 0.4), offset < 0 ? barrierMat : stripeMat);
    bar.position.set(anchorPos.x + px * offset, 0.45, anchorPos.z + pz * offset);
    bar.rotation.y = perp;
    group.add(bar);
  }
  group.position.set(0, 0, 0);
  c.scene.add(group);
  const block = { group, cars, anchor: { x: anchorPos.x, z: anchorPos.z }, heading };
  roadblocks.push(block);
  return block;
}

function clearRoadblocks(ctx) {
  const c = ctx || boundCtx;
  for (const b of roadblocks) {
    if (c && c.scene) c.scene.remove(b.group);
  }
  roadblocks = [];
}

function updateRoadblocks(ctx, dt, pPos, heading) {
  const wanted = getWanted(ctx);
  if (wanted < ROADBLOCK_WANTED) {
    if (roadblocks.length) clearRoadblocks(ctx);
    roadblockTimer = 0;
    return;
  }
  roadblockTimer += dt;
  if (roadblocks.length < ROADBLOCK_COUNT || roadblockTimer >= ROADBLOCK_REPLACE_SECONDS) {
    roadblockTimer = 0;
    if (roadblocks.length >= ROADBLOCK_COUNT) clearRoadblocks(ctx);
    // Two blocks: one ahead on the player's road, one on the cross road.
    const ahead = 55;
    for (let i = 0; i < ROADBLOCK_COUNT; i++) {
      const dist = ahead + i * 25;
      const hx = Math.sin(heading);
      const hz = Math.cos(heading);
      let ax = pPos.x + hx * dist + (i === 1 ? 20 : 0);
      let az = pPos.z + hz * dist + (i === 1 ? -20 : 0);
      // Snap the anchor onto the road grid so the barricade sits on asphalt.
      if (Math.abs(hx) > Math.abs(hz)) az = snapToRoad(az);
      else ax = snapToRoad(ax);
      ax = Math.max(-WORLD_SIZE / 2 + 10, Math.min(WORLD_SIZE / 2 - 10, ax));
      az = Math.max(-WORLD_SIZE / 2 + 10, Math.min(WORLD_SIZE / 2 - 10, az));
      placeRoadblock(ctx, { x: ax, z: az }, heading);
    }
  }
}

// REAL collision: push the player (and their car) out of the barricade disc.
function collideRoadblocks(ctx, pPos) {
  for (const b of roadblocks) {
    const dx = pPos.x - b.anchor.x;
    const dz = pPos.z - b.anchor.z;
    const d = Math.hypot(dx, dz);
    if (d < ROADBLOCK_RADIUS && d > 0.001) {
      const push = ROADBLOCK_RADIUS - d;
      const nx = dx / d;
      const nz = dz / d;
      setPlayerPos(ctx, { x: pPos.x + nx * push, y: 0, z: pPos.z + nz * push });
      pPos.x += nx * push;
      pPos.z += nz * push;
    } else if (d <= 0.001) {
      setPlayerPos(ctx, { x: pPos.x + ROADBLOCK_RADIUS, y: 0, z: pPos.z });
      pPos.x += ROADBLOCK_RADIUS;
    }
  }
}

export function init(ctx) {
  boundCtx = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (ctx) {
    ctx.state = ctx.state || {};
    if (typeof ctx.state.wanted !== 'number') ctx.state.wanted = 0;
  }
  const api = {
    get wanted() { return getWanted(ctx); },
    set wanted(v) { setWanted(v, ctx); },
    addWanted(n) { return addWanted(n, ctx); },
    setWanted(n) { return setWanted(n, ctx); },
    clearWanted() { return clearWanted(ctx); },
    get roadblocks() { return roadblocks; },
    get heli() { return heli ? heli.group : null; },
    get heliActive() { return !!heli && !heli.leaving; },
    get policeCars() { return policeCars; },
    get isHidden() { return hiddenTime > 0; },
  };
  if (ctx) ctx.police = api;
  return api;
}

export function update(dt, ctx) {
  const c = ctx || boundCtx;
  if (!c) return;
  const s = stateOf(ctx);
  const step = Math.min(dt, 0.05);
  const pPos = playerPos(ctx);
  const heading = playerHeading(ctx);
  const wanted = s.wanted || 0;

  // --- Consume offence flags set by other modules (one star each). ------
  if (s.stoleCar) {
    s.stoleCar = false;
    addWanted(1, ctx);
  }
  if (s.harmedNpc) {
    s.harmedNpc = false;
    addWanted(1, ctx);
  }
  if (typeof s.offence === 'number' && s.offence > 0) {
    const n = s.offence;
    s.offence = 0;
    addWanted(n, ctx);
  }

  setSiren(ctx, wanted > 0);

  // --- Police cars: keep one per star (max 5), chase and ram. ------------
  const wantCars = Math.min(wanted, MAX_POLICE_CARS);
  while (policeCars.length < wantCars) {
    if (!spawnPoliceCar(ctx, pPos)) break;
  }
  while (policeCars.length > wantCars) {
    removePoliceCar(ctx, policeCars[policeCars.length - 1]);
  }
  let nearestPolice = Infinity;
  for (const car of [...policeCars]) {
    const cp = car.group.position;
    const dx = pPos.x - cp.x;
    const dz = pPos.z - cp.z;
    const dist = Math.hypot(dx, dz);
    if (dist < nearestPolice) nearestPolice = dist;
    if (dist > POLICE_DESPAWN_DIST) {
      // Too far away: respawn it near the player instead of letting the
      // pursuit die out.
      removePoliceCar(ctx, car);
      spawnPoliceCar(ctx, pPos);
      continue;
    }
    // Chase: steer toward the player, faster at higher wanted levels.
    const targetHeading = Math.atan2(dx, dz);
    let dh = targetHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car.heading += Math.max(-2.2 * step, Math.min(2.2 * step, dh));
    const cruise = 11 + wanted * 2.2;
    car.speed += (cruise - car.speed) * Math.min(1, step * 1.5);
    cp.x += Math.sin(car.heading) * car.speed * step;
    cp.z += Math.cos(car.heading) * car.speed * step;
    car.group.rotation.y = car.heading;
    // Flash the light bar red/blue.
    car.lightTimer += step;
    const phase = Math.floor(car.lightTimer * 4) % 2 === 0;
    car.lightLMat.emissiveIntensity = phase ? 2.2 : 0.15;
    car.lightRMat.emissiveIntensity = phase ? 0.15 : 2.2;
    // Ram: close contact damages the player and shoves them.
    car.ramCooldown -= step;
    if (dist < 3.2 && car.ramCooldown <= 0) {
      car.ramCooldown = 1.0;
      damagePlayer(ctx, 8);
      const push = 3.2 - dist + 0.5;
      const nx = dist > 0.01 ? dx / dist : 0;
      const nz = dist > 0.01 ? dz / dist : 1;
      setPlayerPos(ctx, { x: pPos.x + nx * push, y: 0, z: pPos.z + nz * push });
      pPos.x += nx * push;
      pPos.z += nz * push;
      playSfx(ctx, 'gunshot');
    }
  }

  // --- Roadblocks + helicopter at 3+ stars. ------------------------------
  updateRoadblocks(c, step, pPos, heading);
  collideRoadblocks(c, pPos);

  if (wanted >= ROADBLOCK_WANTED) {
    if (!heli) spawnHeli(ctx, pPos);
  } else if (heli && !heli.leaving) {
    heli.leaving = true;
    heli.leaveTimer = 0;
    showMessage(ctx, 'CONDOR-1 is leaving the area.');
  }
  if (heli) {
    const hp = heli.group.position;
    heli.rotor.rotation.y += step * 22;
    if (heli.leaving) {
      heli.leaveTimer += step;
      hp.y += step * 18;
      hp.x += step * 12;
      if (heli.leaveTimer > 3) removeHeli(ctx);
    } else {
      // Slow orbit above the player, searchlight locked on them.
      heli.orbitAngle += step * 0.25;
      const tx = pPos.x + Math.cos(heli.orbitAngle) * 14;
      const tz = pPos.z + Math.sin(heli.orbitAngle) * 14;
      hp.x += (tx - hp.x) * Math.min(1, step * 1.2);
      hp.z += (tz - hp.z) * Math.min(1, step * 1.2);
      hp.y += (36 - hp.y) * Math.min(1, step * 1.2);
      heli.group.lookAt(pPos.x, hp.y, pPos.z);
      if (heli.light && heli.light.target) {
        heli.light.target.position.set(pPos.x, 0, pPos.z);
        heli.light.target.updateMatrixWorld();
      }
      if (heli.cone) {
        heli.cone.lookAt(pPos.x, 0, pPos.z);
        heli.cone.rotateX(Math.PI / 2);
      }
    }
  }

  // --- Wanted decay: only while unseen (no police close, no heli). -------
  const seen = nearestPolice < SIGHT_RANGE || (!!heli && !heli.leaving);
  if (wanted > 0) {
    if (seen) {
      hiddenTime = 0;
    } else {
      hiddenTime += step;
      const need = HIDE_DECAY_BASE + HIDE_DECAY_PER_STAR * wanted;
      if (hiddenTime >= need) {
        hiddenTime = 0;
        s.wanted = wanted - 1;
        if (s.wanted === 0) showMessage(ctx, 'You lost the cops — wanted cleared.');
        else showMessage(ctx, `Wanted level down to ${s.wanted} — stay hidden!`);
      }
    }
  } else {
    hiddenTime = 0;
  }
}

export default { init, update, getWanted, addWanted, playerPos };
