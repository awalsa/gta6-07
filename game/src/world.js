// ISLA BRASA 3D — the city.
//
// Builds the whole 3D island in one pass: ground, the road grid, the sea and
// beach on the south edge, the runway on the north edge, twelve distinct
// landmarks, a field of low-poly buildings, lamps, palms, parked cars and
// crates, plus a gradient sky dome, a sun and drifting clouds.
//
// What other modules get (ctx.world):
//   { landmarks, landmarksList, buildings, buildingCount,
//     roads, roadWidth, worldSize, crates, parkedCars, lamps,
//     dirLight, hemiLight, sunMesh, skyUniforms, lampHeadMat, windowMat,
//     waterMesh, waterMat,
//     isOnRoad(x, z), isInWater(x, z), getGroundY(x, z), setNightFactor(f) }
//
// setNightFactor(f) is the day/night hook: f = 0 at noon, 1 at midnight.
// daynight.js calls it every frame; it darkens the sky, dims the sun and
// switches the lamps and windows on. The city itself is static — update()
// only animates water, clouds and a faint lamp shimmer.

import THREE from './three.js';
import {
  LANDMARKS,
  LANDMARK_NAMES,
  ROAD_LINES,
  ROAD_WIDTH,
  WORLD_SIZE,
} from './config.js';

const SIZE = WORLD_SIZE;
const HALF = SIZE / 2;
const LINES = ROAD_LINES;
const ROAD_HALF = ROAD_WIDTH / 2;

// Deterministic layout so the city looks the same on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xB3A5A);

// ---------------------------------------------------------------------------
// Module-level handles (update() animates these; setNightFactor() tunes them)
// ---------------------------------------------------------------------------

let elapsed = 0;
let waterMesh = null;
let waterMat = null;
let dirLight = null;
let hemiLight = null;
let sunMesh = null;
let skyUniforms = null;
let lampHeadMat = null;
let windowMat = null;
const clouds = [];

// Landmarks as { key: { x, z, name } } plus a flat list for the HUD/minimap.
function normalizeLandmarks(raw) {
  const out = {};
  for (const key of Object.keys(raw)) {
    out[key] = { x: raw[key][0], z: raw[key][1], name: LANDMARK_NAMES[key] || key };
  }
  return out;
}

function isNearLandmark(x, z, landmarks, margin) {
  for (const key of Object.keys(landmarks)) {
    const lm = landmarks[key];
    if (Math.abs(x - lm.x) < margin && Math.abs(z - lm.z) < margin) return true;
  }
  return false;
}

function onRoad(x, z) {
  for (const v of LINES) {
    if (Math.abs(x - v) <= ROAD_HALF + 1 || Math.abs(z - v) <= ROAD_HALF + 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// init(ctx) — build the city once and hang the public API on ctx.world.
// ---------------------------------------------------------------------------

export function init(ctx) {
  const scene = ctx.scene;
  const landmarks = normalizeLandmarks(LANDMARKS);
  const landmarkList = Object.keys(landmarks).map((key) => ({
    key,
    x: landmarks[key].x,
    z: landmarks[key].z,
    name: landmarks[key].name,
  }));

  const buildings = [];
  const crates = [];
  const parkedCars = [];
  const lampSpots = [];

  // --- shared materials (a handful of materials for the whole city) ---
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x5d7a4a });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xd9c27a });
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
  const runwayMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3f });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
  const crateMat = new THREE.MeshLambertMaterial({ color: 0xb5893c, emissive: 0x332200 });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  windowMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a4a, emissive: 0xffd27a, emissiveIntensity: 0.35, roughness: 0.4,
  });
  lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.6,
  });
  waterMat = new THREE.MeshLambertMaterial({
    color: 0x1e6f9f, transparent: true, opacity: 0.72,
  });

  const palette = [0xc96f4a, 0x4a7a9e, 0x9e8a4a, 0x7a5a9e, 0x5a9e7a, 0xa85a5a, 0x6a7a8a, 0xb08a5a];

  // --- ground, sidewalks, roads, runway, sand, water ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  // Sidewalk slabs sit just above the ground, roads just above those.
  for (const v of LINES) {
    const swH = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, ROAD_WIDTH + 5), sidewalkMat);
    swH.rotation.x = -Math.PI / 2;
    swH.position.set(0, 0.01, v);
    scene.add(swH);
    const swV = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH + 5, SIZE), sidewalkMat);
    swV.rotation.x = -Math.PI / 2;
    swV.position.set(v, 0.01, 0);
    scene.add(swV);
    const rH = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, ROAD_WIDTH), roadMat);
    rH.rotation.x = -Math.PI / 2;
    rH.position.set(0, 0.02, v);
    scene.add(rH);
    const rV = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, SIZE), roadMat);
    rV.rotation.x = -Math.PI / 2;
    rV.position.set(v, 0.02, 0);
    scene.add(rV);
  }

  // Runway strip along the north edge.
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(300, 14), runwayMat);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0.02, -195);
  scene.add(runway);
  const runwayLine = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 0.8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  runwayLine.rotation.x = -Math.PI / 2;
  runwayLine.position.set(0, 0.03, -195);
  scene.add(runwayLine);

  // Sand strip, then the sea.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 15), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, 157.5);
  scene.add(sand);
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 35), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(0, 0.06, 182.5);
  scene.add(waterMesh);

  // --- lights and sky ---
  hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x5a6a4a, 0.9);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0xfff2d0, 1.6);
  dirLight.position.set(120, 180, 60);
  scene.add(dirLight);

  skyUniforms = {
    top: { value: new THREE.Color(0x2f6fd0) },
    bottom: { value: new THREE.Color(0xcfeef7) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 16, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
    }),
  );
  scene.add(sky);

  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(10, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe98a }),
  );
  sunMesh.position.set(180, 220, -120);
  scene.add(sunMesh);

  // Clouds: low-poly blobs that drift east.
  for (let i = 0; i < 9; i++) {
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 5, 8, 6), mat);
      puff.position.set(j * 7 - 7, rand() * 2, rand() * 4 - 2);
      puff.scale.y = 0.55;
      group.add(puff);
    }
    group.position.set(-HALF + rand() * SIZE, 90 + rand() * 40, -HALF + rand() * SIZE);
    group.userData.speed = 1.5 + rand() * 2;
    scene.add(group);
    clouds.push(group);
  }

  // --- helper: register a building (mesh + collision AABB) ---
  function addBuilding(x, z, w, h, d, color, opts = {}) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
    // Window strip: one emissive band around the upper floors.
    if (h > 6) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, Math.min(2.2, h * 0.25), d + 0.2), windowMat);
      band.position.set(x, h * 0.62, z);
      scene.add(band);
    }
    // Flat roof cap so towers read as finished.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.5, d * 0.9),
      new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
    roof.position.set(x, h + 0.25, z);
    scene.add(roof);
    const minX = x - w / 2;
    const maxX = x + w / 2;
    const minZ = z - d / 2;
    const maxZ = z + d / 2;
    buildings.push({ minX, maxX, minZ, maxZ, height: h });
    return mesh;
  }

  function addLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5, 6),
      new THREE.MeshLambertMaterial({ color: 0x222222 }));
    pole.position.set(x, 2.5, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampHeadMat);
    head.position.set(x, 5.1, z);
    scene.add(head);
    lampSpots.push({ x, z });
  }

  function addPalm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 6), trunkMat);
    trunk.position.set(x, 3, z);
    scene.add(trunk);
    const top = new THREE.Mesh(new THREE.ConeGeometry(3, 3.5, 7), palmMat);
    top.position.set(x, 7.2, z);
    scene.add(top);
  }

  function addParkedCar(x, z, color, heading = 0) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 1.9), bodyMat);
    body.position.y = 0.7;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.7),
      new THREE.MeshLambertMaterial({ color: 0x1a2028 }));
    cabin.position.set(-0.2, 1.5, 0);
    group.add(cabin);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (const [wx, wz] of [[-1.4, 0.95], [1.4, 0.95], [-1.4, -0.95], [1.4, -0.95]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      group.add(wheel);
    }
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    scene.add(group);
    parkedCars.push({ x, z, color });
    return group;
  }

  function addCrate(x, z, y = 0.6) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
    crate.position.set(x, y, z);
    scene.add(crate);
    crates.push({ x, z, mesh: crate });
    return crate;
  }

  // --- generic city blocks (skip roads, landmarks, water, runway) ---
  const blockCenters = [];
  for (let gx = -180; gx <= 180; gx += 40) {
    for (let gz = -180; gz <= 180; gz += 40) {
      if (gz >= 150) continue; // sand + sea, handled below
      if (gz <= -180) continue; // runway strip
      if (isNearLandmark(gx, gz, landmarks, 22)) continue;
      blockCenters.push([gx, gz]);
    }
  }
  for (const [bx, bz] of blockCenters) {
    const count = rand() < 0.55 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const ox = count === 1 ? 0 : (i === 0 ? -7 : 7);
      const oz = count === 1 ? 0 : (i === 0 ? -6 : 6);
      const w = 9 + rand() * 8;
      const d = 9 + rand() * 8;
      const h = 6 + rand() * rand() * 26; // mostly low, a few tall
      addBuilding(bx + ox, bz + oz, w, h, d, palette[Math.floor(rand() * palette.length)]);
    }
  }

  // --- the twelve landmarks, each reading at a glance ---

  // Plaza Tower (0, 0): the tallest tower in the city, with a spire.
  addBuilding(0, 0, 20, 55, 20, 0x3a5a7a);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 14, 6),
    new THREE.MeshLambertMaterial({ color: 0xffd75e }));
  spire.position.set(0, 62, 0);
  scene.add(spire);

  // Feria Market (0, -80): four stalls with striped awnings and crates.
  const awningColors = [0xe74c3c, 0x2e86c1, 0x27ae60, 0xf39c12];
  for (let i = 0; i < 4; i++) {
    const sx = -12 + i * 8;
    const stall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 5),
      new THREE.MeshLambertMaterial({ color: 0xd8cdb8 }));
    stall.position.set(sx, 1.2, -80);
    scene.add(stall);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.25, 5.6),
      new THREE.MeshLambertMaterial({ color: awningColors[i] }));
    awning.position.set(sx, 2.9, -80);
    awning.rotation.x = 0.12;
    scene.add(awning);
    buildings.push({ minX: sx - 3, maxX: sx + 3, minZ: -82.5, maxZ: -77.5, height: 3 });
  }
  addCrate(14, -86);
  addCrate(-14, -74);

  // Old Pier (-160, 170): a wooden deck out over the water, on posts.
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 34), woodMat);
  pierDeck.position.set(-160, 0.5, 182);
  scene.add(pierDeck);
  for (let i = 0; i < 5; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), woodMat);
    post.position.set(-164.5, 0.4, 168 + i * 7);
    scene.add(post);
    const post2 = post.clone();
    post2.position.x = -155.5;
    scene.add(post2);
  }
  addLamp(-160, 196);

  // Marina Docks (-120, 175): dock fingers and two small boats.
  const dock = new THREE.Mesh(new THREE.BoxGeometry(26, 0.6, 6), woodMat);
  dock.position.set(-120, 0.5, 172);
  scene.add(dock);
  for (const [bx, bz] of [[-132, 182], [-108, 182]]) {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 7),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    hull.position.set(bx, 0.7, bz);
    scene.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), trunkMat);
    mast.position.set(bx, 3.5, bz);
    scene.add(mast);
  }

  // Brasa Garage (80, -40): low wide block, dark roller door, orange sign.
  addBuilding(80, -40, 22, 7, 14, 0x8a6d3b);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.5),
    new THREE.MeshLambertMaterial({ color: 0x22262c }));
  door.position.set(80, 2.4, -32.9);
  scene.add(door);
  const garageSign = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 0.6),
    new THREE.MeshLambertMaterial({ color: 0xff8c1a, emissive: 0x552200 }));
  garageSign.position.set(80, 7.6, -33);
  scene.add(garageSign);
  addParkedCar(70, -28, 0xc0392b, 0.3);
  addParkedCar(92, -28, 0x2e86c1, -0.2);

  // Rook Arcade (40, 80): purple block with a neon strip.
  addBuilding(40, 80, 16, 12, 12, 0x7a3a9e);
  const neon = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff4fd8, emissiveIntensity: 1.2 }));
  neon.position.set(40, 10, 73.8);
  scene.add(neon);

  // Coral Room Casino (120, 120): tall gold tower.
  addBuilding(120, 120, 18, 40, 18, 0xd4a017);
  const casinoTop = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0x664400, emissiveIntensity: 0.6 }));
  casinoTop.position.set(120, 41.5, 120);
  scene.add(casinoTop);

  // Coast Tunnel (-80, -160): a concrete gateway arch over the road.
  const tunnelMat = new THREE.MeshLambertMaterial({ color: 0x6a6f76 });
  for (const px of [-88, -72]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(4, 9, 6), tunnelMat);
    pillar.position.set(px, 4.5, -160);
    scene.add(pillar);
    buildings.push({ minX: px - 2, maxX: px + 2, minZ: -163, maxZ: -157, height: 9 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(20, 3, 6), tunnelMat);
  lintel.position.set(-80, 10.5, -160);
  scene.add(lintel);

  // Motel Vela (-40, 40): a long low block with a sign board.
  addBuilding(-40, 40, 26, 5, 8, 0xe8dcc0);
  const motelSign = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x1abc9c, emissive: 0x0a5544, emissiveIntensity: 0.7 }));
  motelSign.position.set(-40, 6.2, 35.8);
  scene.add(motelSign);

  // Underpass (0, 150): a bridge slab over the road with railings.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 10), wallMat);
  bridge.position.set(0, 4, 150);
  scene.add(bridge);
  for (const rz of [145.2, 154.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x444444 }));
    rail.position.set(0, 5, rz);
    scene.add(rail);
  }

  // Old Church (-120, -120): white box, pitched roof, spire and cross.
  addBuilding(-120, -120, 14, 10, 18, 0xf2ead8);
  const roofPrism = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 8, 5, 4),
    new THREE.MeshLambertMaterial({ color: 0x8a3a3a }));
  roofPrism.position.set(-120, 12.5, -120);
  roofPrism.rotation.y = Math.PI / 4;
  roofPrism.scale.set(1, 1, 1.3);
  scene.add(roofPrism);
  const steeple = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 12, 6),
    new THREE.MeshLambertMaterial({ color: 0xf2ead8 }));
  steeple.position.set(-120, 16, -128);
  scene.add(steeple);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xffd75e }));
  crossV.position.set(-120, 23, -128);
  scene.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xffd75e }));
  crossH.position.set(-120, 22.6, -128);
  scene.add(crossH);

  // Beachfront (160, 170): sand, umbrellas and palms.
  for (const [ux, uz, col] of [[148, 158, 0xe74c3c], [164, 156, 0x2e86c1], [176, 160, 0xf39c12]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), trunkMat);
    pole.position.set(ux, 1.5, uz);
    scene.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 8),
      new THREE.MeshLambertMaterial({ color: col }));
    canopy.position.set(ux, 3.4, uz);
    scene.add(canopy);
  }
  addPalm(140, 160);
  addPalm(182, 156);
  addPalm(150, 168);

  // --- street lamps along the roads, palms near the beach road ---
  for (const v of LINES) {
    for (let t = -160; t <= 160; t += 80) {
      addLamp(v + 5.5, t);
      addLamp(t, v - 5.5);
    }
  }
  for (let i = 0; i < 10; i++) {
    addPalm(-180 + i * 40, 148);
  }

  // --- a few parked cars along the roads ---
  const carColors = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1];
  for (let i = 0; i < 12; i++) {
    const v = LINES[Math.floor(rand() * LINES.length)];
    const t = -160 + rand() * 320;
    addParkedCar(v + 5.5, t, carColors[i % carColors.length], Math.PI / 2);
  }

  // --- public API ---
  const world = {
    landmarks,
    landmarksList: landmarkList,
    buildings,
    buildingCount: buildings.length,
    roads: LINES.slice(),
    roadWidth: ROAD_WIDTH,
    worldSize: SIZE,
    crates,
    parkedCars,
    lamps: lampSpots,
    // Light / sky handles for the day-night module.
    dirLight,
    hemiLight,
    sunMesh,
    skyUniforms,
    lampHeadMat,
    windowMat,
    waterMesh,
    waterMat,

    isOnRoad(x, z) {
      if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
      for (const v of LINES) {
        if (Math.abs(x - v) <= ROAD_HALF || Math.abs(z - v) <= ROAD_HALF) return true;
      }
      return false;
    },
    isInWater(x, z) {
      return z >= 165 && z <= HALF && x >= -HALF && x <= HALF;
    },
    getGroundY(/* x, z */) {
      return 0; // flat city; pier deck / bridge are visual only
    },
    // Day/night hook: f = 0 (noon) .. 1 (midnight). Called by the day-night
    // module; keeps lamp/window glow and light levels in sync.
    setNightFactor(f) {
      const n = Math.max(0, Math.min(1, f));
      if (lampHeadMat) lampHeadMat.emissiveIntensity = 0.6 + n * 2.0;
      if (windowMat) windowMat.emissiveIntensity = 0.35 + n * 1.4;
      if (dirLight) dirLight.intensity = 1.6 - n * 1.3;
      if (hemiLight) hemiLight.intensity = 0.9 - n * 0.5;
      if (skyUniforms) {
        skyUniforms.top.value.setHex(n > 0.5 ? 0x0a1a3a : 0x2f6fd0);
        skyUniforms.bottom.value.setHex(n > 0.5 ? 0x1a2a4a : 0xcfeef7);
      }
    },
  };

  ctx.world = world;
  return world;
}

// ---------------------------------------------------------------------------
// update(dt, ctx) — most of the world is static; animate water + clouds only.
// ---------------------------------------------------------------------------

export function update(dt, ctx) {
  elapsed += dt;
  if (waterMesh) {
    waterMesh.position.y = 0.06 + Math.sin(elapsed * 0.8) * 0.02;
  }
  if (waterMat) {
    waterMat.opacity = 0.72 + Math.sin(elapsed * 0.8) * 0.04;
  }
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > HALF + 40) cloud.position.x = -HALF - 40;
  }
  // Gentle lamp shimmer (subtle; night brightness is owned by setNightFactor).
  if (lampHeadMat && ctx && ctx.state && typeof ctx.state.nightFactor === 'number') {
    lampHeadMat.emissiveIntensity =
      0.6 + ctx.state.nightFactor * 2.0 + Math.sin(elapsed * 2) * 0.05;
  }
}

export default { init, update };
