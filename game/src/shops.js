// shops.js — ISLA BRASA 3D (round 7): clothes shop + weapon shop.
//
// Clothes: 4 outfits the player can buy and wear — buying recolours the
// player mesh (shirt / pants) so the outfit is visible in the world.
// Weapons: Sniper $6,000 and RPG $9,000 — once bought they join
// state.weaponsOwned and show up in the weapon wheel (hold Q).
// Also sells the motorbike ($1,500) and the boat ($4,500).
// Open the shop overlay (DOM id overlay-shop) with G near the market
// stall, or with F right at the stall door.
// Contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config, THREE }.

import * as THREE from 'three';
import { LANDMARKS, SNIPER_PRICE, RPG_PRICE, MOTORBIKE_PRICE, BOAT_PRICE } from './config.js';

const MARKET_KEY = 'feriaMarket';
const MARKET_FALLBACK = [0, -80];

function marketPos() {
  const raw = (LANDMARKS && LANDMARKS[MARKET_KEY]) || MARKET_FALLBACK;
  if (Array.isArray(raw)) return new THREE.Vector3(raw[0], 0, raw[1]);
  if (raw && raw.position) return new THREE.Vector3(raw.position.x || 0, 0, raw.position.z || 0);
  if (raw && typeof raw.x === 'number') return new THREE.Vector3(raw.x, 0, raw.z || 0);
  return new THREE.Vector3(0, 0, 0);
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
  console.log('[shops]', msg);
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

function saveNow(ctx) {
  try {
    if (typeof ctx.save === 'function') ctx.save();
    else if (typeof ctx.saveGame === 'function') ctx.saveGame();
  } catch (e) { /* best-effort */ }
}

// 4 buyable outfits. `colors` are the shirt / pants hex values applied to
// the player mesh. 'default' is the starter outfit and is always owned.
const OUTFITS = [
  { name: 'default', label: 'Default', price: 0, colors: { shirt: 0x2e86c1, pants: 0x2c3e50 } },
  { name: 'street', label: 'Street', price: 300, colors: { shirt: 0xe74c3c, pants: 0x34495e } },
  { name: 'suit', label: 'Suit', price: 800, colors: { shirt: 0x1a1a1a, pants: 0x111111 } },
  { name: 'beach', label: 'Beach', price: 400, colors: { shirt: 0x1abc9c, pants: 0xe8d27a } },
  { name: 'biker', label: 'Biker', price: 1200, colors: { shirt: 0x111111, pants: 0x2f3542 } },
];

const WEAPONS = [
  { name: 'sniper', label: 'Sniper', price: typeof SNIPER_PRICE === 'number' ? SNIPER_PRICE : 6000, damage: 90, range: 120 },
  { name: 'rpg', label: 'RPG', price: typeof RPG_PRICE === 'number' ? RPG_PRICE : 9000, damage: 150, range: 80 },
];

const VEHICLES = [
  { name: 'motorbike', label: 'Motorbike', price: typeof MOTORBIKE_PRICE === 'number' ? MOTORBIKE_PRICE : 1500, desc: 'Fast, nimble — top speed 38' },
  { name: 'boat', label: 'Brasa Boat', price: typeof BOAT_PRICE === 'number' ? BOAT_PRICE : 4500, desc: 'Drives on the water by the pier/marina' },
];

let S = null;

export function init(ctx) {
  const stallPos = marketPos().add(new THREE.Vector3(8, 0, 0));
  S = {
    ctx,
    open: false,
    tab: 'clothes',
    stallPos,
    overlay: null,
    balanceEl: null,
    listEl: null,
    ownedOutfits: ['default'],
    ownedWeapons: [],
    gWasDown: false,
    fWasDown: false,
    escWasDown: false,
  };

  // Restore owned items from a loaded save.
  if (ctx.state) {
    if (Array.isArray(ctx.state.outfitsOwned)) S.ownedOutfits = ctx.state.outfitsOwned.slice();
    if (Array.isArray(ctx.state.weaponsOwned)) S.ownedWeapons = ctx.state.weaponsOwned.slice();
    if (!ctx.state.weaponsOwned) ctx.state.weaponsOwned = S.ownedWeapons;
    if (!ctx.state.outfitsOwned) ctx.state.outfitsOwned = S.ownedOutfits;
  }

  if (ctx.scene) {
    // Shop front at the market: awning, glowing sign, stall counter.
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xe84393 })
    );
    awning.position.set(stallPos.x, 3.1, stallPos.z);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 1.0, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xe84393, emissive: 0xe84393, emissiveIntensity: 0.6 })
    );
    sign.position.set(stallPos.x, 3.9, stallPos.z);
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 1.1, 2),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
    );
    counter.position.set(stallPos.x, 0.55, stallPos.z);
    ctx.scene.add(awning, sign, counter);
  }

  if (typeof document !== 'undefined') buildOverlay(ctx);

  const api = {
    outfits: OUTFITS,
    weapons: WEAPONS,
    vehicles: VEHICLES,
    ownedOutfits: S.ownedOutfits,
    ownedWeapons: S.ownedWeapons,
    buyOutfit(name) { return buyOutfit(ctx, name); },
    buyWeapon(name) { return buyWeapon(ctx, name); },
    buyVehicle(name) { return buyVehicle(ctx, name); },
    open() { openShop(ctx); },
    close() { closeShop(ctx); },
    get isOpen() { return S.open; },
  };
  ctx.shops = api;
  return api;
}

function buildOverlay(ctx) {
  let ov = document.getElementById('overlay-shop');
  if (ov) {
    S.overlay = ov;
    S.balanceEl = ov.querySelector('#shop-balance');
    S.listEl = ov.querySelector('#shop-list');
    const closeBtn = ov.querySelector('#shop-close');
    if (closeBtn) closeBtn.onclick = () => closeShop(ctx);
    drawList(ctx);
    return;
  }

  ov = document.createElement('div');
  ov.id = 'overlay-shop';
  ov.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,10,20,0.8);z-index:10000;align-items:center;justify-content:center;font-family:sans-serif;';
  ov.innerHTML =
    '<div style="background:#14141f;border:2px solid #e84393;border-radius:12px;padding:20px 24px;width:min(520px,92vw);color:#f5f5f5;max-height:88vh;overflow:auto;">' +
    '<h2 style="margin:0 0 4px;color:#ff8fb3;">Feria Market — Shops</h2>' +
    '<div style="margin-bottom:10px;">Your cash: <b id="shop-balance" style="color:#7CFC00;">$0</b></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button data-tab="clothes" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e84393;background:#3a1a2a;color:#ffe9f2;cursor:pointer;">Clothes</button>' +
    '<button data-tab="weapons" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e84393;background:#3a1a2a;color:#ffe9f2;cursor:pointer;">Weapons</button>' +
    '<button data-tab="vehicles" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e84393;background:#3a1a2a;color:#ffe9f2;cursor:pointer;">Vehicles</button>' +
    '</div>' +
    '<div id="shop-list"></div>' +
    '<button id="shop-close" style="width:100%;margin-top:12px;padding:10px;border-radius:6px;border:none;background:#e84393;color:#fff;font-weight:bold;cursor:pointer;">Close (Esc)</button>' +
    '</div>';
  document.body.appendChild(ov);
  S.overlay = ov;
  S.balanceEl = ov.querySelector('#shop-balance');
  S.listEl = ov.querySelector('#shop-list');
  ov.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => { S.tab = btn.getAttribute('data-tab'); drawList(ctx); };
  });
  ov.querySelector('#shop-close').onclick = () => closeShop(ctx);
  drawList(ctx);
}

function refreshBalance(ctx) {
  if (S.balanceEl) S.balanceEl.textContent = '$' + cashOf(ctx).toLocaleString();
}

function rowStyle() {
  return 'display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #333;';
}

function drawList(ctx) {
  if (!S.listEl) return;
  refreshBalance(ctx);
  const cash = cashOf(ctx);
  let html = '';
  if (S.tab === 'clothes') {
    for (const o of OUTFITS) {
      const owned = S.ownedOutfits.includes(o.name);
      const worn = ctx.state && (ctx.state.outfit === o.name || ctx.state.currentOutfit === o.name);
      const swatch = '#' + o.colors.shirt.toString(16).padStart(6, '0');
      html += '<div style="' + rowStyle() + '">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:' + swatch + ';border:2px solid #fff;display:inline-block;"></span>' +
        '<span style="flex:1;"><b>' + o.label + '</b>' + (worn ? ' <span style="color:#7CFC00;">(wearing)</span>' : '') + '<br><span style="font-size:12px;color:#aaa;">$' + o.price.toLocaleString() + '</span></span>' +
        '<button data-outfit="' + o.name + '" ' + (cash < o.price && !owned ? 'disabled' : '') + ' style="padding:6px 14px;border-radius:6px;border:none;background:' + (owned ? '#2ecc71' : '#e84393') + ';color:#fff;font-weight:bold;cursor:pointer;">' + (owned ? (worn ? 'Worn' : 'Wear') : 'Buy') + '</button>' +
        '</div>';
    }
  } else if (S.tab === 'weapons') {
    for (const w of WEAPONS) {
      const owned = S.ownedWeapons.includes(w.name);
      html += '<div style="' + rowStyle() + '">' +
        '<span style="flex:1;"><b>' + w.label + '</b><br><span style="font-size:12px;color:#aaa;">Damage ' + w.damage + ' · Range ' + w.range + ' · $' + w.price.toLocaleString() + '</span></span>' +
        '<button data-weapon="' + w.name + '" ' + (owned || cash < w.price ? 'disabled' : '') + ' style="padding:6px 14px;border-radius:6px;border:none;background:' + (owned ? '#2ecc71' : '#e84393') + ';color:#fff;font-weight:bold;cursor:pointer;">' + (owned ? 'Owned' : 'Buy') + '</button>' +
        '</div>';
    }
    html += '<div style="font-size:12px;color:#aaa;margin-top:6px;">Bought weapons appear in the weapon wheel (hold Q).</div>';
  } else {
    for (const v of VEHICLES) {
      const owned = ctx.state && Array.isArray(ctx.state.carsOwned) && ctx.state.carsOwned.includes(v.name);
      html += '<div style="' + rowStyle() + '">' +
        '<span style="flex:1;"><b>' + v.label + '</b><br><span style="font-size:12px;color:#aaa;">' + v.desc + ' · $' + v.price.toLocaleString() + '</span></span>' +
        '<button data-vehicle="' + v.name + '" ' + (owned || cash < v.price ? 'disabled' : '') + ' style="padding:6px 14px;border-radius:6px;border:none;background:' + (owned ? '#2ecc71' : '#e84393') + ';color:#fff;font-weight:bold;cursor:pointer;">' + (owned ? 'Owned' : 'Buy') + '</button>' +
        '</div>';
    }
  }
  S.listEl.innerHTML = html;
  S.listEl.querySelectorAll('[data-outfit]').forEach((btn) => {
    btn.onclick = () => { buyOutfit(ctx, btn.getAttribute('data-outfit')); drawList(ctx); };
  });
  S.listEl.querySelectorAll('[data-weapon]').forEach((btn) => {
    btn.onclick = () => { buyWeapon(ctx, btn.getAttribute('data-weapon')); drawList(ctx); };
  });
  S.listEl.querySelectorAll('[data-vehicle]').forEach((btn) => {
    btn.onclick = () => { buyVehicle(ctx, btn.getAttribute('data-vehicle')); drawList(ctx); };
  });
}

function wearOutfit(ctx, name) {
  const o = OUTFITS.find((x) => x.name === name);
  if (!o) return false;
  if (ctx.player && typeof ctx.player.setOutfit === 'function') {
    try { ctx.player.setOutfit(name); } catch (e) { /* fall through to mesh recolour */ }
  }
  if (ctx.state) {
    ctx.state.outfit = name;
    ctx.state.currentOutfit = name;
  }
  // Fallback: recolour the player mesh by material name (shirt / pants).
  if (ctx.player && ctx.player.mesh) {
    ctx.player.mesh.traverse((child) => {
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const n = (m.name || '').toLowerCase();
        if (n.includes('shirt') && o.colors.shirt !== undefined) m.color.setHex(o.colors.shirt);
        if (n.includes('pants') && o.colors.pants !== undefined) m.color.setHex(o.colors.pants);
      }
    });
  }
  return true;
}

function buyOutfit(ctx, name) {
  if (!S) return false;
  const o = OUTFITS.find((x) => x.name === name);
  if (!o) { toast(ctx, 'No such outfit: ' + name); return false; }
  if (S.ownedOutfits.includes(name)) {
    wearOutfit(ctx, name);
    toast(ctx, 'Wearing the ' + o.label + ' outfit.');
    return true;
  }
  if (cashOf(ctx) < o.price) {
    toast(ctx, 'Not enough cash for the ' + o.label + ' outfit ($' + o.price + ').');
    return false;
  }
  shiftCash(ctx, -o.price);
  S.ownedOutfits.push(name);
  if (ctx.state) ctx.state.outfitsOwned = S.ownedOutfits.slice();
  wearOutfit(ctx, name);
  toast(ctx, 'Bought the ' + o.label + ' outfit for $' + o.price + ' — now wearing it.');
  return true;
}

function buyWeapon(ctx, name) {
  if (!S) return false;
  const w = WEAPONS.find((x) => x.name === name);
  if (!w) { toast(ctx, 'No such weapon: ' + name); return false; }
  if (S.ownedWeapons.includes(name)) { toast(ctx, 'You already own the ' + w.label + '.'); return false; }
  if (cashOf(ctx) < w.price) {
    toast(ctx, 'Not enough cash for the ' + w.label + ' ($' + w.price.toLocaleString() + ').');
    return false;
  }
  shiftCash(ctx, -w.price);
  S.ownedWeapons.push(name);
  if (ctx.state) {
    if (!Array.isArray(ctx.state.weaponsOwned)) ctx.state.weaponsOwned = [];
    if (!ctx.state.weaponsOwned.includes(name)) ctx.state.weaponsOwned.push(name);
  }
  toast(ctx, 'Bought the ' + w.label + ' for $' + w.price.toLocaleString() + '! Hold Q to open the weapon wheel.');
  return true;
}

function buyVehicle(ctx, name) {
  if (!S) return false;
  const v = VEHICLES.find((x) => x.name === name);
  if (!v) { toast(ctx, 'No such vehicle: ' + name); return false; }
  if (ctx.state && Array.isArray(ctx.state.carsOwned) && ctx.state.carsOwned.includes(name)) {
    toast(ctx, 'You already own the ' + v.label + '.');
    return false;
  }
  let paid = false;
  if (ctx.economy && typeof ctx.economy.spend === 'function') paid = ctx.economy.spend(v.price);
  else if (ctx.state && (ctx.state.cash || 0) >= v.price) {
    ctx.state.cash -= v.price;
    paid = true;
  }
  if (!paid) {
    toast(ctx, 'Not enough cash for the ' + v.label + ' ($' + v.price.toLocaleString() + ').');
    return false;
  }
  if (ctx.state) {
    if (!Array.isArray(ctx.state.carsOwned)) ctx.state.carsOwned = [];
    if (!ctx.state.carsOwned.includes(name)) ctx.state.carsOwned.push(name);
  }
  // Spawn it now: bike beside the player, boat at the Marina Docks (on water).
  if (ctx.cars && typeof ctx.cars.spawnCar === 'function') {
    let spawned = null;
    if (name === 'boat') spawned = ctx.cars.spawnCar('boat', -120, 178, 0);
    else {
      const p = playerPosition(ctx);
      spawned = ctx.cars.spawnCar('motorbike', p.x + 3, p.z + 3, 0);
    }
    if (spawned) spawned._owned = true;
  }
  saveNow(ctx);
  toast(ctx, 'Bought the ' + v.label + ' for $' + v.price.toLocaleString() + '! Press E near it to ride.');
  return true;
}

function openShop(ctx) {
  if (!S || S.open) return;
  if (!S.overlay) buildOverlay(ctx);
  if (!S.overlay) return;
  S.open = true;
  drawList(ctx);
  S.overlay.style.display = 'flex';
  if (ctx.state) ctx.state.uiOpen = true;
}

function closeShop(ctx) {
  if (!S || !S.open) return;
  S.open = false;
  if (S.overlay) S.overlay.style.display = 'none';
  if (ctx.state) ctx.state.uiOpen = false;
}

export function update(dt, ctx) {
  if (!S) return;
  const p = playerPosition(ctx);

  const gDown = keyIsDown(ctx, 'KeyG');
  const gPressed = gDown && !S.gWasDown;
  S.gWasDown = gDown;
  const fDown = keyIsDown(ctx, 'KeyF');
  const fPressed = fDown && !S.fWasDown;
  S.fWasDown = fDown;
  const escDown = keyIsDown(ctx, 'Escape');
  const escPressed = escDown && !S.escWasDown;
  S.escWasDown = escDown;

  if (escPressed && S.open) { closeShop(ctx); return; }

  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;
  const nearStall = p.distanceTo(S.stallPos) < 10;

  if (!S.open && !overlayOpen && !inPlane && !inside) {
    // G near the market opens the shop. F at the stall door opens it too,
    // unless the player is standing on the delivery marker (sidejobs owns F there).
    const delPos = ctx.sidejobs && ctx.sidejobs.deliveryMarkerPos;
    const onDeliveryMarker = delPos ? p.distanceTo(delPos) < 4 : false;
    if (gPressed && nearStall) openShop(ctx);
    else if (fPressed && p.distanceTo(S.stallPos) < 4 && !onDeliveryMarker) openShop(ctx);
  }

  if (!S.open && !overlayOpen && !inPlane && !inside && nearStall) {
    setPrompt('Press G — Shops (clothes & weapons) · F at the stall also works');
  }
}

export default { init, update };
