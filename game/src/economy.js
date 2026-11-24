// economy.js — ISLA BRASA 3D (round 7): cash, respect ranks, crew, garage.
//
// Every dollar in the game flows through this module. Cash, respect, crew
// membership and the garage ledger all live on ctx.state so save/load sees
// them; other modules spend and earn only through the API returned by
// init(), so the HUD and the save file can never drift apart.
//
// Contract: exports init(ctx) and update(dt, ctx); init attaches the API
// as ctx.economy. ctx = { scene, camera, renderer, state, input, config,
// THREE } — but this module only needs ctx.state plus optional ctx.save /
// ctx.hud.showMessage, so it stays usable even before the scene exists.

import { START_CASH } from './config.js';

// Respect ladder. Legend needs 35,000 total respect; each rank above
// Nobody adds +5% to mission payouts (Nobody x1.00 ... Legend x1.25).
export const RESPECT_RANKS = ['Nobody', 'Hustler', 'Dealer', 'Boss', 'Kingpin', 'Legend'];
export const RESPECT_THRESHOLDS = [0, 1000, 5000, 12000, 22000, 35000];
export const TOTAL_RESPECT = 35000;
export const PAYOUT_BONUS_PER_RANK = 0.05;

// Crew for hire. The hire price is paid once to hire and again per
// level-up; levels run 0-3. The HUD/UI worker drives hiring through the
// hireCrew / levelCrew hooks below.
export const CREW = {
  rico: {
    id: 'rico', name: 'Rico Vega', role: 'Driver', cost: 1500,
    desc: 'Driver — faster getaway car in missions.',
  },
  marta: {
    id: 'marta', name: 'Marta Solis', role: 'Gunman', cost: 2000,
    desc: 'Gunman — fights beside you in missions.',
  },
  ghost: {
    id: 'ghost', name: 'Ghost', role: 'Hacker', cost: 2500,
    desc: 'Hacker — +15s per level on timed missions.',
  },
};
export const CREW_MAX_LEVEL = 3;

// Garage stock (the vehicles worker owns the garage UI and driving; this
// module only owns the ledger and the money). Four cars, $2,800-$12,000.
export const CARS = {
  sedan: { type: 'sedan', name: 'Brasa Sedan', price: 2800, speed: 22, handling: 0.7, desc: 'Cheap, cheerful, everywhere.' },
  coupe: { type: 'coupe', name: 'Vela Coupe', price: 5000, speed: 27, handling: 0.8, desc: 'Solid all-rounder.' },
  sport: { type: 'sport', name: 'Coral Sport', price: 8000, speed: 33, handling: 0.9, desc: 'Fast sports coupe.' },
  supercar: { type: 'supercar', name: 'Isla GT', price: 12000, speed: 40, handling: 1.0, desc: 'Top-tier supercar.' },
};
export const UPGRADE_PARTS = ['engine', 'armor', 'handling'];
export const UPGRADE_MAX_TIER = 3;
// Each upgrade tier costs a growing fraction of the car's base price.
const UPGRADE_FRACTIONS = [0.25, 0.45, 0.7];

const FALLBACK_CASH = 500;

function stateOf(ctx) {
  if (!ctx) return {};
  if (!ctx.state || typeof ctx.state !== 'object') ctx.state = {};
  return ctx.state;
}

// Fill in any missing economy fields (fresh game or an older save).
function ensureState(ctx) {
  const s = stateOf(ctx);
  if (typeof s.cash !== 'number' || Number.isNaN(s.cash)) {
    s.cash = typeof START_CASH === 'number' ? START_CASH : FALLBACK_CASH;
  }
  if (typeof s.respect !== 'number' || Number.isNaN(s.respect)) s.respect = 0;
  if (!s.crew || typeof s.crew !== 'object') s.crew = {};
  if (!s.garage || typeof s.garage !== 'object') s.garage = {};
  if (!s.garage.owned || typeof s.garage.owned !== 'object') s.garage.owned = {};
  if (!('current' in s.garage)) s.garage.current = null;
  if (!Array.isArray(s.weaponsOwned)) s.weaponsOwned = ['fists', 'pistol'];
  return s;
}

function saveSoon(ctx) {
  try {
    if (ctx && typeof ctx.save === 'function') ctx.save();
    else if (ctx && typeof ctx.saveGame === 'function') ctx.saveGame();
  } catch (e) { /* saving is best-effort; gameplay must never break on it */ }
}

function tell(ctx, msg) {
  if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
    ctx.hud.showMessage(msg);
  }
}

function rankFor(respect) {
  let rank = 0;
  for (let i = 0; i < RESPECT_THRESHOLDS.length; i++) {
    if (respect >= RESPECT_THRESHOLDS[i]) rank = i;
  }
  return rank;
}

function fmt(n) {
  return '$' + Math.floor(Number(n) || 0).toLocaleString('en-US');
}

// Price of taking `part` on `type` up to `tier` (1-3).
export function upgradeCost(type, part, tier) {
  const car = CARS[type];
  if (!car || !UPGRADE_PARTS.includes(part)) return 0;
  if (tier < 1 || tier > UPGRADE_MAX_TIER) return 0;
  return Math.round(car.price * UPGRADE_FRACTIONS[tier - 1]);
}

export function init(ctx) {
  ensureState(ctx);

  const api = {
    get cash() { return ensureState(ctx).cash; },
    set cash(v) { ensureState(ctx).cash = Math.max(0, Math.floor(Number(v) || 0)); },
    get respect() { return ensureState(ctx).respect; },
    set respect(v) { ensureState(ctx).respect = Math.max(0, Math.floor(Number(v) || 0)); },

    addCash(n) {
      const s = ensureState(ctx);
      s.cash = Math.max(0, s.cash + Math.floor(Number(n) || 0));
      saveSoon(ctx);
      return s.cash;
    },

    // Returns true when the player could afford `n` and it was deducted.
    spend(n) {
      const s = ensureState(ctx);
      const amount = Math.floor(Number(n) || 0);
      if (amount <= 0) return true;
      if (s.cash < amount) return false;
      s.cash -= amount;
      saveSoon(ctx);
      return true;
    },

    // Income credit (property rent, job pay, orb pickups): adds cash and,
    // when a label is given, tells the player where it came from.
    creditIncome(amount, label) {
      const s = ensureState(ctx);
      const n = Math.floor(Number(amount) || 0);
      if (n <= 0) return s.cash;
      s.cash += n;
      saveSoon(ctx);
      if (label) tell(ctx, `${label}: +${fmt(n)}`);
      return s.cash;
    },

    addRespect(n) {
      const s = ensureState(ctx);
      const before = rankFor(s.respect);
      s.respect = Math.min(TOTAL_RESPECT, Math.max(0, s.respect + Math.floor(Number(n) || 0)));
      const after = rankFor(s.respect);
      saveSoon(ctx);
      if (after > before) {
        tell(ctx, `Respect up! You are now ${RESPECT_RANKS[after]}. Payouts +${after * 5}%.`);
      }
      return s.respect;
    },

    rank() { return rankFor(ensureState(ctx).respect); },
    rankName() { return RESPECT_RANKS[rankFor(ensureState(ctx).respect)]; },
    // +5% payout per rank: Nobody x1.00 ... Legend x1.25.
    payoutMultiplier() { return 1 + rankFor(ensureState(ctx).respect) * PAYOUT_BONUS_PER_RANK; },

    // --- Crew -----------------------------------------------------------
    hireCrew(id) {
      const def = CREW[id];
      if (!def) return false;
      const s = ensureState(ctx);
      if (s.crew[id] && s.crew[id].hired) return false;
      if (!api.spend(def.cost)) return false;
      s.crew[id] = { hired: true, level: 0 };
      saveSoon(ctx);
      tell(ctx, `${def.name} joined your crew! (level 0 — pay again to level up)`);
      return true;
    },

    levelCrew(id) {
      const def = CREW[id];
      if (!def) return false;
      const s = ensureState(ctx);
      const member = s.crew[id];
      if (!member || !member.hired) return false;
      if (member.level >= CREW_MAX_LEVEL) return false;
      if (!api.spend(def.cost)) return false;
      member.level += 1;
      saveSoon(ctx);
      tell(ctx, `${def.name} reached level ${member.level}!`);
      return true;
    },

    crewLevel(id) {
      const s = ensureState(ctx);
      const member = s.crew[id];
      return member && member.hired ? member.level : -1; // -1 = not hired
    },
    isCrewHired(id) {
      const s = ensureState(ctx);
      return !!(s.crew[id] && s.crew[id].hired);
    },
    // Ghost: +15s per level on timed missions.
    hackerBonusSeconds() {
      const s = ensureState(ctx);
      const g = s.crew.ghost;
      return g && g.hired ? g.level * 15 : 0;
    },
    // Rico: getaway car speed bonus, +4% per level.
    getawaySpeedMultiplier() {
      const s = ensureState(ctx);
      const r = s.crew.rico;
      return r && r.hired ? 1 + r.level * 0.04 : 1;
    },
    // Marta: fights beside you when hired.
    hasGunman() {
      const s = ensureState(ctx);
      return !!(s.crew.marta && s.crew.marta.hired);
    },

    // --- Garage ---------------------------------------------------------
    buyCar(type) {
      const car = CARS[type];
      if (!car) return false;
      const s = ensureState(ctx);
      if (s.garage.owned[type]) return false;
      if (!api.spend(car.price)) return false;
      s.garage.owned[type] = { upgrades: { engine: 0, armor: 0, handling: 0 }, spent: 0 };
      if (!s.garage.current) s.garage.current = type;
      saveSoon(ctx);
      tell(ctx, `You bought the ${car.name} for ${fmt(car.price)}.`);
      return true;
    },

    upgradeCar(type, part) {
      const car = CARS[type];
      if (!car || !UPGRADE_PARTS.includes(part)) return false;
      const s = ensureState(ctx);
      const owned = s.garage.owned[type];
      if (!owned) return false;
      const tier = owned.upgrades[part] + 1;
      if (tier > UPGRADE_MAX_TIER) return false;
      const cost = upgradeCost(type, part, tier);
      if (!api.spend(cost)) return false;
      owned.upgrades[part] = tier;
      owned.spent += cost;
      saveSoon(ctx);
      return true;
    },

    // Sell for 60% of base price + 40% of what upgrades cost (design spec).
    sellCar(type) {
      const car = CARS[type];
      if (!car) return 0;
      const s = ensureState(ctx);
      const owned = s.garage.owned[type];
      if (!owned) return 0;
      const value = Math.round(car.price * 0.6 + owned.spent * 0.4);
      delete s.garage.owned[type];
      if (s.garage.current === type) {
        const left = Object.keys(s.garage.owned);
        s.garage.current = left.length ? left[0] : null;
      }
      api.addCash(value);
      tell(ctx, `Sold the ${car.name} for ${fmt(value)}.`);
      return value;
    },

    carStats(type) {
      const car = CARS[type];
      if (!car) return null;
      const s = ensureState(ctx);
      const owned = s.garage.owned[type];
      const up = owned ? owned.upgrades : { engine: 0, armor: 0, handling: 0 };
      return {
        ...car,
        owned: !!owned,
        upgrades: { ...up },
        spent: owned ? owned.spent : 0,
        // Engine tier +8% top speed; handling tier +0.05 grip; armor +25 HP.
        speed: car.speed * (1 + up.engine * 0.08),
        handling: Math.min(1.2, car.handling + up.handling * 0.05),
        armor: up.armor * 25,
      };
    },
  };

  if (ctx) ctx.economy = api;
  return api;
}

export function update(dt, ctx) {
  // Cash and respect only move through the API above, so there is no
  // per-frame work. Re-validate state in case another module swapped it.
  if (ctx) ensureState(ctx);
}

export default { init, update, RESPECT_RANKS, RESPECT_THRESHOLDS, TOTAL_RESPECT, CREW, CARS };
