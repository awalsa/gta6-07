// ISLA BRASA 3D — local dev server for round 7 (gta6-07).
//
// Node 22, standard library only. Serves the static files under game/ on
// http://localhost:8080 so the game can be played in desktop Chrome with
// no build step:
//
//   node serve.ts
//   node serve.ts --port 8080
//
// Only files inside game/ are ever served, and only with the MIME types a
// browser game needs. Anything that would climb out of game/ is refused.
// This is a play-testing convenience, not a public server.
//
// I wrote this server fresh for the gta6-07 rebuild, following the kit
// starter's shape; the wording and structure are my own.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// game/ sits next to this file. Resolve it once; every request is checked
// against this root, so no request can ever escape it.
const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));

function pickPort(argv: string[]): number {
  const flag = argv.indexOf('--port');
  if (flag === -1) return 8080;
  const value = Number(argv[flag + 1]);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 8080;
}

const port = pickPort(process.argv.slice(2));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = resolve(join(gameRoot, normalize(pathname)));
  if (file !== gameRoot && !file.startsWith(gameRoot + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  let size: number;
  try {
    const info = statSync(file);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }

  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`ISLA BRASA 3D (gta6-07): game/ is on http://localhost:${port}`);
});
