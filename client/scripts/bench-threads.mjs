// CPU thread-scaling benchmark for the BSP renderer's worker pool.
//
// Drives the REAL browser engine (the pool needs Worker + SharedArrayBuffer + crossOriginIsolated,
// so it only runs under the isolated build server, NOT ng serve). For each pinned worker count it
// loads /bsp?workers=N&renderer=cpu&perflog=1&noenemies=1, lets the static spawn view render for a
// few seconds, and reads the per-frame perf ring (window.__bspPerfRing) — render cost + parallel
// compute per frame — to report the median at each thread count and the speedup vs 1 worker.
//
// Prereqs:  npm run build  &&  node serve-isolated.mjs   (serves dist on :4202 with COOP/COEP)
// Usage:    node scripts/bench-threads.mjs [level=m1] [--workers=1,2,4,8]
//
// Static spawn view, 720p (windowed), no sprites/enemies — isolates the rasterizer's parallel
// scaling. WebGPU is NOT covered here (headless chromium has no navigator.gpu); read __bspGpuStats
// in a real Chrome for the GPU path.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/stephanedetodaro/Projects/Portfolio/client/')('@playwright/test');

const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const LEVEL = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'm1';
const WORKERS = arg('workers', '1,2,4,8').split(',').map(Number);
const BASE = 'http://localhost:4202';

const browser = await chromium.launch();
const results = [];
for (const N of WORKERS) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/bsp?renderer=cpu&workers=${N}&perflog=1&noenemies=1&level=${LEVEL}`);
  try {
    await page.waitForFunction(() => (globalThis.__bspPerfRing?.n ?? 0) > 150, { timeout: 25000 });
  } catch {
    const iso = await page.evaluate(() => globalThis.crossOriginIsolated);
    console.error(`  N=${N}: ring never filled (crossOriginIsolated=${iso}) — is serve-isolated.mjs up on :4202?`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(3000);
  const stat = await page.evaluate((N) => {
    const r = globalThis.__bspPerfRing;
    const size = r.render.length;
    const count = Math.min(r.n, size);
    const render = [];
    const compute = [];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      if (r.render[i] > 0) {
        seen.add(r.workers[i]);
        if (r.workers[i] === N) {
          render.push(r.render[i]);
          compute.push(r.compute[i]);
        }
      }
    }
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
    return {
      iso: globalThis.crossOriginIsolated,
      threadsSeen: [...seen].sort((a, b) => a - b),
      frames: render.length,
      render: med(render),
      compute: med(compute),
    };
  }, N);
  results.push({ N, ...stat });
  await page.close();
}
await browser.close();

const base = results.find((r) => r.N === 1)?.render;
console.log(`\nBSP renderer — CPU thread scaling (isolated build :4202)`);
console.log(`level ${LEVEL} · 720p · static spawn view · no sprites · median render cost over ~200+ frames\n`);
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(`${pad('workers', 9)}${padl('render ms', 12)}${padl('compute ms', 12)}${padl('speedup', 10)}${padl('efficiency', 12)}${padl('frames', 9)}`);
console.log('─'.repeat(64));
for (const r of results) {
  const sp = base && r.render ? base / r.render : NaN;
  const eff = Number.isFinite(sp) ? (sp / r.N) * 100 : NaN;
  console.log(
    `${pad(r.N, 9)}${padl(r.render?.toFixed(2) ?? '—', 12)}${padl(r.compute?.toFixed(2) ?? '—', 12)}${padl(Number.isFinite(sp) ? sp.toFixed(2) + '×' : '—', 10)}${padl(Number.isFinite(eff) ? Math.round(eff) + '%' : '—', 12)}${padl(r.frames, 9)}`,
  );
  if (r.threadsSeen && (r.threadsSeen.length !== 1 || r.threadsSeen[0] !== r.N)) {
    console.log(`         ⚠ threads observed: [${r.threadsSeen}] (expected only ${r.N}) — pin may not have held`);
  }
}
console.log('─'.repeat(64));
console.log('speedup = render(1)/render(N); efficiency = speedup/N (100% = perfect linear scaling)\n');
