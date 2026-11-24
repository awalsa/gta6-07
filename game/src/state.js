// ISLA BRASA 3D — player state and save/load.
//
// The state object is the single source of truth for cash, respect, wanted
// level, health, inventory and progress. Every system module reads and writes
// it through the ctx main.js hands out, so a change in one module is visible
// to the rest on the next frame.
//
// ONLY the keys listed in DEFAULT_STATE survive a reload: loadGame() restores
// exactly those keys. Anything a module needs to persist MUST be declared
// here — that is the round-6 bug this file fixes: completedMissions was
// missing from DEFAULT_STATE, so finished missions vanished on reload. It is
// declared here now, and loadGame restores it.
//
// Runtime-only flags (uiOpen, inPlane, insideInterior, nightFactor, ...) are
// declared too, so modules can read them before any other module has set
// them; they simply reset to these defaults on load.

import { SAVE_KEY, START_CASH, PLAYER_MAX_HEALTH } from './config.js';

// Fresh-game defaults. A new player starts with $500, a pistol and a sedan.
export const DEFAULT_STATE = {
  cash: START_CASH,
  respect: 0,
  wanted: 0,
  health: PLAYER_MAX_HEALTH,
  armor: 0,
  weaponsOwned: ['fists', 'pistol'],
  currentWeapon: 'fists',
  carsOwned: ['sedan'],
  currentCar: null,
  // Garage ledger owned by the economy module:
  // { owned: { [carId]: { upgrades: { engine, armor, handling }, spent } } }
  garage: { owned: {} },
  garageOwned: [],
  crew: {},
  missionsCompleted: [],
  // The missions module records finished mission ids here. It MUST be in
  // DEFAULT_STATE or loadGame() drops it and mission progress is lost on
  // reload (the round-6 bug). Both completion lists are kept so older saves
  // and the missions module agree.
  completedMissions: [],
  currentMission: 0,
  day: 1,
  timeOfDay: 0.3,
  raining: false,
  outfitsOwned: ['default'],
  // Currently worn outfit id ('default' = the starting clothes).
  outfit: 'default',
  currentOutfit: 'default',
  propertiesOwned: [],
  orbsCollected: 0,
  kills: 0,
  // Runtime flags, reset to these defaults on load.
  uiOpen: false,
  inPlane: false,
  insideInterior: null,
  isNight: false,
  nightFactor: 0,
  playerHeading: 0,
  playerPos: [0, 0, 10],
  // Combat signals (combat.js writes, pedestrians.js reads): the most recent
  // gunshot { x, y, z, t } and whether the player is attacking right now.
  // Declared here so readers see false/null instead of undefined before the
  // first shot is fired.
  lastGunshot: null,
  playerAttacking: false,
  playerFiring: false,
};

export const state = { ...DEFAULT_STATE };

// Deep-copy the mutable fields so DEFAULT_STATE is never mutated through state.
state.weaponsOwned = [...DEFAULT_STATE.weaponsOwned];
state.carsOwned = [...DEFAULT_STATE.carsOwned];
state.garage = { owned: { ...DEFAULT_STATE.garage.owned } };
state.garageOwned = [...DEFAULT_STATE.garageOwned];
state.crew = { ...DEFAULT_STATE.crew };
state.missionsCompleted = [...DEFAULT_STATE.missionsCompleted];
state.completedMissions = [...DEFAULT_STATE.completedMissions];
state.outfitsOwned = [...DEFAULT_STATE.outfitsOwned];
state.propertiesOwned = [...DEFAULT_STATE.propertiesOwned];
state.playerPos = [...DEFAULT_STATE.playerPos];

// Write the current state to localStorage. Never throws: a failed save
// (private mode, full storage) must not crash the game loop.
export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Load a saved game into state. Returns true when a save was found and
// applied, false when there is no save or it is unreadable (the game then
// keeps its fresh defaults).
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;
    for (const key of Object.keys(DEFAULT_STATE)) {
      if (saved[key] !== undefined) state[key] = saved[key];
    }
    // Keep array/object fields as fresh copies so later edits stay local.
    if (Array.isArray(state.weaponsOwned)) state.weaponsOwned = [...state.weaponsOwned];
    if (Array.isArray(state.carsOwned)) state.carsOwned = [...state.carsOwned];
    if (Array.isArray(state.garageOwned)) state.garageOwned = [...state.garageOwned];
    if (Array.isArray(state.missionsCompleted)) state.missionsCompleted = [...state.missionsCompleted];
    if (Array.isArray(state.completedMissions)) state.completedMissions = [...state.completedMissions];
    if (Array.isArray(state.outfitsOwned)) state.outfitsOwned = [...state.outfitsOwned];
    if (Array.isArray(state.propertiesOwned)) state.propertiesOwned = [...state.propertiesOwned];
    if (Array.isArray(state.playerPos)) state.playerPos = [...state.playerPos];
    if (state.crew && typeof state.crew === 'object') state.crew = { ...state.crew };
    if (state.garage && typeof state.garage === 'object') {
      state.garage = { ...state.garage };
      if (state.garage.owned && typeof state.garage.owned === 'object') {
        state.garage.owned = { ...state.garage.owned };
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Reset state to fresh-game defaults (used by a "New Game" action).
export function resetGame() {
  for (const key of Object.keys(DEFAULT_STATE)) {
    const value = DEFAULT_STATE[key];
    if (Array.isArray(value)) state[key] = [...value];
    else if (value && typeof value === 'object') state[key] = JSON.parse(JSON.stringify(value));
    else state[key] = value;
  }
  return state;
}

export default state;
