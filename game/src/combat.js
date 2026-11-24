// combat.js — ISLA BRASA 3D: weapons, shooting, weapon wheel, thug enemies.
//
// Weapon wheel (hold Q): 5 base weapons (fists, pistol, SMG, shotgun,
// rifle) with different damage / range / fire rate, plus 2 shop weapons
// (sniper $6,000, RPG $9,000) usable from the wheel once bought — the shop
// writes them into state.weaponsOwned and this module picks them up.
// The wheel UI itself is rendered by hud.js (it shows while Q is held and
// calls ctx.combat.selectWeapon on click / Digit 1-7). This module owns the
// selection state, the Q-hold tracking and the number-key fallback, so the
// wheel works even if the HUD is still loading.
//
// Shooting is hitscan (raycast from the player along their heading) with a
// fire-rate cooldown per weapon. Fists are a short-range melee punch.
// Muzzle flashes go through ctx.particles and shot sounds through
// ctx.audio.playSfx, both guarded — combat works without them.
//
// Thug enemies: low-poly gunmen with HP bars who chase the player and
// melee-attack up close. Missions spawn them via spawnWave / spawnEnemies.
// Hitting an enemy raises state.wanted by 1 (first hit per enemy); kills
// are counted on combat.kills and state.kills so missions.js 'clear'
// steps see them. A shot also stamps state.lastGunshot so pedestrians flee.
//
// Contract: exports init(ctx), update(dt, ctx) and WEAPON_STATS; attaches
//   ctx.combat = {
//     weapons, current, enemies, kills,
//     selectWeapon(name), shoot(), punch(),
//     spawnEnemy(x, z, hp), spawnEnemies(count, center, opts),
//     spawnWave(count, center, opts), damageEnemy(enemy, amount),
//     wheelOpen, stats,
//   }

import THREE_SHIM from './three.js';
import * as Config from './config.js';

const CFG_STATS = Config.WEAPON_STATS || {};

function stat(id, fallback) {
  return CFG_STATS[id] || fallback;
}

const WEAPON_STATS = {
  fists: stat('fists', { damage: 10, range: 2, rate: 2.0 }),
  pistol: stat('pistol', { damage: 20, range: 40, rate: 2.5 }),
  smg: stat('smg', { damage: 12, range: 32, rate: 8.0 }),
  shotgun: stat('shotgun', { damage: 45, range: 16, rate: 1.0 }),
  rifle: stat('rifle', { damage: 35, range: 70, rate: 4.0 }),
  sniper: stat('sniper', { damage: 90, range: 120, rate: 0.8 }),
  rpg: stat('rpg', { damage: 150, range: 80, rate: 0.5 }),
};

const BASE_WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
const SHOP_WEAPONS = ['sniper', 'rpg'];
const WHEEL_ORDER = [...BASE_WEAPONS, ...SHOP_WEAPONS];
const WHEEL_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];

const ENEMY_MELEE_DAMAGE = 4;
const ENEMY_MELEE_RANGE = 2.0;
const ENEMY_MELEE_COOLDOWN = 1.5;
const ENEMY_CHASE_RANGE = 25;
const ENEMY_WALK_SPEED = 2.6;

let T = null;
let ctxRef = null;
let raycaster = null;
let prevMouseDown = false;
let lastShotAt = 0;
let ownedKey = '';

function nowSec() {
  return (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
}

function stateOf(ctx) {
  const c = ctx || ctxRef;
  return (c && c.state) || {};
}

function keyDown(input, ...codes) {
  if (!input || !input.keys) return false;
  return codes.some((code) => input.keys.has(code));
}

function playSfx(ctx, name) {
  const c = ctx || ctxRef;
  if (c && c.audio && typeof c.audio.playSfx === 'function') {
    try { c.audio.playSfx(name); } catch (e) { /* audio is optional */ }
  }
}

function burstParticles(ctx, pos, color, count, speed) {
  const c = ctx || ctxRef;
  if (c && c.particles && typeof c.particles.burst === 'function') {
    try { c.particles.burst(pos, color, count, speed); } catch (e) { /* optional */ }
  }
}

function muzzleParticles(ctx, pos) {
  const c = ctx || ctxRef;
  if (c && c.particles && typeof c.particles.muzzle === 'function') {
    try { c.particles.muzzle(pos); } catch (e) { /* optional */ }
  }
}

function playerPosArr(ctx) {
  const s = stateOf(ctx);
  if (Array.isArray(s.playerPos)) return s.playerPos;
  return [0, 0, 10];
}

function playerHeading(ctx) {
  const c = ctx || ctxRef;
  if (c && typeof c.playerHeading === 'number') return c.playerHeading;
  const s = stateOf(ctx);
  return typeof s.playerHeading === 'number' ? s.playerHeading : 0;
}

function addWanted(ctx, n) {
  const c = ctx || ctxRef;
  if (c && c.police && typeof c.police.addWanted === 'function') {
    try { c.police.addWanted(n); return; } catch (e) { /* fall through */ }
  }
  const s = stateOf(ctx);
  s.wanted = Math.max(0, Math.min(5, (s.wanted || 0) + n));
}

function showMessage(ctx, text) {
  const c = ctx || ctxRef;
  if (c && c.hud && typeof c.hud.showMessage === 'function') {
    try { c.hud.showMessage(text); } catch (e) { /* optional */ }
  }
}

// --- Enemy HP bar (canvas sprite floating above the thug's head) ----------
function makeHpBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const tex = new T.CanvasTexture(canvas);
  const mat = new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new T.Sprite(mat);
  sprite.scale.set(1.6, 0.2, 1);
  sprite.position.y = 2.6;
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  drawHpBar(sprite, 1);
  return sprite;
}

function drawHpBar(bar, frac) {
  const canvas = bar.userData.canvas;
  if (!canvas) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, 64, 8);
  g.fillStyle = '#400';
  g.fillRect(0, 0, 64, 8);
  g.fillStyle = frac > 0.5 ? '#2ecc71' : (frac > 0.25 ? '#f1c40f' : '#e74c3c');
  g.fillRect(1, 1, 62 * Math.max(0, Math.min(1, frac)), 6);
  if (bar.userData.tex) bar.userData.tex.needsUpdate = true;
}

function buildThugMesh() {
  const group = new T.Group();
  const bodyMat = new T.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 0.75 });
  const headMat = new T.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });
  const gunMat = new T.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.5 });

  const body = new T.Mesh(new T.CapsuleGeometry(0.42, 0.8, 4, 8), bodyMat);
  body.position.y = 1.05;
  group.add(body);
  const head = new T.Mesh(new T.SphereGeometry(0.3, 10, 8), headMat);
  head.position.y = 1.95;
  group.add(head);
  const gun = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 0.7), gunMat);
  gun.position.set(0.35, 1.25, 0.3);
  group.add(gun);
  const bar = makeHpBar();
  group.add(bar);
  // Tag every child mesh so raycasts resolve back to this enemy.
  group.traverse((obj) => { obj.userData.isEnemyMesh = true; });
  return { group, bodyMat, bar };
}

function spawnEnemy(x, z, hp = 100) {
  const c = ctxRef;
  if (!c || !c.scene || !T) return null;
  const built = buildThugMesh();
  built.group.position.set(x, 0, z);
  c.scene.add(built.group);
  const enemy = {
    group: built.group,
    bodyMat: built.bodyMat,
    bar: built.bar,
    hp,
    maxHp: hp,
    dead: false,
    hitCooldown: 0,
    attackCooldown: 0,
    speed: ENEMY_WALK_SPEED * (0.9 + Math.random() * 0.3),
    wantedRaised: false,
    flash: 0,
    x,
    z,
  };
  built.group.traverse((obj) => { obj.userData.enemyRef = enemy; });
  combat.enemies.push(enemy);
  return enemy;
}

function damageEnemy(e, amount, ctx) {
  if (!e || e.dead) return;
  e.hp -= amount;
  e.flash = 0.12;
  if (e.bodyMat && e.bodyMat.emissive) e.bodyMat.emissive.setHex(0x881111);
  if (e.bar) drawHpBar(e.bar, e.hp / e.maxHp);
  // First hit on an enemy draws police attention.
  if (!e.wantedRaised) {
    e.wantedRaised = true;
    addWanted(ctx, 1);
  }
  if (e.hp <= 0) {
    e.dead = true;
    e.group.visible = false;
    combat.kills += 1;
    const s = stateOf(ctx);
    s.kills = (s.kills || 0) + 1;
    const p = e.group.position;
    burstParticles(ctx, { x: p.x, y: 1.2, z: p.z }, 0xe74c3c, 16, 5);
  }
}

function aimOrigin(ctx) {
  const p = playerPosArr(ctx);
  return { x: p[0], y: (p[1] || 0) + 1.4, z: p[2] };
}

function aimDirection(ctx) {
  const h = playerHeading(ctx);
  return { x: Math.sin(h), y: 0, z: Math.cos(h) };
}

function raycastEnemies(ctx, origin, dir, range) {
  if (!raycaster || !T) return null;
  raycaster.set(
    new T.Vector3(origin.x, origin.y, origin.z),
    new T.Vector3(dir.x, dir.y, dir.z),
  );
  raycaster.far = range;
  const meshes = [];
  for (const e of combat.enemies) {
    if (e.dead) continue;
    e.group.traverse((obj) => { if (obj.isMesh) meshes.push(obj); });
  }
  if (!meshes.length) return null;
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const enemy = hit.object.userData.enemyRef || null;
  return { enemy, point: hit.point, distance: hit.distance };
}

function shoot(ctx) {
  const c = ctx || ctxRef;
  const s = stateOf(ctx);
  if (s.currentCar) return false; // can't shoot while driving
  const weapon = combat.current;
  const stats = WEAPON_STATS[weapon] || WEAPON_STATS.pistol;
  const now = nowSec();
  if (now - lastShotAt < 1 / (stats.rate || 2)) return false;
  lastShotAt = now;

  const origin = aimOrigin(ctx);
  const dir = aimDirection(ctx);
  // Muzzle flash just in front of the player.
  muzzleParticles(ctx, {
    x: origin.x + dir.x * 1.2,
    y: origin.y - 0.1,
    z: origin.z + dir.z * 1.2,
  });
  playSfx(ctx, 'gunshot');
  s.lastGunshot = { x: origin.x, y: origin.y, z: origin.z, t: now };
  s.playerFiring = true;
  s.playerAttacking = true;

  if (weapon === 'rpg') {
    // Explosive round: detonate at the first enemy hit, or at max range.
    const hit = raycastEnemies(ctx, origin, dir, stats.range);
    const impact = hit
      ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
      : { x: origin.x + dir.x * stats.range, y: 1, z: origin.z + dir.z * stats.range };
    if (c && c.particles && typeof c.particles.explosion === 'function') {
      try { c.particles.explosion(impact); } catch (e) { /* optional */ }
    } else {
      burstParticles(ctx, impact, 0xff7722, 40, 14);
    }
    // Area damage: every living enemy near the blast takes the hit.
    for (const e of [...combat.enemies]) {
      if (e.dead) continue;
      const d = Math.hypot(e.group.position.x - impact.x, e.group.position.z - impact.z);
      if (d < 7) damageEnemy(e, stats.damage, ctx);
    }
    return true;
  }

  const hit = raycastEnemies(ctx, origin, dir, stats.range);
  if (hit && hit.enemy) {
    damageEnemy(hit.enemy, stats.damage, ctx);
    burstParticles(ctx, hit.point, 0xff5252, 8, 4);
  } else {
    // Tracer puff where the shot lands (max range / ground).
    const end = {
      x: origin.x + dir.x * stats.range,
      y: Math.max(0.2, origin.y - 1),
      z: origin.z + dir.z * stats.range,
    };
    burstParticles(ctx, end, 0xcccccc, 2, 1);
  }
  return true;
}

function punch(ctx) {
  const c = ctx || ctxRef;
  const s = stateOf(ctx);
  if (s.currentCar) return false;
  const now = nowSec();
  if (now - lastShotAt < 1 / (WEAPON_STATS.fists.rate || 2)) return false;
  lastShotAt = now;
  s.playerAttacking = true;
  s.lastGunshot = null;
  const p = playerPosArr(ctx);
  const dir = aimDirection(ctx);
  let best = null;
  let bestD = WEAPON_STATS.fists.range;
  for (const e of combat.enemies) {
    if (e.dead) continue;
    const ex = e.group.position.x - p[0];
    const ez = e.group.position.z - p[2];
    const d = Math.hypot(ex, ez);
    if (d > bestD) continue;
    const dot = d > 0 ? (ex * dir.x + ez * dir.z) / d : 1;
    if (dot < 0.2) continue; // must be roughly in front of the player
    best = e;
    bestD = d;
  }
  if (best) {
    damageEnemy(best, WEAPON_STATS.fists.damage, ctx);
    const bp = best.group.position;
    burstParticles(ctx, { x: bp.x, y: 1.2, z: bp.z }, 0xffd34d, 6, 3);
    playSfx(ctx, 'gunshot');
  }
  return !!best;
}

function selectWeapon(name) {
  if (!name || !combat.weapons.includes(name)) return false;
  combat.current = name;
  const s = stateOf();
  s.currentWeapon = name;
  return true;
}

function refreshWeapons() {
  const s = stateOf();
  const owned = Array.isArray(s.weaponsOwned) ? s.weaponsOwned : ['fists', 'pistol'];
  const key = owned.join(',');
  if (key === ownedKey) return;
  ownedKey = key;
  combat.weapons = WHEEL_ORDER.filter((w) => w === 'fists' || owned.includes(w));
  if (!combat.weapons.includes(combat.current)) {
    combat.current = combat.weapons[0] || 'fists';
    s.currentWeapon = combat.current;
  }
}

function spawnEnemies(count, center, opts = {}) {
  const out = [];
  const cx = center && typeof center.x === 'number' ? center.x : (Array.isArray(center) ? center[0] : 0);
  const cz = center && typeof center.z === 'number' ? center.z : (Array.isArray(center) ? center[1] : 0);
  const hp = opts.hp || 100;
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.5;
    const r = 5 + Math.random() * 3;
    const e = spawnEnemy(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, hp);
    if (e) out.push(e);
  }
  return out;
}

const combat = {
  weapons: ['fists', 'pistol'],
  current: 'fists',
  enemies: [],
  kills: 0,
  wheelOpen: false,
  stats: WEAPON_STATS,
  selectWeapon,
  shoot: (ctx) => shoot(ctx || ctxRef),
  punch: (ctx) => punch(ctx || ctxRef),
  spawnEnemy,
  spawnEnemies,
  spawnWave: (count, center, opts) => spawnEnemies(count, center, opts),
  damageEnemy: (e, amount, ctx) => damageEnemy(e, amount, ctx || ctxRef),
  _refreshWeapons: refreshWeapons,
};

export function init(ctx) {
  ctxRef = ctx;
  T = (ctx && ctx.THREE) || THREE_SHIM || null;
  if (ctx && ctx.state) {
    ctx.state.playerAttacking = false;
    ctx.state.playerFiring = false;
  }
  if (T) raycaster = new T.Raycaster();
  combat._refreshWeapons();
  // Restore the saved weapon when it is owned.
  if (ctx && ctx.state && ctx.state.currentWeapon && combat.weapons.includes(ctx.state.currentWeapon)) {
    combat.current = ctx.state.currentWeapon;
  }
  if (ctx) ctx.combat = combat;
  return combat;
}

export function update(dt, ctx) {
  const c = ctx || ctxRef;
  if (!c) return;
  const s = stateOf(ctx);
  const input = c.input;

  refreshWeapons();

  // --- Weapon wheel: open while Q is held (not while an overlay is open).
  const wheelHeld = !!input && keyDown(input, 'KeyQ') && !s.uiOpen && !s.currentCar;
  combat.wheelOpen = wheelHeld;
  if (wheelHeld) {
    for (let i = 0; i < WHEEL_KEYS.length; i++) {
      if (keyDown(input, WHEEL_KEYS[i]) && combat.weapons[i]) {
        selectWeapon(combat.weapons[i]);
      }
    }
  }

  // --- Fire / punch on mouse click (edge-triggered).
  const mouseDown = !!(input && input.mouse && input.mouse.down);
  if (mouseDown && !prevMouseDown && !s.uiOpen && !s.currentCar) {
    if (combat.current === 'fists') punch(ctx);
    else shoot(ctx);
  }
  prevMouseDown = mouseDown;
  // Hold-to-fire for automatic weapons (SMG / rifle): keep firing while held.
  if (mouseDown && !s.uiOpen && !s.currentCar
    && (combat.current === 'smg' || combat.current === 'rifle')) {
    shoot(ctx);
  }
  // playerFiring / playerAttacking are per-frame signals for pedestrians:
  // clear them unless the mouse is held down this frame.
  if (!mouseDown) {
    s.playerFiring = false;
    if (combat.current !== 'fists') s.playerAttacking = false;
  }

  // --- Enemies: chase the player, melee when close, flash on hit.
  const step = Math.min(dt, 0.05);
  const p = playerPosArr(ctx);
  for (const e of combat.enemies) {
    if (e.dead) continue;
    e.hitCooldown -= step;
    e.attackCooldown -= step;
    if (e.flash > 0) {
      e.flash -= step;
      if (e.flash <= 0 && e.bodyMat && e.bodyMat.emissive) {
        e.bodyMat.emissive.setHex(0x000000);
      }
    }
    const ep = e.group.position;
    const dx = p[0] - ep.x;
    const dz = p[2] - ep.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ENEMY_CHASE_RANGE && dist > ENEMY_MELEE_RANGE) {
      ep.x += (dx / dist) * e.speed * step;
      ep.z += (dz / dist) * e.speed * step;
      e.group.lookAt(p[0], 0, p[2]);
    } else if (dist <= ENEMY_MELEE_RANGE) {
      e.group.lookAt(p[0], 0, p[2]);
      if (e.attackCooldown <= 0) {
        e.attackCooldown = ENEMY_MELEE_COOLDOWN;
        s.health = Math.max(0, (s.health || 100) - ENEMY_MELEE_DAMAGE);
        if (s.health <= 0) {
          // Busted / down: reset with a hospital bill instead of a death loop.
          s.health = 100;
          s.cash = Math.max(0, (s.cash || 0) - 200);
          if (c.police && typeof c.police.clearWanted === 'function') {
            try { c.police.clearWanted(); } catch (err) { s.wanted = 0; }
          } else {
            s.wanted = 0;
          }
          showMessage(ctx, 'You got beaten down — hospital bill $200. Wanted cleared.');
        }
      }
    }
  }
}

export { WEAPON_STATS };
export default { init, update, WEAPON_STATS };
