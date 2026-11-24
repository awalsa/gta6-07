// weather.js — ISLA BRASA 3D: rain weather.
//
// Rain toggle (V key): visible rain streaks (THREE.Points, one draw call,
// the rain box follows the player so drops are always overhead), a wet-road
// look (road materials darken and turn glossy while it rains), and car grip
// drops to 0.75 while it rains (ctx.state.raining = true; cars.js reads it
// and multiplies steering + acceleration by Config.RAIN_GRIP).
//
// Contract: exports init(ctx) and update(dt, ctx); attaches
//   ctx.weather = { raining, toggle, setRaining }

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const DROP_COUNT = Config.RAIN_DROPS ?? 900;
const FALL_SPEED = 55;
const AREA = (Config.WORLD_SIZE ?? 400) / 2; // rain box half-extent around player
const RAIN_GRIP = Config.RAIN_GRIP ?? 0.75;

let T = null;
let ctxRef = null;
let raining = false;
let points = null;
let positions = null;
let velocities = null;
let roadMats = []; // { mat, baseColor, baseRoughness } captured on first toggle
let roadsScanned = false;

function playerPos(ctx) {
  const c = ctx || ctxRef;
  const s = c && c.state;
  if (s && Array.isArray(s.playerPos)) {
    return { x: s.playerPos[0] || 0, y: s.playerPos[1] || 0, z: s.playerPos[2] || 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

// Roads are dark asphalt: find meshes whose material is a dark grey, or
// meshes the world module tagged as road, and remember their materials so
// the wet look can be applied and later restored exactly.
function scanRoads() {
  if (roadsScanned || !ctxRef || !ctxRef.scene) return;
  roadsScanned = true;
  const seen = new Set();
  ctxRef.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material || !obj.material.color) return;
    if (seen.has(obj.material)) return;
    const tagged = obj.userData && (obj.userData.isRoad || obj.userData.road);
    const col = obj.material.color;
    const dark = col.r < 0.22 && col.g < 0.22 && col.b < 0.22;
    const asphalt = tagged || (dark && obj.position.y < 0.5);
    if (!asphalt) return;
    seen.add(obj.material);
    roadMats.push({
      mat: obj.material,
      baseColor: col.clone(),
      baseRoughness: typeof obj.material.roughness === 'number' ? obj.material.roughness : 0.9,
    });
  });
}

function applyWetLook(wet) {
  scanRoads();
  for (const entry of roadMats) {
    if (!entry.mat || !entry.mat.color) continue;
    if (wet) {
      entry.mat.color.copy(entry.baseColor).multiplyScalar(0.55);
      if (typeof entry.mat.roughness === 'number') entry.mat.roughness = 0.25;
    } else {
      entry.mat.color.copy(entry.baseColor);
      if (typeof entry.mat.roughness === 'number') entry.mat.roughness = entry.baseRoughness;
    }
    entry.mat.needsUpdate = false;
  }
}

function notify(ctx, msg) {
  const c = ctx || ctxRef;
  if (c && c.hud && typeof c.hud.showMessage === 'function') {
    try { c.hud.showMessage(msg); } catch (e) { /* HUD is optional */ }
  }
}

export function setRaining(value, ctx) {
  const next = !!value;
  if (next === raining) return raining;
  raining = next;
  if (ctxRef && ctxRef.state) ctxRef.state.raining = raining;
  if (points) points.visible = raining;
  applyWetLook(raining);
  notify(ctx, raining
    ? `Rain started — grip down to ${RAIN_GRIP} (slippery roads!)`
    : 'Rain stopped — roads drying, grip back to normal');
  return raining;
}

export function toggle(ctx) {
  return setRaining(!raining, ctx || ctxRef);
}

export function isRaining() {
  return raining;
}

export function init(ctx) {
  ctxRef = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (!T || !ctx || !ctx.scene) return;
  ctx.state = ctx.state || {};
  ctx.state.raining = false;

  positions = new Float32Array(DROP_COUNT * 3);
  velocities = new Float32Array(DROP_COUNT);
  for (let i = 0; i < DROP_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * AREA * 2;
    positions[i * 3 + 1] = Math.random() * 60;
    positions[i * 3 + 2] = (Math.random() - 0.5) * AREA * 2;
    velocities[i] = FALL_SPEED * (0.8 + Math.random() * 0.4);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(positions, 3));
  const mat = new T.PointsMaterial({
    color: 0x9db8d6,
    size: 0.35,
    transparent: true,
    opacity: 0.65,
    sizeAttenuation: true,
    depthWrite: false,
  });
  points = new T.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false; // positions wrap around the player; never cull
  points.userData.isRain = true;
  ctx.scene.add(points);

  // V toggles the rain. Ignore repeats and keypresses aimed at a text field.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    toggle();
  });

  ctx.weather = {
    toggle,
    setRaining,
    get raining() { return raining; },
    get grip() { return raining ? RAIN_GRIP : 1; },
  };
}

export function update(dt, ctx) {
  if (!raining || !points) return;
  const p = playerPos(ctx);
  const step = Math.min(dt, 0.05);
  for (let i = 0; i < DROP_COUNT; i++) {
    let y = positions[i * 3 + 1] - velocities[i] * step;
    if (y < 0) {
      y = 45 + Math.random() * 15;
      positions[i * 3] = p.x + (Math.random() - 0.5) * AREA;
      positions[i * 3 + 2] = p.z + (Math.random() - 0.5) * AREA;
    }
    positions[i * 3 + 1] = y;
    // Slight wind slant: drift drops -x as they fall.
    positions[i * 3] -= 6 * step;
  }
  points.geometry.attributes.position.needsUpdate = true;
}

export default { init, update, toggle, setRaining, isRaining };
