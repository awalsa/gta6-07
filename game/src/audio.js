// audio.js — ISLA BRASA 3D: WebAudio music + sound effects (round 7, worker W7).
//
// Procedural music: a 16-step lookahead sequencer at 112 BPM by default.
// Three patterns (brasa / chill / rock) share the same scheduler; the radio
// module switches between them. All sound is synthesized — no audio files,
// no network. The AudioContext is created lazily on the first user gesture
// (browsers block audio before interaction).
//
// Sound effects: gunshot, pickup, click, explosion, siren burst, coin,
// success, error. A persistent engine hum follows car speed, and a looping
// two-tone siren runs while the wanted level is 3 or higher.
//
// Keys: N toggles mute (all audio). M opens the map (handled by hud.js).
//
// Exports init(ctx) and update(dt, ctx). Attaches:
//   ctx.audio = { playSfx, playPickup, playMissionComplete, setMusic,
//                 setPattern, toggleMute, muted, musicOn, pattern, bpm }

import * as CFG from './config.js';

const DEFAULT_BPM = typeof CFG.BPM === 'number' ? CFG.BPM : 112;
const MUSIC_LEVEL = 0.3;
const SFX_LEVEL = 0.5;
const MASTER_LEVEL = 0.9;

// 16-step patterns. Bass notes are semitone offsets from A2 (110 Hz),
// lead notes from A4 (440 Hz); -1 is a rest on that step.
const PATTERNS = {
  brasa: { // Brasa FM — upbeat 112 BPM, the default station
    bpm: 112,
    bass: [0, -1, 0, -1, 5, -1, 0, -1, 3, -1, 5, -1, 7, -1, 10, -1],
    lead: [12, -1, 17, -1, 19, -1, 17, -1, 15, -1, 19, -1, 24, -1, 19, 15],
    wave: 'sawtooth', leadWave: 'square', hatEvery: 2,
  },
  chill: { // Coral Chill — slow and mellow, 84 BPM
    bpm: 84,
    bass: [0, -1, -1, -1, 8, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1],
    lead: [12, -1, -1, 15, -1, -1, 20, -1, -1, 19, -1, -1, 17, -1, -1, 12],
    wave: 'sine', leadWave: 'sine', hatEvery: 4,
  },
  rock: { // Turbo Rock — driving rock, 132 BPM
    bpm: 132,
    bass: [0, 0, -1, 0, 0, -1, 3, -1, 5, 5, -1, 5, -1, 7, -1, 3],
    lead: [12, -1, 12, 15, -1, 12, -1, 17, 19, -1, 17, -1, 15, -1, 12, -1],
    wave: 'sawtooth', leadWave: 'sawtooth', hatEvery: 1,
  },
};

function semitoneToFreq(semi, base) {
  return base * Math.pow(2, semi / 12);
}

let ctxRef = null;
let ac = null; // AudioContext, created lazily on first gesture
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let noiseBuffer = null; // shared 1 s white-noise buffer (hats, shots, blasts)

let musicOn = true;
let muted = false;
let patternName = 'brasa';
let stepIdx = 0;
let nextStepTime = 0;
let schedulerId = null;

// Engine hum: one persistent sawtooth through a lowpass; gain and pitch
// follow the car's speed (silent on foot).
let engineOsc = null;
let engineGain = null;
let engineFilter = null;

// Looping wanted siren: a triangle wave whose pitch wobbles via an LFO.
let sirenOsc = null;
let sirenLfo = null;
let sirenGain = null;
let sirenActive = false;

function buildContext() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
  } catch (e) {
    return null;
  }
  masterGain = ac.createGain();
  masterGain.gain.value = muted ? 0 : MASTER_LEVEL;
  masterGain.connect(ac.destination);

  musicGain = ac.createGain();
  musicGain.gain.value = MUSIC_LEVEL;
  musicGain.connect(masterGain);

  sfxGain = ac.createGain();
  sfxGain.gain.value = SFX_LEVEL;
  sfxGain.connect(masterGain);

  // 1 s of white noise, reused by every noise-based sound.
  const len = ac.sampleRate;
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  // Engine hum chain, started once and left running at gain 0.
  engineOsc = ac.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 42;
  engineFilter = ac.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 420;
  engineGain = ac.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start();

  nextStepTime = ac.currentTime + 0.1;
  schedulerId = setInterval(scheduleAhead, 30);
  return ac;
}

function onFirstGesture() {
  buildContext();
}

function scheduleAhead() {
  if (!ac || !musicOn || muted) {
    // Keep the clock moving silently so resuming lands on the beat.
    if (ac) nextStepTime = Math.max(nextStepTime, ac.currentTime + 0.05);
    return;
  }
  const p = PATTERNS[patternName] || PATTERNS.brasa;
  const stepDur = 60 / p.bpm / 4; // 16th notes
  while (nextStepTime < ac.currentTime + 0.15) {
    scheduleStep(stepIdx, nextStepTime, p);
    nextStepTime += stepDur;
    stepIdx = (stepIdx + 1) % 16;
  }
}

function scheduleStep(step, t, p) {
  const bassNote = p.bass[step];
  if (bassNote != null && bassNote >= 0) {
    blip(semitoneToFreq(bassNote, 110), t, 0.22, p.wave, 0.5, musicGain);
  }
  const leadNote = p.lead[step];
  if (leadNote != null && leadNote >= 0) {
    blip(semitoneToFreq(leadNote, 440), t, 0.16, p.leadWave, 0.22, musicGain);
  }
  if (p.hatEvery && step % p.hatEvery === 0) {
    hat(t, 0.05, 0.1);
  }
  // Kick on beats 0, 4, 8, 12.
  if (step % 4 === 0) kick(t);
}

function blip(freq, t, dur, wave, vol, dest) {
  if (!ac) return;
  const o = ac.createOscillator();
  o.type = wave || 'sine';
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(dest || musicGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function hat(t, dur, vol) {
  if (!ac || !noiseBuffer) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(hp);
  hp.connect(g);
  g.connect(musicGain);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

function kick(t) {
  if (!ac) return;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g);
  g.connect(musicGain);
  o.start(t);
  o.stop(t + 0.16);
}

function noiseBurst(t, dur, filterFreq, vol, type) {
  if (!ac || !noiseBuffer) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ac.createBiquadFilter();
  f.type = type || 'lowpass';
  f.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(sfxGain);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

// One-shot sound effects. Names used by the rest of the game:
// 'gunshot', 'pickup', 'click', 'explosion', 'siren' (short burst),
// 'coin', 'success', 'error'.
function playSfx(name) {
  if (muted) return;
  buildContext();
  if (!ac) return;
  const t = ac.currentTime;
  if (name === 'gunshot') {
    noiseBurst(t, 0.14, 1600, 0.9);
    blip(190, t, 0.08, 'square', 0.35, sfxGain);
  } else if (name === 'pickup') {
    blip(660, t, 0.09, 'sine', 0.5, sfxGain);
    blip(990, t + 0.08, 0.14, 'sine', 0.5, sfxGain);
  } else if (name === 'click') {
    blip(1200, t, 0.04, 'square', 0.25, sfxGain);
  } else if (name === 'coin') {
    blip(1320, t, 0.07, 'sine', 0.45, sfxGain);
    blip(1760, t + 0.06, 0.12, 'sine', 0.45, sfxGain);
  } else if (name === 'success') {
    [523, 659, 784, 1047].forEach((f, i) => blip(f, t + i * 0.09, 0.16, 'triangle', 0.45, sfxGain));
  } else if (name === 'error') {
    blip(220, t, 0.16, 'sawtooth', 0.4, sfxGain);
    blip(175, t + 0.14, 0.22, 'sawtooth', 0.4, sfxGain);
  } else if (name === 'explosion') {
    noiseBurst(t, 0.7, 900, 1.0);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + 0.75);
  } else if (name === 'siren') {
    // Short two-tone burst (the looping siren is driven by update()).
    blip(740, t, 0.22, 'triangle', 0.4, sfxGain);
    blip(960, t + 0.24, 0.22, 'triangle', 0.4, sfxGain);
    blip(740, t + 0.48, 0.22, 'triangle', 0.4, sfxGain);
  }
}

function setSiren(on) {
  if (!ac) return;
  if (on === sirenActive) return;
  sirenActive = on;
  if (on) {
    sirenOsc = ac.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 800;
    sirenLfo = ac.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 0.6; // wail period ~1.7 s
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 220;
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenGain = ac.createGain();
    sirenGain.gain.value = 0;
    sirenGain.gain.linearRampToValueAtTime(0.12, ac.currentTime + 0.4);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(masterGain);
    sirenOsc.start();
    sirenLfo.start();
  } else if (sirenOsc) {
    const t = ac.currentTime;
    const osc = sirenOsc;
    const lfo = sirenLfo;
    const g = sirenGain;
    g.gain.setTargetAtTime(0, t, 0.1);
    setTimeout(() => {
      try { osc.stop(); lfo.stop(); } catch (e) { /* already stopped */ }
      try { g.disconnect(); } catch (e) { /* already gone */ }
    }, 400);
    sirenOsc = null;
    sirenLfo = null;
    sirenGain = null;
  }
}

function toggleMute() {
  muted = !muted;
  if (ac && masterGain) {
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : MASTER_LEVEL, ac.currentTime + 0.1);
  }
  if (ctxRef && ctxRef.hud && typeof ctxRef.hud.showMessage === 'function') {
    ctxRef.hud.showMessage(muted ? 'Audio muted (N)' : 'Audio on (N)');
  }
  return muted;
}

export function init(ctx) {
  ctxRef = ctx;
  if (ctx) ctx.state = ctx.state || {};
  // N toggles all audio. Gesture listeners create/resume the AudioContext.
  window.addEventListener('keydown', (e) => {
    buildContext();
    if (e.code === 'KeyN' && !e.repeat) toggleMute();
  });
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('click', onFirstGesture);

  ctx.audio = {
    playSfx,
    playPickup() { playSfx('pickup'); },
    // Mission-complete jingle: the pickup chime twice.
    playMissionComplete() { playSfx('pickup'); setTimeout(() => playSfx('pickup'), 180); },
    setMusic(on) { musicOn = !!on; },
    setPattern(name) {
      if (PATTERNS[name]) {
        patternName = name;
        stepIdx = 0;
      }
    },
    toggleMute,
    get muted() { return muted; },
    get musicOn() { return musicOn; },
    get pattern() { return patternName; },
  };
  // Expose the default tempo so other modules (e.g. HUD) can show it.
  ctx.audio.bpm = DEFAULT_BPM;
}

function readSpeed(ctx) {
  const s = ctx.state || {};
  if (typeof s.speed === 'number') return s.speed;
  if (s.vehicle && typeof s.vehicle.speed === 'number') return s.vehicle.speed;
  if (ctx.vehicle && typeof ctx.vehicle.speed === 'number') return ctx.vehicle.speed;
  return 0;
}

function readInCar(ctx) {
  const s = ctx.state || {};
  return !!(s.inCar || s.driving || s.vehicle || ctx.vehicle);
}

export function update(dt, ctx) {
  if (!ac) return;
  // Engine hum follows car speed; silent on foot.
  const inCar = readInCar(ctx);
  const speed = Math.abs(readSpeed(ctx));
  if (engineGain && engineOsc) {
    const target = inCar ? Math.min(0.22, 0.05 + speed * 0.006) : 0;
    engineGain.gain.setTargetAtTime(muted ? 0 : target, ac.currentTime, 0.08);
    engineOsc.frequency.setTargetAtTime(42 + speed * 3.2, ac.currentTime, 0.1);
  }
  // Wanted siren while wanted level is 3 or higher.
  const wanted = ctx.state && typeof ctx.state.wanted === 'number' ? ctx.state.wanted : 0;
  setSiren(wanted >= 3 && !muted);
}

export default { init, update, PATTERNS };
