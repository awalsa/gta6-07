// ISLA BRASA 3D — bootstrap and game loop.
//
// This is the game's entry module. index.html's loader resolves the locally
// vendored Three.js first (game/vendor/three.module.min.js, via the import
// map) and then dynamically imports this file, so by the time this code runs
// window.__ISLA_THREE__ holds the THREE namespace.
//
// Contract for every system module: each exports init(ctx) and update(dt, ctx).
// ctx is { scene, camera, renderer, state, input, config, THREE, ... } and
// modules attach their public API to it (for example ctx.world, ctx.economy).
// Modules must NOT statically import 'three' from a URL; they use ctx.THREE
// (or the default export of ./three.js) so the loader's local vendored copy
// is the one that loads.
// All 3D positions use world coords: x east, z south, y up, ground y = 0.

import THREE from './three.js';
import { CONFIG } from './config.js';
import { state, loadGame, saveGame } from './state.js';
import { input, initInput } from './input.js';
import * as world from './world.js';
import * as player from './player.js';
import * as cars from './cars.js';
import * as combat from './combat.js';
import * as police from './police.js';
import * as missions from './missions.js';
import * as races from './races.js';
import * as hud from './hud.js';
import * as economy from './economy.js';
import * as dialogue from './dialogue.js';
import * as audio from './audio.js';
import * as radio from './radio.js';
import * as daynight from './daynight.js';
import * as weather from './weather.js';
import * as particles from './particles.js';
import * as pedestrians from './pedestrians.js';
import * as traffic from './traffic.js';
import * as sidejobs from './sidejobs.js';
import * as plane from './plane.js';
import * as casino from './casino.js';
import * as properties from './properties.js';
import * as interiors from './interiors.js';
import * as shops from './shops.js';

// The system modules, in boot order: world first (it builds the city the
// others stand on), player and vehicles next, then combat/police/missions,
// then the HUD and economy, then ambience and activities. main.js calls each
// init(ctx) in this order and each update(dt, ctx) in the same order every
// frame.
const SYSTEMS = [
  { name: 'world', mod: world },
  { name: 'player', mod: player },
  { name: 'cars', mod: cars },
  { name: 'combat', mod: combat },
  { name: 'police', mod: police },
  { name: 'missions', mod: missions },
  { name: 'races', mod: races },
  { name: 'hud', mod: hud },
  { name: 'economy', mod: economy },
  { name: 'dialogue', mod: dialogue },
  { name: 'audio', mod: audio },
  { name: 'radio', mod: radio },
  { name: 'daynight', mod: daynight },
  { name: 'weather', mod: weather },
  { name: 'particles', mod: particles },
  { name: 'pedestrians', mod: pedestrians },
  { name: 'traffic', mod: traffic },
  { name: 'sidejobs', mod: sidejobs },
  { name: 'plane', mod: plane },
  { name: 'casino', mod: casino },
  { name: 'properties', mod: properties },
  { name: 'interiors', mod: interiors },
  { name: 'shops', mod: shops },
];

function showFatal(message) {
  const box = document.getElementById('loading-error');
  if (box) {
    box.textContent = message;
    box.style.display = 'block';
  } else {
    // Last resort: the page itself is broken, so say so on the page.
    document.body.insertAdjacentHTML('beforeend', `<div style="color:#fff;background:#a00;padding:12px">${message}</div>`);
  }
  console.error(`[ISLA BRASA] ${message}`);
}

function boot() {
  if (!THREE) {
    showFatal('Could not load the vendored Three.js library (game/vendor/three.module.min.js). Reload the page.');
    return;
  }

  // Restore the save before any system reads state.
  loadGame();
  initInput();

  const container = document.getElementById('game-container') ?? document.body;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.id = 'game-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d6);
  scene.fog = new THREE.Fog(0x87b5d6, 120, 380);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 6, 18);

  // Shared context handed to every system module.
  const ctx = {
    scene,
    camera,
    renderer,
    state,
    input,
    config: CONFIG,
    THREE,
    // Seconds since boot; modules that animate on their own clock read this.
    time: 0,
    // Third-person follow camera. A module may set ctx.cameraHandled = true
    // to drive the camera itself (for example a cutscene or an interior).
    cameraHandled: false,
    cameraYaw: 0,
    cameraPitch: 0.35,
    cameraDistance: 11,
    // Set by the player module each frame: where the player is and which way
    // they face, so the camera and the HUD arrow agree.
    playerHeading: 0,
    saveGame,
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Initialise every system in order. A module that has no init yet (still
  // being written by another worker) is skipped with a warning, never a
  // crash, so the game boots while the build is still in progress.
  for (const { name, mod } of SYSTEMS) {
    if (typeof mod.init === 'function') {
      try {
        mod.init(ctx);
      } catch (err) {
        console.error(`[ISLA BRASA] ${name}.init failed:`, err);
      }
    } else {
      console.warn(`[ISLA BRASA] ${name} has no init(ctx) yet`);
    }
  }

  // Aliases other modules expect: ctx.save() (economy persist) and
  // ctx.notify() (toast messages from casino / interiors / properties /
  // shops / sidejobs).
  ctx.save = saveGame;
  ctx.notify = (msg) => {
    if (ctx.hud && typeof ctx.hud.showMessage === 'function') ctx.hud.showMessage(msg);
  };

  // Expose the live context for debugging and for the browser play-tests.
  window.ISLA_BRASA = ctx;
  window.__ISLA__ = ctx;

  let last = performance.now();
  let saveTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    // Clamp dt so a hitch (tab switch, slow frame) never teleports the player.
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    ctx.time += dt;

    for (const { name, mod } of SYSTEMS) {
      if (typeof mod.update === 'function') {
        try {
          mod.update(dt, ctx);
        } catch (err) {
          console.error(`[ISLA BRASA] ${name}.update failed:`, err);
        }
      }
    }

    updateCamera(dt, ctx);
    renderer.render(scene, camera);

    // Autosave every 30 seconds so a crash never loses a whole session.
    saveTimer += dt;
    if (saveTimer >= 30) {
      saveTimer = 0;
      saveGame();
    }
  }

  requestAnimationFrame(frame);
}

// Third-person follow camera: behind and above the player, looking slightly
// ahead of them. Skipped when a module has taken over the camera.
function updateCamera(dt, ctx) {
  if (ctx.cameraHandled) return;
  const pos = ctx.state.playerPos;
  if (!pos) return;
  const heading = ctx.playerHeading || 0;
  const dist = ctx.cameraDistance || 11;
  const height = 4.5 + Math.sin(ctx.cameraPitch || 0.35) * dist * 0.5;
  const behindX = pos[0] - Math.sin(heading) * dist;
  const behindZ = pos[2] - Math.cos(heading) * dist;
  const targetX = pos[0] + Math.sin(heading) * 4;
  const targetZ = pos[2] + Math.cos(heading) * 4;
  // Ease toward the target so the camera glides instead of snapping.
  const k = 1 - Math.pow(0.001, dt);
  ctx.camera.position.x += (behindX - ctx.camera.position.x) * k;
  ctx.camera.position.y += (height - ctx.camera.position.y) * k;
  ctx.camera.position.z += (behindZ - ctx.camera.position.z) * k;
  ctx.camera.lookAt(targetX, (pos[1] || 0) + 1.6, targetZ);
}

boot();
