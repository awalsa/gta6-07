// ISLA BRASA 3D — "Brasa Air" plane.
//
// The player boards with E near the plane on the runway, throttles with W,
// and takes off once speed reaches >= 22 units/s. Ceiling is 120 units.
// W/S pitch (climb/descend) once airborne, A/D bank and turn, Shift adds
// throttle. Land by descending onto the runway (or the beach) and rolling
// to a stop, then E to exit when speed < 3.
//
// Public contract (other modules read these off ctx.plane):
//   ctx.plane = { inPlane, mesh, pos, speed, airborne, board(), exit() }
//   state.inPlane mirrors inPlane. While flying, this module owns the
//   camera (chase cam, dist 16) and sets ctx.cameraHandled = true so
//   main.js's follow camera does not fight it; the player module returns
//   early while inPlane, so the two never overlap.

import { THREE } from './three.js';
import { RUNWAY_Z, RUNWAY_X_MIN, RUNWAY_X_MAX } from './config.js';

const TAKEOFF_SPEED = 22;
const CEILING = 120;
const MAX_SPEED = 42;
const MIN_FLY_SPEED = 8;
const WORLD_BOUND = 320;

let TH = null;
let ctxRef = null;

const S = {
  mesh: null,
  prop: null,
  pos: null, // THREE.Vector3, live position of the plane
  heading: Math.PI / 2, // east, down the runway (+X)
  speed: 0,
  pitch: 0, // >0 climbing, radians of nose attitude
  bank: 0,
  airborne: false,
  inPlane: false,
  _vy: 0,
};

function keyDown(ctx, code) {
  const keys = ctx && ctx.input && ctx.input.keys;
  return !!(keys && typeof keys.has === 'function' && keys.has(code));
}

// Edge-triggered E, tracked per frame (input.keys is a held-state Set).
let prevE = false;
function ePressed(ctx) {
  const down = keyDown(ctx, 'KeyE');
  const pressed = down && !prevE;
  prevE = down;
  return pressed;
}

function playerPos(ctx) {
  if (ctx.player) {
    if (ctx.player.position) return ctx.player.position;
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (typeof ctx.player.getPosition === 'function') return ctx.player.getPosition();
  }
  if (ctx.state && ctx.state.playerPos) return ctx.state.playerPos;
  if (ctx.camera) return ctx.camera.position;
  return { x: 0, y: 0, z: 0 };
}

function setPlayerPos(ctx, v) {
  if (ctx.player) {
    if (ctx.player.position && typeof ctx.player.position.copy === 'function') {
      ctx.player.position.copy(v);
    } else if (ctx.player.mesh && ctx.player.mesh.position) {
      ctx.player.mesh.position.copy(v);
    } else if (typeof ctx.player.setPosition === 'function') {
      ctx.player.setPosition(v);
    }
  }
  if (ctx.state) ctx.state.playerPos = [v.x, v.y, v.z];
}

function toast(ctx, msg) {
  if (ctx && typeof ctx.notify === 'function') { ctx.notify(msg); return; }
  if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') ctx.hud.showMessage(msg);
}

function setPrompt(msg) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('hud-prompt');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud-prompt';
    el.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#ffe9a8;padding:6px 12px;border-radius:6px;font:13px sans-serif;z-index:9998;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function buildPlaneMesh() {
  const group = new TH.Group();
  const white = new TH.MeshLambertMaterial({ color: 0xf5f5f5 });
  const red = new TH.MeshLambertMaterial({ color: 0xd84a4a });
  const dark = new TH.MeshLambertMaterial({ color: 0x222831 });
  const glass = new TH.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x1a3a4a });

  // Fuselage along Z (nose +Z), so heading = rotation.y like the cars.
  const fuselage = new TH.Mesh(new TH.CylinderGeometry(0.9, 0.7, 7.5, 12), white);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 1.4;
  group.add(fuselage);

  const nose = new TH.Mesh(new TH.ConeGeometry(0.9, 1.6, 12), red);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.4, 4.5);
  group.add(nose);

  const canopy = new TH.Mesh(new TH.BoxGeometry(1.2, 0.7, 1.8), glass);
  canopy.position.set(0, 2.1, 2.2);
  group.add(canopy);

  // Wings span X.
  const wing = new TH.Mesh(new TH.BoxGeometry(13, 0.18, 2.2), white);
  wing.position.set(0, 1.35, 0.4);
  group.add(wing);
  const wingTipL = new TH.Mesh(new TH.BoxGeometry(0.3, 0.22, 2.2), red);
  wingTipL.position.set(-6.5, 1.35, 0.4);
  group.add(wingTipL);
  const wingTipR = wingTipL.clone();
  wingTipR.position.x = 6.5;
  group.add(wingTipR);

  // Tail: horizontal stabiliser + vertical fin.
  const tail = new TH.Mesh(new TH.BoxGeometry(4.4, 0.16, 1.2), white);
  tail.position.set(0, 1.6, -3.6);
  group.add(tail);
  const fin = new TH.Mesh(new TH.BoxGeometry(0.16, 2.0, 1.4), red);
  fin.position.set(0, 2.5, -3.6);
  group.add(fin);

  // "BRASA AIR" cheatline stripe along the fuselage.
  const stripe = new TH.Mesh(new TH.BoxGeometry(0.06, 0.3, 7.0), red);
  stripe.position.set(0.92, 1.4, 0);
  group.add(stripe);
  const stripeR = stripe.clone();
  stripeR.position.x = -0.92;
  group.add(stripeR);

  // Propeller at the nose: hub + two blades, spins around the Z axis.
  const prop = new TH.Group();
  prop.position.set(0, 1.4, 5.35);
  const hub = new TH.Mesh(new TH.CylinderGeometry(0.22, 0.22, 0.3, 8), dark);
  hub.rotation.x = Math.PI / 2;
  prop.add(hub);
  for (const a of [0, Math.PI / 2]) {
    const blade = new TH.Mesh(new TH.BoxGeometry(0.22, 2.6, 0.08), dark);
    blade.rotation.z = a;
    prop.add(blade);
  }
  group.add(prop);

  // Fixed landing gear: 3 small wheels.
  for (const [x, z] of [[-0.9, 0.8], [0.9, 0.8], [0, -2.6]]) {
    const leg = new TH.Mesh(new TH.CylinderGeometry(0.07, 0.07, 0.8, 6), dark);
    leg.position.set(x, 0.4, z);
    group.add(leg);
    const w = new TH.Mesh(new TH.CylinderGeometry(0.3, 0.3, 0.2, 10), dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.3, z);
    group.add(w);
  }

  group.traverse((child) => { if (child.isMesh) child.castShadow = false; });
  return { group, prop };
}

function board(ctx) {
  if (ctx.player && ctx.player.inCar) return false;
  if (S.inPlane) return false;
  S.inPlane = true;
  if (ctx.state) ctx.state.inPlane = true;
  if (ctx.player && ctx.player.mesh) ctx.player.mesh.visible = false;
  toast(ctx, 'Boarded the Brasa Air plane — W to throttle, take off at 22!');
  return true;
}

function exitPlane(ctx) {
  S.inPlane = false;
  if (ctx.state) ctx.state.inPlane = false;
  S.speed = 0;
  S.pitch = 0;
  S.bank = 0;
  S._vy = 0;
  // Step out beside the plane, on the ground.
  const out = S.pos.clone();
  out.x += Math.cos(S.heading) * 4;
  out.z -= Math.sin(S.heading) * 4;
  out.y = 0;
  setPlayerPos(ctx, out);
  if (ctx.player && ctx.player.mesh) {
    ctx.player.mesh.visible = true;
    ctx.player.mesh.rotation.y = S.heading;
  }
  if (ctx.state) ctx.state.playerHeading = S.heading;
  ctx.playerHeading = S.heading;
  setPrompt('');
  toast(ctx, 'You left the plane.');
}

const api = {
  get inPlane() { return S.inPlane; },
  get mesh() { return S.mesh; },
  get pos() { return S.pos; },
  get speed() { return S.speed; },
  get airborne() { return S.airborne; },
  board(ctx) { return board(ctx || ctxRef); },
  exit(ctx) { exitPlane(ctx || ctxRef); },
};

export function init(ctx) {
  TH = (ctx && ctx.THREE) || THREE;
  ctxRef = ctx;
  const built = buildPlaneMesh();
  S.mesh = built.group;
  S.prop = built.prop;
  const startX = (RUNWAY_X_MIN + RUNWAY_X_MAX) / 2 || 0;
  const startZ = typeof RUNWAY_Z === 'number' ? RUNWAY_Z : -195;
  S.pos = new TH.Vector3(startX, 0, startZ);
  S.mesh.position.copy(S.pos);
  S.mesh.rotation.y = S.heading;
  if (ctx.scene) ctx.scene.add(S.mesh);

  // Runway windsock: pole + orange cone that swings with the wind.
  if (ctx.scene) {
    const pole = new TH.Mesh(
      new TH.CylinderGeometry(0.08, 0.08, 4, 6),
      new TH.MeshLambertMaterial({ color: 0x888888 })
    );
    pole.position.set(startX + 18, 2, startZ + 6);
    const sock = new TH.Mesh(
      new TH.ConeGeometry(0.5, 1.8, 8),
      new TH.MeshLambertMaterial({ color: 0xff7f2a, emissive: 0x994400 })
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(startX + 19, 3.8, startZ + 6);
    sock.name = 'windsock';
    ctx.scene.add(pole, sock);
    S.windsock = sock;
  }

  ctx.plane = api;
  return api;
}

export function update(dt, ctx) {
  if (!ctxRef) ctxRef = ctx;
  const T = (ctx && ctx.THREE) || TH;
  if (!S.mesh || !T) return;

  // --- On foot: offer boarding when the player is near the plane. ---
  if (!S.inPlane) {
    const p = playerPos(ctx);
    const px = typeof p.x === 'number' ? p.x : (Array.isArray(p) ? p[0] : 0);
    const pz = typeof p.z === 'number' ? p.z : (Array.isArray(p) ? p[2] : 0);
    const d = Math.hypot(px - S.pos.x, pz - S.pos.z);
    if (d < 6 && !(ctx.player && ctx.player.inCar) && !(ctx.state && ctx.state.insideInterior)) {
      setPrompt('Press E — Board the Brasa Air plane');
      if (ePressed(ctx)) board(ctx);
    } else if (d < 10) {
      setPrompt('');
    }
    // Propeller idles slowly on the ground.
    if (S.prop) S.prop.rotation.z += dt * 2;
    if (S.windsock) S.windsock.rotation.y = Math.sin((ctx.time || 0) * 0.6) * 0.5;
    return;
  }

  // --- Flying / taxiing. ---
  const state = ctx.state || {};
  const uiOpen = state.uiOpen || ctx.uiOpen;
  const boost = keyDown(ctx, 'ShiftLeft', 'ShiftRight');
  const throttle = !uiOpen && keyDown(ctx, 'KeyW', 'ArrowUp');
  const brake = !uiOpen && keyDown(ctx, 'KeyS', 'ArrowDown');
  const bankIn = !uiOpen ? ((keyDown(ctx, 'KeyA') ? 1 : 0) - (keyDown(ctx, 'KeyD') ? 1 : 0)) : 0;

  // Throttle: W spools up, S brakes, Shift adds extra thrust.
  if (throttle) S.speed += (boost ? 10 : 6) * dt;
  if (brake) S.speed -= 12 * dt;
  S.speed -= S.speed * 0.12 * dt; // drag
  S.speed = Math.max(0, Math.min(MAX_SPEED, S.speed));

  // Takeoff: at >= 22 u/s the plane lifts off the runway.
  if (!S.airborne && S.speed >= TAKEOFF_SPEED) {
    S.airborne = true;
    S._vy = 2;
    toast(ctx, 'Airborne! W climb · S descend · A/D turn · Ceiling 120');
  }

  if (S.airborne) {
    // Pitch: W climbs, S descends. Climbing bleeds speed; descending gains it.
    const pitchIn = (throttle ? 1 : 0) - (brake ? 1 : 0);
    S.pitch += (pitchIn * 0.45 - S.pitch) * Math.min(1, 3 * dt);
    S._vy = S.pitch * 14;
    // Stall: below minimum flying speed the plane sinks no matter what.
    if (S.speed < MIN_FLY_SPEED + 4) S._vy -= (MIN_FLY_SPEED + 4 - S.speed) * 1.2;
    S.pos.y += S._vy * dt;
    if (S.pos.y > CEILING) { S.pos.y = CEILING; S._vy = Math.min(S._vy, 0); }
    // Bank into turns.
    S.bank += (bankIn * 0.5 - S.bank) * Math.min(1, 4 * dt);
    S.heading += bankIn * 0.85 * dt * Math.min(1, S.speed / 25);
    if (S.pos.y <= 0.6 && S._vy <= 0.5) {
      // Touchdown: wheels on the ground again.
      S.pos.y = 0;
      S.airborne = false;
      S.pitch = 0;
      S.bank = 0;
      S._vy = 0;
      toast(ctx, 'Landed. Roll to a stop, then press E to exit.');
    }
  } else {
    // Taxiing: steer gently with A/D, scaled by speed.
    S.heading += bankIn * 0.5 * dt * Math.min(1, S.speed / 12);
    S.bank = 0;
    S.pitch = 0;
    S.pos.y = 0;
  }

  // Move along the heading.
  const fx = Math.sin(S.heading);
  const fz = Math.cos(S.heading);
  S.pos.x += fx * S.speed * dt;
  S.pos.z += fz * S.speed * dt;
  S.pos.x = T.MathUtils.clamp(S.pos.x, -WORLD_BOUND, WORLD_BOUND);
  S.pos.z = T.MathUtils.clamp(S.pos.z, -WORLD_BOUND, WORLD_BOUND);

  // Apply transform. Model forward is +Z, so yaw = heading; YXZ order so
  // pitch and bank compose cleanly with the yaw.
  if (S.mesh) {
    S.mesh.position.copy(S.pos);
    S.mesh.rotation.order = 'YXZ';
    S.mesh.rotation.y = S.heading;
    S.mesh.rotation.x = -S.pitch;
    S.mesh.rotation.z = S.bank;
  }
  if (S.prop) S.prop.rotation.z += dt * (4 + S.speed * 1.2);
  if (S.windsock) S.windsock.rotation.y = Math.sin((ctx.time || 0) * 0.6) * 0.5;

  // Keep the player anchor on the plane so the HUD/minimap track the flight.
  setPlayerPos(ctx, S.pos.clone().add(new T.Vector3(0, 1.5, 0)));
  if (ctx.state) ctx.state.inPlane = true;
  ctx.playerHeading = S.heading;
  if (ctx.state) ctx.state.playerHeading = S.heading;

  // Chase camera for flight (dist 16). Claim it so main.js's follow cam
  // does not fight the chase cam while flying.
  const camera = ctx.camera;
  if (camera && ctx.cameraControl !== 'external') {
    const camDist = 16;
    camera.position.set(
      S.pos.x - fx * camDist,
      S.pos.y + 5.5,
      S.pos.z - fz * camDist
    );
    camera.lookAt(S.pos.x + fx * 8, S.pos.y + 1, S.pos.z + fz * 8);
    ctx.cameraHandled = true;
  }

  // Exit with E when stopped on the ground.
  if (ePressed(ctx) && !S.airborne && S.speed < 3) exitPlane(ctx);

  setPrompt(
    S.airborne
      ? 'Flying — W climb / S descend · A/D turn · Shift throttle · Alt ' + Math.round(S.pos.y) + ' / ' + CEILING + ' · Speed ' + Math.round(S.speed)
      : 'On runway — W throttle (need ' + TAKEOFF_SPEED + ' to take off) · Speed ' + Math.round(S.speed) + ' · E to exit when stopped'
  );
}

export { TAKEOFF_SPEED, CEILING };
export default api;
