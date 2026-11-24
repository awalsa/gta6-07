// missions.js — ISLA BRASA 3D: 15 missions (12 story + 3-part heist).
//
// Contract: exports init(ctx) and update(dt, ctx); attaches ctx.missions.
//   ctx.missions = {
//     list, heist, current, currentIndex, activeStep, stepIndex,
//     stepProgress, timeLeft, unlocked, unlockedIndex, isHeistUnlocked,
//     heistIndex, completed, totalPayout, heistTotal,
//     startMission(i), completeStep(), failMission(reason), startNext(),
//     isUnlocked(i),
//   }
// Story missions 1-12 total $10,510 (names/payouts from the 2D version;
// missions 3-12 steps from the round-4 mission spec — every mission a
// distinct step pattern). The heist chain (missions 13-15) unlocks after
// mission 12 and pays +$5,000. All 15 missions: $15,510 total.
// Step kinds: goto, collect (count), clear (count), steal, deliver.
// Timed missions carry a generous countdown; Ghost (hacker crew) adds
// +15s per level via the economy module. Missions unlock in order, one
// active at a time. Respect: +250 per story mission, +500 per heist part
// (12 x 250 + 3 x 500 = 4,500 after all 15). Payouts use the economy's
// rank multiplier (+5% per respect rank).
// Markers use LANDMARKS from config.js; step targets are nudged out of
// building footprints (ctx.world.buildings) so beacons, crates, thugs and
// target cars are always reachable.
//
// Two fixes baked in from the start (round-6 v1 bugs):
//  - ensureHud() builds the mission-tracker children whenever they are
//    missing — an empty pre-defined #mission-tracker div no longer leaves
//    the tracker blank.
//  - updateHud() publishes the active mission into state.currentMission,
//    so hud.js shows it instead of "No active mission".

import THREE_SHIM from './three.js';
import * as Config from './config.js';

// Short step names -> canonical LANDMARKS keys in config.js. Config wins:
// the world is built from config.js, so a mission beacon must sit on the
// same spot as the landmark the world built.
const LM = {
  market: 'feriaMarket', plaza: 'plazaTower', pier: 'oldPier',
  marina: 'marinaDocks', garage: 'brasaGarage', arcade: 'rookArcade',
  casino: 'coralCasino', tunnel: 'coastTunnel', motel: 'motelVela',
  church: 'oldChurch', beach: 'beachfront', underpass: 'underpass',
};
const CONFIG_LANDMARKS = (Config && Config.LANDMARKS) || {};

export function landmarkPos(key) {
  const aliased = LM[key] || key;
  const raw = CONFIG_LANDMARKS[aliased] || CONFIG_LANDMARKS[key] || { x: 0, z: 0 };
  if (Array.isArray(raw)) return new T.Vector3(raw[0] || 0, 0, raw[1] || 0);
  if (raw.pos) {
    if (Array.isArray(raw.pos)) return new T.Vector3(raw.pos[0] || 0, 0, raw.pos[1] || 0);
    if (typeof raw.pos.x === 'number') {
      return new T.Vector3(raw.pos.x, raw.pos.y || 0, raw.pos.z || 0);
    }
  }
  if (typeof raw.x === 'number') return new T.Vector3(raw.x, raw.y || 0, raw.z || 0);
  return new T.Vector3(0, 0, 0);
}

export function landmarkName(key) {
  const names = {
    market: 'Feria Market', pier: 'Old Pier', marina: 'Marina Docks',
    garage: 'Brasa Garage', arcade: 'Rook Arcade', casino: 'Coral Room Casino',
    tunnel: 'Coast Tunnel', motel: 'Motel Vela', underpass: 'Underpass',
    church: 'Old Church', plaza: 'Plaza Tower', beach: 'Beachfront',
  };
  return names[key] || key;
}

// --- Mission data ----------------------------------------------------------
// Missions 1-2: names/payouts from the 2D version; steps hand-written for 3D.
// Missions 3-12: exactly the round-4 mission spec (distinct step patterns).
export const MISSIONS = [
  {
    id: 1, name: 'Tamale Run', payout: 740,
    brief: "Hot tamales from Feria Market to the beach and the plaza. Don't let them go cold.",
    steps: [
      { kind: 'collect', at: 'market', count: 3, label: 'Pick up 3 tamale crates' },
      { kind: 'deliver', at: 'beach', label: 'Deliver to the Beachfront' },
      { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 2, name: 'The Vela Job', payout: 800,
    brief: 'A car is waiting at Motel Vela. Take it and bring it to Rook Arcade — quietly.',
    steps: [
      { kind: 'goto', at: 'motel', label: 'Reach Motel Vela' },
      { kind: 'steal', at: 'motel', label: 'Take the car' },
      { kind: 'deliver', at: 'arcade', inCar: true, label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 3, name: 'Feria Shakedown', payout: 990,
    brief: "Delgado's men are shaking down the market stalls. Clear them out, grab the cash, and take a getaway car.",
    steps: [
      { kind: 'clear', at: 'market', count: 5, label: "Clear 5 of Delgado's men" },
      { kind: 'collect', at: 'market', count: 2, label: 'Collect the cash' },
      { kind: 'steal', at: 'market', label: 'Take a getaway car' },
      { kind: 'deliver', at: 'arcade', inCar: true, label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 4, name: 'Coral Room Getaway', payout: 1300, timed: 150,
    brief: 'Hit the Coral Room Casino, grab the chips, and lose the cops in the Coast Tunnel. 150 seconds.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Reach the casino' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 chip cases' },
      { kind: 'deliver', at: 'tunnel', label: 'Escape to the Coast Tunnel' },
    ],
  },
  {
    id: 5, name: 'Last Call', payout: 850,
    brief: 'Four drops, one night: the pier, the motel, the underpass and the church. Then report back to Rook.',
    steps: [
      { kind: 'deliver', at: 'pier', label: 'Drop 1: Old Pier' },
      { kind: 'deliver', at: 'motel', label: 'Drop 2: Motel Vela' },
      { kind: 'deliver', at: 'underpass', label: 'Drop 3: Underpass' },
      { kind: 'deliver', at: 'church', label: 'Drop 4: Old Church' },
      { kind: 'goto', at: 'arcade', label: 'Report to Rook Arcade' },
    ],
  },
  {
    id: 6, name: 'Dawn Dash', payout: 880, timed: 120,
    brief: 'Rush delivery: hot plates from the market to the beach AND the plaza before the sun is up. 120 seconds.',
    steps: [
      { kind: 'collect', at: 'market', count: 2, label: 'Pick up the plates' },
      { kind: 'deliver', at: 'beach', label: 'Deliver to the Beachfront' },
      { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 7, name: 'Hot Plate', payout: 860, timed: 90,
    brief: "A rival crew's courier car is waiting at the marina. Take it and get the plaza tower menu there by lunch. 90 seconds.",
    steps: [
      { kind: 'steal', at: 'marina', label: 'Take the courier car' },
      { kind: 'deliver', at: 'plaza', inCar: true, label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 8, name: 'Pier Pressure', payout: 750,
    brief: "Crates are piling up at the pier and Delgado's crew is guarding them. Clear the crew, grab the crates, stash them at the church.",
    steps: [
      { kind: 'clear', at: 'pier', count: 3, label: 'Clear 3 guards' },
      { kind: 'collect', at: 'pier', count: 5, label: 'Collect 5 crates' },
      { kind: 'deliver', at: 'church', label: 'Stash them at the Old Church' },
    ],
  },
  {
    id: 9, name: 'Motel Stakeout', payout: 800,
    brief: 'A snitch is holed up at Motel Vela. Get close, grab the ledger, deal with his guards, and slip away to Rook.',
    steps: [
      { kind: 'goto', at: 'motel', label: 'Reach Motel Vela' },
      { kind: 'collect', at: 'motel', count: 1, label: 'Grab the ledger' },
      { kind: 'clear', at: 'motel', count: 2, label: 'Deal with 2 guards' },
      { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 10, name: 'Tunnel Run', payout: 820,
    brief: 'The Coast Tunnel is the only way past the roadblocks tonight. Take a fast car, thread the tunnel, and hit the marina then the beach.',
    steps: [
      { kind: 'steal', at: 'tunnel', label: 'Take a fast car' },
      { kind: 'deliver', at: 'marina', inCar: true, label: 'Drop 1: Marina Docks' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Drop 2: Beachfront' },
    ],
  },
  {
    id: 11, name: 'Casino Chips', payout: 850,
    brief: 'The Coral Room is moving chips. Hit the casino floor, take the cases, then fight off the reinforcements at the plaza and keep the cut.',
    steps: [
      { kind: 'clear', at: 'casino', count: 5, label: 'Clear 5 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Take 3 chip cases' },
      { kind: 'clear', at: 'plaza', count: 3, label: 'Fight off 3 reinforcements' },
      { kind: 'deliver', at: 'plaza', label: 'Keep the cut at Plaza Tower' },
    ],
  },
  {
    id: 12, name: 'The Big One', payout: 870, timed: 240,
    brief: 'The final heist: lift the vault cash at the casino, clear the guards, take the getaway car, shake the tail at the beach, and meet Rook. 240 seconds.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Reach the casino' },
      { kind: 'clear', at: 'casino', count: 4, label: 'Clear 4 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 vault cases' },
      { kind: 'steal', at: 'casino', label: 'Take the getaway car' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Shake the tail at the Beachfront' },
      { kind: 'goto', at: 'arcade', label: 'Meet Rook and finish' },
    ],
  },
];

// Heist chain (missions 13-15): unlocks after mission 12. Total +$5,000.
export const HEIST = [
  {
    id: 13, part: 1, name: 'Heist: The Plan', payout: 1000,
    brief: 'The Coral Room vault. Case the casino, grab the floor plans, and meet Ghost at the garage.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Case the Coral Room Casino' },
      { kind: 'collect', at: 'casino', count: 2, label: 'Grab 2 floor plans' },
      { kind: 'goto', at: 'garage', label: 'Meet Ghost at Brasa Garage' },
    ],
  },
  {
    id: 14, part: 2, name: 'Heist: Infiltrate', payout: 1500,
    brief: 'Inside the Coral Room. Clear the vault guards and lift the cash — quiet if you can, loud if you must.',
    steps: [
      { kind: 'goto', at: 'casino', label: 'Slip into the casino' },
      { kind: 'clear', at: 'casino', count: 4, label: 'Clear 4 vault guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Lift 3 vault bags' },
    ],
  },
  {
    id: 15, part: 3, name: 'Heist: Getaway', payout: 2500, timed: 180,
    brief: 'The alarm is up. Take the getaway car, lose the tail at the beach, and vanish through the Coast Tunnel. 180 seconds.',
    steps: [
      { kind: 'steal', at: 'casino', label: 'Take the getaway car' },
      { kind: 'deliver', at: 'beach', inCar: true, label: 'Lose the tail at the Beachfront' },
      { kind: 'deliver', at: 'tunnel', inCar: true, label: 'Vanish through the Coast Tunnel' },
    ],
  },
];

export const MISSION_TOTAL = MISSIONS.reduce((sum, m) => sum + m.payout, 0); // 10,510
export const HEIST_TOTAL = HEIST.reduce((sum, m) => sum + m.payout, 0); // 5,000
export const ALL_MISSIONS_TOTAL = MISSION_TOTAL + HEIST_TOTAL; // 15,510

// Respect per completion: story +250, heist part +500 -> 4,500 after all 15.
export const RESPECT_STORY = 250;
export const RESPECT_HEIST = 500;

const BEACON_RADIUS = 4.5;
const BEACON_RADIUS_CAR = 12; // cars park at a landmark's edge, so a car
// delivery needs a wider radius than an on-foot goto.
const PICKUP_RADIUS = 2.6;
const STEAL_RADIUS = 3.0;

let T = THREE_SHIM || null; // THREE namespace, resolved in init from ctx.THREE or the shim.
let ctx = null; // bound game context

// All mutable mission state lives in one object so init() can reset it cleanly.
const S = {
  mission: null, // active mission object (from MISSIONS or HEIST)
  index: -1, // index into MISSIONS, or 12 + part - 1 for heist
  step: 0, // index of the active step
  progress: 0, // collected count / cleared count for the active step
  timeLeft: 0,
  unlocked: 0, // highest unlocked mission index (0-based) in MISSIONS
  heistUnlocked: false,
  heistPart: 0, // next heist part to run (0-based into HEIST)
  done: [], // completed mission ids
  beacon: null, // { group, pillar, ring, target }
  crates: [], // { mesh, taken, baseY, phase }
  thugs: [], // local fallback enemies { group, hp, dead, hitCooldown }
  combatFoes: null, // enemies spawned by ctx.combat, if any
  killsAtStepStart: 0,
  targetCar: null, // { group, pos, external }
  stepTarget: null, // resolved (open-point) target of the active step
  published: null, // object shared with hud.js via state.currentMission
};

// --- Context helpers -------------------------------------------------------

function stateOf(c) {
  const g = c || ctx;
  if (!g) return {};
  if (!g.state) g.state = {};
  const s = g.state;
  if (typeof s.cash !== 'number') s.cash = 500;
  if (typeof s.respect !== 'number') s.respect = 0;
  if (!Array.isArray(s.completedMissions)) s.completedMissions = [];
  return s;
}

function playerPos(c) {
  const g = c || ctx;
  if (!g) return new T.Vector3(0, 0, 0);
  const p = g.player;
  if (p) {
    if (p.pos && typeof p.pos.x === 'number') return p.pos.clone();
    if (p.position && typeof p.position.x === 'number') {
      return new T.Vector3(p.position.x, p.position.y || 0, p.position.z || 0);
    }
    if (p.mesh && p.mesh.position) return p.mesh.position.clone();
    if (typeof p.x === 'number') return new T.Vector3(p.x, p.y || 0, p.z || 0);
  }
  const s = g.state || {};
  if (Array.isArray(s.playerPos)) {
    return new T.Vector3(s.playerPos[0] || 0, 0, s.playerPos[2] || 0);
  }
  if (g.camera && g.camera.position) return g.camera.position.clone().setY(0);
  return new T.Vector3(0, 0, 0);
}

function playerInCar(c) {
  const g = c || ctx;
  if (!g) return false;
  const s = g.state || {};
  if (s.inCar || s.driving) return true;
  if (g.player && (g.player.inCar || g.player.driving)) return true;
  if (g.cars && g.cars.current) return true;
  return false;
}

function inputAttacking(c) {
  const inp = (c || ctx || {}).input;
  if (!inp) return false;
  if (inp.attack || inp.firing || inp.mouseDown || inp.mouse0) return true;
  // Real input shape (input.js): keys is a Set of event.codes, mouse.down is
  // the left-button state. Mouse click or F (punch) counts as attacking.
  if (inp.mouse && inp.mouse.down) return true;
  if (inp.keys) {
    if (typeof inp.keys.has === 'function') {
      if (inp.keys.has('KeyF') || inp.keys.has('Mouse0')) return true;
    } else if (inp.keys.KeyF || inp.keys.Mouse0 || inp.keys.mouse0) return true;
  }
  return false;
}

function inputInteractPressed(c) {
  const inp = (c || ctx || {}).input;
  if (!inp) return false;
  if (inp.interactPressed || inp.pressedE || inp.justPressedE) return true;
  // Real input shape (input.js): keys is a Set of event.codes ('KeyE').
  if (inp.keys) {
    if (typeof inp.keys.has === 'function') return inp.keys.has('KeyE');
    if (inp.keys.e || inp.keys.KeyE) return true;
  }
  return false;
}

function killsCount(c) {
  const g = c || ctx;
  if (!g) return 0;
  if (g.combat && typeof g.combat.kills === 'number') return g.combat.kills;
  if (g.combat && typeof g.combat.killsCount === 'number') return g.combat.killsCount;
  if (g.state && typeof g.state.kills === 'number') return g.state.kills;
  if (g.state && typeof g.state.enemiesDefeated === 'number') return g.state.enemiesDefeated;
  return 0;
}

function showMessage(c, text) {
  const g = c || ctx;
  if (g && g.hud && typeof g.hud.showMessage === 'function') {
    try { g.hud.showMessage(text); return; } catch (e) { /* fall through */ }
  }
  if (typeof document !== 'undefined') {
    let el = document.getElementById('mission-message');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mission-message';
      el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:56;background:rgba(10,10,18,0.85);color:#fff;padding:8px 14px;border-radius:8px;font-family:system-ui,sans-serif;font-size:14px;pointer-events:none;display:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }
}

function showBrief(c, mission) {
  const g = c || ctx;
  const stepsText = mission.steps.map((st, i) => `${i + 1}. ${st.label}`).join('\n');
  const timedText = mission.timed ? `\nTime limit: ${mission.timed} seconds.` : '';
  if (g && g.dialogue && typeof g.dialogue.showBrief === 'function') {
    try {
      g.dialogue.showBrief(`${mission.name} — $${mission.payout.toLocaleString('en-US')}`, [mission.brief + timedText, stepsText]);
      return;
    } catch (e) { /* fall through to HUD message */ }
  }
  showMessage(g, `${mission.name}: ${mission.brief}`);
}

// Nudge a step target out of any building footprint: landmark centres sit
// inside their own buildings (Plaza Tower, casino, motel...), and the player
// is pushed out of those AABBs, so a beacon/car/crate at the exact centre
// could never be reached. The nearest open point just outside the footprint
// is where the beacon, crates, thugs and target car belong.
function openPointNear(c, center) {
  const buildings = (c && c.world && c.world.buildings) || [];
  let x = center.x;
  let z = center.z;
  for (const b of buildings) {
    const r = 2;
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
      const dxl = x - (b.minX - r);
      const dxr = (b.maxX + r) - x;
      const dzl = z - (b.minZ - r);
      const dzr = (b.maxZ + r) - z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) x = b.minX - r;
      else if (m === dxr) x = b.maxX + r;
      else if (m === dzl) z = b.minZ - r;
      else z = b.maxZ + r;
    }
  }
  return new T.Vector3(x, 0, z);
}

// --- 3D markers ------------------------------------------------------------

function makeBeacon(scene, target, color) {
  const group = new T.Group();
  const pillar = new T.Mesh(
    new T.CylinderGeometry(1.6, 1.6, 40, 16, 1, true),
    new T.MeshBasicMaterial({
      color: color || 0xffd34d, transparent: true, opacity: 0.28,
      side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending,
    }),
  );
  pillar.position.y = 20;
  group.add(pillar);
  const ring = new T.Mesh(
    new T.RingGeometry(2.2, 3.4, 32),
    new T.MeshBasicMaterial({
      color: color || 0xffd34d, transparent: true, opacity: 0.85,
      side: T.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.position.set(target.x, 0, target.z);
  scene.add(group);
  return { group, pillar, ring, target: target.clone() };
}

function clearStepObjects(c) {
  const g = c || ctx;
  const scene = g && g.scene;
  if (S.beacon && scene) scene.remove(S.beacon.group);
  S.beacon = null;
  for (const crate of S.crates) if (scene && crate.mesh) scene.remove(crate.mesh);
  S.crates = [];
  for (const thug of S.thugs) if (scene && thug.group) scene.remove(thug.group);
  S.thugs = [];
  S.combatFoes = null;
  if (S.targetCar && scene) scene.remove(S.targetCar.group);
  S.targetCar = null;
  S.stepTarget = null;
}

function spawnCrates(c, center, count, color) {
  const g = c || ctx;
  const scene = g && g.scene;
  if (!scene) return;
  const geo = new T.BoxGeometry(1.2, 1.2, 1.2);
  const mat = new T.MeshStandardMaterial({
    color: color || 0xffd34d, emissive: color || 0xffaa00, emissiveIntensity: 1.2, roughness: 0.4,
  });
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + 0.6;
    const r = 4 + (i % 3) * 3;
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(center.x + Math.cos(angle) * r, 0.9, center.z + Math.sin(angle) * r);
    mesh.rotation.y = angle;
    scene.add(mesh);
    S.crates.push({ mesh, taken: false, baseY: 0.9, phase: Math.random() * Math.PI * 2 });
  }
}

function spawnThugs(c, center, count) {
  const g = c || ctx;
  const scene = g && g.scene;
  if (!scene) return;
  const bodyMat = new T.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.7 });
  const headMat = new T.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2;
    const group = new T.Group();
    const body = new T.Mesh(new T.CapsuleGeometry(0.55, 0.9, 4, 8), bodyMat);
    body.position.y = 1.1;
    group.add(body);
    const head = new T.Mesh(new T.SphereGeometry(0.34, 10, 8), headMat);
    head.position.y = 2.15;
    group.add(head);
    group.position.set(center.x + Math.cos(angle) * 6, 0, center.z + Math.sin(angle) * 6);
    scene.add(group);
    S.thugs.push({ group, hp: 3, dead: false, hitCooldown: 0 });
  }
}

function spawnTargetCar(c, center) {
  const g = c || ctx;
  const scene = g && g.scene;
  if (!scene) return null;
  // Prefer the vehicle module's spawner when it offers one, so the stolen
  // car is a real drivable car (player enters it with E).
  if (g) {
    const spawnFn = (g.cars && g.cars.spawnMissionCar)
      || (g.vehicles && g.vehicles.spawnMissionCar)
      || (g.vehicle && g.vehicle.spawnMissionCar);
    if (typeof spawnFn === 'function') {
      try {
        const car = spawnFn(center);
        if (car) {
          S.targetCar = { group: car.group || car.mesh || car, pos: center.clone(), external: true };
          return S.targetCar;
        }
      } catch (e) { /* fall through to the local mesh */ }
    }
  }
  // Local low-poly target car: gold body so it reads as "the" car.
  const group = new T.Group();
  const gold = new T.MeshStandardMaterial({ color: 0xffc400, roughness: 0.3, metalness: 0.6 });
  const dark = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.4 });
  const glass = new T.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.1, metalness: 0.8 });
  const body = new T.Mesh(new T.BoxGeometry(2.0, 0.55, 4.4), gold);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new T.Mesh(new T.BoxGeometry(1.7, 0.5, 2.2), glass);
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);
  const wheelGeo = new T.CylinderGeometry(0.38, 0.38, 0.3, 10);
  for (const [wx, wz] of [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]]) {
    const w = new T.Mesh(wheelGeo, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.38, wz);
    group.add(w);
  }
  // Beacon ring under the car so the player can spot it.
  const ring = new T.Mesh(
    new T.RingGeometry(2.6, 3.4, 32),
    new T.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  group.add(ring);
  group.position.set(center.x, 0, center.z);
  scene.add(group);
  S.targetCar = { group, pos: center.clone(), external: false };
  return S.targetCar;
}

// --- Step setup / completion ----------------------------------------------

function activeStep() {
  if (!S.mission) return null;
  return S.mission.steps[S.step] || null;
}

function setupStep(c) {
  const g = c || ctx;
  const step = activeStep();
  clearStepObjects(g);
  S.progress = 0;
  if (!step) return;
  const center = openPointNear(g, landmarkPos(step.at));
  S.stepTarget = center;
  const scene = g && g.scene;
  if (step.kind === 'goto' || step.kind === 'deliver') {
    if (scene) S.beacon = makeBeacon(scene, center, step.kind === 'deliver' ? 0x33ff88 : 0xffd34d);
  } else if (step.kind === 'collect') {
    if (scene) S.beacon = makeBeacon(scene, center, 0xffd34d);
    spawnCrates(g, center, step.count || 1, 0xffd34d);
  } else if (step.kind === 'clear') {
    if (scene) S.beacon = makeBeacon(scene, center, 0xff4444);
    S.killsAtStepStart = killsCount(g);
    // Prefer the combat module's spawner when it offers one.
    let spawned = null;
    if (g && g.combat) {
      const fn = g.combat.spawnEnemies || g.combat.spawnWave;
      if (typeof fn === 'function') {
        try { spawned = fn.call(g.combat, step.count || 1, center, { mission: true }); } catch (e) { spawned = null; }
      }
    }
    if (Array.isArray(spawned) && spawned.length) {
      S.combatFoes = spawned;
    } else {
      spawnThugs(g, center, step.count || 1);
    }
  } else if (step.kind === 'steal') {
    if (scene) S.beacon = makeBeacon(scene, center, 0xffc400);
    spawnTargetCar(g, center);
  }
  updateHud(g);
}

function completeStep(c) {
  const g = c || ctx;
  const step = activeStep();
  if (!S.mission || !step) return false;
  showMessage(g, `Done: ${step.label}`);
  if (g && g.audio && typeof g.audio.playPickup === 'function') {
    try { g.audio.playPickup(); } catch (e) { /* best-effort */ }
  }
  S.step += 1;
  if (S.step >= S.mission.steps.length) {
    completeMission(g);
    return true;
  }
  setupStep(g);
  updateHud(g);
  return true;
}

function failMission(c, reason) {
  const g = c || ctx;
  if (!S.mission) return;
  const name = S.mission.name;
  clearStepObjects(g);
  S.mission = null;
  S.index = -1;
  S.step = 0;
  S.timeLeft = 0;
  updateHud(g);
  if (g && g.dialogue && typeof g.dialogue.show === 'function') {
    try { g.dialogue.show('Rook', `Mission failed — ${reason}. Come back when you're ready.`); } catch (e) { /* ignore */ }
  }
  showMessage(g, `Mission failed: ${name} — ${reason}`);
}

function completeMission(c) {
  const g = c || ctx;
  const mission = S.mission;
  if (!mission) return;
  const isHeist = mission.id > 12;
  // Respect payout multiplier (+5% per rank) via the economy module.
  let mult = 1;
  if (g && g.economy && typeof g.economy.payoutMultiplier === 'function') {
    try { mult = g.economy.payoutMultiplier(); } catch (e) { mult = 1; }
  }
  const amount = Math.round(mission.payout * mult);
  if (g && g.economy && typeof g.economy.addCash === 'function') {
    g.economy.addCash(amount);
  } else {
    const s = stateOf(g);
    s.cash = Math.max(0, (s.cash || 0) + amount);
  }
  const respectGain = isHeist ? RESPECT_HEIST : RESPECT_STORY;
  if (g && g.economy && typeof g.economy.addRespect === 'function') {
    g.economy.addRespect(respectGain);
  } else {
    const s = stateOf(g);
    s.respect = Math.min(35000, (s.respect || 0) + respectGain);
  }
  const s = stateOf(g);
  if (!s.completedMissions.includes(mission.id)) s.completedMissions.push(mission.id);
  if (!S.done.includes(mission.id)) S.done.push(mission.id);
  if (g && g.audio && typeof g.audio.playMissionComplete === 'function') {
    try { g.audio.playMissionComplete(); } catch (e) { /* best-effort */ }
  }
  if (g && g.dialogue && typeof g.dialogue.show === 'function') {
    try {
      g.dialogue.show('Rook', `Clean work. ${mission.name} paid $${amount.toLocaleString('en-US')}.`);
    } catch (e) { /* ignore */ }
  }
  showMessage(g, `Mission complete: ${mission.name} — +$${amount.toLocaleString('en-US')}`);
  clearStepObjects(g);
  // Unlock the next mission (or the next heist part).
  if (!isHeist) {
    S.unlocked = Math.max(S.unlocked, Math.min(MISSIONS.length - 1, S.index + 1));
    if (S.index === MISSIONS.length - 1) {
      S.heistUnlocked = true;
      S.heistPart = 0;
      showMessage(g, 'The heist is on. Talk to Rook — the Coral Room vault is next.');
    }
  } else {
    S.heistPart = Math.min(HEIST.length, S.heistPart + 1);
    if (S.heistPart >= HEIST.length) {
      showMessage(g, 'Heist complete! The Coral Room vault is yours. Legend.');
    }
  }
  S.mission = null;
  S.index = -1;
  S.step = 0;
  S.timeLeft = 0;
  updateHud(g);
  if (g && typeof g.save === 'function') {
    try { g.save(); } catch (e) { /* save is best-effort */ }
  }
}

// --- Starting missions -----------------------------------------------------

function startMission(i, c) {
  const g = c || ctx;
  if (S.mission) return false; // only one active at a time
  const idx = Math.floor(Number(i) || 0);
  let mission = null;
  let listIndex = idx;
  if (idx >= 0 && idx < MISSIONS.length) {
    if (idx > S.unlocked) return false; // locked — missions unlock in order
    mission = MISSIONS[idx];
  } else if (idx >= MISSIONS.length && idx < MISSIONS.length + HEIST.length) {
    if (!S.heistUnlocked) return false;
    const part = idx - MISSIONS.length;
    if (part !== S.heistPart) return false; // heist parts run in order
    mission = HEIST[part];
    listIndex = idx;
  } else {
    return false;
  }
  S.mission = mission;
  S.index = listIndex;
  S.step = 0;
  S.progress = 0;
  // Timed missions: generous countdown + Ghost hacker bonus (+15s/level).
  let bonus = 0;
  if (g && g.economy && typeof g.economy.hackerBonusSeconds === 'function') {
    try { bonus = g.economy.hackerBonusSeconds(); } catch (e) { bonus = 0; }
  }
  S.timeLeft = mission.timed ? mission.timed + bonus : 0;
  showBrief(g, mission);
  setupStep(g);
  updateHud(g);
  return true;
}

// --- HUD (mission tracker + arrow + distance + timer) ----------------------

let trackerEl = null; // #mission-tracker panel
let titleEl = null;
let labelEl = null;
let distEl = null;
let timerEl = null;
let arrowEl = null;

function ensureHud() {
  if (typeof document === 'undefined') return;
  if (trackerEl && document.body.contains(trackerEl) && titleEl) return;
  trackerEl = document.getElementById('mission-tracker');
  if (!trackerEl) {
    trackerEl = document.createElement('div');
    trackerEl.id = 'mission-tracker';
    document.body.appendChild(trackerEl);
  }
  // index.html may pre-define an empty #mission-tracker div. Taking the
  // "it exists" branch and then writing into children that were never
  // created is what left the tracker blank in round-6 v1. Build the
  // children whenever they are missing, whichever branch ran.
  trackerEl.style.cssText = [
    'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)', 'z-index:55',
    'background:rgba(10,10,18,0.75)', 'color:#fff', 'padding:10px 12px',
    'border-radius:10px', 'border:1px solid rgba(255,255,255,0.18)',
    'font-family:system-ui,sans-serif', 'font-size:14px', 'line-height:1.5',
    'max-width:320px', 'pointer-events:none', 'display:none',
  ].join(';');
  const need = (id) => {
    let el = trackerEl.querySelector('#' + id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      trackerEl.appendChild(el);
    }
    return el;
  };
  titleEl = need('mission-title');
  titleEl.style.cssText = 'font-weight:700;color:#ffd34d;';
  labelEl = need('mission-label');
  distEl = need('mission-distance');
  distEl.style.cssText = 'color:#9fd8ff;';
  timerEl = need('mission-timer');
  timerEl.style.cssText = 'color:#ff9d9d;font-weight:700;';
  arrowEl = need('mission-arrow');
  if (!arrowEl.textContent) arrowEl.textContent = '▲';
  arrowEl.style.cssText = 'font-size:22px;color:#ffd34d;text-align:center;transition:transform 0.1s linear;';
}

function updateHud(c) {
  // Publish the active mission to shared state so hud.js's #hud-mission
  // tracker (which reads state.currentMission) shows the mission instead
  // of "No active mission" — in round-6 v1 nothing ever wrote that field.
  // One object, mutated in place, so the distance written by
  // updateHudDistance survives the next updateHud call.
  const g = c || ctx;
  const st = g ? g.state : null;
  if (st) {
    if (!S.mission) {
      st.currentMission = null;
      S.published = null;
    } else {
      if (!S.published) {
        S.published = {};
        st.currentMission = S.published;
      }
      const step = activeStep();
      const count = step && (step.kind === 'collect' || step.kind === 'clear')
        ? ` (${S.progress}/${step.count || 1})` : '';
      S.published.name = S.mission.name;
      S.published.stepLabel = step
        ? `Step ${S.step + 1}/${S.mission.steps.length}: ${step.label}${count}` : '';
      S.published.timeLeft = S.mission.timed ? S.timeLeft : null;
    }
  }
  if (typeof document === 'undefined') return;
  ensureHud();
  if (!trackerEl) return;
  // One mission panel at a time: hud.js's #hud-mission sits at the same
  // top-left spot and shows the same info (now that we publish it), so
  // hide it while a mission is active and restore it when idle.
  const hudMission = document.getElementById('hud-mission');
  if (hudMission) hudMission.style.display = S.mission ? 'none' : '';
  if (!S.mission) {
    trackerEl.style.display = 'none';
    return;
  }
  trackerEl.style.display = 'block';
  if (titleEl) titleEl.textContent = `${S.mission.name} — $${S.mission.payout.toLocaleString('en-US')}`;
  const step = activeStep();
  if (labelEl && step) {
    const count = (step.kind === 'collect' || step.kind === 'clear')
      ? ` (${S.progress}/${step.count || 1})` : '';
    labelEl.textContent = `Step ${S.step + 1}/${S.mission.steps.length}: ${step.label}${count}`;
  }
  if (timerEl) {
    timerEl.textContent = S.mission.timed ? `⏱ ${Math.max(0, Math.ceil(S.timeLeft))}s left` : '';
    timerEl.style.display = S.mission.timed ? 'block' : 'none';
  }
}

function updateHudDistance(c, target) {
  if (typeof document === 'undefined' || !trackerEl || !S.mission) return;
  const g = c || ctx;
  const pPos = playerPos(g);
  const dist = Math.round(pPos.distanceTo(target));
  if (S.published) S.published.distance = dist;
  const step = activeStep();
  if (distEl) distEl.textContent = `${dist}m — ${landmarkName(step ? step.at : '')}`;
  if (arrowEl && g && g.camera) {
    // Arrow points toward the marker relative to the camera's facing.
    const camDir = new T.Vector3();
    g.camera.getWorldDirection(camDir);
    const camYaw = Math.atan2(camDir.x, camDir.z);
    const toTarget = Math.atan2(target.x - pPos.x, target.z - pPos.z);
    let rel = toTarget - camYaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // Screen-up is "ahead": rotate the ▲ by -rel.
    arrowEl.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  }
}

// --- Public API ------------------------------------------------------------

export function init(c) {
  T = (c && c.THREE) || THREE_SHIM;
  if (!T) throw new Error('missions: THREE is not available (ctx.THREE / ./three.js)');
  ctx = c || null;
  S.mission = null;
  S.index = -1;
  S.step = 0;
  S.progress = 0;
  S.timeLeft = 0;
  S.unlocked = 0;
  S.heistUnlocked = false;
  S.heistPart = 0;
  S.done = [];
  S.published = null;
  clearStepObjects(c);
  if (c) {
    const s = stateOf(c);
    S.done = [...s.completedMissions];
    // Restore unlocks from saved completions.
    let lastDone = -1;
    for (let i = 0; i < MISSIONS.length; i++) {
      if (S.done.includes(MISSIONS[i].id)) lastDone = i;
    }
    S.unlocked = Math.min(MISSIONS.length - 1, lastDone + 1);
    if (S.done.includes(12)) {
      S.heistUnlocked = true;
      S.heistPart = HEIST.filter((h) => S.done.includes(h.id)).length;
    }
    if (typeof document !== 'undefined') ensureHud();
  }

  const api = {
    list: MISSIONS,
    heist: HEIST,
    get current() { return S.mission; },
    get currentIndex() { return S.index; },
    get activeStep() { return activeStep(); },
    get stepIndex() { return S.step; },
    get stepProgress() { return S.progress; },
    get timeLeft() { return S.timeLeft; },
    get unlocked() { return S.unlocked; },
    get unlockedIndex() { return S.unlocked; },
    get isHeistUnlocked() { return S.heistUnlocked; },
    get heistIndex() { return S.heistPart; },
    get completed() { return [...S.done]; },
    get totalPayout() { return MISSION_TOTAL; },
    get heistTotal() { return HEIST_TOTAL; },
    startMission(i) { return startMission(i, c); },
    completeStep() { return completeStep(c); },
    failMission(reason) { failMission(c, reason || 'failed'); },
    // Start the next unlocked, uncompleted mission (mission-select helper).
    startNext() {
      for (let i = 0; i < MISSIONS.length; i++) {
        if (!S.done.includes(MISSIONS[i].id) && i <= S.unlocked) return startMission(i, c);
      }
      if (S.heistUnlocked && S.heistPart < HEIST.length) {
        return startMission(MISSIONS.length + S.heistPart, c);
      }
      return false;
    },
    isUnlocked(i) { return i >= 0 && i < MISSIONS.length && i <= S.unlocked; },
  };
  if (c) c.missions = api;
  return api;
}

export function update(dt, c) {
  const g = c || ctx;
  if (!g) return;
  const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0.016;
  const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;

  // Animate the beacon pillar (pulse + slow spin) and the crates (bob/spin).
  if (S.beacon) {
    S.beacon.pillar.material.opacity = 0.22 + Math.sin(now * 3) * 0.08;
    S.beacon.pillar.rotation.y += step * 0.6;
    S.beacon.ring.scale.setScalar(1 + Math.sin(now * 3) * 0.12);
  }
  for (const crate of S.crates) {
    if (crate.taken) continue;
    crate.mesh.rotation.y += step * 1.2;
    crate.mesh.position.y = crate.baseY + Math.sin(now * 2 + crate.phase) * 0.25;
  }

  if (!S.mission) return;
  const active = activeStep();
  if (!active) return;

  // --- Timed missions: countdown, fail at zero ---------------------------
  if (S.mission.timed) {
    S.timeLeft -= step;
    if (S.timeLeft <= 0) {
      S.timeLeft = 0;
      updateHud(g);
      failMission(g, 'out of time');
      return;
    }
  }

  const pPos = playerPos(g);
  const center = S.stepTarget || landmarkPos(active.at);
  const inCar = playerInCar(g);

  if (active.kind === 'goto' || active.kind === 'deliver') {
    const radius = (active.inCar || inCar) ? BEACON_RADIUS_CAR : BEACON_RADIUS;
    if (active.inCar && !inCar) {
      // Must be in a car for this delivery — show the requirement, don't complete.
      updateHudDistance(g, center);
      return;
    }
    updateHudDistance(g, center);
    if (pPos.distanceTo(center) <= radius) completeStep(g);
  } else if (active.kind === 'collect') {
    updateHudDistance(g, center);
    let changed = false;
    for (const crate of S.crates) {
      if (crate.taken) continue;
      if (pPos.distanceTo(crate.mesh.position) <= PICKUP_RADIUS) {
        crate.taken = true;
        crate.mesh.visible = false;
        S.progress += 1;
        changed = true;
        if (g.particles && typeof g.particles.burst === 'function') {
          try { g.particles.burst(crate.mesh.position, 0xffd34d, 12, 3); } catch (e) { /* best-effort */ }
        }
        if (g.audio && typeof g.audio.playPickup === 'function') {
          try { g.audio.playPickup(); } catch (e) { /* best-effort */ }
        }
      }
    }
    if (changed) updateHud(g);
    if (S.progress >= (active.count || 1)) completeStep(g);
  } else if (active.kind === 'clear') {
    updateHudDistance(g, center);
    // Kills reported by the combat module (enemies it spawned near the site).
    const kills = killsCount(g);
    if (kills > S.killsAtStepStart) {
      const gained = kills - S.killsAtStepStart;
      S.killsAtStepStart = kills;
      S.progress = Math.min(active.count || 1, S.progress + gained);
      updateHud(g);
    }
    // Local fallback thugs: the player defeats one by attacking up close.
    if (S.thugs.length) {
      const attacking = inputAttacking(g);
      for (const thug of S.thugs) {
        if (thug.dead) continue;
        thug.hitCooldown -= step;
        const tp = thug.group.position;
        const dist = Math.hypot(tp.x - pPos.x, tp.z - pPos.z);
        // Thugs close in on the player slowly.
        if (dist > 2.2 && dist < 25) {
          const dx = (pPos.x - tp.x) / dist;
          const dz = (pPos.z - tp.z) / dist;
          tp.x += dx * 3 * step;
          tp.z += dz * 3 * step;
          thug.group.lookAt(pPos.x, 0, pPos.z);
        }
        if (attacking && dist <= 2.8 && thug.hitCooldown <= 0) {
          thug.hitCooldown = 0.45;
          thug.hp -= 1;
          thug.group.position.y = 0.1; // hit flinch
          if (thug.hp <= 0) {
            thug.dead = true;
            thug.group.visible = false;
            S.progress = Math.min(active.count || 1, S.progress + 1);
            updateHud(g);
          }
        }
      }
    }
    // Combat-module enemies: count any that report dead.
    if (S.combatFoes) {
      let dead = 0;
      for (const e of S.combatFoes) {
        if (!e) continue;
        if (e.dead || e.isDead || (typeof e.hp === 'number' && e.hp <= 0)
          || (e.group && e.group.visible === false)) dead += 1;
      }
      if (dead > 0 && S.progress < dead && killsCount(g) === S.killsAtStepStart) {
        // Only use the dead-flag count when the combat module has no kill counter.
        S.progress = Math.min(active.count || 1, dead);
        updateHud(g);
      }
    }
    if (S.progress >= (active.count || 1)) completeStep(g);
  } else if (active.kind === 'steal') {
    updateHudDistance(g, center);
    if (!S.targetCar) return;
    const carPos = S.targetCar.group && S.targetCar.group.position
      ? S.targetCar.group.position : S.targetCar.pos;
    const dist = Math.hypot(carPos.x - pPos.x, carPos.z - pPos.z);
    // Taking the car: entering it (inCar near the target) or pressing E beside it.
    if (dist <= STEAL_RADIUS && (inCar || inputInteractPressed(g))) {
      // Stealing in view raises heat — the police module picks this up.
      const s = stateOf(g);
      s.stoleCar = true;
      if (g.state) g.state.stoleCar = true;
      // The car is now the player's: leave the mesh in the world.
      if (S.targetCar.external) {
        // Vehicle module owns the mesh; just stop tracking it as a target.
        S.targetCar = null;
      } else {
        // Local mesh: hand it over by clearing the target flag, not the mesh.
        const handedOver = S.targetCar.group;
        if (handedOver && g.scene) {
          // Keep the car where it is; remove only the beacon ring marker.
          const ring = handedOver.children.find((ch) => ch.geometry && ch.geometry.type === 'RingGeometry');
          if (ring) handedOver.remove(ring);
        }
        S.targetCar = null;
      }
      completeStep(g);
    }
  }

  updateHud(g);
}

export default { init, update, MISSIONS, HEIST, MISSION_TOTAL, HEIST_TOTAL, ALL_MISSIONS_TOTAL, landmarkPos, landmarkName };
