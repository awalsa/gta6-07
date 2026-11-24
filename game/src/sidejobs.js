// sidejobs.js — ISLA BRASA 3D (round 7): side jobs.
// Taxi job ($120 per fare), delivery job ($100 per delivery, +$50 bonus for
// a fast delivery), and 10 collectible orbs hidden around the city ($50 each).
// Start a job by pressing F at its marker: taxi at the Plaza, delivery at
// the Market. Orbs are picked up just by walking into them.
// Contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config, THREE }.
//
// Round-7 bug fixes (learned from round 6, written in directly):
// 1. The taxi pickup marker sits at plaza + (14, 0, 0) — the old offset
//    (+6, 0, 0) was INSIDE the Plaza Tower AABB, so the player was pushed
//    out of the tower and could never come within the F radius.
// 2. Side-job prompts use their OWN element, #hud-prompt-sidejobs — the
//    shared #hud-prompt is overwritten every frame by shops/casino/etc,
//    which erased the taxi/delivery cue in the same frame it was written.
// 3. Taxi and delivery complete while driving: completion checks use the
//    vehicle position when the player is in a car (cars.js drive() syncs
//    the player mesh to the car, but the mesh lags the car position), so
//    jobPos() returns ctx.cars.current.pos while driving.

import * as THREE from 'three';
import { LANDMARKS, SIDE_JOBS, ORB_COUNT } from './config.js';

// Payouts from config.js (fallbacks if the config shape ever changes).
const TAXI_FARE = (SIDE_JOBS && SIDE_JOBS.taxi) || 120;
const DELIVERY_PAY = (SIDE_JOBS && SIDE_JOBS.delivery) || 100;
const FAST_BONUS = (SIDE_JOBS && SIDE_JOBS.deliveryFastBonus) || 50;
const ORB_PAY = (SIDE_JOBS && SIDE_JOBS.orb) || 50;
const TOTAL_ORBS = ORB_COUNT || 10;

// Job time limits: a delivery must land within 60s; finishing in under 25s
// earns the fast bonus.
const DELIVERY_LIMIT = 60;
const FAST_LIMIT = 25;

// Landmark keys in config.js (short name -> real key).
const LM = {
  market: 'feriaMarket', plaza: 'plazaTower', pier: 'oldPier',
  marina: 'marinaDocks', garage: 'brasaGarage', arcade: 'rookArcade',
  casino: 'coralCasino', tunnel: 'coastTunnel', motel: 'motelVela',
  church: 'oldChurch', beach: 'beachfront', underpass: 'underpass',
};

// Fallback landmark coords (mirror config.js; used only if a key is missing).
const FALLBACK = {
  market: { x: 0, z: -80 },
  plaza: { x: 0, z: 0 },
  pier: { x: -160, z: 170 },
  marina: { x: -120, z: 175 },
  garage: { x: 80, z: -40 },
  arcade: { x: 40, z: 80 },
  casino: { x: 120, z: 120 },
  tunnel: { x: -80, z: -160 },
  motel: { x: -40, z: 40 },
  church: { x: -120, z: -120 },
  beach: { x: 160, z: 170 },
  underpass: { x: 0, z: 150 },
};

function landmarkPos(name) {
  const key = LM[name] || name;
  const raw = (LANDMARKS && LANDMARKS[key]) || FALLBACK[name] || { x: 0, z: 0 };
  if (Array.isArray(raw)) return new THREE.Vector3(raw[0], 0, raw[1]);
  if (raw && raw.position) return new THREE.Vector3(raw.position.x || 0, 0, raw.position.z || 0);
  if (raw && typeof raw.x === 'number') return new THREE.Vector3(raw.x, 0, raw.z || 0);
  return new THREE.Vector3(0, 0, 0);
}

// Nudge a job destination out of any building footprint: landmark centres
// sit inside their own buildings and the player is pushed out of those
// AABBs, so a dropoff at the exact centre could never come within the
// 7-unit completion radius.
function clearOfBuildings(ctx, pos) {
  const buildings = (ctx && ctx.world && ctx.world.buildings) || [];
  let x = pos.x;
  let z = pos.z;
  for (const b of buildings) {
    const pad = 2;
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) {
      const toLeft = x - (b.minX - pad);
      const toRight = (b.maxX + pad) - x;
      const toTop = z - (b.minZ - pad);
      const toBottom = (b.maxZ + pad) - z;
      const nearest = Math.min(toLeft, toRight, toTop, toBottom);
      if (nearest === toLeft) x = b.minX - pad;
      else if (nearest === toRight) x = b.maxX + pad;
      else if (nearest === toTop) z = b.minZ - pad;
      else z = b.maxZ + pad;
    }
  }
  return new THREE.Vector3(x, 0, z);
}

function keyIsDown(ctx, code) {
  const inp = (ctx && ctx.input) || {};
  if (typeof inp.isDown === 'function') return !!inp.isDown(code);
  if (inp.keys instanceof Set) return inp.keys.has(code);
  if (inp.keys) return !!inp.keys[code];
  if (typeof inp[code] === 'boolean') return inp[code];
  return false;
}

function playerPosition(ctx) {
  if (ctx.player) {
    if (ctx.player.position) return ctx.player.position;
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (typeof ctx.player.getPosition === 'function') return ctx.player.getPosition();
  }
  if (ctx.state && ctx.state.playerPos) return ctx.state.playerPos;
  if (ctx.camera) return ctx.camera.position;
  return new THREE.Vector3(0, 0, 0);
}

// Position used for job start/completion checks. While driving, the car
// position is authoritative: cars.js drive() syncs the player mesh to the
// car each frame, but the mesh can lag a frame behind the car, so checking
// the mesh would miss a dropoff the car already reached.
function jobPos(ctx) {
  if (ctx.player && ctx.player.inCar && ctx.cars && ctx.cars.current && ctx.cars.current.pos) {
    return ctx.cars.current.pos;
  }
  if (ctx.player && ctx.player.inCar && ctx.cars && ctx.cars.current && ctx.cars.current.position) {
    return ctx.cars.current.position;
  }
  return playerPosition(ctx);
}

function shiftCash(ctx, amount) {
  if (ctx.economy && typeof ctx.economy.addCash === 'function') { ctx.economy.addCash(amount); return; }
  if (ctx.state) ctx.state.cash = (ctx.state.cash || 0) + amount;
}

function toast(ctx, msg) {
  if (ctx && typeof ctx.notify === 'function') { ctx.notify(msg); return; }
  if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') { ctx.hud.showMessage(msg); return; }
  if (typeof document !== 'undefined') {
    let el = document.getElementById('hud-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-toast';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;z-index:9999;pointer-events:none;transition:opacity .4s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
  }
  console.log('[sidejobs]', msg);
}

function showPrompt(msg) {
  if (typeof document === 'undefined') return;
  // Own element, NOT #hud-prompt: that id is shared by casino, interiors,
  // plane, properties and shops, which all overwrite it every frame (shops
  // runs last in main.js), so a sidejobs prompt written there was erased in
  // the same frame and the taxi/delivery cue never showed on screen even
  // though F itself worked. This one sits just above the shared line so
  // both can show without overlapping.
  let el = document.getElementById('hud-prompt-sidejobs');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud-prompt-sidejobs';
    el.style.cssText = 'position:fixed;bottom:112px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#ffe9a8;padding:6px 12px;border-radius:6px;font:13px sans-serif;z-index:9998;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// Where the 10 orbs hide: one near each of 10 landmarks.
const ORB_SPOTS = [
  { name: 'pier', off: [6, 2, 0] },
  { name: 'marina', off: [-8, 2, 4] },
  { name: 'beach', off: [10, 2, -6] },
  { name: 'church', off: [0, 2, 8] },
  { name: 'tunnel', off: [-6, 2, -6] },
  { name: 'arcade', off: [8, 2, 8] },
  { name: 'plaza', off: [-10, 2, -4] },
  { name: 'motel', off: [6, 2, 6] },
  { name: 'garage', off: [-8, 2, -8] },
  { name: 'casino', off: [10, 2, 10] },
];

const DEST_POOL = ['market', 'pier', 'marina', 'garage', 'arcade', 'casino', 'motel', 'church', 'plaza', 'beach'];

function makeBeacon(color) {
  const g = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 30, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  pillar.position.y = 15;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.8, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color })
  );
  gem.position.y = 3.2;
  g.add(pillar, ring, gem);
  g.userData.gem = gem;
  return g;
}

function makePassenger(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a })
  );
  head.position.y = 1.75;
  g.add(body, head);
  return g;
}

let S = null;

export function init(ctx) {
  // Taxi marker: 14 units east of the Plaza Tower centre. The tower's own
  // collision box spans x/z -10..+10, so the old offset (+6,0,0) sat INSIDE
  // the tower: the player was pushed out to x=10.5, 4.5 units away — outside
  // the 4-unit F radius — and F could never start the job. +14 keeps the
  // marker on the plaza pad but clear of the tower, matching how the
  // interior doors sit just outside their buildings' footprints.
  const taxiMarkerPos = landmarkPos('plaza').add(new THREE.Vector3(14, 0, 0));
  const deliveryMarkerPos = landmarkPos('market').add(new THREE.Vector3(-8, 0, 0));

  S = {
    ctx,
    orbsCollected: 0,
    orbsTotal: ORB_SPOTS.length,
    orbs: [],
    taxi: { active: false, phase: 'idle', dest: null, destName: '' },
    delivery: { active: false, dest: null, destName: '', timer: 0, elapsed: 0 },
    taxiMarkerPos,
    deliveryMarkerPos,
    taxiBeacon: null,
    deliveryBeacon: null,
    destBeacon: null,
    passengerMesh: null,
    fWasDown: false,
    hudEl: null,
    clock: 0,
  };

  if (ctx.scene) {
    S.taxiBeacon = makeBeacon(0xffc300); // yellow = taxi
    S.taxiBeacon.position.copy(taxiMarkerPos);
    ctx.scene.add(S.taxiBeacon);
    S.deliveryBeacon = makeBeacon(0x2ecc71); // green = delivery
    S.deliveryBeacon.position.copy(deliveryMarkerPos);
    ctx.scene.add(S.deliveryBeacon);
    S.destBeacon = makeBeacon(0xff3366); // pink = current destination
    S.destBeacon.visible = false;
    ctx.scene.add(S.destBeacon);

    // 10 glowing orbs.
    const orbGeo = new THREE.SphereGeometry(0.5, 14, 14);
    for (const spot of ORB_SPOTS) {
      const base = landmarkPos(spot.name);
      const pos = new THREE.Vector3(base.x + spot.off[0], spot.off[1], base.z + spot.off[2]);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x66e0ff, emissive: 0x33bbff, emissiveIntensity: 1.6, transparent: true, opacity: 0.95,
      });
      const orb = new THREE.Mesh(orbGeo, mat);
      orb.position.copy(pos);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.22, depthWrite: false })
      );
      orb.add(halo);
      orb.userData = { taken: false, baseY: pos.y };
      ctx.scene.add(orb);
      S.orbs.push(orb);
    }
  }

  if (typeof document !== 'undefined') {
    let el = document.getElementById('hud-sidejobs');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-sidejobs';
      el.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(0,0,0,0.6);color:#bfefff;padding:6px 10px;border-radius:6px;font:12px sans-serif;z-index:9997;pointer-events:none;';
      document.body.appendChild(el);
    }
    S.hudEl = el;
  }

  const api = {
    get orbsCollected() { return S.orbsCollected; },
    orbsTotal: TOTAL_ORBS,
    get taxiActive() { return S.taxi.active; },
    get deliveryActive() { return S.delivery.active; },
    taxiMarkerPos,
    deliveryMarkerPos,
    startTaxi() { return startTaxi(ctx); },
    startDelivery() { return startDelivery(ctx); },
  };
  ctx.sidejobs = api;
  refreshHud(ctx);
  return api;
}

function pickDestination(ctx, notName) {
  const pool = DEST_POOL.filter((n) => n !== notName);
  const name = pool[Math.floor(Math.random() * pool.length)];
  return { name, pos: clearOfBuildings(ctx, landmarkPos(name)) };
}

function burstAt(ctx, pos, color) {
  if (ctx.particles && typeof ctx.particles.burst === 'function') {
    try { ctx.particles.burst(pos, color); } catch (e) { /* particles are optional */ }
  }
}

function startTaxi(ctx) {
  if (!S || S.taxi.active) return false;
  const pickup = S.taxiMarkerPos.clone().add(new THREE.Vector3(2, 0, 2));
  S.taxi.active = true;
  S.taxi.phase = 'pickup';
  S.taxi.dest = null;
  if (ctx.scene) {
    S.passengerMesh = makePassenger(0xe74c3c);
    S.passengerMesh.position.copy(pickup);
    ctx.scene.add(S.passengerMesh);
    S.destBeacon.position.copy(pickup);
    S.destBeacon.visible = true;
  }
  toast(ctx, 'Taxi job: pick up the passenger at the yellow marker (Plaza).');
  refreshHud(ctx);
  return true;
}

function startDelivery(ctx) {
  if (!S || S.delivery.active) return false;
  const dest = pickDestination(ctx, 'market');
  S.delivery.active = true;
  S.delivery.dest = dest.pos;
  S.delivery.destName = dest.name;
  S.delivery.timer = DELIVERY_LIMIT;
  S.delivery.elapsed = 0;
  if (ctx.scene) {
    S.destBeacon.position.copy(dest.pos);
    S.destBeacon.visible = true;
  }
  toast(ctx, 'Delivery job: take the package to ' + dest.name + ' (' + DELIVERY_LIMIT + 's — under ' + FAST_LIMIT + 's earns a $' + FAST_BONUS + ' bonus).');
  refreshHud(ctx);
  return true;
}

function finishTaxi(ctx) {
  S.taxi.active = false;
  S.taxi.phase = 'idle';
  S.taxi.dest = null;
  if (S.destBeacon) S.destBeacon.visible = false;
  shiftCash(ctx, TAXI_FARE);
  toast(ctx, 'Fare complete! +$' + TAXI_FARE);
  burstAt(ctx, jobPos(ctx), 0xffc300);
  refreshHud(ctx);
}

function finishDelivery(ctx, fast) {
  S.delivery.active = false;
  S.delivery.dest = null;
  if (S.destBeacon) S.destBeacon.visible = false;
  const pay = fast ? DELIVERY_PAY + FAST_BONUS : DELIVERY_PAY;
  shiftCash(ctx, pay);
  toast(ctx, fast ? 'Delivery complete — fast bonus! +$' + pay : 'Delivery complete! +$' + pay);
  burstAt(ctx, jobPos(ctx), 0x2ecc71);
  refreshHud(ctx);
}

function refreshHud(ctx) {
  if (!S || !S.hudEl) return;
  const taxi = S.taxi.active
    ? (S.taxi.phase === 'pickup' ? 'Taxi: pick up passenger' : 'Taxi: drop off @ ' + S.taxi.destName)
    : 'Taxi: idle (F at Plaza)';
  const del = S.delivery.active
    ? 'Delivery: ' + S.delivery.destName + ' — ' + Math.ceil(S.delivery.timer) + 's'
    : 'Delivery: idle (F at Market)';
  S.hudEl.textContent = 'Orbs ' + S.orbsCollected + '/' + S.orbsTotal + '  ·  ' + taxi + '  ·  ' + del;
}

export function update(dt, ctx) {
  if (!S) return;
  S.clock += dt;
  const p = jobPos(ctx); // vehicle position while driving, player on foot
  const fDown = keyIsDown(ctx, 'KeyF');
  const fPressed = fDown && !S.fWasDown;
  S.fWasDown = fDown;

  // --- orbs: bob, spin, collect on touch ---
  for (const orb of S.orbs) {
    if (orb.userData.taken) continue;
    orb.rotation.y += dt * 1.5;
    orb.position.y = orb.userData.baseY + Math.sin(S.clock * 2 + orb.position.x) * 0.25;
    if (p.distanceTo(orb.position) < 2.5) {
      orb.userData.taken = true;
      orb.visible = false;
      S.orbsCollected += 1;
      shiftCash(ctx, ORB_PAY);
      toast(ctx, 'Orb collected! +$' + ORB_PAY + ' (' + S.orbsCollected + '/' + S.orbsTotal + ')');
      burstAt(ctx, orb.position, 0x66e0ff);
      refreshHud(ctx);
    }
  }

  // --- beacons pulse ---
  for (const b of [S.taxiBeacon, S.deliveryBeacon, S.destBeacon]) {
    if (b && b.visible && b.userData.gem) {
      b.userData.gem.rotation.y += dt * 2;
      b.userData.gem.position.y = 3.2 + Math.sin(S.clock * 3) * 0.3;
    }
  }

  // --- taxi job ---
  if (S.taxi.active) {
    if (S.taxi.phase === 'pickup' && S.passengerMesh) {
      if (p.distanceTo(S.passengerMesh.position) < 3) {
        S.taxi.phase = 'dropoff';
        const dest = pickDestination(ctx, 'plaza');
        S.taxi.dest = dest.pos;
        S.taxi.destName = dest.name;
        if (S.passengerMesh) S.passengerMesh.visible = false; // passenger aboard
        if (S.destBeacon) { S.destBeacon.position.copy(dest.pos); S.destBeacon.visible = true; }
        toast(ctx, 'Passenger aboard — drive them to ' + dest.name + '.');
        refreshHud(ctx);
      }
    } else if (S.taxi.phase === 'dropoff' && S.taxi.dest) {
      if (p.distanceTo(S.taxi.dest) < 7) {
        if (S.passengerMesh && ctx.scene) { ctx.scene.remove(S.passengerMesh); S.passengerMesh = null; }
        finishTaxi(ctx);
      }
    }
  }

  // --- delivery job ---
  if (S.delivery.active) {
    S.delivery.timer -= dt;
    S.delivery.elapsed += dt;
    if (S.delivery.timer <= 0) {
      S.delivery.active = false;
      S.delivery.dest = null;
      if (S.destBeacon) S.destBeacon.visible = false;
      toast(ctx, 'Delivery failed — out of time.');
      refreshHud(ctx);
    } else if (S.delivery.dest && p.distanceTo(S.delivery.dest) < 7) {
      finishDelivery(ctx, S.delivery.elapsed < FAST_LIMIT);
    } else if (Math.floor(S.clock * 2) !== Math.floor((S.clock - dt) * 2)) {
      refreshHud(ctx); // refresh the countdown about twice a second
    }
  }

  // --- F starts a job (skipped while another overlay is open) ---
  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;
  if (fPressed && !overlayOpen && !inPlane && !inside) {
    if (!S.taxi.active && p.distanceTo(S.taxiMarkerPos) < 4) {
      startTaxi(ctx);
    } else if (!S.delivery.active && p.distanceTo(S.deliveryMarkerPos) < 4) {
      startDelivery(ctx);
    }
  }

  // --- contextual prompt (own element — see showPrompt) ---
  let prompt = '';
  if (!overlayOpen && !inPlane && !inside) {
    if (!S.taxi.active && p.distanceTo(S.taxiMarkerPos) < 4) prompt = 'Press F — Start taxi job ($' + TAXI_FARE + '/fare)';
    else if (!S.delivery.active && p.distanceTo(S.deliveryMarkerPos) < 4) prompt = 'Press F — Start delivery job ($' + DELIVERY_PAY + ' + $' + FAST_BONUS + ' fast bonus)';
    else if (S.taxi.active && S.taxi.phase === 'pickup') prompt = 'Taxi: pick up the passenger at the pink marker';
    else if (S.taxi.active) prompt = 'Taxi: drive the passenger to ' + S.taxi.destName;
    else if (S.delivery.active) prompt = 'Delivery: reach ' + S.delivery.destName + ' — ' + Math.ceil(S.delivery.timer) + 's left';
  }
  showPrompt(prompt);
}

export default { init, update };
