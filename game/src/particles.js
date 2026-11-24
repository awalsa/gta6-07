// particles.js — ISLA BRASA 3D: one-draw-call particle system.
//
// A fixed-size ring buffer (400 particles by default, Config.PARTICLE_MAX)
// rendered as a single THREE.Points with one BufferGeometry — one draw call
// no matter how many particles are alive. Per-particle velocity, lifetime
// and gravity live in plain CPU arrays; the GPU only sees the position and
// colour attributes. Dead particles are parked far below the ground with a
// black colour, so additive blending fades them to nothing.
//
// Effects: muzzle flashes, exhaust smoke, pickup sparkles, explosion
// bursts. Other modules call ctx.particles.burst(pos, color, count, speed)
// or one of the named wrappers (muzzle / smoke / sparkle / explosion).
//
// Contract: exports init(ctx) and update(dt, ctx); attaches
//   ctx.particles = { burst, muzzle, smoke, sparkle, explosion, count, max }

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const MAX = Config.PARTICLE_MAX ?? 400;

let T = null;
let ctxRef = null;
let points = null;
let positions = null;
let colors = null;
let baseColor = null;
let vel = null;
let life = null;
let maxLife = null;
let grav = null;
let cursor = 0;
let aliveCount = 0;

const tmpColor = { r: 1, g: 1, b: 1 };

// Decode a 0xRRGGBB colour into 0..1 components without needing THREE.
function decodeColor(hex) {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

// Accept either a THREE.Vector3-like {x,y,z} or a plain [x, y, z] array.
function posOf(p) {
  if (!p) return { x: 0, y: 1, z: 0 };
  if (Array.isArray(p)) return { x: p[0] || 0, y: p[1] || 0, z: p[2] || 0 };
  return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
}

function spawnOne(x, y, z, color, speed, lifeTime, gravity) {
  const i = cursor;
  cursor = (cursor + 1) % MAX;
  const i3 = i * 3;
  positions[i3] = x;
  positions[i3 + 1] = y;
  positions[i3 + 2] = z;
  // Random direction on a sphere, biased upward for bursts.
  const a = Math.random() * Math.PI * 2;
  const b = Math.acos(2 * Math.random() - 1);
  const s = speed * (0.4 + Math.random() * 0.8);
  vel[i3] = Math.sin(b) * Math.cos(a) * s;
  vel[i3 + 1] = Math.abs(Math.cos(b)) * s * 0.9 + speed * 0.25;
  vel[i3 + 2] = Math.sin(b) * Math.sin(a) * s;
  const c = decodeColor(color);
  baseColor[i3] = c.r;
  baseColor[i3 + 1] = c.g;
  baseColor[i3 + 2] = c.b;
  colors[i3] = c.r;
  colors[i3 + 1] = c.g;
  colors[i3 + 2] = c.b;
  life[i] = lifeTime * (0.6 + Math.random() * 0.7);
  maxLife[i] = life[i];
  grav[i] = gravity;
}

// Spawn a burst of `count` particles at `pos` (Vector3 or [x,y,z]).
// count defaults to 12, speed to 6, colour to warm yellow.
export function burst(pos, color = 0xffd34d, count = 12, speed = 6) {
  if (!points) return;
  const p = posOf(pos);
  const n = Math.max(1, Math.floor(count));
  for (let k = 0; k < n; k++) {
    spawnOne(p.x, p.y, p.z, color, speed, 0.7, 9);
  }
}

export function muzzle(pos) {
  burst(pos, 0xffd34d, 6, 9);
}

export function smoke(pos) {
  if (!points) return;
  const p = posOf(pos);
  for (let k = 0; k < 3; k++) {
    // Slow grey puff that drifts up and barely falls.
    spawnOne(p.x, p.y, p.z, 0x999999, 1.2, 1.4, -1.5);
  }
}

export function sparkle(pos) {
  burst(pos, 0x7dffd4, 14, 3);
}

export function explosion(pos) {
  if (!points) return;
  const p = posOf(pos);
  for (let k = 0; k < 40; k++) {
    const c = k % 3 === 0 ? 0xffdd55 : (k % 3 === 1 ? 0xff7722 : 0x777777);
    spawnOne(p.x, p.y + 0.5, p.z, c, 14, 1.1, 12);
  }
}

export function init(ctx) {
  ctxRef = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (!T || !ctx || !ctx.scene) return;

  positions = new Float32Array(MAX * 3);
  colors = new Float32Array(MAX * 3);
  baseColor = new Float32Array(MAX * 3);
  vel = new Float32Array(MAX * 3);
  life = new Float32Array(MAX);
  maxLife = new Float32Array(MAX);
  grav = new Float32Array(MAX);
  // Park every particle far below the ground until it is spawned.
  for (let i = 0; i < MAX; i++) positions[i * 3 + 1] = -100;

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  const mat = new T.PointsMaterial({
    size: 0.9,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: T.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  points = new T.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.isParticles = true;
  ctx.scene.add(points);

  ctx.particles = {
    burst,
    muzzle,
    smoke,
    sparkle,
    explosion,
    get count() { return aliveCount; },
    get max() { return MAX; },
  };
}

export function update(dt, ctx) {
  if (!points) return;
  const step = Math.min(dt, 0.05);
  aliveCount = 0;
  for (let i = 0; i < MAX; i++) {
    if (life[i] <= 0) continue;
    life[i] -= step;
    const i3 = i * 3;
    if (life[i] <= 0) {
      // Park the dead particle below the ground, colour black.
      positions[i3 + 1] = -100;
      colors[i3] = 0;
      colors[i3 + 1] = 0;
      colors[i3 + 2] = 0;
      continue;
    }
    aliveCount += 1;
    vel[i3 + 1] -= grav[i] * step;
    positions[i3] += vel[i3] * step;
    positions[i3 + 1] += vel[i3 + 1] * step;
    positions[i3 + 2] += vel[i3 + 2] * step;
    if (positions[i3 + 1] < 0.05 && grav[i] > 0) {
      positions[i3 + 1] = 0.05;
      vel[i3 + 1] = 0;
    }
    // Fade toward black as the particle dies (additive blending).
    const f = life[i] / maxLife[i];
    colors[i3] = baseColor[i3] * f;
    colors[i3 + 1] = baseColor[i3 + 1] * f;
    colors[i3 + 2] = baseColor[i3 + 2] * f;
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
}

export default { init, update, burst, muzzle, smoke, sparkle, explosion };
