// radio.js — ISLA BRASA 3D: car radio with 3 stations (round 7, worker W7).
//
// Press R while driving to cycle stations. Each station is a different
// WebAudio pattern played through ctx.audio (see audio.js: 'brasa' = 112 BPM
// upbeat, 'chill' = 84 BPM mellow, 'rock' = 132 BPM driving rock). On foot,
// R is NOT the radio — it starts races — so the key handler only fires while
// the player is in a car.
//
// Exports init(ctx) and update(dt, ctx). Attaches:
//   ctx.radio = { cycle, station, stationName, stations }

const STATIONS = [
  { name: 'Brasa FM', pattern: 'brasa', desc: 'Upbeat 112 BPM' },
  { name: 'Coral Chill', pattern: 'chill', desc: 'Slow & mellow' },
  { name: 'Turbo Rock', pattern: 'rock', desc: 'Driving rock' },
];

let ctxRef = null;
let station = 0;

function isInCar(ctx) {
  const s = (ctx && ctx.state) || {};
  // inCar lives on ctx.player (player.js) and on ctx.cars.current — the
  // state.* spellings below are fallbacks only.
  return !!(
    s.inCar || s.driving || s.vehicle || ctx.vehicle
    || (ctx.player && ctx.player.inCar)
    || (ctx.cars && ctx.cars.current)
  );
}

function applyStation() {
  const st = STATIONS[station];
  if (!ctxRef) return;
  if (ctxRef.audio && typeof ctxRef.audio.setPattern === 'function') {
    ctxRef.audio.setPattern(st.pattern);
  }
  if (ctxRef.audio && typeof ctxRef.audio.setMusic === 'function') {
    ctxRef.audio.setMusic(true);
  }
  if (ctxRef.hud && typeof ctxRef.hud.showMessage === 'function') {
    ctxRef.hud.showMessage('Radio: ' + st.name + ' — ' + st.desc);
  }
}

function cycle() {
  station = (station + 1) % STATIONS.length;
  applyStation();
  return STATIONS[station].name;
}

export function init(ctx) {
  ctxRef = ctx;
  station = 0;
  // R cycles stations, but only while driving (R on foot starts races).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const c = ctxRef;
    if (!c) return;
    // Never cycle while an overlay is open or the player is inside a
    // building — R there belongs to the overlay / interior.
    if (c.state && c.state.uiOpen) return;
    if (c.state && c.state.insideInterior) return;
    if (!isInCar(c)) return;
    cycle();
  });

  ctx.radio = {
    cycle,
    get station() { return station; },
    get stationName() { return STATIONS[station].name; },
    stations: STATIONS.map((s) => s.name),
  };
  return ctx.radio;
}

export function update(dt, ctx) {
  if (!ctxRef) return;
  // If the audio context was (re)created after a gesture, re-apply the
  // current station so driving music survives the first click.
  if (ctx.audio && ctx.audio.pattern !== STATIONS[station].pattern) {
    if (isInCar(ctx)) ctx.audio.setPattern(STATIONS[station].pattern);
  }
}

export default { init, update, STATIONS };
