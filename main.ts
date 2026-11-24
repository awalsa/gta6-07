// ISLA BRASA 3D — hand-in entrypoint for make.fun, round 7 (gta6-07).
//
// Node 22, standard library only, no build step and no install. The game
// itself is plain static files under game/ (game/index.html plus its ES
// modules, with Three.js vendored at game/vendor/three.module.min.js and
// reached through the import map in game/index.html), so it plays offline
// with no network request at all.
//
// What this file does, in order:
//   1. Copy game/ into the output directory.
//   2. Copy screenshots/ (real renders of the game) into the output.
//   3. Write dossier.json there with buildDossier from vendor/makefun-game.ts.
//
// Run it locally to check the hand-in before submission:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Leave MAKEFUN_OUTPUT_DIR unset and the grader's /output is used.
// To play the game instead, run `node serve.ts` and open
// http://localhost:8080 in desktop Chrome.
//
// I wrote this entrypoint fresh for the gta6-07 rebuild, from the kit's
// contract (copy the two trees, build the dossier with the scorer's caps).
// The wording, comments and structure are my own.

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repo root is the directory this file sits in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps, as the kit describes them. text_max_bytes is the only
// one that shapes the dossier's bytes; the others refuse an entry the
// scorer would refuse anyway (too many screenshots, one too large, too many
// game entries, too many game bytes, or a game path too long). Failing here,
// while there is still time to fix it, is the whole point of passing them.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function fail(message: string): never {
  throw new Error(`main.ts: ${message}`);
}

const gameDir = join(repoRoot, 'game');
if (!existsSync(join(gameDir, 'index.html')) || !statSync(join(gameDir, 'index.html')).isFile()) {
  fail('game/index.html is missing — there is no game to hand in');
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });

const shotsDir = join(repoRoot, 'screenshots');
const outShotsDir = join(outDir, 'screenshots');
mkdirSync(outShotsDir, { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, outShotsDir, { recursive: true });
}

writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

console.log(`ISLA BRASA 3D (gta6-07) handed in: ${outDir}`);
