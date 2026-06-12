// Dev helper: serve the production build with cross-origin isolation (COOP/COEP) so SharedArrayBuffer —
// and therefore the /bsp multi-threaded renderer — is enabled locally. `ng serve` can't set these headers,
// so to SEE the worker pool: `npm run build` then `node serve-isolated.mjs`, open http://localhost:4202/bsp
// (the overlay should show N thread(s)). Not for production — prod headers live in staticwebapp.config.json.
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';

const ROOT = join(process.cwd(), 'dist/super-dev-portfolio/browser');
const PORT = 4202;
// Perf telemetry sink: the /bsp harness POSTs one JSON sample per tick here (localhost only); appended as
// JSONL to the repo-root .sessions/ (gitignored) so it can be read back and analysed offline.
const PERF_LOG = join(process.cwd(), '..', '.sessions', 'bsp-perf.jsonl');
let perfWrite = Promise.resolve(); // serialise appends so rapid beacons never interleave a line
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

const send = (res, type, body) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Type', type);
  res.end(body);
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));

  // Perf telemetry sink (dev only): append the posted JSON sample as one JSONL line.
  if (req.method === 'POST' && path === '/perf') {
    let body = '';

    for await (const chunk of req) {
      body += chunk;
    }
    perfWrite = perfWrite
      .then(() => mkdir(dirname(PERF_LOG), { recursive: true }))
      .then(() => appendFile(PERF_LOG, body.trim() + '\n'))
      .catch(() => {});
    res.statusCode = 204;
    res.end();

    return;
  }

  const candidates = [join(ROOT, path), join(ROOT, path, 'index.html'), join(ROOT, 'index.html')];

  for (const file of candidates) {
    try {
      send(res, TYPES[extname(file)] ?? 'application/octet-stream', await readFile(file));

      return;
    } catch {
      // try the next candidate (file → directory index → SPA fallback)
    }
  }
  res.statusCode = 404;
  send(res, 'text/plain', 'not found');
}).listen(PORT, () => console.log(`isolated build on http://localhost:${PORT}  (open /bsp)`));
