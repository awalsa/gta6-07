// ISLA BRASA 3D — Three.js access shim.
//
// Three.js is vendored locally at ../vendor/three.module.min.js and mapped
// to the bare specifier "three" by the import map in game/index.html. The
// boot loader in index.html imports it first and stores the resolved module
// namespace on window.__ISLA_THREE__ before main.js is dynamically imported.
// This shim is the one place game code gets THREE from, so no module ever
// hard-codes a URL.
//
// Modules should prefer ctx.THREE (main.js puts this same namespace on ctx);
// this shim exists for modules that need THREE at import time. If the loader
// has not run yet (for example a module imported outside the game boot), the
// default export is undefined and main.js shows the loading error instead of
// crashing.

export const THREE = globalThis.__ISLA_THREE__;

export default THREE;
