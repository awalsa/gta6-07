// ISLA BRASA 3D — keyboard and mouse input.
//
// One shared `input` object: modules read input.keys (a Set of event.code
// strings) and input.mouse each frame. initInput() wires the window
// listeners once; main.js calls it at boot, before any system reads input.
//
// Key map (the game design):
//   WASD move, Shift run, E enter/exit car, F interact, Q weapon wheel
//   (hold), G shop/garage, R race, M map, N mute, V rain toggle, H help,
//   Space jump.
// Edge-triggered keys (E, F, G, R, M, N, V, H) are handled by the owning
// module with its own keydown listener or its own edge tracking on
// input.keys; this module only records the raw held state.

export const input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
};

let attached = false;

export function initInput() {
  if (attached) return;
  attached = true;

  window.addEventListener('keydown', (event) => {
    // Ignore key repeats for the Set (a repeat is already present) and keep
    // typing in overlay inputs from leaking into the game: overlays stop
    // propagation on their own fields, so here we just record the key.
    input.keys.add(event.code);
    // Keep the page from scrolling on game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    input.keys.delete(event.code);
  });

  window.addEventListener('blur', () => {
    // Losing the window must not leave the player running or driving forever.
    input.keys.clear();
    input.mouse.down = false;
  });

  window.addEventListener('mousemove', (event) => {
    input.mouse.x = event.clientX;
    input.mouse.y = event.clientY;
  });

  window.addEventListener('mousedown', (event) => {
    if (event.button === 0) input.mouse.down = true;
  });

  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.mouse.down = false;
  });
}

// Convenience check used by gameplay modules: is this physical key held now?
export function isDown(code) {
  return input.keys.has(code);
}

// Edge helper for modules that want "pressed this frame" without keeping
// their own listener: returns true once per physical press. Call once per
// frame per key; the press is consumed on the first call.
const consumed = new Set();
export function justPressed(code) {
  if (!input.keys.has(code)) {
    consumed.delete(code);
    return false;
  }
  if (consumed.has(code)) return false;
  consumed.add(code);
  return true;
}

export default input;
