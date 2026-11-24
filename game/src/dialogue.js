// dialogue.js — ISLA BRASA 3D: dialogue boxes, NPC chatter, mission briefs.
//
// Contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config, THREE }.
// Renders into #dialogue-box (created here when the page has none).
// Lines are queued and play one at a time; each line stays on screen for a
// few seconds, then the next queued line takes over automatically.
//
// Speakers: 'Rook' (mission giver), 'Pedestrian' (random NPC chatter),
// plus whatever speaker name a caller passes to show().
// missions.js calls dialogue.showBrief(title, lines) for the mission brief
// and dialogue.show('Rook', text) for completion / failure lines.

const LINE_MS = 4000; // how long a normal spoken line stays up
const BRIEF_MS = 5000; // mission brief lines stay up a little longer

// Idle chatter a pedestrian says when the player walks up and presses F.
export const NPC_LINES = [
  'You look new around Brasa. Watch yourself after dark.',
  'The Coral Room pays out big tonight, or so they say.',
  'Rico at the garage can get you a car that actually runs.',
  'Heard the Vela job went sideways. Again.',
  'Feria Market has the best tamales on the island. Fact.',
  'Police have been stopping everyone near the tunnel.',
  'If you want work, ask around the plaza. Somebody always needs a driver.',
  'The beach at sunset? Best free thing on this island.',
  "Ghost says the casino cameras are blind on Tuesdays. Don't quote me.",
  "Marta doesn't miss. If she offers to ride along, say yes.",
  'Delgado owns half the market stalls. The other half owe him money.',
  'The tunnel is the only way past the roadblocks when it gets hot.',
  'Rook pays on time. That is rarer than it sounds around here.',
  'I saw a gold car tear through the plaza last night. Probably yours.',
];

export const MISSION_GIVER_LINES = {
  default: 'Got a job for you. Read the brief and get moving — time is money.',
};

// --- Module state ----------------------------------------------------------

let queue = []; // pending { speaker, text, leftMs } lines
let current = null; // line on screen right now, or null
let boxEl = null;
let speakerEl = null;
let textEl = null;

function pickRandomLine() {
  return NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)];
}

// Build (or repair) the dialogue box DOM. The page may already define an
// empty #dialogue-box div; either way we make sure the speaker + text
// children exist before anything tries to write into them.
function ensureBox() {
  if (boxEl && document.body.contains(boxEl) && speakerEl && textEl) return boxEl;
  boxEl = document.getElementById('dialogue-box');
  if (!boxEl) {
    boxEl = document.createElement('div');
    boxEl.id = 'dialogue-box';
    boxEl.className = 'dialogue-box';
    boxEl.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:90px', 'transform:translateX(-50%)',
      'min-width:280px', 'max-width:560px', 'padding:12px 16px',
      'background:rgba(10,10,18,0.88)', 'color:#fff',
      'border:1px solid rgba(255,255,255,0.25)', 'border-radius:10px',
      'font-family:system-ui,sans-serif', 'font-size:15px', 'line-height:1.4',
      'z-index:60', 'display:none', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(boxEl);
  }
  speakerEl = boxEl.querySelector('#dialogue-speaker');
  if (!speakerEl) {
    speakerEl = document.createElement('div');
    speakerEl.id = 'dialogue-speaker';
    speakerEl.style.cssText = 'font-weight:700;color:#ffd34d;margin-bottom:4px;';
    boxEl.prepend(speakerEl);
  }
  textEl = boxEl.querySelector('#dialogue-text');
  if (!textEl) {
    textEl = document.createElement('div');
    textEl.id = 'dialogue-text';
    boxEl.appendChild(textEl);
  }
  return boxEl;
}

// Show the next queued line, or hide the box when the queue is empty.
function playNext() {
  const el = ensureBox();
  if (!queue.length) {
    current = null;
    el.style.display = 'none';
    return;
  }
  current = queue.shift();
  if (speakerEl) speakerEl.textContent = current.speaker || '';
  if (textEl) textEl.textContent = current.text || '';
  el.style.display = 'block';
}

// --- Public API ------------------------------------------------------------

export function init(ctx) {
  queue = [];
  current = null;
  if (typeof document !== 'undefined') ensureBox();

  const api = {
    // Queue one spoken line. Plays immediately if nothing is on screen.
    show(speaker, text, ms) {
      queue.push({
        speaker: speaker || '???',
        text: String(text == null ? '' : text),
        leftMs: typeof ms === 'number' && ms > 0 ? ms : LINE_MS,
      });
      if (!current) playNext();
      return true;
    },
    // Plain-name alias other modules use.
    showDialogue(speaker, text, ms) { return api.show(speaker, text, ms); },

    // Mission brief: one line per entry, all under the mission title.
    // `lines` may be a single string or an array of strings.
    showBrief(title, lines) {
      const parts = Array.isArray(lines) ? lines : [String(lines == null ? '' : lines)];
      const who = String(title || 'Mission');
      for (const part of parts) {
        queue.push({ speaker: who, text: String(part), leftMs: BRIEF_MS });
      }
      if (!current) playNext();
      return true;
    },

    // An NPC speaks when the player presses F near them. With no text
    // given, the NPC says a random chatter line.
    speakTo(speakerName, text) {
      return api.show(speakerName || 'Pedestrian', text || pickRandomLine(), LINE_MS);
    },
    randomNpcLine: pickRandomLine,

    // Skip the line on screen right now; the next queued line plays.
    dismiss() {
      current = null;
      playNext();
    },
    clear() {
      queue = [];
      current = null;
      ensureBox().style.display = 'none';
    },
    get isShowing() { return !!current; },
    get queuedCount() { return queue.length; },
  };

  if (ctx) ctx.dialogue = api;

  // F-interact hook: the nearest pedestrian within 4.5 units says a line.
  // player.js calls ctx.onInteract(playerPos) on an F edge. Combat owns F
  // while a live enemy is in punch range, so never talk over a punch.
  if (ctx && typeof ctx.onInteract !== 'function') {
    ctx.onInteract = (pos) => {
      if (!pos || typeof pos.x !== 'number' || typeof pos.z !== 'number') return false;
      const foes = ctx.combat && Array.isArray(ctx.combat.enemies) ? ctx.combat.enemies : [];
      for (const foe of foes) {
        if (foe && foe.alive && foe.pos && Math.hypot(foe.pos.x - pos.x, foe.pos.z - pos.z) < 3) return false;
      }
      const crowd = ctx.pedestrians && Array.isArray(ctx.pedestrians.list) ? ctx.pedestrians.list : [];
      let nearest = null;
      let nearestD = 4.5;
      for (const ped of crowd) {
        if (!ped || !ped.mesh) continue;
        const d = Math.hypot(ped.mesh.position.x - pos.x, ped.mesh.position.z - pos.z);
        if (d < nearestD) { nearestD = d; nearest = ped; }
      }
      if (!nearest) return false;
      api.speakTo('Pedestrian');
      return true;
    };
  }
  return api;
}

export function update(dt, ctx) {
  if (!current) {
    if (queue.length) playNext();
    return;
  }
  current.leftMs -= (typeof dt === 'number' ? dt : 0) * 1000;
  if (current.leftMs <= 0) playNext();
}

export default { init, update, NPC_LINES };
