// properties.js — ISLA BRASA 3D (round 7): buyable properties.
// Safehouse $5,000 (+$100/day), shop $12,000 (+$300/day),
// nightclub $25,000 (+$800/day). Income accrues daily: whenever state.day
// ticks up, every owned property pays its daily income at once.
// Buy by pressing F at the property's for-sale beacon, or from code via
// ctx.properties.buy(id) (the shop overlay calls this too).
// Contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config, THREE }.

import * as THREE from 'three';
import { LANDMARKS, PROPERTIES as CONFIG_PROPERTIES } from './config.js';

// Which landmark each property sits next to (short name -> config key).
const SPOTS = {
  safehouse: 'motelVela',
  shop: 'feriaMarket',
  nightclub: 'coralCasino',
};

// Used only if a landmark key is missing from config.js.
const SPOT_FALLBACK = {
  safehouse: [-40, 40],
  shop: [0, -80],
  nightclub: [120, 120],
};

// Offsets from the landmark centre so the beacon stands on open ground.
const OFFSETS = {
  safehouse: [8, 0],
  shop: [8, 8],
  nightclub: [-8, 8],
};

function spotPos(id) {
  const key = SPOTS[id] || id;
  const raw = (LANDMARKS && LANDMARKS[key]) || SPOT_FALLBACK[id] || [0, 0];
  const off = OFFSETS[id] || [0, 0];
  if (Array.isArray(raw)) return new THREE.Vector3(raw[0] + off[0], 0, raw[1] + off[1]);
  if (raw && raw.position) return new THREE.Vector3((raw.position.x || 0) + off[0], 0, (raw.position.z || 0) + off[1]);
  if (raw && typeof raw.x === 'number') return new THREE.Vector3(raw.x + off[0], 0, (raw.z || 0) + off[1]);
  return new THREE.Vector3(off[0], 0, off[1]);
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

function cashOf(ctx) {
  if (ctx.economy && typeof ctx.economy.cash === 'number') return ctx.economy.cash;
  if (ctx.state) return ctx.state.cash || 0;
  return 0;
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
  console.log('[properties]', msg);
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

function defFor(id) {
  const fromConfig = CONFIG_PROPERTIES && CONFIG_PROPERTIES[id];
  const fallback = {
    safehouse: { id: 'safehouse', name: 'Vela Safehouse', price: 5000, income: 100 },
    shop: { id: 'shop', name: 'Feria Shop', price: 12000, income: 300 },
    nightclub: { id: 'nightclub', name: 'Coral Nightclub', price: 25000, income: 800 },
  }[id];
  if (!fromConfig && !fallback) return null;
  return {
    id,
    name: (fromConfig && fromConfig.name) || (fallback && fallback.name) || id,
    price: (fromConfig && fromConfig.price) || (fallback && fallback.price) || 0,
    income: (fromConfig && fromConfig.income) || (fallback && fallback.income) || 0,
    color: { safehouse: 0x2ecc71, shop: 0x3498db, nightclub: 0xe84393 }[id] || 0xffffff,
  };
}

const DEFS = ['safehouse', 'shop', 'nightclub'].map(defFor).filter(Boolean);

let S = null;

export function init(ctx) {
  S = {
    ctx,
    owned: [],
    markers: [], // { def, pos, beacon }
    lastDay: (ctx.state && typeof ctx.state.day === 'number') ? ctx.state.day : 0,
    fWasDown: false,
    clock: 0,
  };

  // Restore owned properties from a loaded save.
  if (ctx.state && Array.isArray(ctx.state.propertiesOwned)) {
    S.owned = ctx.state.propertiesOwned.slice();
  }

  for (const def of DEFS) {
    const pos = spotPos(def.id);
    let beacon = null;
    if (ctx.scene) {
      beacon = new THREE.Group();
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 24, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      pillar.position.y = 12;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.6, 24),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.0, 0.15),
        new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.55 })
      );
      sign.position.y = 3.4;
      beacon.add(pillar, ring, sign);
      beacon.position.copy(pos);
      beacon.userData.sign = sign;
      // Hide the for-sale beacon straight away for properties already owned.
      beacon.visible = !S.owned.includes(def.id);
      ctx.scene.add(beacon);
    }
    S.markers.push({ def, pos, beacon });
  }

  const api = {
    owned: S.owned,
    list: DEFS,
    buy(id) { return buyProperty(ctx, id); },
    dailyIncome() { return incomePerDay(); },
  };
  ctx.properties = api;
  return api;
}

function incomePerDay() {
  if (!S) return 0;
  let total = 0;
  for (const id of S.owned) {
    const def = DEFS.find((d) => d.id === id);
    if (def) total += def.income;
  }
  return total;
}

function buyProperty(ctx, id) {
  if (!S) return false;
  const def = DEFS.find((d) => d.id === id);
  if (!def) { toast(ctx, 'No such property: ' + id); return false; }
  if (S.owned.includes(id)) { toast(ctx, 'You already own the ' + def.name + '.'); return false; }
  const cash = cashOf(ctx);
  if (cash < def.price) {
    toast(ctx, 'Not enough cash for the ' + def.name + ' ($' + def.price.toLocaleString() + ' — you have $' + cash.toLocaleString() + ').');
    return false;
  }
  shiftCash(ctx, -def.price);
  S.owned.push(id);
  if (ctx.state) {
    ctx.state.propertiesOwned = S.owned.slice();
    if (typeof ctx.save === 'function') { try { ctx.save(); } catch (e) { /* best-effort */ } }
    else if (typeof ctx.saveGame === 'function') { try { ctx.saveGame(); } catch (e) { /* best-effort */ } }
  }
  const marker = S.markers.find((m) => m.def.id === id);
  if (marker && marker.beacon) marker.beacon.visible = false;
  toast(ctx, 'You bought the ' + def.name + ' for $' + def.price.toLocaleString() + '! It earns $' + def.income + '/day.');
  return true;
}

export function update(dt, ctx) {
  if (!S) return;
  S.clock += dt;
  const p = playerPosition(ctx);

  // --- daily income when the day counter moves forward ---
  const day = (ctx.state && typeof ctx.state.day === 'number') ? ctx.state.day : S.lastDay;
  if (day > S.lastDay) {
    const days = day - S.lastDay;
    S.lastDay = day;
    const pay = incomePerDay() * days;
    if (pay > 0) {
      if (ctx.economy && typeof ctx.economy.creditIncome === 'function') {
        ctx.economy.creditIncome(pay, 'Property income (' + days + ' day' + (days > 1 ? 's' : '') + ')');
      } else {
        shiftCash(ctx, pay);
        toast(ctx, 'Property income: +$' + pay.toLocaleString() + ' (' + days + ' day' + (days > 1 ? 's' : '') + ').');
      }
    }
  } else if (day < S.lastDay) {
    S.lastDay = day; // day counter reset (loaded save) — pay nothing
  }

  // --- bob + spin the for-sale signs ---
  for (const m of S.markers) {
    if (m.beacon && m.beacon.visible && m.beacon.userData.sign) {
      m.beacon.userData.sign.position.y = 3.4 + Math.sin(S.clock * 2 + m.pos.x) * 0.15;
      m.beacon.userData.sign.rotation.y += dt * 0.8;
    }
  }

  // --- F buys the property whose beacon the player stands at ---
  const fDown = keyIsDown(ctx, 'KeyF');
  const fPressed = fDown && !S.fWasDown;
  S.fWasDown = fDown;
  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;

  let near = null;
  if (!overlayOpen && !inPlane && !inside) {
    for (const m of S.markers) {
      if (!S.owned.includes(m.def.id) && p.distanceTo(m.pos) < 5) { near = m; break; }
    }
  }
  if (fPressed && near) buyProperty(ctx, near.def.id);

  if (near) {
    setPrompt('Press F — Buy ' + near.def.name + ' ($' + near.def.price.toLocaleString() + ', earns $' + near.def.income + '/day)');
  }
}

export default { init, update };
