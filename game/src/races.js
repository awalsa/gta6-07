// races.js — ISLA BRASA 3D (round 7): 3 street races (design spec gap #7).
//
// Contract: exports init(ctx) and update(dt, ctx); attaches ctx.races.
//   ctx.races = { list, active, wins, bestTimes, start(i) }
// Malecon Sprint, Old Town Circuit and Beachfront Dash. Each race has a
// start marker in the world (a glowing ring + beacon); press R on foot near
// a start to begin. Checkpoints are glowing rings along the roads — drive
// or run through each one in order before the clock runs out to win the
// prize. R while driving cycles the radio (radio.js owns that); R on foot
// starts a race. The race position is the car's position while driving and
// the player's position on foot, so races can be run either way.

import * as THREE from 'three';
import { RACES as RACE_NAMES } from './config.js';

const RACE_DEFS = [
  {
    name: (RACE_NAMES && RACE_NAMES[0]) || 'Malecon Sprint',
    start: [160, 160],
    checkpoints: [[80, 160], [0, 160], [-80, 160], [-160, 160]],
    prize: 500,
    timeLimit: 90,
  },
  {
    name: (RACE_NAMES && RACE_NAMES[1]) || 'Old Town Circuit',
    start: [0, 0],
    checkpoints: [[80, 0], [80, 80], [0, 80], [-80, 80], [-80, 0]],
    prize: 750,
    timeLimit: 120,
  },
  {
    name: (RACE_NAMES && RACE_NAMES[2]) || 'Beachfront Dash',
    start: [-120, 160],
    checkpoints: [[-40, 160], [40, 160], [120, 160], [160, 120]],
    prize: 600,
    timeLimit: 100,
  },
];

const START_RADIUS = 6;
const CHECKPOINT_RADIUS = 6;
const RACE_RESPECT = 250;

let ctxRef = null;
let active = null; // { def, index, cpIndex, timeLeft, markers: [] }
let startMarkers = [];
let wins = 0;
let bestTimes = {}; // race name -> best total seconds
let hudEl = null;

function racePos(ctx) {
  // In a car the race position is the car's position; on foot the player's.
  if (ctx.player && ctx.player.inCar && ctx.cars && ctx.cars.current && ctx.cars.current.pos) {
    return ctx.cars.current.pos;
  }
  if (ctx.player && ctx.player.inCar && ctx.cars && ctx.cars.current && ctx.cars.current.position) {
    return ctx.cars.current.position;
  }
  if (ctx.player && ctx.player.pos) return ctx.player.pos;
  if (ctx.player && ctx.player.mesh) return ctx.player.mesh.position;
  if (ctx.state && ctx.state.playerPos) {
    const p = ctx.state.playerPos;
    return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  }
  return new THREE.Vector3(0, 0, 0);
}

function showMessage(ctx, msg) {
  if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
    try { ctx.hud.showMessage(msg); return; } catch (e) { /* fall through */ }
  }
  if (ctx && typeof ctx.notify === 'function') {
    try { ctx.notify(msg); } catch (e) { /* best-effort */ }
  }
}

function ensureHud() {
  if (typeof document === 'undefined') return null;
  if (hudEl && document.body.contains(hudEl)) return hudEl;
  hudEl = document.getElementById('race-hud');
  if (!hudEl) {
    hudEl = document.createElement('div');
    hudEl.id = 'race-hud';
    hudEl.style.cssText = 'position:fixed;top:110px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#ffe9a8;padding:6px 12px;border-radius:6px;font:14px sans-serif;z-index:60;pointer-events:none;display:none;';
    document.body.appendChild(hudEl);
  }
  return hudEl;
}

function setHud(text) {
  const el = ensureHud();
  if (!el) return;
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
}

// Glowing ring on the road + a tall translucent beacon pillar.
function makeRing(color, radius) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.35, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  g.add(ring);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 26, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 13;
  g.add(pillar);
  return g;
}

function clearMarkers(list) {
  if (!ctxRef || !ctxRef.scene) return;
  for (const m of list || []) ctxRef.scene.remove(m);
  list.length = 0;
}

function startRace(ctx, i) {
  if (active) return false;
  const def = RACE_DEFS[i];
  if (!def) return false;
  if (ctx.player && ctx.player.inCar) return false;
  if (ctx.state && ctx.state.uiOpen) return false;
  if (ctx.plane && ctx.plane.inPlane) return false;
  if (ctx.interiors && ctx.interiors.inside) return false;
  active = { def, index: i, cpIndex: 0, timeLeft: def.timeLimit, markers: [], startedAt: ctx.time || 0 };
  // One marker per checkpoint; only the next one glows bright.
  for (const [x, z] of def.checkpoints) {
    const marker = makeRing(0xffd34d, 5);
    marker.position.set(x, 0, z);
    marker.children[1].material.opacity = 0.08;
    ctx.scene.add(marker);
    active.markers.push(marker);
  }
  showMessage(ctx, `${def.name} — hit all ${def.checkpoints.length} checkpoints in ${def.timeLimit}s for $${def.prize}!`);
  if (ctx.dialogue && typeof ctx.dialogue.show === 'function') {
    try { ctx.dialogue.show('Rook', `${def.name}. Beat the clock and the $${def.prize} is yours.`); } catch (e) { /* best-effort */ }
  }
  return true;
}

function finishRace(ctx, won) {
  const def = active.def;
  clearMarkers(active.markers);
  const elapsed = def.timeLimit - Math.max(0, active.timeLeft);
  if (won) {
    wins += 1;
    if (!bestTimes[def.name] || elapsed < bestTimes[def.name]) bestTimes[def.name] = Math.round(elapsed);
    if (ctx.economy && typeof ctx.economy.addCash === 'function') ctx.economy.addCash(def.prize);
    else if (ctx.state) ctx.state.cash = (ctx.state.cash || 0) + def.prize;
    if (ctx.economy && typeof ctx.economy.addRespect === 'function') {
      try { ctx.economy.addRespect(RACE_RESPECT); } catch (e) { /* best-effort */ }
    }
    showMessage(ctx, `You won the ${def.name}! +$${def.prize} in ${Math.round(elapsed)}s.`);
    if (ctx.dialogue && typeof ctx.dialogue.show === 'function') {
      try { ctx.dialogue.show('Rook', `Clean driving. ${def.name} is yours — $${def.prize} in the pocket.`); } catch (e) { /* best-effort */ }
    }
    if (ctx.audio && typeof ctx.audio.playSfx === 'function') {
      try { ctx.audio.playSfx('pickup'); } catch (e) { /* best-effort */ }
    }
  } else {
    showMessage(ctx, `${def.name} — out of time. Try again at the start marker.`);
  }
  active = null;
  setHud('');
}

export function init(ctx) {
  ctxRef = ctx || null;
  active = null;
  startMarkers = [];
  if (ctx && ctx.scene) {
    // Start markers: one glowing ring + beacon per race, labelled by colour.
    for (const def of RACE_DEFS) {
      const marker = makeRing(0x22d8ff, 5);
      marker.position.set(def.start[0], 0, def.start[1]);
      ctx.scene.add(marker);
      startMarkers.push(marker);
    }
  }
  if (typeof document !== 'undefined') ensureHud();

  // R on foot near a start marker begins that race. (R while driving is the
  // radio — radio.js owns that case; this listener only fires on foot.)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.repeat) return;
    const c = ctxRef;
    if (!c || active) return;
    if (c.player && c.player.inCar) return;
    if (c.state && c.state.uiOpen) return;
    if (c.plane && c.plane.inPlane) return;
    if (c.interiors && c.interiors.inside) return;
    const p = racePos(c);
    for (let i = 0; i < RACE_DEFS.length; i++) {
      const s = RACE_DEFS[i].start;
      if (Math.hypot(p.x - s[0], p.z - s[1]) <= START_RADIUS) {
        startRace(c, i);
        return;
      }
    }
  });

  const api = {
    list: RACE_DEFS,
    get active() { return active; },
    get wins() { return wins; },
    get bestTimes() { return { ...bestTimes }; },
    start(i) { return startRace(ctxRef, i); },
  };
  if (ctx) ctx.races = api;
  return api;
}

export function update(dt, ctx) {
  const c = ctx || ctxRef;
  if (!c) return;
  const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0.016;
  // Pulse the start markers so they read as race starts.
  const t = c.time || 0;
  startMarkers.forEach((m, i) => {
    m.children[0].rotation.z = t * 0.8 + i;
  });

  if (!active) {
    // Prompt when standing on a start marker.
    if (!c.player || c.player.inCar) { setHud(''); return; }
    if (c.state && c.state.uiOpen) { setHud(''); return; }
    const p = racePos(c);
    for (const def of RACE_DEFS) {
      if (Math.hypot(p.x - def.start[0], p.z - def.start[1]) <= START_RADIUS) {
        setHud(`Press R — ${def.name} ($${def.prize}, ${def.timeLimit}s)`);
        return;
      }
    }
    setHud('');
    return;
  }

  // Race in progress: countdown, checkpoint hits, win/fail.
  active.timeLeft -= step;
  const p = racePos(c);
  const next = active.def.checkpoints[active.cpIndex];
  if (next) {
    const d = Math.hypot(p.x - next[0], p.z - next[1]);
    if (d <= CHECKPOINT_RADIUS) {
      if (c.particles && typeof c.particles.burst === 'function') {
        try { c.particles.burst(new THREE.Vector3(next[0], 1, next[1]), 0xffd34d, 12, 3); } catch (e) { /* best-effort */ }
      }
      if (c.audio && typeof c.audio.playSfx === 'function') {
        try { c.audio.playSfx('pickup'); } catch (e) { /* best-effort */ }
      }
      active.cpIndex += 1;
      const marker = active.markers[active.cpIndex - 1];
      if (marker) marker.visible = false;
      const nextMarker = active.markers[active.cpIndex];
      if (nextMarker) nextMarker.children[1].material.opacity = 0.18;
      if (active.cpIndex >= active.def.checkpoints.length) {
        finishRace(c, true);
        return;
      }
    }
  }
  setHud(`${active.def.name} — checkpoint ${active.cpIndex + 1}/${active.def.checkpoints.length} · ${Math.max(0, Math.ceil(active.timeLeft))}s left`);
  if (active.timeLeft <= 0) finishRace(c, false);
}

export default { init, update, RACE_DEFS };
