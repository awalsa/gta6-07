// casino.js — Coral Room Casino games for ISLA BRASA 3D (round 7).
//
// Slots, blackjack and roulette, betting the player's cash (via ctx.economy
// when it exists, otherwise state.cash). The overlay opens when the player
// is near the casino landmark and presses F, or via ctx.casino.open()
// (for example from the casino interior, F at the card table), or via
// ctx.casino.playSlots() / playBlackjack() / playRoulette() from the HUD.
//
// CRITICAL: the overlay UI is built DYNAMICALLY by this module every time
// it opens, from casinoPanelHTML(). index.html must NOT ship a static
// #overlay-casino placeholder: a static shell left in the page would
// shadow the real games and leave the casino unplayable. buildOverlay()
// therefore always replaces the overlay's innerHTML with the full playable
// panel — it never trusts or reuses a static placeholder's contents.
//
// Three.js ES module. Exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.

import * as THREE from 'three';
import { LANDMARKS } from './config.js';

// Landmark key in config.js for the casino.
const LM = { casino: 'coralCasino' };

const FALLBACK = { casino: { x: 120, z: 120 } };

function lmPos(name) {
  const key = LM[name] || name;
  const src = (LANDMARKS && LANDMARKS[key]) || FALLBACK[name] || { x: 0, z: 0 };
  if (Array.isArray(src)) return new THREE.Vector3(src[0], 0, src[1]);
  if (src && src.position) return new THREE.Vector3(src.position.x || 0, 0, src.position.z || 0);
  if (src && typeof src.x === 'number') return new THREE.Vector3(src.x, 0, src.z || 0);
  return new THREE.Vector3(0, 0, 0);
}

function keyIsDown(ctx, code) {
  const inp = (ctx && ctx.input) || {};
  if (typeof inp.isDown === 'function') return !!inp.isDown(code);
  if (inp.keys instanceof Set) return inp.keys.has(code);
  if (Array.isArray(inp.keys)) return inp.keys.includes(code);
  if (inp.keys) return !!inp.keys[code];
  if (typeof inp[code] === 'boolean') return inp[code];
  return false;
}

function playerPosition(ctx) {
  if (ctx.player) {
    if (ctx.player.position && typeof ctx.player.position.x === 'number') return ctx.player.position;
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (typeof ctx.player.getPosition === 'function') {
      const p = ctx.player.getPosition();
      if (p) return p;
    }
  }
  if (ctx.state && Array.isArray(ctx.state.playerPos)) {
    return new THREE.Vector3(ctx.state.playerPos[0] || 0, ctx.state.playerPos[1] || 0, ctx.state.playerPos[2] || 0);
  }
  if (ctx.state && ctx.state.playerPos && typeof ctx.state.playerPos.x === 'number') return ctx.state.playerPos;
  if (ctx.camera) return ctx.camera.position;
  return new THREE.Vector3(0, 0, 0);
}

// ---- cash: prefer the economy module, fall back to state.cash ----
function getCash(ctx) {
  if (ctx.economy && typeof ctx.economy.getCash === 'function') return ctx.economy.getCash();
  if (ctx.economy && typeof ctx.economy.cash === 'number') return ctx.economy.cash;
  if (ctx.economy && typeof ctx.economy.balance === 'number') return ctx.economy.balance;
  if (ctx.state) return ctx.state.cash || 0;
  return 0;
}

function setCash(ctx, amount) {
  if (ctx.economy && typeof ctx.economy.setCash === 'function') { ctx.economy.setCash(amount); return; }
  if (ctx.economy && typeof ctx.economy.cash === 'number') { ctx.economy.cash = amount; return; }
  if (ctx.economy && typeof ctx.economy.balance === 'number') { ctx.economy.balance = amount; return; }
  if (ctx.state) ctx.state.cash = amount;
}

function shiftCash(ctx, amount) {
  if (ctx.economy && typeof ctx.economy.addCash === 'function') { ctx.economy.addCash(amount); return; }
  if (ctx.economy && typeof ctx.economy.earn === 'function') { ctx.economy.earn(amount); return; }
  setCash(ctx, getCash(ctx) + amount);
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
  console.log('[casino]', msg);
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

// ---- card helpers (blackjack) ----
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const r = card.slice(0, -1);
    if (r === 'A') { total += 11; aces += 1; }
    else if (r === 'J' || r === 'Q' || r === 'K') total += 10;
    else total += parseInt(r, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎'];
const SLOT_PAYOUTS = { '🍒': 3, '🍋': 3, '🔔': 4, '⭐': 5, '7️⃣': 10, '💎': 8 };

let S = null;

export function init(ctx) {
  S = {
    ctx,
    open: false,
    game: 'slots',
    casinoPos: lmPos('casino'),
    overlay: null,
    balanceEl: null,
    betEl: null,
    gameEl: null,
    resultEl: null,
    bj: null, // blackjack round state
    prevF: false,
    prevEsc: false,
  };

  if (typeof document !== 'undefined') buildOverlay(ctx);

  const api = {
    open() { openCasino(ctx); },
    close() { closeCasino(ctx); },
    playSlots() { S.game = 'slots'; S.bj = null; openCasino(ctx); renderGame(ctx); },
    playBlackjack() { S.game = 'blackjack'; S.bj = null; openCasino(ctx); renderGame(ctx); },
    playRoulette() { S.game = 'roulette'; S.bj = null; openCasino(ctx); renderGame(ctx); },
    get balance() { return getCash(ctx); },
    get isOpen() { return S.open; },
  };
  ctx.casino = api;
  return api;
}

// The full casino panel, built as a string so it can be (re)created at any
// time. Nothing in index.html may pre-declare this markup: a static
// #overlay-casino shell would sit on top of this panel and block it.
function casinoPanelHTML() {
  return '<div style="background:#1d1033;border:2px solid #d4af37;border-radius:12px;padding:20px 24px;width:min(560px,92vw);color:#f5e9c8;max-height:88vh;overflow:auto;">' +
    '<h2 style="margin:0 0 4px;color:#ffd700;">🎰 Coral Room Casino</h2>' +
    '<div style="margin-bottom:10px;">Your cash: <b id="casino-balance" style="color:#7CFC00;">$0</b>' +
    '&nbsp;&nbsp;Bet: $<input id="casino-bet" type="number" value="100" min="10" step="10" style="width:90px;padding:4px;border-radius:4px;border:1px solid #d4af37;background:#2a1a4a;color:#fff;"></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button data-game="slots" style="flex:1;padding:8px;border-radius:6px;border:1px solid #d4af37;background:#3a2060;color:#ffe9a8;cursor:pointer;">Slots</button>' +
    '<button data-game="blackjack" style="flex:1;padding:8px;border-radius:6px;border:1px solid #d4af37;background:#3a2060;color:#ffe9a8;cursor:pointer;">Blackjack</button>' +
    '<button data-game="roulette" style="flex:1;padding:8px;border-radius:6px;border:1px solid #d4af37;background:#3a2060;color:#ffe9a8;cursor:pointer;">Roulette</button>' +
    '</div>' +
    '<div id="casino-game"></div>' +
    '<div id="casino-result" style="min-height:24px;margin:10px 0;font-weight:bold;"></div>' +
    '<button id="casino-close" style="width:100%;padding:10px;border-radius:6px;border:none;background:#d4af37;color:#1d1033;font-weight:bold;cursor:pointer;">Leave Casino (Esc)</button>' +
    '</div>';
}

function buildOverlay(ctx) {
  // ALWAYS build the full panel fresh. A static #overlay-casino placeholder
  // from index.html (empty shell, no #casino-game inside) must never be
  // trusted: if we reused it, the games would be missing and the casino
  // unplayable. Replacing innerHTML wipes any such placeholder.
  let ov = document.getElementById('overlay-casino');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'overlay-casino';
    ov.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,5,25,0.85);z-index:10000;align-items:center;justify-content:center;font-family:sans-serif;';
    document.body.appendChild(ov);
  }
  ov.innerHTML = casinoPanelHTML();
  S.overlay = ov;
  S.balanceEl = ov.querySelector('#casino-balance');
  S.betEl = ov.querySelector('#casino-bet');
  S.gameEl = ov.querySelector('#casino-game');
  S.resultEl = ov.querySelector('#casino-result');
  ov.querySelectorAll('[data-game]').forEach((btn) => {
    btn.onclick = () => { S.game = btn.getAttribute('data-game'); S.bj = null; renderGame(ctx); };
  });
  ov.querySelector('#casino-close').onclick = () => closeCasino(ctx);
  renderGame(ctx);
}

function refreshBalance(ctx) {
  if (S.balanceEl) S.balanceEl.textContent = '$' + getCash(ctx).toLocaleString();
}

function readBet(ctx) {
  const raw = S.betEl ? parseInt(S.betEl.value, 10) : 100;
  const bet = Number.isFinite(raw) ? Math.max(10, Math.floor(raw)) : 100;
  const cash = getCash(ctx);
  if (bet > cash) return { ok: false, reason: 'Not enough cash for a $' + bet + ' bet (you have $' + cash + ').' };
  return { ok: true, bet };
}

function say(msg, color) {
  if (S.resultEl) {
    S.resultEl.textContent = msg;
    S.resultEl.style.color = color || '#ffe9a8';
  }
}

function renderGame(ctx) {
  if (!S.gameEl) return;
  refreshBalance(ctx);
  if (S.game === 'slots') {
    S.gameEl.innerHTML =
      '<div style="text-align:center;">' +
      '<div id="slot-reels" style="font-size:52px;letter-spacing:8px;margin:8px 0;">🎰 🎰 🎰</div>' +
      '<div style="font-size:12px;color:#cbb;">3× 7️⃣ pays 10× · 3× 💎 8× · 3× ⭐ 5× · 3× 🔔 4× · any 3 alike 3× · first two alike 1×</div>' +
      '<button id="slot-spin" style="margin-top:10px;padding:10px 26px;border-radius:6px;border:none;background:#ff3366;color:#fff;font-weight:bold;cursor:pointer;">SPIN</button>' +
      '</div>';
    S.gameEl.querySelector('#slot-spin').onclick = () => spinSlots(ctx);
  } else if (S.game === 'blackjack') {
    S.gameEl.innerHTML =
      '<div style="text-align:center;">' +
      '<div id="bj-table" style="font-size:15px;line-height:1.9;margin:6px 0;">Press Deal to start a hand.</div>' +
      '<button id="bj-deal" style="padding:8px 18px;margin:2px;border-radius:6px;border:none;background:#2ecc71;color:#fff;font-weight:bold;cursor:pointer;">Deal</button>' +
      '<button id="bj-hit" style="padding:8px 18px;margin:2px;border-radius:6px;border:none;background:#3498db;color:#fff;font-weight:bold;cursor:pointer;" disabled>Hit</button>' +
      '<button id="bj-stand" style="padding:8px 18px;margin:2px;border-radius:6px;border:none;background:#e67e22;color:#fff;font-weight:bold;cursor:pointer;" disabled>Stand</button>' +
      '<div style="font-size:12px;color:#cbb;margin-top:6px;">Dealer stands on 17 · Blackjack pays 3:2 · Win pays 1:1</div>' +
      '</div>';
    S.gameEl.querySelector('#bj-deal').onclick = () => dealBlackjack(ctx);
    S.gameEl.querySelector('#bj-hit').onclick = () => hitBlackjack(ctx);
    S.gameEl.querySelector('#bj-stand').onclick = () => standBlackjack(ctx);
  } else {
    S.gameEl.innerHTML =
      '<div style="text-align:center;">' +
      '<div id="roulette-wheel" style="font-size:44px;margin:6px 0;">🎡</div>' +
      '<div>Bet on: <select id="roulette-choice" style="padding:6px;border-radius:4px;background:#2a1a4a;color:#fff;border:1px solid #d4af37;">' +
      '<option value="red">Red (pays 2×)</option><option value="black">Black (pays 2×)</option><option value="green">Green 0 (pays 36×)</option><option value="number">A number 0–36 (pays 36×)</option>' +
      '</select> <input id="roulette-number" type="number" min="0" max="36" value="7" style="width:56px;padding:6px;border-radius:4px;background:#2a1a4a;color:#fff;border:1px solid #d4af37;"></div>' +
      '<button id="roulette-spin" style="margin-top:10px;padding:10px 26px;border-radius:6px;border:none;background:#ff3366;color:#fff;font-weight:bold;cursor:pointer;">SPIN THE WHEEL</button>' +
      '</div>';
    S.gameEl.querySelector('#roulette-spin').onclick = () => spinRoulette(ctx);
  }
}

function spinSlots(ctx) {
  const b = readBet(ctx);
  if (!b.ok) { say(b.reason, '#ff8888'); return; }
  shiftCash(ctx, -b.bet);
  const reels = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
  const reelsEl = S.gameEl && S.gameEl.querySelector('#slot-reels');
  if (reelsEl) reelsEl.textContent = '🎰 🎰 🎰';
  say('Spinning…');
  setTimeout(() => {
    if (reelsEl) reelsEl.textContent = reels.join(' ');
    let mult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) mult = SLOT_PAYOUTS[reels[0]] || 3;
    else if (reels[0] === reels[1]) mult = 1;
    if (mult > 0) {
      shiftCash(ctx, b.bet * mult);
      say('WIN! ' + reels.join(' ') + ' — paid $' + (b.bet * mult) + ' (' + mult + '×).', '#7CFC00');
    } else {
      say('No win — ' + reels.join(' ') + '. Lost $' + b.bet + '.', '#ff8888');
    }
    refreshBalance(ctx);
  }, 500);
}

function bjButtons(inHand) {
  if (!S.gameEl) return;
  const hit = S.gameEl.querySelector('#bj-hit');
  const stand = S.gameEl.querySelector('#bj-stand');
  const deal = S.gameEl.querySelector('#bj-deal');
  if (hit) hit.disabled = !inHand;
  if (stand) stand.disabled = !inHand;
  if (deal) deal.disabled = inHand;
}

function bjShow(hideDealerHole) {
  const table = S.gameEl && S.gameEl.querySelector('#bj-table');
  if (!table || !S.bj) return;
  const dealerShown = hideDealerHole ? S.bj.dealer[0] + ' ??' : S.bj.dealer.join(' ');
  const dealerVal = hideDealerHole ? '?' : handValue(S.bj.dealer);
  table.innerHTML =
    'Dealer (' + dealerVal + '): <b>' + dealerShown + '</b><br>' +
    'You (' + handValue(S.bj.player) + '): <b>' + S.bj.player.join(' ') + '</b>';
}

function dealBlackjack(ctx) {
  const b = readBet(ctx);
  if (!b.ok) { say(b.reason, '#ff8888'); return; }
  shiftCash(ctx, -b.bet);
  const deck = newDeck();
  S.bj = { deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], bet: b.bet, done: false };
  bjButtons(true);
  bjShow(true);
  const pv = handValue(S.bj.player);
  if (pv === 21) {
    // Natural blackjack pays 3:2 (stake back + 1.5x = 2.5x total).
    shiftCash(ctx, Math.floor(b.bet * 2.5));
    S.bj.done = true;
    bjShow(false);
    bjButtons(false);
    say('BLACKJACK! Paid $' + Math.floor(b.bet * 2.5) + '.', '#7CFC00');
  } else {
    say('Your move — Hit or Stand.');
  }
  refreshBalance(ctx);
}

function hitBlackjack(ctx) {
  if (!S.bj || S.bj.done) return;
  S.bj.player.push(S.bj.deck.pop());
  const v = handValue(S.bj.player);
  bjShow(true);
  if (v > 21) {
    S.bj.done = true;
    bjShow(false);
    bjButtons(false);
    say('Bust! ' + v + ' — you lose $' + S.bj.bet + '.', '#ff8888');
  } else if (v === 21) {
    standBlackjack(ctx);
  }
  refreshBalance(ctx);
}

function standBlackjack(ctx) {
  if (!S.bj || S.bj.done) return;
  while (handValue(S.bj.dealer) < 17) S.bj.dealer.push(S.bj.deck.pop());
  const pv = handValue(S.bj.player);
  const dv = handValue(S.bj.dealer);
  S.bj.done = true;
  bjShow(false);
  bjButtons(false);
  if (dv > 21) {
    shiftCash(ctx, S.bj.bet * 2);
    say('Dealer busts (' + dv + ')! You win $' + S.bj.bet + '.', '#7CFC00');
  } else if (pv > dv) {
    shiftCash(ctx, S.bj.bet * 2);
    say('You win ' + pv + ' vs ' + dv + '! +$' + S.bj.bet + '.', '#7CFC00');
  } else if (pv < dv) {
    say('Dealer wins ' + dv + ' vs ' + pv + '. Lost $' + S.bj.bet + '.', '#ff8888');
  } else {
    shiftCash(ctx, S.bj.bet);
    say('Push — ' + pv + ' vs ' + dv + '. Bet returned.', '#ffe9a8');
  }
  refreshBalance(ctx);
}

function spinRoulette(ctx) {
  const b = readBet(ctx);
  if (!b.ok) { say(b.reason, '#ff8888'); return; }
  const choiceEl = S.gameEl && S.gameEl.querySelector('#roulette-choice');
  const numEl = S.gameEl && S.gameEl.querySelector('#roulette-number');
  const choice = choiceEl ? choiceEl.value : 'red';
  const num = numEl ? parseInt(numEl.value, 10) : 7;
  shiftCash(ctx, -b.bet);
  const result = Math.floor(Math.random() * 37); // 0–36
  const color = result === 0 ? 'green' : (RED_NUMBERS.has(result) ? 'red' : 'black');
  const wheel = S.gameEl && S.gameEl.querySelector('#roulette-wheel');
  if (wheel) wheel.textContent = '🎡 …';
  say('Spinning…');
  setTimeout(() => {
    if (wheel) wheel.textContent = '🎡 ' + result + ' ' + (color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢');
    let win = false;
    let mult = 0;
    if (choice === 'red' && color === 'red') { win = true; mult = 2; }
    if (choice === 'black' && color === 'black') { win = true; mult = 2; }
    if (choice === 'green' && result === 0) { win = true; mult = 36; }
    if (choice === 'number' && result === num) { win = true; mult = 36; }
    if (win) {
      shiftCash(ctx, b.bet * mult);
      say('Ball lands ' + result + ' (' + color + ') — YOU WIN $' + (b.bet * mult) + '!', '#7CFC00');
    } else {
      say('Ball lands ' + result + ' (' + color + ') — you lose $' + b.bet + '.', '#ff8888');
    }
    refreshBalance(ctx);
  }, 600);
}

function openCasino(ctx) {
  if (!S || S.open) return;
  if (!S.overlay) buildOverlay(ctx);
  if (!S.overlay) return;
  S.open = true;
  S.bj = null;
  renderGame(ctx);
  S.overlay.style.display = 'flex';
  if (ctx.state) ctx.state.uiOpen = true;
  refreshBalance(ctx);
  say('Welcome to the Coral Room. Good luck.');
}

function closeCasino(ctx) {
  if (!S || !S.open) return;
  S.open = false;
  if (S.overlay) S.overlay.style.display = 'none';
  if (ctx.state) ctx.state.uiOpen = false;
  toast(ctx, 'You leave the Coral Room.');
}

export function update(dt, ctx) {
  if (!S) return;
  const p = playerPosition(ctx);

  const fDown = keyIsDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;
  const escDown = keyIsDown(ctx, 'Escape');
  const escPressed = escDown && !S.prevEsc;
  S.prevEsc = escDown;

  if (escPressed && S.open) { closeCasino(ctx); return; }

  const inside = ctx.interiors && ctx.interiors.inside;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const overlayOpen = ctx.state && ctx.state.uiOpen;

  if (!S.open && fPressed && !overlayOpen && !inPlane && !inside) {
    // Radius 14: the casino building (24x22) pushes the player to ~12.5
    // from its centre, so a tighter radius could never be reached on foot.
    if (p.distanceTo(S.casinoPos) < 14) openCasino(ctx);
  }

  if (!S.open && !overlayOpen && !inPlane && !inside && p.distanceTo(S.casinoPos) < 14) {
    setPrompt('Press F — Enter the Coral Room Casino');
  } else if (S.open) {
    setPrompt('');
  }
}

export default { init, update };
