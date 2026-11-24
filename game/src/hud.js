// hud.js — ISLA BRASA 3D: HUD, minimap, weapon wheel, shop/garage/crew/help
// overlays (round 7, worker W7).
//
// The HUD bar shows cash, wanted stars (0–5), respect rank + payout bonus,
// the mission tracker (name, current step, distance, timer) and a health
// bar. A 180×180 minimap canvas (top-right) draws the road grid, the water
// strip, landmark dots, the mission target diamond and the player dot.
// Holding Q opens the weapon wheel (click or press 1–7 to equip); G opens
// the shop (or the garage near Brasa Garage); C opens the crew panel;
// H opens help; M opens the full map; Esc closes overlays.
//
// The mission tracker reads state.currentMission — the object the missions
// module publishes there ({ name, stepLabel, distance, timeLeft }) — or a
// mission index into the config MISSIONS list.
//
// Buying, upgrades, selling and crew all go through ctx.economy when it is
// available, with direct state fallbacks so the HUD still works if the
// economy module loads later or uses different car ids.
//
// Shared contract: exports init(ctx) and update(dt, ctx), plus WEAPONS and
// OUTFITS. ctx = { scene, camera, renderer, state, input, config }.
// DOM ids (created here when index.html did not provide them):
// hud-cash, hud-wanted, hud-respect, hud-mission, hud-health, minimap,
// hud-message, hud-prompt, weapon-wheel, overlay-shop, overlay-garage,
// overlay-crew, overlay-weapons, overlay-casino, overlay-help, overlay-map.
// Every lookup is null-guarded.

import * as CFG from './config.js';

const WORLD_SIZE = typeof CFG.WORLD_SIZE === 'number' ? CFG.WORLD_SIZE : 400;
const ROAD_SPACING = typeof CFG.ROAD_SPACING === 'number' ? CFG.ROAD_SPACING : 40;
const ROAD_LINES = Array.isArray(CFG.ROAD_LINES) && CFG.ROAD_LINES.length
  ? CFG.ROAD_LINES
  : [-160, -120, -80, -40, 0, 40, 80, 120, 160];
const LANDMARKS = CFG.LANDMARKS || null;
const LANDMARK_ALIASES = CFG.LANDMARK_ALIASES || {};
const LANDMARK_NAMES = CFG.LANDMARK_NAMES || null;
const MISSIONS = Array.isArray(CFG.MISSIONS) ? CFG.MISSIONS : [];
const GARAGE_CARS = Array.isArray(CFG.GARAGE_CARS) && CFG.GARAGE_CARS.length
  ? CFG.GARAGE_CARS
  : [
      { id: 'sedan', name: 'Brasa Sedan', price: 2800, topSpeed: 26, accel: 10, handling: 1.0 },
      { id: 'coupe', name: 'Vela Coupe', price: 5000, topSpeed: 32, accel: 13, handling: 1.1 },
      { id: 'sport', name: 'Coral Sport', price: 8000, topSpeed: 38, accel: 16, handling: 1.25 },
      { id: 'supercar', name: 'Isla GT', price: 12000, topSpeed: 46, accel: 20, handling: 1.4 },
    ];
const CREW_DEFS = (CFG.CREW && typeof CFG.CREW === 'object' && Object.keys(CFG.CREW).length)
  ? CFG.CREW
  : {
      rico: { id: 'rico', name: 'Rico Vega', role: 'driver', price: 1500 },
      marta: { id: 'marta', name: 'Marta Solis', role: 'gunman', price: 2000 },
      ghost: { id: 'ghost', name: 'Ghost', role: 'hacker', price: 2500 },
    };
const RESPECT_RANKS = CFG.RESPECT_RANKS || ['Nobody', 'Hustler', 'Dealer', 'Boss', 'Kingpin', 'Legend'];
const RESPECT_THRESHOLDS = [0, 1000, 5000, 12000, 22000, 35000];
const TOTAL_RESPECT = typeof CFG.RESPECT_TOTAL === 'number' ? CFG.RESPECT_TOTAL : 35000;
const SELL_BACK_RATE = typeof CFG.SELL_BACK_RATE === 'number' ? CFG.SELL_BACK_RATE : 0.6;
const SELL_UPGRADE_RATE = typeof CFG.SELL_UPGRADE_RATE === 'number' ? CFG.SELL_UPGRADE_RATE : 0.4;
const UPGRADE_MAX_TIER = typeof CFG.UPGRADE_MAX_TIER === 'number' ? CFG.UPGRADE_MAX_TIER : 3;
const UPGRADE_PARTS = Array.isArray(CFG.UPGRADE_PARTS) && CFG.UPGRADE_PARTS.length
  ? CFG.UPGRADE_PARTS
  : ['engine', 'armor', 'handling'];
const WATER_Z_MIN = typeof CFG.WATER_Z_MIN === 'number' ? CFG.WATER_Z_MIN : 165;

// Fallback landmark layout (used only if config.js exposes no landmarks).
const FALLBACK_LANDMARKS = [
  { name: 'Feria Market', x: 0, z: -80 },
  { name: 'Old Pier', x: -160, z: 170 },
  { name: 'Marina Docks', x: -120, z: 175 },
  { name: 'Brasa Garage', x: 80, z: -40 },
  { name: 'Rook Arcade', x: 40, z: 80 },
  { name: 'Coral Room Casino', x: 120, z: 120 },
  { name: 'Coast Tunnel', x: -80, z: -160 },
  { name: 'Motel Vela', x: -40, z: 40 },
  { name: 'Underpass', x: 0, z: 150 },
  { name: 'Old Church', x: -120, z: -120 },
  { name: 'Plaza Tower', x: 0, z: 0 },
  { name: 'Beachfront', x: 160, z: 170 },
];

export const WEAPONS = [
  { id: 'fists', name: 'Fists', key: '1', price: 0 },
  { id: 'pistol', name: 'Pistol', key: '2', price: 0 },
  { id: 'smg', name: 'SMG', key: '3', price: 2500 },
  { id: 'shotgun', name: 'Shotgun', key: '4', price: 3500 },
  { id: 'rifle', name: 'Rifle', key: '5', price: 5000 },
  { id: 'sniper', name: 'Sniper', key: '6', price: 6000 },
  { id: 'rpg', name: 'RPG', key: '7', price: 9000 },
];

// Clothes shop: 4 outfits (feature 10). Buying one sets state.outfit; the
// player module recolours the player mesh from state.outfit.
export const OUTFITS = [
  { id: 'street', name: 'Street', price: 200, colors: ['#2b6cb0', '#1a202c'] },
  { id: 'beach', name: 'Beach', price: 350, colors: ['#ed8936', '#f6e05e'] },
  { id: 'suit', name: 'Sharp Suit', price: 800, colors: ['#1a202c', '#ffffff'] },
  { id: 'club', name: 'Nightclub', price: 1200, colors: ['#9b2c2c', '#d53f8c'] },
];

const CREW_BENEFIT = {
  rico: 'Driver — getaway cars +4% top speed per level.',
  marta: 'Gunman — fights beside you in missions.',
  ghost: 'Hacker — +15s per level on timed missions.',
};
const CREW_ROLE_LABEL = { driver: 'Driver', gunman: 'Gunman', hacker: 'Hacker' };
const MOTORBIKE_PRICE = typeof CFG.MOTORBIKE_PRICE === 'number' ? CFG.MOTORBIKE_PRICE : 1500;
const BOAT_PRICE = typeof CFG.BOAT_PRICE === 'number' ? CFG.BOAT_PRICE : 4500;

const OVERLAY_IDS = ['shop', 'garage', 'crew', 'weapons', 'casino', 'help', 'map'];

let els = {};
let minimapCtx = null;
let mapCtx = null;
let wheelVisible = false;
let messageTimer = null;
let listenersAttached = false;
let boundCtx = null;
let trackerOverride = null; // set via setMissionTracker(...)
let messageQueue = [];
let elementsBuilt = false;

// --- small helpers -----------------------------------------------------------

function fmtCash(n) {
  const v = Math.floor(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

function el(tag, text, style) {
  const d = document.createElement(tag);
  if (text != null) d.textContent = text;
  if (style) d.style.cssText = style;
  return d;
}

function elButton(label, disabled, onClick) {
  const b = el('button', label, 'padding:6px 12px;border-radius:6px;border:1px solid #555;background:#2d3748;color:#fff;cursor:pointer;font:13px sans-serif;');
  b.disabled = !!disabled;
  if (disabled) b.style.opacity = '0.45';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function keyIsDown(ctx, code) {
  if (!ctx || !ctx.input) return false;
  const inp = ctx.input;
  if (typeof inp.isDown === 'function') { try { return !!inp.isDown(code); } catch (e) { return false; } }
  if (inp.keys instanceof Set) return inp.keys.has(code);
  if (Array.isArray(inp.keys)) return inp.keys.includes(code);
  if (inp.keys && typeof inp.keys === 'object') return !!inp.keys[code];
  return false;
}

function getPlayerPos(ctx) {
  const s = (ctx && ctx.state) || {};
  if (Array.isArray(s.playerPos)) return { x: s.playerPos[0] || 0, y: s.playerPos[1] || 0, z: s.playerPos[2] || 0 };
  if (s.playerPos && typeof s.playerPos.x === 'number') return { x: s.playerPos.x, y: s.playerPos.y || 0, z: s.playerPos.z };
  if (ctx && ctx.player && ctx.player.position) return { x: ctx.player.position.x || 0, y: ctx.player.position.y || 0, z: ctx.player.position.z || 0 };
  return { x: 0, y: 0, z: 0 };
}

function playerHeading(ctx) {
  if (ctx && typeof ctx.playerHeading === 'number') return ctx.playerHeading;
  const s = (ctx && ctx.state) || {};
  if (typeof s.playerHeading === 'number') return s.playerHeading;
  return 0;
}

// Resolve a landmark key ('market', 'feriaMarket', ...) to {x, z}.
function landmarkPos(key) {
  if (!key) return null;
  const canon = LANDMARK_ALIASES[key] || key;
  if (LANDMARKS) {
    const v = LANDMARKS[canon] || LANDMARKS[key];
    if (Array.isArray(v)) return { x: v[0], z: v[1] };
    if (v && typeof v.x === 'number') return { x: v.x, z: v.z || 0 };
    if (v && v.position) return { x: v.position.x || 0, z: v.position.z || 0 };
  }
  const fb = FALLBACK_LANDMARKS.find((l) => l.name.toLowerCase().includes(String(key).toLowerCase().slice(0, 4)));
  return fb ? { x: fb.x, z: fb.z } : null;
}

function landmarkList() {
  if (LANDMARKS) {
    return Object.keys(LANDMARKS).map((k) => {
      const p = landmarkPos(k);
      const name = (LANDMARK_NAMES && LANDMARK_NAMES[k]) || k;
      return { name, x: p ? p.x : 0, z: p ? p.z : 0 };
    });
  }
  return FALLBACK_LANDMARKS.slice();
}

function isNearGarage(ctx) {
  const p = getPlayerPos(ctx);
  const g = landmarkPos('brasaGarage') || landmarkPos('garage');
  if (!g) return false;
  return Math.hypot(p.x - g.x, p.z - g.z) < 25;
}

// --- economy bridge (ctx.economy first, direct state fallback) ---------------

function econ(ctx) {
  return (ctx && ctx.economy) || null;
}

function cashOf(ctx) {
  const e = econ(ctx);
  if (e && typeof e.cash === 'number') return e.cash;
  const s = (ctx && ctx.state) || {};
  return typeof s.cash === 'number' ? s.cash : 0;
}

function spend(ctx, n) {
  const e = econ(ctx);
  if (e && typeof e.spend === 'function') {
    try { return !!e.spend(n); } catch (err) { /* fall through to state */ }
  }
  const s = (ctx && ctx.state) || {};
  const amount = Math.floor(Number(n) || 0);
  if (amount <= 0) return true;
  if ((s.cash || 0) < amount) return false;
  s.cash -= amount;
  return true;
}

function addCash(ctx, n) {
  const e = econ(ctx);
  if (e && typeof e.addCash === 'function') {
    try { e.addCash(n); return; } catch (err) { /* fall through */ }
  }
  const s = (ctx && ctx.state) || {};
  s.cash = Math.max(0, (s.cash || 0) + Math.floor(Number(n) || 0));
}

function ensureGarage(ctx) {
  const s = (ctx && ctx.state) || {};
  if (!s.garage || typeof s.garage !== 'object') s.garage = { owned: {} };
  if (!s.garage.owned || typeof s.garage.owned !== 'object') s.garage.owned = {};
  if (!Array.isArray(s.carsOwned)) s.carsOwned = [];
  return s.garage;
}

function isCarOwned(ctx, carId) {
  const s = (ctx && ctx.state) || {};
  if (Array.isArray(s.carsOwned) && s.carsOwned.includes(carId)) return true;
  if (s.garage && s.garage.owned && s.garage.owned[carId]) return true;
  const e = econ(ctx);
  if (e && typeof e.carStats === 'function') {
    try { const st = e.carStats(carId); if (st && st.owned) return true; } catch (err) { /* ignore */ }
  }
  return false;
}

function carUpgrades(ctx, carId) {
  const s = (ctx && ctx.state) || {};
  const owned = s.garage && s.garage.owned && s.garage.owned[carId];
  if (owned && owned.upgrades) return { ...owned.upgrades, spent: owned.spent || 0 };
  const e = econ(ctx);
  if (e && typeof e.carStats === 'function') {
    try {
      const st = e.carStats(carId);
      if (st && st.upgrades) return { ...st.upgrades, spent: st.spent || 0 };
    } catch (err) { /* ignore */ }
  }
  return { engine: 0, armor: 0, handling: 0, spent: 0 };
}

function upgradeCostFor(ctx, car, part, tier) {
  const e = econ(ctx);
  if (e && typeof e.upgradeCost === 'function') {
    try {
      const c = e.upgradeCost(car.id, part, tier);
      if (typeof c === 'number' && c > 0) return c;
    } catch (err) { /* fall through */ }
  }
  // Fallback: 8% of base price per tier.
  return Math.round(car.price * 0.08 * tier);
}

function buyCar(ctx, car) {
  const e = econ(ctx);
  if (e && typeof e.buyCar === 'function') {
    let ok = false;
    try { ok = !!e.buyCar(car.id); } catch (err) { ok = false; }
    if (ok || isCarOwned(ctx, car.id)) return true;
    // Economy did not know this car id — fall through to the direct buy.
  }
  if (isCarOwned(ctx, car.id)) return true;
  if (cashOf(ctx) < car.price) { showMessage('Not enough cash.'); return false; }
  if (!spend(ctx, car.price)) { showMessage('Not enough cash.'); return false; }
  const g = ensureGarage(ctx);
  g.owned[car.id] = { upgrades: { engine: 0, armor: 0, handling: 0 }, spent: 0 };
  const s = ctx.state || {};
  if (!s.carsOwned.includes(car.id)) s.carsOwned.push(car.id);
  if (!g.current) g.current = car.id;
  showMessage('You bought the ' + car.name + ' for ' + fmtCash(car.price) + '.');
  return true;
}

function upgradeCar(ctx, car, part) {
  const before = carUpgrades(ctx, car.id);
  const beforeTier = before[part] || 0;
  const e = econ(ctx);
  if (e && typeof e.upgradeCar === 'function') {
    let ok = false;
    try { ok = !!e.upgradeCar(car.id, part); } catch (err) { ok = false; }
    if (ok) return true;
    const after = carUpgrades(ctx, car.id);
    // Economy may have applied it without returning true.
    if ((after[part] || 0) > beforeTier) return true;
  }
  const up = carUpgrades(ctx, car.id);
  const tier = (up[part] || 0) + 1;
  if (tier > UPGRADE_MAX_TIER) return false;
  const cost = upgradeCostFor(ctx, car, part, tier);
  if (cashOf(ctx) < cost) { showMessage('Not enough cash.'); return false; }
  if (!spend(ctx, cost)) { showMessage('Not enough cash.'); return false; }
  const g = ensureGarage(ctx);
  if (!g.owned[car.id]) g.owned[car.id] = { upgrades: { engine: 0, armor: 0, handling: 0 }, spent: 0 };
  g.owned[car.id].upgrades[part] = tier;
  g.owned[car.id].spent = (g.owned[car.id].spent || 0) + cost;
  showMessage(car.name + ' ' + part + ' upgraded to tier ' + tier + '.');
  return true;
}

function sellCar(ctx, car) {
  const e = econ(ctx);
  if (e && typeof e.sellCar === 'function') {
    let value = 0;
    try { value = e.sellCar(car.id) || 0; } catch (err) { value = 0; }
    if (value > 0 || !isCarOwned(ctx, car.id)) return value;
    // Economy returned 0 but the car is still owned — fall through.
  }
  if (!isCarOwned(ctx, car.id)) return 0;
  const up = carUpgrades(ctx, car.id);
  const value = Math.round(car.price * SELL_BACK_RATE + (up.spent || 0) * SELL_UPGRADE_RATE);
  const s = ctx.state || {};
  const g = ensureGarage(ctx);
  delete g.owned[car.id];
  s.carsOwned = (s.carsOwned || []).filter((id) => id !== car.id);
  if (g.current === car.id) {
    const left = Object.keys(g.owned);
    g.current = left.length ? left[0] : null;
  }
  if (s.currentCar === car.id) s.currentCar = g.current;
  addCash(ctx, value);
  showMessage('Sold the ' + car.name + ' for ' + fmtCash(value) + '.');
  return value;
}

function crewLevel(ctx, id) {
  const e = econ(ctx);
  if (e && typeof e.crewLevel === 'function') {
    try { return e.crewLevel(id); } catch (err) { /* fall through */ }
  }
  const s = (ctx && ctx.state) || {};
  const m = s.crew && s.crew[id];
  return m && m.hired ? (m.level || 0) : -1;
}

function hireCrew(ctx, member) {
  const e = econ(ctx);
  if (e && typeof e.hireCrew === 'function') {
    let ok = false;
    try { ok = !!e.hireCrew(member.id); } catch (err) { ok = false; }
    if (ok || crewLevel(ctx, member.id) >= 0) return true;
  }
  if (crewLevel(ctx, member.id) >= 0) return true;
  const price = member.price != null ? member.price : member.cost;
  if (cashOf(ctx) < price) { showMessage('Not enough cash.'); return false; }
  if (!spend(ctx, price)) { showMessage('Not enough cash.'); return false; }
  const s = (ctx && ctx.state) || {};
  if (!s.crew || typeof s.crew !== 'object') s.crew = {};
  s.crew[member.id] = { hired: true, level: 0 };
  showMessage(member.name + ' joined your crew! (level 0 — pay again to level up)');
  return true;
}

function levelCrew(ctx, member) {
  const e = econ(ctx);
  if (e && typeof e.levelCrew === 'function') {
    let ok = false;
    try { ok = !!e.levelCrew(member.id); } catch (err) { ok = false; }
    if (ok) return true;
  }
  const level = crewLevel(ctx, member.id);
  if (level < 0 || level >= UPGRADE_MAX_TIER) return false;
  const price = member.price != null ? member.price : member.cost;
  if (cashOf(ctx) < price) { showMessage('Not enough cash.'); return false; }
  if (!spend(ctx, price)) { showMessage('Not enough cash.'); return false; }
  const s = (ctx && ctx.state) || {};
  if (s.crew && s.crew[member.id]) s.crew[member.id].level = level + 1;
  showMessage(member.name + ' reached level ' + (level + 1) + '!');
  return true;
}

// --- DOM ---------------------------------------------------------------------

function overlayBase(id, title) {
  const wrap = el('div', null, 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:none;align-items:center;justify-content:center;');
  wrap.id = 'overlay-' + id;
  const panel = el('div', null, 'background:#1a202c;color:#fff;border:1px solid #4a5568;border-radius:10px;padding:18px 20px;width:min(560px,92vw);max-height:82vh;overflow-y:auto;font:14px sans-serif;');
  const head = el('div', null, 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;');
  head.appendChild(el('h2', title, 'margin:0;font-size:18px;color:#ffd34d;'));
  const close = elButton('✕ Close (Esc)', false, () => closeOverlays());
  head.appendChild(close);
  panel.appendChild(head);
  const body = el('div');
  body.id = 'overlay-' + id + '-body';
  panel.appendChild(body);
  wrap.appendChild(panel);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeOverlays(); });
  document.body.appendChild(wrap);
  return { wrap, body };
}

function ensureElements() {
  if (typeof document === 'undefined') return;
  if (elementsBuilt) return;
  elementsBuilt = true;

  const mk = (id, style) => {
    let n = document.getElementById(id);
    if (!n) { n = el('div', null, style); n.id = id; document.body.appendChild(n); }
    return n;
  };

  // Top-left HUD bar.
  els.bar = mk('hud-bar', 'position:fixed;top:10px;left:10px;z-index:8000;background:rgba(0,0,0,0.55);color:#fff;padding:8px 12px;border-radius:8px;font:14px sans-serif;line-height:1.5;pointer-events:none;');
  els.cash = el('div', '$500');
  els.cash.id = 'hud-cash';
  els.wanted = el('div', '☆☆☆☆☆');
  els.wanted.id = 'hud-wanted';
  els.wanted.style.color = '#ffd34d';
  els.respect = el('div', 'Nobody');
  els.respect.id = 'hud-respect';
  els.respect.style.fontSize = '12px';
  els.respect.style.color = '#a0aec0';
  const hpWrap = el('div', null, 'position:relative;width:170px;height:10px;background:#2d3748;border-radius:5px;margin-top:4px;overflow:hidden;');
  els.healthBar = el('div', null, 'height:100%;width:100%;background:#48bb78;');
  // NOTE: do NOT give this fill the id 'hud-health' — index.html already
  // has a static #hud-health (bottom-left), whose CSS (#hud-health {
  // position:absolute; left:16px; bottom:16px; width:220px; }) would
  // absolutely position this fill over the whole top-left bar as a solid
  // green 274x127 block, hiding the cash/stars/respect text.
  hpWrap.appendChild(els.healthBar);
  els.bar.appendChild(els.cash);
  els.bar.appendChild(els.wanted);
  els.bar.appendChild(els.respect);
  els.bar.appendChild(hpWrap);

  // Mission tracker (top-center).
  els.mission = mk('hud-mission', 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:8000;background:rgba(0,0,0,0.55);color:#ffe9a8;padding:8px 14px;border-radius:8px;font:13px sans-serif;pointer-events:none;max-width:46vw;text-align:center;');

  // Minimap (top-right).
  let mm = document.getElementById('minimap');
  if (!mm) {
    mm = document.createElement('canvas');
    mm.id = 'minimap';
    mm.width = 180;
    mm.height = 180;
    mm.style.cssText = 'position:fixed;top:10px;right:10px;z-index:8000;border:2px solid rgba(255,255,255,0.35);border-radius:8px;background:#101820;';
    document.body.appendChild(mm);
  }
  minimapCtx = mm.getContext('2d');

  // Toast message (center-top, below the tracker).
  els.message = mk('hud-message', 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9001;background:rgba(0,0,0,0.78);color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;display:none;pointer-events:none;max-width:70vw;text-align:center;');

  // Interaction prompt (shared with interiors.js — same id, reused).
  let prompt = document.getElementById('hud-prompt');
  if (!prompt) {
    prompt = el('div', null, 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#ffe9a8;padding:6px 12px;border-radius:6px;font:13px sans-serif;z-index:8001;pointer-events:none;display:none;');
    prompt.id = 'hud-prompt';
    document.body.appendChild(prompt);
  }
  els.prompt = prompt;

  // Weapon wheel.
  let wheel = document.getElementById('weapon-wheel');
  if (!wheel) {
    wheel = el('div', null, 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9002;background:rgba(0,0,0,0.75);border:1px solid #4a5568;border-radius:12px;padding:14px;display:none;');
    wheel.id = 'weapon-wheel';
    document.body.appendChild(wheel);
  }
  els.wheel = wheel;

  // Overlays.
  els.shop = overlayBase('shop', 'Shop — Ammu-Nation & Clothes');
  els.garage = overlayBase('garage', 'Brasa Garage');
  els.crew = overlayBase('crew', 'Crew');
  els.weapons = overlayBase('weapons', 'Weapons');
  els.casino = overlayBase('casino', 'Coral Room Casino');
  els.help = overlayBase('help', 'ISLA BRASA — Controls');
  const mapOv = overlayBase('map', 'Isla Brasa — Map (M to close)');
  els.map = mapOv;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.id = 'map-canvas';
  mapCanvas.width = 520;
  mapCanvas.height = 520;
  mapCanvas.style.cssText = 'width:100%;border-radius:8px;background:#101820;';
  mapOv.body.appendChild(mapCanvas);
  mapCtx = mapCanvas.getContext('2d');
  const mapHint = el('div', 'Gold dots are landmarks. White arrow is you. Yellow diamond is the mission target.', 'margin-top:8px;font-size:12px;color:#a0aec0;');
  mapOv.body.appendChild(mapHint);
}

// --- messages ------------------------------------------------------------------

function showMessage(text) {
  if (typeof document === 'undefined') { console.log('[hud]', text); return; }
  ensureElements();
  messageQueue.push(String(text == null ? '' : text));
  if (!els.message || els.message.style.display === 'block') return;
  const next = messageQueue.shift();
  if (next == null) return;
  els.message.textContent = next;
  els.message.style.display = 'block';
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    if (!els.message) return;
    if (messageQueue.length) {
      els.message.textContent = messageQueue.shift();
      messageTimer = setTimeout(() => {
        if (els.message) els.message.style.display = 'none';
        if (messageQueue.length) showMessage(messageQueue.shift());
      }, 3500);
    } else {
      els.message.style.display = 'none';
    }
  }, 3500);
}

// --- mission tracker -----------------------------------------------------------

function getMission(ctx) {
  if (trackerOverride) return trackerOverride;
  const s = (ctx && ctx.state) || {};
  const cm = s.currentMission;
  if (!cm) return null;
  if (typeof cm === 'object') return cm;
  if (typeof cm === 'number' && MISSIONS[cm]) {
    const m = MISSIONS[cm];
    return { name: m.name, stepLabel: m.brief || '', timeLeft: null };
  }
  return null;
}

function missionTarget(ctx, m) {
  if (!m) return null;
  const t = m.target || m.marker || m.destination;
  if (t && typeof t.x === 'number') return { x: t.x, z: t.z || 0 };
  const key = m.at || m.landmark || m.landmarkKey || m.stepAt;
  if (key) return landmarkPos(key);
  return null;
}

// --- minimap / map -------------------------------------------------------------

function drawMap(c, size, ctx, detailed) {
  if (!c) return;
  const s = (ctx && ctx.state) || {};
  const half = WORLD_SIZE / 2;
  const toPx = (v) => ((v + half) / WORLD_SIZE) * size;
  c.clearRect(0, 0, size, size);
  c.fillStyle = '#101820';
  c.fillRect(0, 0, size, size);

  // Water strip (south edge, z >= WATER_Z_MIN).
  c.fillStyle = '#1d4e6b';
  c.fillRect(0, toPx(WATER_Z_MIN), size, size - toPx(WATER_Z_MIN));

  // Road grid.
  c.strokeStyle = '#3a4552';
  c.lineWidth = detailed ? 5 : 2;
  for (const line of ROAD_LINES) {
    c.beginPath(); c.moveTo(toPx(line), 0); c.lineTo(toPx(line), size); c.stroke();
    c.beginPath(); c.moveTo(0, toPx(line)); c.lineTo(size, toPx(line)); c.stroke();
  }

  // Landmarks.
  const lm = landmarkList();
  for (const l of lm) {
    const x = toPx(l.x);
    const y = toPx(l.z);
    c.fillStyle = '#ffd34d';
    c.beginPath();
    c.arc(x, y, detailed ? 5 : 3, 0, Math.PI * 2);
    c.fill();
    if (detailed) {
      c.fillStyle = '#e2e8f0';
      c.font = '11px sans-serif';
      c.fillText(l.name, x + 7, y + 4);
    }
  }

  // Mission target diamond.
  const m = getMission(ctx);
  const tgt = missionTarget(ctx, m);
  if (tgt) {
    const x = toPx(tgt.x);
    const y = toPx(tgt.z);
    c.fillStyle = '#ffff00';
    c.beginPath();
    c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 7); c.lineTo(x - 6, y);
    c.closePath();
    c.fill();
  }

  // Player arrow (rotated by heading).
  const p = getPlayerPos(ctx);
  const px = toPx(p.x);
  const py = toPx(p.z);
  const heading = playerHeading(ctx);
  c.save();
  c.translate(px, py);
  c.rotate(heading);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(-5, 6);
  c.closePath();
  c.fill();
  c.restore();

  if (detailed) {
    c.fillStyle = '#a0aec0';
    c.font = '11px sans-serif';
    c.fillText('N ↑', 8, 14);
  }
}

function drawMinimap(ctx) {
  if (minimapCtx) drawMap(minimapCtx, 180, ctx, false);
  if (mapCtx && els.map && els.map.wrap.style.display === 'flex') {
    drawMap(mapCtx, 520, ctx, true);
  }
}

// --- weapon wheel --------------------------------------------------------------

function selectWeapon(ctx, id) {
  const w = WEAPONS.find((x) => x.id === id);
  if (!w) return false;
  const s = (ctx && ctx.state) || {};
  const owned = Array.isArray(s.weaponsOwned) ? s.weaponsOwned : [];
  if (!owned.includes(id) && id !== 'fists') {
    showMessage(w.name + ' not owned — buy it in the shop (G).');
    return false;
  }
  s.currentWeapon = id;
  if (ctx && ctx.audio && typeof ctx.audio.playSfx === 'function') {
    try { ctx.audio.playSfx('click'); } catch (e) { /* ignore */ }
  }
  renderWheel(ctx);
  return true;
}

function renderWheel(ctx) {
  if (!els.wheel) return;
  const s = (ctx && ctx.state) || {};
  const owned = Array.isArray(s.weaponsOwned) ? s.weaponsOwned : ['fists', 'pistol'];
  const current = s.currentWeapon || 'fists';
  els.wheel.innerHTML = '';
  const title = el('div', 'WEAPON WHEEL — hold Q, press 1–7 or click', 'color:#ffd34d;font-size:12px;margin-bottom:8px;text-align:center;');
  els.wheel.appendChild(title);
  for (const w of WEAPONS) {
    const has = owned.includes(w.id);
    const row = el('div', null, 'display:flex;justify-content:space-between;gap:18px;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:14px;' + (current === w.id ? 'background:#2b6cb0;color:#fff;' : 'color:#e2e8f0;') + (has ? '' : 'opacity:0.45;'));
    row.appendChild(el('span', w.key + ' · ' + w.name));
    row.appendChild(el('span', has ? (current === w.id ? '● equipped' : 'owned') : fmtCash(w.price)));
    row.addEventListener('click', () => selectWeapon(ctx, w.id));
    els.wheel.appendChild(row);
  }
}

function showWeaponWheel(ctx) {
  if (wheelVisible) return;
  ensureElements();
  wheelVisible = true;
  renderWheel(ctx);
  if (els.wheel) els.wheel.style.display = 'block';
}

function hideWeaponWheel() {
  if (!wheelVisible) return;
  wheelVisible = false;
  if (els.wheel) els.wheel.style.display = 'none';
}

// --- overlays ------------------------------------------------------------------

function closeOverlays() {
  for (const id of OVERLAY_IDS) {
    if (els[id] && els[id].wrap) els[id].wrap.style.display = 'none';
  }
  if (boundCtx && boundCtx.state) boundCtx.state.uiOpen = false;
  hideWeaponWheel();
}

function openOverlay(id) {
  ensureElements();
  const target = els[id];
  if (!target) return;
  const wasOpen = target.wrap.style.display === 'flex';
  closeOverlays();
  if (wasOpen) return; // toggle off
  if (id === 'shop') renderShop(boundCtx);
  else if (id === 'garage') renderGarage(boundCtx);
  else if (id === 'crew') renderCrew(boundCtx);
  else if (id === 'weapons') renderWeapons(boundCtx);
  else if (id === 'casino') renderCasino(boundCtx);
  else if (id === 'help') renderHelp(boundCtx);
  else if (id === 'map') drawMap(mapCtx, 520, boundCtx, true);
  target.wrap.style.display = 'flex';
  if (boundCtx && boundCtx.state) boundCtx.state.uiOpen = true;
}

function sectionTitle(text) {
  return el('h3', text, 'margin:14px 0 6px;font-size:14px;color:#ffd34d;');
}

function rowLine(leftText, rightEl) {
  const row = el('div', null, 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #2d3748;');
  row.appendChild(el('div', leftText, 'flex:1;'));
  if (rightEl) row.appendChild(rightEl);
  return row;
}

function renderWeapons(ctx) {
  ensureElements();
  const body = els.weapons.body;
  body.innerHTML = '';
  const s = (ctx && ctx.state) || {};
  const owned = Array.isArray(s.weaponsOwned) ? s.weaponsOwned : [];
  body.appendChild(el('div', 'Cash: ' + fmtCash(cashOf(ctx)), 'color:#a0aec0;margin-bottom:6px;'));
  for (const w of WEAPONS) {
    const has = owned.includes(w.id);
    const isCurrent = s.currentWeapon === w.id;
    const btn = elButton(
      has ? (isCurrent ? 'Equipped' : 'Equip') : 'Buy ' + fmtCash(w.price),
      (has && isCurrent) || (!has && cashOf(ctx) < w.price),
      () => {
        if (has) { selectWeapon(ctx, w.id); renderWeapons(ctx); return; }
        if (!spend(ctx, w.price)) { showMessage('Not enough cash.'); return; }
        if (!s.weaponsOwned) s.weaponsOwned = [];
        s.weaponsOwned.push(w.id);
        showMessage('Bought the ' + w.name + '! Press Q to open the weapon wheel.');
        renderWeapons(ctx);
      }
    );
    body.appendChild(rowLine(w.name + (has ? ' — owned' : ''), btn));
  }
  const note = el('div', 'Sniper and RPG are bought here, then used from the weapon wheel (hold Q).', 'margin-top:10px;font-size:12px;color:#a0aec0;');
  body.appendChild(note);
}

function renderShop(ctx) {
  ensureElements();
  const body = els.shop.body;
  body.innerHTML = '';
  const s = (ctx && ctx.state) || {};
  body.appendChild(el('div', 'Cash: ' + fmtCash(cashOf(ctx)), 'color:#a0aec0;margin-bottom:6px;'));

  body.appendChild(sectionTitle('Weapons'));
  const ownedW = Array.isArray(s.weaponsOwned) ? s.weaponsOwned : [];
  for (const w of WEAPONS) {
    const has = ownedW.includes(w.id);
    const btn = elButton(
      has ? 'Owned' : 'Buy ' + fmtCash(w.price),
      has || cashOf(ctx) < w.price,
      () => {
        if (!spend(ctx, w.price)) { showMessage('Not enough cash.'); return; }
        if (!s.weaponsOwned) s.weaponsOwned = [];
        s.weaponsOwned.push(w.id);
        showMessage('Bought the ' + w.name + '! Press Q to open the weapon wheel.');
        renderShop(ctx);
      }
    );
    body.appendChild(rowLine(w.name, btn));
  }

  body.appendChild(sectionTitle('Outfits — changes how you look'));
  const ownedO = Array.isArray(s.outfitsOwned) ? s.outfitsOwned : ['default'];
  for (const o of OUTFITS) {
    const has = ownedO.includes(o.id);
    const wearing = (s.outfit || s.currentOutfit || 'default') === o.id;
    const btn = elButton(
      wearing ? 'Wearing' : (has ? 'Wear' : 'Buy ' + fmtCash(o.price)),
      wearing || (!has && cashOf(ctx) < o.price),
      () => {
        if (!has) {
          if (!spend(ctx, o.price)) { showMessage('Not enough cash.'); return; }
          if (!s.outfitsOwned) s.outfitsOwned = [];
          s.outfitsOwned.push(o.id);
        }
        s.outfit = o.id;
        s.currentOutfit = o.id;
        showMessage('You are wearing ' + o.name + '.');
        renderShop(ctx);
      }
    );
    const swatch = el('span', '■ ', 'color:' + o.colors[0] + ';');
    const label = el('span', o.name);
    const left = el('div');
    left.appendChild(swatch);
    left.appendChild(label);
    const row = el('div', null, 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #2d3748;');
    row.appendChild(left);
    row.appendChild(btn);
    body.appendChild(row);
  }

  body.appendChild(sectionTitle('Vehicles'));
  const vehicles = [
    { id: 'motorbike', name: 'Motorbike — fast & nimble', price: MOTORBIKE_PRICE, flag: 'motorbikeOwned' },
    { id: 'boat', name: 'Boat — drives on the water by the pier', price: BOAT_PRICE, flag: 'boatOwned' },
  ];
  for (const v of vehicles) {
    const has = !!s[v.flag];
    const btn = elButton(
      has ? 'Owned' : 'Buy ' + fmtCash(v.price),
      has || cashOf(ctx) < v.price,
      () => {
        if (!spend(ctx, v.price)) { showMessage('Not enough cash.'); return; }
        s[v.flag] = true;
        showMessage('You bought the ' + v.name.split(' — ')[0] + '!');
        renderShop(ctx);
      }
    );
    body.appendChild(rowLine(v.name, btn));
  }
}

function renderGarage(ctx) {
  ensureElements();
  const body = els.garage.body;
  body.innerHTML = '';
  const s = (ctx && ctx.state) || {};
  const g = ensureGarage(ctx);
  body.appendChild(el('div', 'Cash: ' + fmtCash(cashOf(ctx)), 'color:#a0aec0;margin-bottom:6px;'));
  body.appendChild(el('div', 'Buy cars, upgrade them (3 tiers each), or sell for 60% of the price + 40% of upgrades spent.', 'font-size:12px;color:#a0aec0;margin-bottom:8px;'));

  for (const car of GARAGE_CARS) {
    const owned = isCarOwned(ctx, car.id);
    const up = owned ? carUpgrades(ctx, car.id) : null;
    const isCurrent = (g.current === car.id) || (s.currentCar === car.id);
    const head = el('div', null, 'margin-top:12px;');
    head.appendChild(el('strong', car.name + ' — ' + fmtCash(car.price), 'color:#fff;'));
    head.appendChild(el('span', '  Top speed ' + car.topSpeed + ' · Accel ' + car.accel + ' · Handling ' + car.handling, 'color:#a0aec0;font-size:12px;'));
    body.appendChild(head);

    const actions = el('div', null, 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;');
    if (!owned) {
      actions.appendChild(elButton('Buy', cashOf(ctx) < car.price, () => {
        if (buyCar(ctx, car)) renderGarage(ctx);
      }));
    } else {
      actions.appendChild(elButton(isCurrent ? 'Current car' : 'Select', isCurrent, () => {
        g.current = car.id;
        s.currentCar = car.id;
        showMessage('Current car: ' + car.name + '.');
        renderGarage(ctx);
      }));
      const value = Math.round(car.price * SELL_BACK_RATE + (up.spent || 0) * SELL_UPGRADE_RATE);
      actions.appendChild(elButton('Sell ' + fmtCash(value), false, () => {
        sellCar(ctx, car);
        renderGarage(ctx);
      }));
    }
    body.appendChild(actions);

    if (owned && up) {
      for (const part of UPGRADE_PARTS) {
        const tier = up[part] || 0;
        const next = tier + 1;
        const cost = next <= UPGRADE_MAX_TIER ? upgradeCostFor(ctx, car, part, next) : null;
        const pips = '●'.repeat(tier) + '○'.repeat(UPGRADE_MAX_TIER - tier);
        const btn = elButton(
          next <= UPGRADE_MAX_TIER ? 'Upgrade — ' + fmtCash(cost) : 'MAX',
          next > UPGRADE_MAX_TIER || cashOf(ctx) < (cost || 0),
          () => { if (upgradeCar(ctx, car, part)) renderGarage(ctx); }
        );
        body.appendChild(rowLine(part + ' ' + pips, btn));
      }
    }
  }
}

function renderCrew(ctx) {
  ensureElements();
  const body = els.crew.body;
  body.innerHTML = '';
  body.appendChild(el('div', 'Cash: ' + fmtCash(cashOf(ctx)), 'color:#a0aec0;margin-bottom:6px;'));
  body.appendChild(el('div', 'Hire crew to help in missions. Each member levels 0–3; pay their hire price again to level up.', 'font-size:12px;color:#a0aec0;margin-bottom:8px;'));

  for (const key of Object.keys(CREW_DEFS)) {
    const def = CREW_DEFS[key];
    const member = {
      id: def.id || key,
      name: def.name || key,
      role: def.role || key,
      price: def.price != null ? def.price : (def.cost != null ? def.cost : 0),
    };
    const level = crewLevel(ctx, member.id);
    const hired = level >= 0;
    const maxed = hired && level >= UPGRADE_MAX_TIER;
    const head = el('div', null, 'margin-top:12px;');
    head.appendChild(el('strong', member.name + ' — ' + (CREW_ROLE_LABEL[member.role] || member.role), 'color:#fff;'));
    body.appendChild(head);
    body.appendChild(el('div', CREW_BENEFIT[member.id] || '', 'font-size:12px;color:#a0aec0;'));
    const pips = hired ? ('Level ' + level + ' ' + '●'.repeat(level) + '○'.repeat(UPGRADE_MAX_TIER - level)) : 'Not hired';
    const btn = hired
      ? elButton(maxed ? 'MAX LEVEL' : 'Level up — ' + fmtCash(member.price), maxed || cashOf(ctx) < member.price, () => {
          if (levelCrew(ctx, member)) renderCrew(ctx);
        })
      : elButton('Hire — ' + fmtCash(member.price), cashOf(ctx) < member.price, () => {
          if (hireCrew(ctx, member)) renderCrew(ctx);
        });
    body.appendChild(rowLine(pips, btn));
  }
}

function renderCasino(ctx) {
  ensureElements();
  const body = els.casino.body;
  body.innerHTML = '';
  body.appendChild(el('div', 'Cash: ' + fmtCash(cashOf(ctx)), 'color:#a0aec0;margin-bottom:6px;'));
  body.appendChild(el('div', 'Bet your cash on slots, blackjack or roulette. Step inside the casino (green door) for the full tables.', 'font-size:12px;color:#a0aec0;margin-bottom:8px;'));
  const games = [
    { id: 'slots', name: 'Slots' },
    { id: 'blackjack', name: 'Blackjack' },
    { id: 'roulette', name: 'Roulette' },
  ];
  for (const game of games) {
    const btn = elButton('Play ' + game.name, false, () => {
      const cz = ctx && ctx.casino;
      if (cz && typeof cz.play === 'function') { try { cz.play(game.id); return; } catch (e) { /* fall through */ } }
      if (cz && typeof cz.open === 'function') { try { cz.open(); return; } catch (e) { /* fall through */ } }
      showMessage('Slots are not ready yet — step inside the casino.');
    });
    body.appendChild(rowLine(game.name, btn));
  }
}

function renderHelp(ctx) {
  ensureElements();
  const body = els.help.body;
  body.innerHTML = '';
  const lines = [
    ['W A S D', 'Move / drive'],
    ['Shift', 'Run'],
    ['E', 'Enter / exit car · enter interior at a green door'],
    ['F', 'Interact (talk, pick up, sleep at the safehouse bed)'],
    ['Q (hold)', 'Weapon wheel — press 1–7 or click to equip'],
    ['G', 'Shop (garage menu near Brasa Garage)'],
    ['C', 'Crew panel'],
    ['R', 'Start a race near a start marker · cycle radio while driving'],
    ['M', 'Map'],
    ['N', 'Mute / unmute audio'],
    ['V', 'Toggle rain'],
    ['H', 'This help'],
    ['Esc', 'Close menus'],
    ['Mouse click', 'Shoot (when armed)'],
  ];
  for (const [key, desc] of lines) {
    body.appendChild(rowLine('<b>' + key + '</b> — ' + desc, null));
  }
  body.appendChild(el('div', 'Missions pay out when finished. Wanted stars rise when you cause trouble — at 3 stars the police set roadblocks and CONDOR-1 takes off. Sleep at the safehouse to save.', 'margin-top:10px;font-size:12px;color:#a0aec0;'));
}

// --- key handling --------------------------------------------------------------

function attachListeners() {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.repeat) return;
    if (e.code === 'KeyQ') showWeaponWheel(boundCtx);
    else if (e.code === 'KeyG') {
      const anyOpen = OVERLAY_IDS.some((id) => els[id] && els[id].wrap.style.display === 'flex');
      if (anyOpen) closeOverlays();
      else if (isNearGarage(boundCtx)) openOverlay('garage');
      else openOverlay('shop');
    } else if (e.code === 'KeyC') {
      const crewOpen = els.crew && els.crew.wrap.style.display === 'flex';
      if (crewOpen) closeOverlays();
      else openOverlay('crew');
    } else if (e.code === 'KeyH') {
      if (els.help && els.help.wrap.style.display === 'flex') closeOverlays();
      else openOverlay('help');
    } else if (e.code === 'KeyM') {
      const mapOpen = els.map && els.map.wrap.style.display === 'flex';
      if (mapOpen) closeOverlays();
      else openOverlay('map');
    } else if (e.code === 'Escape') { closeOverlays(); hideWeaponWheel(); }
    else if (wheelVisible && /^Digit[1-7]$/.test(e.code)) {
      const w = WEAPONS[Number(e.code.slice(5)) - 1];
      if (w) selectWeapon(boundCtx, w.id);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyQ') hideWeaponWheel();
  });
}

// --- init / update ---------------------------------------------------------------

export function init(ctx) {
  boundCtx = ctx || null;
  if (typeof document !== 'undefined') ensureElements();
  attachListeners();

  const api = {
    showMessage(text) { showMessage(text); },
    setMissionTracker(name, stepLabel, distance, timeLeft) {
      if (name && typeof name === 'object') {
        trackerOverride = name;
      } else {
        trackerOverride = { name, stepLabel, distance, timeLeft };
      }
    },
    clearMissionTracker() { trackerOverride = null; },
    updateMinimap() { drawMinimap(boundCtx); },
    openOverlay(id) { openOverlay(id); },
    closeOverlays() { closeOverlays(); },
    toggleShop() {
      const anyOpen = OVERLAY_IDS.some((id) => els[id] && els[id].wrap.style.display === 'flex');
      if (anyOpen) closeOverlays();
      else if (isNearGarage(boundCtx)) openOverlay('garage');
      else openOverlay('shop');
    },
    showWeaponWheel() { showWeaponWheel(boundCtx); },
    hideWeaponWheel() { hideWeaponWheel(); },
    selectWeapon(id) { return selectWeapon(boundCtx, id); },
    renderShop() { renderShop(boundCtx); },
    renderGarage() { renderGarage(boundCtx); },
    renderCrew() { renderCrew(boundCtx); },
    renderWeapons() { renderWeapons(boundCtx); },
    renderCasino() { renderCasino(boundCtx); },
    renderHelp() { renderHelp(boundCtx); },
    get wheelVisible() { return wheelVisible; },
  };

  if (ctx) ctx.hud = api;
  return api;
}

export function update(dt, ctx) {
  if (typeof document === 'undefined') return;
  ensureElements();
  const c = ctx || boundCtx;
  const s = c && c.state ? c.state : {};

  // Poll ctx.input as a fallback for the Q-hold wheel (own listeners are primary).
  if (keyIsDown(c, 'KeyQ')) showWeaponWheel(c);

  // Cash.
  if (els.cash) {
    const cash = cashOf(c);
    els.cash.textContent = fmtCash(cash);
  }
  // Wanted stars (0–5).
  if (els.wanted) {
    const wanted = Math.max(0, Math.min(5, Math.floor(s.wanted || 0)));
    els.wanted.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    els.wanted.style.color = wanted >= 3 ? '#ff5252' : '#ffd34d';
  }
  // Respect rank + progress to next rank.
  if (els.respect) {
    const respect = Math.max(0, Math.min(TOTAL_RESPECT, Math.floor(s.respect || 0)));
    let rank = 0;
    for (let i = 0; i < RESPECT_THRESHOLDS.length; i++) if (respect >= RESPECT_THRESHOLDS[i]) rank = i;
    const cur = RESPECT_THRESHOLDS[rank];
    const next = rank + 1 < RESPECT_THRESHOLDS.length ? RESPECT_THRESHOLDS[rank + 1] : TOTAL_RESPECT;
    const pct = next > cur ? Math.round(((respect - cur) / (next - cur)) * 100) : 100;
    els.respect.textContent = RESPECT_RANKS[rank] + ' · Respect ' + respect.toLocaleString('en-US') + '/' + TOTAL_RESPECT.toLocaleString('en-US') + ' (' + pct + '%) · Payout +' + (rank * 5) + '%';
  }
  // Mission tracker.
  if (els.mission) {
    const m = getMission(c);
    if (!m) {
      els.mission.textContent = 'No active mission — find work at the Plaza or Garage.';
    } else {
      const name = m.name || m.title || 'Mission';
      const step = m.stepLabel || m.step || m.label || '';
      let dist = '';
      if (typeof m.distance === 'number') dist = ' · ' + Math.round(m.distance) + 'm';
      else {
        const target = missionTarget(c, m);
        if (target) {
          const p = getPlayerPos(c);
          dist = ' · ' + Math.round(Math.hypot(target.x - p.x, target.z - p.z)) + 'm';
        }
      }
      let timer = '';
      const tl = m.timeLeft != null ? m.timeLeft : (m.timer != null ? m.timer : m.time);
      if (typeof tl === 'number') {
        const t = Math.max(0, Math.ceil(tl));
        timer = ' · ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      }
      els.mission.textContent = name + (step ? ' — ' + step : '') + dist + timer;
    }
  }
  // Health bar (+ armor note).
  if (els.healthBar) {
    const health = typeof s.health === 'number' ? s.health : 100;
    const max = typeof s.maxHealth === 'number' ? s.maxHealth : 100;
    const pct = Math.max(0, Math.min(100, (health / max) * 100));
    els.healthBar.style.width = pct + '%';
    els.healthBar.style.background = pct > 50 ? '#48bb78' : pct > 25 ? '#ed8936' : '#e53e3e';
  }
  // Minimap (redraw every frame; cheap 2D canvas).
  drawMinimap(c);
}

export default { init, update, WEAPONS, OUTFITS };
