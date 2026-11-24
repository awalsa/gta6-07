// daynight.js — 360-second day/night cycle for ISLA BRASA 3D.
//
// The sun and moon orbit the sky, sky/fog colours lerp through
// dawn -> day -> dusk -> night, and street lamps + window lights switch on
// at night.
//
// CRITICAL: the night sky MUST actually darken. The visible sky is darkened
// in three places every single frame:
//   1. scene.background / scene.fog colour (this module),
//   2. the sun/moon/lamp light intensities (this module),
//   3. the world's gradient sky dome via ctx.world.setNightFactor(f) — the
//      dome covers the background, so without that call the sky stays
//      day-blue all night even though isNight is true. (Round 6 v1 never
//      called it, so night never darkened. This module calls it on EVERY
//      update, and also once in init.)
//
// init(ctx) / update(dt, ctx). Attaches:
//   ctx.daynight = { timeOfDay, isNight, nightFactor }
// Writes ctx.state.timeOfDay in [0, 1): 0 = dawn, 0.25 = noon,
// 0.5 = dusk, 0.75 = midnight. Also writes ctx.state.isNight and
// ctx.state.nightFactor (0 = full day, 1 = full night).

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const CYCLE_SECONDS = Config.DAY_LENGTH_SECONDS ?? Config.DAY_LENGTH ?? 360;
const WORLD_R = (Config.WORLD_SIZE ?? 400) / 2 + 60;

const SKY_DAY = { r: 0.53, g: 0.81, b: 0.92 };   // 0x87ceeb
const SKY_DAWN = { r: 1.0, g: 0.70, b: 0.48 };  // 0xffb27a
const SKY_DUSK = { r: 1.0, g: 0.49, b: 0.28 };  // 0xff7e47
const SKY_NIGHT = { r: 0.04, g: 0.06, b: 0.15 };// 0x0b1026
const FOG_DAY = { r: 0.53, g: 0.71, b: 0.84 };   // 0x87b5d6
const FOG_NIGHT = { r: 0.05, g: 0.07, b: 0.16 };

let T = null;
let ctxRef = null;
let timeOfDay = 0.08; // start just after dawn
let sunLight = null;
let moonLight = null;
let hemiLight = null;
let sunMesh = null;
let moonMesh = null;
let lampTimer = 0;

function lerp(a, b, f) {
  return a + (b - a) * f;
}

function mixColor(c1, c2, f) {
  return { r: lerp(c1.r, c2.r, f), g: lerp(c1.g, c2.g, f), b: lerp(c1.b, c2.b, f) };
}

// Sky colour for a time of day: dawn -> day -> dusk -> night -> dawn.
function skyColorAt(t) {
  if (t < 0.12) return mixColor(SKY_DAWN, SKY_DAY, t / 0.12);
  if (t < 0.38) return SKY_DAY;
  if (t < 0.5) return mixColor(SKY_DAY, SKY_DUSK, (t - 0.38) / 0.12);
  if (t < 0.62) return mixColor(SKY_DUSK, SKY_NIGHT, (t - 0.5) / 0.12);
  if (t < 0.88) return SKY_NIGHT;
  return mixColor(SKY_NIGHT, SKY_DAWN, (t - 0.88) / 0.12);
}

// Sun elevation: +1 at noon (t=0.25), 0 at dawn/dusk, -1 at midnight.
function sunElevation(t) {
  return Math.sin(t * Math.PI * 2);
}

// 0 = full day, 1 = full night, smooth across dawn/dusk.
function nightFactorAt(t) {
  const e = sunElevation(t);
  const f = (0.12 - e) / 0.3;
  return Math.max(0, Math.min(1, f));
}

export function isNight() {
  return nightFactorAt(timeOfDay) > 0.5;
}

// Push the current night factor into every place that renders the sky:
// scene background + fog, the world sky dome (via setNightFactor), and the
// lamp/window emissive levels. Called every frame — never skip it.
function applyNightFactor(nf, ctx) {
  const c = ctx || ctxRef;
  if (!c) return;
  // 1. Scene background + fog.
  const sky = skyColorAt(timeOfDay);
  const fog = mixColor(FOG_DAY, FOG_NIGHT, nf);
  if (c.scene) {
    if (c.scene.background && c.scene.background.isColor) {
      c.scene.background.setRGB(sky.r, sky.g, sky.b);
    }
    if (c.scene.fog && c.scene.fog.color) {
      c.scene.fog.color.setRGB(fog.r, fog.g, fog.b);
    }
  }
  // 2. World sky dome + world lights — THE call round 6 v1 missed.
  if (c.world && typeof c.world.setNightFactor === 'function') {
    try { c.world.setNightFactor(nf); } catch (e) { /* world is optional */ }
  }
  // 3. Light intensities.
  if (sunLight) sunLight.intensity = 1.6 * Math.max(0, sunElevation(timeOfDay));
  if (moonLight) moonLight.intensity = 0.35 * nf;
  if (hemiLight) hemiLight.intensity = 0.9 - nf * 0.55;
}

function setLampAndWindowLights(night) {
  if (!ctxRef || !ctxRef.scene) return;
  // Lamps / windows the world tagged (userData.isLamp / isWindow) glow at
  // night. Throttled by the caller to a few times a second — traverse is
  // the whole scene graph, so do not run it every frame.
  ctxRef.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.isLamp && obj.material && obj.material.emissive) {
      obj.material.emissiveIntensity = night ? 2.2 : 0.0;
    }
    if (obj.userData.isWindow && obj.material && obj.material.emissive) {
      obj.material.emissiveIntensity = night ? 1.6 : 0.15;
    }
  });
}

export function init(ctx) {
  ctxRef = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (!T || !ctx || !ctx.scene) return;
  ctx.state = ctx.state || {};
  ctx.state.timeOfDay = timeOfDay;

  // Sun: warm directional light + visible disc. Moon: cool dim light + disc.
  sunLight = new T.DirectionalLight(0xfff2d0, 1.6);
  sunLight.position.set(100, 180, 60);
  ctx.scene.add(sunLight);
  moonLight = new T.DirectionalLight(0x8fa8ff, 0.0);
  moonLight.position.set(-100, 160, -60);
  ctx.scene.add(moonLight);
  hemiLight = new T.HemisphereLight(0xbfd9ff, 0x3a2f28, 0.7);
  ctx.scene.add(hemiLight);

  sunMesh = new T.Mesh(
    new T.SphereGeometry(9, 16, 16),
    new T.MeshBasicMaterial({ color: 0xffdf6b, fog: false }),
  );
  sunMesh.userData.isSun = true;
  ctx.scene.add(sunMesh);
  moonMesh = new T.Mesh(
    new T.SphereGeometry(6.5, 16, 16),
    new T.MeshBasicMaterial({ color: 0xe8ecf5, fog: false }),
  );
  moonMesh.userData.isMoon = true;
  ctx.scene.add(moonMesh);

  if (!ctx.scene.fog) ctx.scene.fog = new T.Fog(0x87ceeb, 120, 420);
  if (ctx.scene.background && ctx.scene.background.isColor) {
    const sky = skyColorAt(timeOfDay);
    ctx.scene.background.setRGB(sky.r, sky.g, sky.b);
  }

  // Apply the night factor immediately so the first frame is correct,
  // then update() keeps calling it every frame.
  applyNightFactor(nightFactorAt(timeOfDay), ctx);
  setLampAndWindowLights(isNight());

  ctx.daynight = {
    get timeOfDay() { return timeOfDay; },
    set timeOfDay(v) { timeOfDay = ((v % 1) + 1) % 1; },
    isNight,
    get nightFactor() { return nightFactorAt(timeOfDay); },
  };
}

export function update(dt, ctx) {
  if (!ctxRef && !ctx) return;
  const c = ctx || ctxRef;
  timeOfDay = (timeOfDay + dt / CYCLE_SECONDS) % 1;
  if (c.state) {
    c.state.timeOfDay = timeOfDay;
    c.state.isNight = isNight();
    c.state.nightFactor = nightFactorAt(timeOfDay);
  }

  // Sun and moon orbit on opposite sides of the sky.
  const theta = timeOfDay * Math.PI * 2;
  const elev = sunElevation(timeOfDay);
  if (sunMesh) {
    sunMesh.position.set(Math.cos(theta) * WORLD_R, elev * WORLD_R * 0.9 + 20, 60);
    sunMesh.visible = elev > -0.15;
  }
  if (moonMesh) {
    moonMesh.position.set(-Math.cos(theta) * WORLD_R, -elev * WORLD_R * 0.9 + 20, -60);
    moonMesh.visible = elev < 0.15;
  }
  if (sunLight) {
    sunLight.position.set(Math.cos(theta) * 120, Math.max(10, elev * 160), 60);
  }
  if (moonLight) {
    moonLight.position.set(-Math.cos(theta) * 120, Math.max(10, -elev * 160), -60);
  }

  // THE critical call: darken the sky dome + world lights every frame.
  applyNightFactor(nightFactorAt(timeOfDay), c);

  // Lamp/window glow is a whole-scene traverse — run it 2x/second, not
  // every frame.
  lampTimer += dt;
  if (lampTimer >= 0.5) {
    lampTimer = 0;
    setLampAndWindowLights(isNight());
  }
}

export default { init, update, isNight };
