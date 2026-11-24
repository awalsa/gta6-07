// ISLA BRASA 3D — drivable cars, motorbike, boat, garage vehicles.
//
// Driving: W/S accelerate/brake/reverse, A/D steer, camera follows behind
// (the player module owns the camera — this module never touches it).
// Rain (state.raining, toggled with V) drops grip to 0.75.
//
// CRITICAL SYNC: while driving, drive() syncs the player mesh to the car
// position/rotation EVERY frame (mesh position, mesh rotation, state.playerPos,
// ctx.playerHeading). If that sync is skipped for even one frame the player
// mesh freezes/stales while driving and taxi/delivery/mission completion
// checks that read the player position break.
//
// Public contract (other modules read these off ctx.cars):
//   ctx.cars = { list, current,
//                spawnCar(type, x, z, heading),
//                spawnMissionCar(center),   // center = {x,z} | [x,z] | Vector3
//                getNearbyCar(pos, maxDist), removeCar(car), drive(dt) }
//   Cars: sedan/coupe/sport/supercar (garage), truck/runner/cruiser/gt
//   (mission/street variants), motorbike ($1,500), boat ($4,500).
//   Garage: sell = 60% of price + 40% of upgrade spend (sellValue).
//   Upgrades live in state.garage.owned[type] = { upgrades, spent }
//   (3 tiers each of engine/armor/handling, owned by the economy module).

import { THREE } from './three.js';
import {
  GARAGE_CARS,
  GARAGE_CAR_PRICES,
  SELL_BACK_RATE,
  SELL_UPGRADE_RATE,
  UPGRADE_MAX_TIER,
  MOTORBIKE_PRICE,
  BOAT_PRICE,
  LANDMARKS,
} from './config.js';

const WORLD_BOUND = 195;
const RAIN_GRIP = 0.75;

let TH = null;
let ctxRef = null;

// Base stats per car type. Garage cars are overridden from config
// GARAGE_CARS at init so the garage UI and the physics never disagree.
const CAR_STATS = {
  sedan:    { topSpeed: 26, accel: 10, steer: 1.8, tough: 1.0, color: 0x8fa3b8, cabin: 0x2c3e50 },
  coupe:    { topSpeed: 32, accel: 13, steer: 2.0, tough: 0.9, color: 0xc0392b, cabin: 0x1a1a1a },
  sport:    { topSpeed: 38, accel: 16, steer: 2.2, tough: 0.9, color: 0xd84a4a, cabin: 0x111111 },
  supercar: { topSpeed: 46, accel: 20, steer: 2.4, tough: 0.8, color: 0x1a1a1e, cabin: 0x000000 },
  truck:    { topSpeed: 22, accel: 9,  steer: 1.4, tough: 2.0, color: 0x27ae60, cabin: 0x145a32 },
  runner:   { topSpeed: 22, accel: 11, steer: 1.8, tough: 1.0, color: 0x7a9ab8, cabin: 0x2c3e50 },
  cruiser:  { topSpeed: 27, accel: 13, steer: 1.9, tough: 1.0, color: 0x5a7ab5, cabin: 0x1a1a1a },
  gt:       { topSpeed: 33, accel: 16, steer: 2.2, tough: 0.9, color: 0xd84a4a, cabin: 0x111111 },
  motorbike:{ topSpeed: 34, accel: 15, steer: 2.9, tough: 0.5, color: 0x222831, cabin: 0x222831 },
  boat:     { topSpeed: 24, accel: 9,  steer: 1.6, tough: 1.2, color: 0xf5f5f5, cabin: 0x2980b9 },
};

const CAR_PRICES = {
  sedan: 2800, coupe: 5000, sport: 8000, supercar: 12000,
  truck: 3200, runner: 2600, cruiser: 4200, gt: 6500,
  motorbike: MOTORBIKE_PRICE, boat: BOAT_PRICE,
};

const CAR_NAMES = {
  sedan: 'Brasa Sedan', coupe: 'Vela Coupe', sport: 'Coral Sport',
  supercar: 'Isla GT', truck: 'Haul Truck', runner: 'Street Runner',
  cruiser: 'City Cruiser', gt: 'Plaza GT',
  motorbike: 'Brasa Bike', boat: 'Marina Boat',
};

function applyConfigPrices() {
  if (Array.isArray(GARAGE_CARS)) {
    for (const g of GARAGE_CARS) {
      if (!g || !CAR_STATS[g.id]) continue;
      if (typeof g.topSpeed === 'number') CAR_STATS[g.id].topSpeed = g.topSpeed;
      if (typeof g.accel === 'number') CAR_STATS[g.id].accel = g.accel;
      if (typeof g.handling === 'number') CAR_STATS[g.id].steer = 1.8 * g.handling;
      if (typeof g.price === 'number') CAR_PRICES[g.id] = g.price;
      if (g.name) CAR_NAMES[g.id] = g.name;
    }
  }
  if (Array.isArray(GARAGE_CAR_PRICES)) {
    const ids = ['sedan', 'coupe', 'sport', 'supercar'];
    GARAGE_CAR_PRICES.forEach((p, i) => { if (ids[i] && typeof p === 'number') CAR_PRICES[ids[i]] = p; });
  }
}

// Sell value: 60% of base price + 40% of what upgrades cost.
export function sellValue(type, upgrades, spent) {
  const price = CAR_PRICES[type] || 0;
  const s = typeof spent === 'number' ? spent : 0;
  return Math.round(price * (SELL_BACK_RATE || 0.6) + s * (SELL_UPGRADE_RATE || 0.4));
}

function keyDown(ctx, ...codes) {
  const keys = ctx && ctx.input && ctx.input.keys;
  if (!keys || typeof keys.has !== 'function') return false;
  return codes.some((c) => keys.has(c));
}

function tryParticles(ctx, kind, pos, opts) {
  const p = ctx && ctx.particles;
  if (!p) return;
  try {
    if (kind === 'smoke' && typeof p.smoke === 'function') p.smoke(pos);
    else if (kind === 'burst' && typeof p.burst === 'function') p.burst(pos, (opts && opts.color) || 0xffd34d, (opts && opts.count) || 10, 4);
  } catch (e) { /* particles are optional */ }
}

function wheelMesh(mat) {
  const w = new TH.Mesh(new TH.CylinderGeometry(0.36, 0.36, 0.28, 12), mat);
  w.rotation.z = Math.PI / 2; // axle along X
  return w;
}

// Low-poly car: box body + cabin box + 4 cylinder wheels. Forward is +Z,
// so heading = rotation.y and forward = (sin h, 0, cos h).
function buildCarMesh(type) {
  const st = CAR_STATS[type] || CAR_STATS.sedan;
  const group = new TH.Group();
  const bodyMat = new TH.MeshLambertMaterial({ color: st.color });
  const cabinMat = new TH.MeshLambertMaterial({ color: st.cabin });
  const darkMat = new TH.MeshLambertMaterial({ color: 0x111111 });
  const glassMat = new TH.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x1a3a4a });

  if (type === 'motorbike') {
    const frame = new TH.Mesh(new TH.BoxGeometry(0.28, 0.28, 1.9), bodyMat);
    frame.position.y = 0.62;
    group.add(frame);
    const seat = new TH.Mesh(new TH.BoxGeometry(0.3, 0.12, 0.7), darkMat);
    seat.position.set(0, 0.82, -0.35);
    group.add(seat);
    const tank = new TH.Mesh(new TH.BoxGeometry(0.34, 0.24, 0.6), cabinMat);
    tank.position.set(0, 0.8, 0.35);
    group.add(tank);
    const bars = new TH.Mesh(new TH.BoxGeometry(0.7, 0.06, 0.06), darkMat);
    bars.position.set(0, 0.95, 0.85);
    group.add(bars);
    const light = new TH.Mesh(new TH.BoxGeometry(0.2, 0.12, 0.06),
      new TH.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffdf5e }));
    light.position.set(0, 0.68, 1.0);
    group.add(light);
    const wheels = [];
    for (const z of [0.85, -0.85]) {
      const w = new TH.Mesh(new TH.CylinderGeometry(0.34, 0.34, 0.14, 12), darkMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.34, z);
      group.add(w);
      wheels.push(w);
    }
    group.userData.wheels = wheels;
    return group;
  }

  if (type === 'boat') {
    const hull = new TH.Mesh(new TH.BoxGeometry(2.4, 0.7, 5.0), bodyMat);
    hull.position.y = 0.45;
    group.add(hull);
    const bow = new TH.Mesh(new TH.BoxGeometry(2.0, 0.55, 1.2), bodyMat);
    bow.position.set(0, 0.45, 2.9);
    bow.rotation.x = -0.25;
    group.add(bow);
    const cabin = new TH.Mesh(new TH.BoxGeometry(1.7, 0.8, 1.8), cabinMat);
    cabin.position.set(0, 1.15, -0.4);
    group.add(cabin);
    const glass = new TH.Mesh(new TH.BoxGeometry(1.5, 0.4, 0.1), glassMat);
    glass.position.set(0, 1.25, 0.55);
    group.add(glass);
    const mast = new TH.Mesh(new TH.CylinderGeometry(0.06, 0.06, 2.4, 8), darkMat);
    mast.position.set(0, 2.4, -0.4);
    group.add(mast);
    group.userData.wheels = [];
    return group;
  }

  const long = type === 'truck';
  const bodyLen = long ? 5.2 : 4.2;
  const body = new TH.Mesh(new TH.BoxGeometry(2.2, 0.62, bodyLen), bodyMat);
  body.position.y = 0.58;
  group.add(body);

  if (long) {
    const bed = new TH.Mesh(new TH.BoxGeometry(2.0, 0.5, 2.6), cabinMat);
    bed.position.set(0, 1.05, -1.2);
    group.add(bed);
    const cab = new TH.Mesh(new TH.BoxGeometry(1.9, 0.7, 1.4), glassMat);
    cab.position.set(0, 1.15, 1.2);
    group.add(cab);
  } else {
    const cabin = new TH.Mesh(new TH.BoxGeometry(1.9, 0.55, 2.1), cabinMat);
    cabin.position.set(0, 1.12, -0.25);
    group.add(cabin);
    const windshield = new TH.Mesh(new TH.BoxGeometry(1.8, 0.4, 0.08), glassMat);
    windshield.position.set(0, 1.1, 0.85);
    windshield.rotation.x = -0.35;
    group.add(windshield);
  }

  if (type === 'sport' || type === 'supercar' || type === 'gt') {
    const spoiler = new TH.Mesh(new TH.BoxGeometry(2.0, 0.08, 0.4), darkMat);
    spoiler.position.set(0, 1.25, -bodyLen / 2 + 0.15);
    group.add(spoiler);
    const strutL = new TH.Mesh(new TH.BoxGeometry(0.08, 0.3, 0.08), darkMat);
    strutL.position.set(-0.8, 1.05, -bodyLen / 2 + 0.15);
    group.add(strutL);
    const strutR = strutL.clone();
    strutR.position.x = 0.8;
    group.add(strutR);
  }

  const headMat = new TH.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffdf5e });
  for (const x of [-0.7, 0.7]) {
    const h = new TH.Mesh(new TH.BoxGeometry(0.36, 0.16, 0.06), headMat);
    h.position.set(x, 0.62, bodyLen / 2 + 0.02);
    group.add(h);
    const t = new TH.Mesh(new TH.BoxGeometry(0.36, 0.16, 0.06),
      new TH.MeshLambertMaterial({ color: 0xff2222, emissive: 0x881111 }));
    t.position.set(x, 0.62, -bodyLen / 2 - 0.02);
    group.add(t);
  }

  const wheels = [];
  for (const [x, z] of [[-1.05, 1.35], [1.05, 1.35], [-1.05, -1.35], [1.05, -1.35]]) {
    const w = wheelMesh(darkMat);
    w.position.set(x, 0.36, z);
    group.add(w);
    wheels.push(w);
  }
  group.userData.wheels = wheels;
  return group;
}

function garageSpots() {
  const g = (LANDMARKS && LANDMARKS.brasaGarage) || [80, -40];
  const spots = [];
  for (let i = 0; i < 6; i++) spots.push([g[0] - 8 + i * 3.2, g[1] + 10]);
  return spots;
}

const cars = {
  list: [],
  current: null,

  spawnCar(type, x, z, heading = 0) {
    const ctx = ctxRef;
    const stats = CAR_STATS[type] || CAR_STATS.sedan;
    const mesh = buildCarMesh(type);
    mesh.position.set(x || 0, 0, z || 0);
    mesh.rotation.y = heading || 0;
    if (ctx && ctx.scene) ctx.scene.add(mesh);
    const ownedUpgrades = (ctx && ctx.state && ctx.state.garage && ctx.state.garage.owned &&
      ctx.state.garage.owned[type]) || null;
    const car = {
      type,
      name: CAR_NAMES[type] || type,
      mesh,
      group: mesh,
      pos: mesh.position, // live alias — missions/traffic read car.pos
      heading: heading || 0,
      speed: 0,
      steer: 0,
      stats,
      topSpeed: stats.topSpeed,
      accel: stats.accel,
      isBoat: type === 'boat',
      isBike: type === 'motorbike',
      upgrades: ownedUpgrades ? { ...ownedUpgrades.upgrades } : { engine: 0, armor: 0, handling: 0 },
      owned: !!(ctx && ctx.state && (ctx.state.carsOwned || []).includes(type)),
      mission: false,
      _smokeT: 0,
    };
    this.list.push(car);
    return car;
  },

  // Missions spawn a stealable target car at a landmark centre.
  // centre may be {x,z}, [x,z] or a Vector3.
  spawnMissionCar(center) {
    let x = 0;
    let z = 0;
    if (center) {
      if (Array.isArray(center)) { x = center[0] || 0; z = center[1] || 0; }
      else if (typeof center.x === 'number') { x = center.x; z = center.z || 0; }
    }
    const car = this.spawnCar('sedan', x + 3, z + 3, 0);
    car.mission = true;
    return car;
  },

  getNearbyCar(pos, maxDist = 4.5) {
    if (!pos) return null;
    const px = typeof pos.x === 'number' ? pos.x : pos[0];
    const pz = typeof pos.z === 'number' ? pos.z : pos[2];
    let best = null;
    let bestD = maxDist;
    for (const car of this.list) {
      const dx = car.pos.x - px;
      const dz = car.pos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  },

  removeCar(car) {
    if (!car) return;
    const i = this.list.indexOf(car);
    if (i >= 0) this.list.splice(i, 1);
    if (car.mesh && ctxRef && ctxRef.scene) ctxRef.scene.remove(car.mesh);
    if (this.current === car) this.current = null;
  },

  // Arcade driving physics for the currently driven car. Called every frame
  // from update() while a car is driven — never from anywhere else.
  drive(dt) {
    const ctx = ctxRef;
    const car = this.current;
    if (!car || !ctx) return;
    const state = ctx.state || {};
    if (state.uiOpen || ctx.uiOpen) {
      // Overlay open: car idles, but the player mesh still syncs below.
      car.speed *= Math.max(0, 1 - 2 * dt);
    } else {
      const up = car.upgrades || { engine: 0, armor: 0, handling: 0 };
      const engineMult = 1 + 0.12 * Math.min(UPGRADE_MAX_TIER || 3, up.engine || 0);
      const handlingMult = 1 + 0.1 * Math.min(UPGRADE_MAX_TIER || 3, up.handling || 0);
      const grip = state.raining ? RAIN_GRIP : 1;
      let topSpeed = car.topSpeed * engineMult;
      let accel = car.accel * engineMult;

      // Boat: full speed on water, a slow crawl on land.
      const inWater = ctx.world && typeof ctx.world.isInWater === 'function'
        ? ctx.world.isInWater(car.pos.x, car.pos.z) : false;
      if (car.isBoat && !inWater) { topSpeed *= 0.22; accel *= 0.4; }
      if (car.isBike) { accel *= 1.25; }

      const fwd = keyDown(ctx, 'KeyW', 'ArrowUp');
      const rev = keyDown(ctx, 'KeyS', 'ArrowDown');
      if (fwd) car.speed += accel * dt;
      if (rev) {
        if (car.speed > 0.5) car.speed -= accel * 1.6 * dt; // brake
        else car.speed -= accel * 0.7 * dt; // reverse
      }
      if (!fwd && !rev) car.speed *= Math.max(0, 1 - 0.9 * dt); // coast drag
      car.speed -= car.speed * 0.25 * dt; // rolling drag
      const maxRev = topSpeed * 0.4;
      car.speed = Math.max(-maxRev, Math.min(topSpeed, car.speed));
      if (Math.abs(car.speed) < 0.05 && !fwd && !rev) car.speed = 0;

      // Steering: sharper at speed, scaled by grip and handling upgrades.
      const steerIn = (keyDown(ctx, 'KeyA') ? 1 : 0) - (keyDown(ctx, 'KeyD') ? 1 : 0);
      const steerRate = (car.stats.steer || 1.8) * handlingMult * grip * (car.isBike ? 1.3 : 1);
      const speedFactor = Math.min(1, Math.abs(car.speed) / 12);
      car.steer += ((steerIn * 0.6) - car.steer) * Math.min(1, 8 * dt);
      car.heading += car.steer * steerRate * speedFactor * dt * (car.speed >= 0 ? 1 : -1);
    }

    // Move along the heading. Forward is +Z of the mesh: (sin h, cos h).
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    car.pos.x += fx * car.speed * dt;
    car.pos.z += fz * car.speed * dt;

    // World edge: soft clamp, bleed speed on impact.
    if (car.pos.x < -WORLD_BOUND || car.pos.x > WORLD_BOUND ||
        car.pos.z < -WORLD_BOUND || car.pos.z > WORLD_BOUND) {
      car.pos.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, car.pos.x));
      car.pos.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, car.pos.z));
      car.speed *= 0.4;
    }

    // Building collision: circle-vs-AABB push-out, lose half the speed.
    if (ctx.world && ctx.world.buildings) {
      const before = { x: car.pos.x, z: car.pos.z };
      for (const b of ctx.world.buildings) {
        if (typeof b.minX !== 'number') continue;
        const cx = Math.max(b.minX, Math.min(car.pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(car.pos.z, b.maxZ));
        const dx = car.pos.x - cx;
        const dz = car.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        const r = 1.6;
        if (d2 < r * r) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            car.pos.x = cx + (dx / d) * r;
            car.pos.z = cz + (dz / d) * r;
          } else {
            car.pos.x = b.maxX + r;
          }
          car.speed *= 0.5;
        }
      }
      if (Math.abs(car.pos.x - before.x) > 0.01 || Math.abs(car.pos.z - before.z) > 0.01) {
        tryParticles(ctx, 'burst', car.pos, { color: 0xaaaaaa, count: 4 });
      }
    }

    // Boat floats on the water plane; everything else sits at y = 0.
    car.pos.y = car.isBoat ? 0.15 + Math.sin((ctx.time || 0) * 1.5) * 0.06 : 0;
    car.mesh.rotation.y = car.heading;
    if (car.isBoat) car.mesh.rotation.z = Math.sin((ctx.time || 0) * 1.2) * 0.02;

    // Wheel spin.
    const wheels = (car.mesh.userData && car.mesh.userData.wheels) || [];
    for (const w of wheels) w.rotation.x += car.speed * dt * 1.4;

    // Exhaust puffs while moving.
    car._smokeT -= dt;
    if (Math.abs(car.speed) > 4 && car._smokeT <= 0) {
      car._smokeT = 0.14;
      const bx = car.pos.x - fx * 2.2;
      const bz = car.pos.z - fz * 2.2;
      tryParticles(ctx, 'smoke', { x: bx, y: 0.6, z: bz });
    }

    // --- CRITICAL: sync the player mesh to the car EVERY frame. ---
    // The player mesh is hidden inside the car while driving, but its
    // position/rotation is what the HUD, minimap, missions and side jobs
    // read — if this stops, the player freezes on the map mid-drive.
    if (ctx.player && ctx.player.mesh) {
      ctx.player.mesh.position.set(car.pos.x, 0, car.pos.z);
      ctx.player.mesh.rotation.y = car.heading;
      ctx.player.mesh.visible = false;
    }
    if (ctx.state) {
      ctx.state.playerPos = [car.pos.x, 0, car.pos.z];
      ctx.state.playerHeading = car.heading;
    }
    ctx.playerHeading = car.heading;
    // Audio / radio read the live vehicle speed from here.
    ctx.vehicle = { speed: car.speed, type: car.type, heading: car.heading };
  },
};

function syncGarageCars(ctx) {
  if (!ctx || !ctx.state) return;
  const owned = new Set((ctx.state.carsOwned || []).filter((t) => CAR_STATS[t]));
  const garageOwned = (ctx.state.garage && ctx.state.garage.owned) || {};
  for (const type of Object.keys(garageOwned)) owned.add(type);
  const have = new Set(cars.list.map((c) => c.type));
  const spots = garageSpots();
  let i = 0;
  for (const type of owned) {
    if (have.has(type)) continue;
    const spot = spots[i % spots.length];
    i += 1;
    const car = cars.spawnCar(type, spot[0], spot[1], Math.PI);
    car.owned = true;
    const ledger = garageOwned[type];
    if (ledger && ledger.upgrades) car.upgrades = { ...ledger.upgrades };
  }
}

export function init(ctx) {
  TH = (ctx && ctx.THREE) || THREE;
  ctxRef = ctx;
  applyConfigPrices();
  ctx.cars = cars;
  syncGarageCars(ctx);
  // Always have at least the starter sedan parked at the garage.
  if (!cars.list.length) cars.spawnCar('sedan', 72, -30, Math.PI);
  return cars;
}

export function update(dt, ctx) {
  if (!ctxRef) ctxRef = ctx;
  syncGarageCars(ctx);
  // Driving only happens while the player is in a car; drive() guards that.
  if (cars.current) cars.drive(dt);
  else if (ctx) ctx.vehicle = null;
}

export { CAR_PRICES, CAR_STATS, CAR_NAMES };
export default cars;
