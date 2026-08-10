// Reproducible render-cost benchmark for the BSP software renderer.
//
// Bundles the engine's PURE modules for Node (buildBsp + renderFrame + locateSubSector +
// proceduralTextures — no DOM, no rAF, no workers), then, for every level, times the
// single-thread CPU `renderFrame` over a deterministic 360° rotation sweep at spawn.
//
// The honest signal is RENDER COST in ms (performance.now around renderFrame), NOT fps:
// the live game's fps is rAF/vsync-bounded (~60) and machine-dependent, whereas render-cost
// ms is comparable across runs. Numbers below are single-thread CPU (the worker pool and
// WebGPU paths are browser-only); textures are the procedural fallback library; the scene is
// world geometry only (no sprites/enemies). Same script + same machine → same numbers.
//
//   Usage: node scripts/bench-render.mjs [--frames=300] [--res=720,1080]
import { build } from 'esbuild';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS_DIR = resolve(HERE, '../src/app/core/lib/game/levels');
const BSP = resolve(HERE, '../src/app/core/lib/bsp-engine');
const LOADTEX = resolve(HERE, '../src/app/core/lib/game/render/load-textures.ts');
const TMP = resolve(HERE, '.bench-bundle.mjs');
const TMP_ENTRY = resolve(HERE, '.bench-entry.ts');

const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const FRAMES = Number(arg('frames', '300'));
const WARMUP = 30;
const EYE_HEIGHT = 1.4; // zone-runtime.ts:28
const FOV = Math.PI / 2; // render-host default
const RES = arg('res', '720,1080')
  .split(',')
  .map((r) => (r === '1080' ? [1920, 1080] : r === '720' ? [1280, 720] : r.split('x').map(Number)));

const levelFiles = readdirSync(LEVELS_DIR).filter((f) => /^level-.+\.ts$/.test(f) && !f.endsWith('.spec.ts'));

// One node bundle: the pure engine seam + proceduralTextures + every level (namespaced).
const lines = [
  `export { buildBsp, locateSubSector } from ${JSON.stringify(resolve(BSP, 'node-builder.ts'))};`,
  `export { renderFrame } from ${JSON.stringify(resolve(BSP, 'renderer.ts'))};`,
  `export { proceduralTextures } from ${JSON.stringify(LOADTEX)};`,
];
for (const f of levelFiles) {
  lines.push(`export * as ${f.replace(/[^a-zA-Z0-9]/g, '_')} from ${JSON.stringify(resolve(LEVELS_DIR, f))};`);
}
writeFileSync(TMP_ENTRY, lines.join('\n'));
await build({ entryPoints: [TMP_ENTRY], bundle: true, format: 'esm', platform: 'node', outfile: TMP, logLevel: 'error' });
rmSync(TMP_ENTRY);
const mod = await import(pathToFileURL(TMP).href);
rmSync(TMP);
const { buildBsp, locateSubSector, renderFrame, proceduralTextures } = mod;

const isLevel = (v) => v && typeof v === 'object' && v.map?.sectors && v.spawn;
const levels = [];
for (const f of levelFiles) {
  const ns = mod[f.replace(/[^a-zA-Z0-9]/g, '_')];
  const level = Object.values(ns).find(isLevel);
  if (level) levels.push({ name: f.replace(/^level-|\.ts$/g, ''), level });
}
levels.sort((a, b) => a.name.localeCompare(b.name));

const textures = proceduralTextures();
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const results = [];
for (const { name, level } of levels) {
  const compiled = buildBsp(level.map);
  const { x, y, angle } = level.spawn;
  const floorZ = compiled.source.sectors[locateSubSector(compiled.root, x, y).sector].floorZ;
  const z = floorZ + EYE_HEIGHT;

  for (const [w, h] of RES) {
    const config = { width: w, height: h, fov: FOV };
    const target = new Uint8ClampedArray(w * h * 4);
    const zbuffer = new Float32Array(w * h);
    const cam = (a) => ({ x, y, angle: a, z, pitch: 0 });

    for (let i = 0; i < WARMUP; i++) renderFrame(compiled, cam(angle + (i / WARMUP) * 2 * Math.PI), config, textures, target, zbuffer, 0, h);

    const times = [];
    for (let i = 0; i < FRAMES; i++) {
      const a = angle + (i / FRAMES) * 2 * Math.PI;
      const t0 = performance.now();
      renderFrame(compiled, cam(a), config, textures, target, zbuffer, 0, h);
      times.push(performance.now() - t0);
    }
    times.sort((p, q) => p - q);
    const mean = times.reduce((s, t) => s + t, 0) / times.length;
    results.push({ name, res: `${w}×${h}`, mean, median: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1] });
  }
}

const cpu = cpus()[0]?.model ?? 'unknown CPU';
console.log(`\nBSP software renderer — single-thread CPU render cost`);
console.log(`node ${process.version} · ${cpu} · ${levels.length} levels · ${FRAMES} frames/scene (360° sweep at spawn) · procedural textures · world geometry, no sprites\n`);
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(`${pad('level', 22)}${pad('res', 11)}${padl('mean', 8)}${padl('median', 9)}${padl('p95', 8)}${padl('max', 8)}${padl('~fps', 8)}`);
console.log('─'.repeat(72));
for (const r of results) {
  console.log(`${pad(r.name, 22)}${pad(r.res, 11)}${padl(r.mean.toFixed(2), 8)}${padl(r.median.toFixed(2), 9)}${padl(r.p95.toFixed(2), 8)}${padl(r.max.toFixed(2), 8)}${padl(Math.round(1000 / r.mean), 8)}`);
}
console.log('─'.repeat(72));
for (const [w, h] of RES) {
  const rs = results.filter((r) => r.res === `${w}×${h}`);
  const m = rs.reduce((s, r) => s + r.mean, 0) / rs.length;
  console.log(`${pad(`ALL (mean of ${rs.length})`, 22)}${pad(`${w}×${h}`, 11)}${padl(m.toFixed(2), 8)}${padl('', 9)}${padl('', 8)}${padl('', 8)}${padl(Math.round(1000 / m), 8)}  ms/frame`);
}
console.log('');
