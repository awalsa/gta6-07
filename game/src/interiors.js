// interiors.js — ISLA BRASA 3D: enterable interiors (round 7, worker W7).
//
// Three enterable places: the Brasa Garage, the Coral Room Casino and the
// Vela Safehouse (at the Motel Vela landmark). Press F at a glowing green
// door outside a building to step inside: the screen fades and the player is
// moved into a small interior room built far outside the city (x ~ 1000) so
// it can never collide with the street map. F at the glowing exit door walks
// back out to the exact spot the player entered from.
//   - Garage: workbench, tool shelf, tyre stacks, lift pad. F inside reports
//     how many cars the player owns (buying happens outside, with G).
//   - Casino: slot machines, a card table and a bar. F at the card table
//     opens the casino games via ctx.casino.open().
//   - Safehouse: bed, table, TV, wardrobe. F at the bed sleeps: one day
//     passes (owned properties pay their daily income — the properties
//     module pays out whenever state.day increments) and the game saves.
//
// Exports init(ctx) and update(dt, ctx). Attaches:
//   ctx.interiors = { inside, enter, exit }
// ctx = { scene, camera, renderer, state, input, config, THREE }.

import THREE from './three.js';
import * as CFG from './config.js';

const LANDMARKS = CFG.LANDMARKS || null;

// Landmark keys in config.js for each interior's door.
const LM = {
  garage: 'brasaGarage',
  casino: 'coralCasino',
  safehouse: 'motelVela',
};

// Fallbacks used only if config.js has no landmark for a door.
const FALLBACK = {
  garage: { x: 80, z: -40 },
  casino: { x: 120, z: 120 },
  safehouse: { x: -40, z: 40 },
};

// Interior rooms live far outside the city so they never collide with it.
const ROOMS = {
  garage: { center: [1000, 0, 1000], wall: 0x3a3f4a, floor: 0x555a66, label: 'Brasa Garage' },
  casino: { center: [1060, 0, 1000], wall: 0x4a1030, floor: 0x2a0a1a, label: 'Coral Room' },
  safehouse: { center: [1120, 0, 1000], wall: 0x2a3a4a, floor: 0x6b4a2a, label: 'Safehouse' },
};

let S = null; // { ctx, inside, returnPos, doors, prevF, transitioning }

function getTHREE(ctx) {
  if (ctx && ctx.THREE) return ctx.THREE;
  return THREE;
}

function lmPos(name, ctx) {
  const T = getTHREE(ctx);
  const key = LM[name] || name;
  const src = (LANDMARKS && LANDMARKS[key]) || FALLBACK[name] || { x: 0, z: 0 };
  if (Array.isArray(src)) return new T.Vector3(src[0], 0, src[1]);
  if (src && src.position) return new T.Vector3(src.position.x || 0, 0, src.position.z || 0);
  if (src && typeof src.x === 'number') return new T.Vector3(src.x, 0, src.z || 0);
  return new T.Vector3(0, 0, 0);
}

function keyDown(ctx, code) {
  const inp = (ctx && ctx.input) || {};
  if (typeof inp.isDown === 'function') return !!inp.isDown(code);
  if (inp.keys instanceof Set) return inp.keys.has(code);
  if (Array.isArray(inp.keys)) return inp.keys.includes(code);
  if (inp.keys) return !!inp.keys[code];
  if (typeof inp[code] === 'boolean') return inp[code];
  return false;
}

// The player's position, from whichever representation the player module
// keeps. state.playerPos is an ARRAY [x, y, z] (see state.js).
function playerPos(ctx) {
  const T = getTHREE(ctx);
  if (ctx.player) {
    if (ctx.player.position && typeof ctx.player.position.x === 'number') return ctx.player.position;
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (typeof ctx.player.getPosition === 'function') {
      const p = ctx.player.getPosition();
      if (p) return p;
    }
  }
  if (ctx.state && Array.isArray(ctx.state.playerPos)) {
    return new T.Vector3(ctx.state.playerPos[0] || 0, ctx.state.playerPos[1] || 0, ctx.state.playerPos[2] || 0);
  }
  if (ctx.state && ctx.state.playerPos && typeof ctx.state.playerPos.x === 'number') return ctx.state.playerPos;
  if (ctx.camera) return ctx.camera.position;
  return new T.Vector3(0, 0, 0);
}

// Move the player: write EVERY representation so the player module and the
// follow camera (which reads state.playerPos) agree on the new spot.
function setPlayerPos(ctx, v) {
  if (ctx.player) {
    if (ctx.player.position && typeof ctx.player.position.copy === 'function') ctx.player.position.copy(v);
    if (ctx.player.mesh && ctx.player.mesh.position && typeof ctx.player.mesh.position.copy === 'function') ctx.player.mesh.position.copy(v);
    if (typeof ctx.player.setPosition === 'function') {
      try { ctx.player.setPosition(v); } catch (e) { /* ignore */ }
    }
  }
  if (ctx.state && Array.isArray(ctx.state.playerPos)) {
    ctx.state.playerPos[0] = v.x;
    ctx.state.playerPos[1] = v.y;
    ctx.state.playerPos[2] = v.z;
  } else if (ctx.state && ctx.state.playerPos && typeof ctx.state.playerPos.copy === 'function') {
    ctx.state.playerPos.copy(v);
  }
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
  console.log('[interiors]', msg);
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

// Full-screen fade used for the enter/exit transition.
function fadeTo(opacity, ms, done) {
  if (typeof document === 'undefined') { if (done) done(); return; }
  let el = document.getElementById('fade-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fade-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9997;transition:opacity ' + ms + 'ms ease;';
    document.body.appendChild(el);
  }
  el.style.transition = 'opacity ' + ms + 'ms ease';
  // Force a reflow so the transition runs from the current value.
  void el.offsetWidth;
  el.style.opacity = String(opacity);
  setTimeout(() => { if (done) done(); }, ms + 30);
}

// --- Room construction -------------------------------------------------------

function box(T, w, h, d, color, x, y, z, emissive) {
  const mat = new T.MeshLambertMaterial({
    color,
    emissive: emissive != null ? emissive : 0x000000,
  });
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildRoom(ctx, place) {
  const T = getTHREE(ctx);
  const def = ROOMS[place];
  const g = new T.Group();
  const [cx, , cz] = def.center;
  const W = 16, D = 14, H = 5; // room width (x), depth (z), height (y)

  // Floor + ceiling + 4 walls.
  const floor = new T.Mesh(
    new T.PlaneGeometry(W, D),
    new T.MeshLambertMaterial({ color: def.floor })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  g.add(floor);
  const ceil = new T.Mesh(
    new T.PlaneGeometry(W, D),
    new T.MeshLambertMaterial({ color: 0x1a1a22 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, 5, cz);
  g.add(ceil);
  const wallMat = new T.MeshLambertMaterial({ color: def.wall });
  const mkWall = (w, h, d, x, y, z) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    g.add(m);
  };
  mkWall(W, 5, 0.4, cx, 2.5, cz - D / 2); // north
  mkWall(W, 5, 0.4, cx, 2.5, cz + D / 2); // south
  mkWall(0.4, 5, D, cx - W / 2, 2.5, cz); // west
  mkWall(0.4, 5, D, cx + W / 2, 2.5, cz); // east

  // Warm ceiling light so the room reads at night too.
  const light = new T.PointLight(0xffe0b3, 60, 30);
  light.position.set(cx, 4.2, cz);
  g.add(light);

  // Glowing green exit panel on the south wall (matches update()'s exitPos).
  const exit = box(T, 1.6, 2.6, 0.2, 0x2ecc71, cx, 1.3, cz + D / 2 - 0.3, 0x2ecc71);
  g.add(exit);

  if (place === 'garage') {
    // Lift pad in the middle, workbench + shelf on the north wall, tyres.
    const pad = box(T, 4, 0.25, 6, 0x222831, cx, 0.15, cz, 0x000000);
    g.add(pad);
    g.add(box(T, 5, 1, 1.2, 0x6b4a2a, cx - 4, 0.5, cz - D / 2 + 1, 0x000000)); // workbench
    g.add(box(T, 5, 0.3, 1, 0x8a5a2a, cx - 4, 2.2, cz - D / 2 + 0.6, 0x000000)); // shelf
    // Tyre stack: three dark tori/cylinders.
    for (let i = 0; i < 3; i++) {
      const tyre = new T.Mesh(
        new T.CylinderGeometry(0.55, 0.55, 0.3, 12),
        new T.MeshLambertMaterial({ color: 0x111111 })
      );
      tyre.position.set(cx + 5.5, 0.15 + i * 0.32, cz - 4);
      g.add(tyre);
    }
    // Tool chest (red box) on the east wall.
    g.add(box(T, 1.2, 1.6, 2.4, 0xc0392b, cx + W / 2 - 0.8, 0.8, cz + 2, 0x000000));
  } else if (place === 'casino') {
    // Row of slot machines along the north wall (bright, emissive fronts).
    for (let i = 0; i < 4; i++) {
      const x = cx - 5.4 + i * 3.6;
      g.add(box(T, 1.6, 2.2, 1, 0x7b1fa2, x, 1.1, cz - D / 2 + 0.8, 0x311b92));
      g.add(box(T, 1.2, 0.7, 0.1, 0xffd34d, x, 1.7, cz - D / 2 + 1.35, 0xffd34d));
    }
    // Card table in the middle (green felt top on a dark base).
    g.add(box(T, 3.6, 0.9, 2.2, 0x4a2c1a, cx, 0.45, cz - 1, 0x000000));
    g.add(box(T, 3.4, 0.12, 2, 0x0e6b3a, cx, 0.95, cz - 1, 0x000000));
    // Bar counter on the east wall.
    g.add(box(T, 1.4, 1.1, 6, 0x3a1a0a, cx + W / 2 - 1, 0.55, cz, 0x000000));
    g.add(box(T, 1.2, 0.15, 5.6, 0xd4af37, cx + W / 2 - 1, 1.15, cz, 0x000000));
  } else if (place === 'safehouse') {
    // Bed on the west side (frame + mattress + pillow).
    g.add(box(T, 2.2, 0.5, 4.4, 0x5a3a1a, cx - 4.5, 0.25, cz - 3, 0x000000));
    g.add(box(T, 2, 0.35, 4.2, 0xf5f0e6, cx - 4.5, 0.65, cz - 3, 0x000000));
    g.add(box(T, 1.6, 0.25, 0.8, 0xffffff, cx - 4.5, 0.85, cz - 4.6, 0x000000));
    // Table + TV on the north wall.
    g.add(box(T, 3, 0.8, 1.4, 0x4a2c1a, cx + 1, 0.4, cz - 4.5, 0x000000));
    g.add(box(T, 2.6, 1.5, 0.25, 0x111111, cx + 1, 2.2, cz - D / 2 + 0.4, 0x1a2a3a));
    // Wardrobe on the east wall + rug in the middle.
    g.add(box(T, 1.2, 2.6, 3, 0x6b4a2a, cx + W / 2 - 0.8, 1.3, cz - 2, 0x000000));
    const rug = new T.Mesh(
      new T.PlaneGeometry(4, 3),
      new T.MeshLambertMaterial({ color: 0x7a1f2b })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx + 1, 0.05, cz + 2);
    g.add(rug);
  }

  return g;
}

// --- Enter / exit / sleep ----------------------------------------------------

function enter(ctx, place) {
  if (!S || !ROOMS[place] || S.inside || S.transitioning) return false;
  if (ctx.plane && ctx.plane.inPlane) return false;
  const T = getTHREE(ctx);
  S.transitioning = true;
  S.returnPos = playerPos(ctx).clone();
  fadeTo(1, 300, () => {
    S.inside = place;
    const room = ROOMS[place];
    setPlayerPos(ctx, new T.Vector3(room.center[0], 0, room.center[2] + 3));
    if (ctx.state) ctx.state.insideInterior = place;
    fadeTo(0, 300, () => { S.transitioning = false; });
    let hint = 'You enter the ' + room.label + '.';
    if (place === 'safehouse') hint += ' Press F at the bed to sleep & save.';
    if (place === 'casino') hint += ' Press F at the card table to play.';
    toast(ctx, hint);
  });
  return true;
}

function exitInterior(ctx) {
  if (!S || !S.inside || S.transitioning) return false;
  const place = S.inside;
  S.transitioning = true;
  fadeTo(1, 300, () => {
    S.inside = null;
    if (S.returnPos) setPlayerPos(ctx, S.returnPos);
    if (ctx.state) ctx.state.insideInterior = null;
    fadeTo(0, 300, () => { S.transitioning = false; });
    toast(ctx, 'You leave the ' + ROOMS[place].label + '.');
  });
  return true;
}

function saveNow(ctx) {
  // main.js attaches the real save as ctx.saveGame (and ctx.save).
  if (typeof ctx.saveGame === 'function') { try { ctx.saveGame(); return true; } catch (e) { /* fall through */ } }
  if (typeof ctx.save === 'function') { try { ctx.save(); return true; } catch (e) { /* fall through */ } }
  if (ctx.state && typeof ctx.state.saveGame === 'function') { try { ctx.state.saveGame(); return true; } catch (e) { /* fall through */ } }
  return false;
}

function sleep(ctx) {
  // A new day begins: increment the day counter (the properties module pays
  // daily income whenever state.day goes up) and save the game.
  if (ctx.state && typeof ctx.state.day === 'number') ctx.state.day += 1;
  const saved = saveNow(ctx);
  if (saved) {
    const day = ctx.state && typeof ctx.state.day === 'number' ? ctx.state.day : '?';
    toast(ctx, 'You sleep… game saved. A new day begins (Day ' + day + ').');
  } else {
    toast(ctx, 'You sleep… but no save function is available (ctx.saveGame missing).');
  }
}

function countGarageCars(ctx) {
  const st = ctx.state || {};
  if (Array.isArray(st.carsOwned)) return st.carsOwned.length;
  if (Array.isArray(st.garageOwned)) return st.garageOwned.length;
  if (st.garage && st.garage.owned && typeof st.garage.owned === 'object') return Object.keys(st.garage.owned).length;
  return 0;
}

// --- init / update -----------------------------------------------------------

export function init(ctx) {
  const T = getTHREE(ctx);
  S = {
    ctx,
    inside: null,
    returnPos: null,
    rooms: {},
    doors: {
      // Doors sit just OUTSIDE each building's footprint: the world pushes
      // the player out of building AABBs, so a door at the landmark centre
      // (or an offset still inside the footprint) could never be reached.
      garage: lmPos('garage', ctx).add(new T.Vector3(0, 0, 11)),
      casino: lmPos('casino', ctx).add(new T.Vector3(-14, 0, 0)),
      safehouse: lmPos('safehouse', ctx).add(new T.Vector3(0, 0, 8)),
    },
    prevF: false,
    transitioning: false,
  };

  if (ctx.scene) {
    for (const place of Object.keys(ROOMS)) {
      S.rooms[place] = buildRoom(ctx, place);
      ctx.scene.add(S.rooms[place]);
    }
    // Door markers in the world: glowing green doorway panels + floor rings.
    for (const [place, pos] of Object.entries(S.doors)) {
      const marker = box(T, 1.6, 2.6, 0.2, 0x2ecc71, pos.x, 1.3, pos.z, 0x2ecc71);
      ctx.scene.add(marker);
      const ring = new T.Mesh(
        new T.RingGeometry(1.2, 1.7, 24),
        new T.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.7, side: T.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, 0.15, pos.z);
      ctx.scene.add(ring);
    }
  }

  const api = {
    get inside() { return S.inside; },
    enter(place) { return enter(ctx, place); },
    exit() { return exitInterior(ctx); },
  };
  ctx.interiors = api;
  return api;
}

export function update(dt, ctx) {
  if (!S || S.transitioning) return;
  const T = getTHREE(ctx);
  const p = playerPos(ctx);
  const fDown = keyDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;

  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;

  if (!S.inside) {
    // Outside: F at a door enters that interior.
    if (fPressed && !overlayOpen && !inPlane) {
      for (const [place, doorPos] of Object.entries(S.doors)) {
        if (p.distanceTo(doorPos) < 4) { enter(ctx, place); return; }
      }
    }
    if (!overlayOpen && !inPlane) {
      for (const [place, doorPos] of Object.entries(S.doors)) {
        if (p.distanceTo(doorPos) < 4) {
          setPrompt('Press F — Enter the ' + ROOMS[place].label);
          return;
        }
      }
    }
    setPrompt('');
    return;
  }

  // Inside an interior.
  const room = ROOMS[S.inside];
  const c = room.center;
  const exitPos = new T.Vector3(c[0], 0, c[2] + 5);
  const bedPos = new T.Vector3(c[0] - 4.5, 0, c[2] - 3);
  const tablePos = new T.Vector3(c[0], 0, c[2] - 1);

  // Walk inside the room (WASD, world axes). The player module freezes
  // on-foot movement while insideInterior, so without this the player is
  // stuck at the entry point (center + 3z) and can never reach the bed
  // (7.5u away) or the casino table (4u away) — both outside the 3.5u
  // F range. Clamp to the room so the player cannot walk through the
  // walls, and face the movement direction so the follow camera swings
  // behind. (playerPos `p` above is the live mesh position, so the F
  // checks below see the moved position.)
  if (!overlayOpen && !inPlane && ctx.player && ctx.player.mesh) {
    const step = Math.min(typeof dt === 'number' && dt > 0 ? dt : 0.016, 0.1);
    let mx = (keyDown(ctx, 'KeyD') ? 1 : 0) - (keyDown(ctx, 'KeyA') ? 1 : 0);
    let mz = (keyDown(ctx, 'KeyS') ? 1 : 0) - (keyDown(ctx, 'KeyW') ? 1 : 0);
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      const mesh = ctx.player.mesh;
      const nx = Math.max(c[0] - 7, Math.min(c[0] + 7, mesh.position.x + mx * 6 * step));
      const nz = Math.max(c[2] - 6, Math.min(c[2] + 6, mesh.position.z + mz * 6 * step));
      setPlayerPos(ctx, new T.Vector3(nx, 0, nz));
      mesh.rotation.y = Math.atan2(mx, mz);
    }
  }

  if (fPressed && !overlayOpen) {
    if (p.distanceTo(exitPos) < 3.5) { exitInterior(ctx); return; }
    if (S.inside === 'safehouse' && p.distanceTo(bedPos) < 3.5) { sleep(ctx); return; }
    if (S.inside === 'casino' && p.distanceTo(tablePos) < 3.5) {
      if (ctx.casino && typeof ctx.casino.open === 'function') ctx.casino.open();
      else toast(ctx, 'The casino games are not loaded (ctx.casino missing).');
      return;
    }
    if (S.inside === 'garage') {
      toast(ctx, 'Your garage holds ' + countGarageCars(ctx) + ' car(s). Buy more outside with G.');
      return;
    }
  }

  // Contextual prompt while inside.
  let prompt = '';
  if (!overlayOpen) {
    if (p.distanceTo(exitPos) < 3.5) prompt = 'Press F — Leave the ' + room.label;
    else if (S.inside === 'safehouse' && p.distanceTo(bedPos) < 3.5) prompt = 'Press F — Sleep & save the game';
    else if (S.inside === 'casino' && p.distanceTo(tablePos) < 3.5) prompt = 'Press F — Play slots, blackjack & roulette';
  }
  setPrompt(prompt);
}

export default { init, update };
