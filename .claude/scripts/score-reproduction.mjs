#!/usr/bin/env node
// CRS CLI — scores ONLY the reproduced surface (src/app + src/styles), reports the same-corpus floor
// so 0.94 is read honestly, and surfaces the weak-file tail. Usage: node .claude/scripts/score-reproduction.mjs [client] [repro]
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { scoreTrees, floorOf, layerOf } from './lib/reproduction-score.mjs';
import { SCORED_EXCLUDE } from './lib/seed-manifest.mjs';

// Provided/reused files (content JSON, articles, assets, environments, index.html, main*.ts, types)
// live elsewhere under src/ and are excluded by construction — they never earn a free 100%.
const GLOBS = [
  'src/app/**/*.ts',
  'src/app/**/*.html',
  'src/app/**/*.scss',
  'src/styles/**/*.scss',
  'src/styles.scss',
];
const IGNORE = /\.spec\.ts$|\.e2e\.|test-providers\.ts$/;

function readTree(root) {
  const tree = {};
  for (const pattern of GLOBS) {
    for (const rel of globSync(pattern, { cwd: root })) {
      if (IGNORE.test(rel) || SCORED_EXCLUDE.includes(rel)) {
        continue;
      }
      tree[rel] = readFileSync(join(root, rel), 'utf8');
    }
  }

  return tree;
}

const [, , originalRoot = 'client', rebuildRoot = 'repro'] = process.argv;
const original = readTree(originalRoot);
const rebuild = readTree(rebuildRoot);
const { global, meanPerFile, files } = scoreTrees(original, rebuild);
const floor = floorOf(original);

const byLayer = {};
for (const [path, info] of Object.entries(files)) {
  const layer = layerOf(path);
  (byLayer[layer] ??= { weighted: 0, loc: 0 });
  byLayer[layer].weighted += info.similarity * info.loc;
  byLayer[layer].loc += info.loc;
}
const layerRows = Object.entries(byLayer)
  .sort((a, b) => b[1].loc - a[1].loc)
  .map(([layer, row]) => `| ${layer} | ${(row.weighted / row.loc).toFixed(3)} | ${row.loc} |`)
  .join('\n');

const sims = Object.values(files)
  .map((info) => info.similarity)
  .sort((a, b) => a - b);
const p10 = sims[Math.floor(sims.length * 0.1)] ?? 0;
const below = Object.entries(files)
  .filter(([, info]) => info.similarity < 0.7)
  .map(([path]) => path);

writeFileSync('reproduction-score.json', JSON.stringify({ global, meanPerFile, floor, byLayer, files }, null, 2));
console.log(`CRS global (LOC-weighted): ${global}`);
console.log(`CRS mean-per-file:         ${meanPerFile}`);
console.log(`Same-corpus FLOOR:         ${floor}   (a different same-kit app scores ~this from conventions alone)`);
console.log(`Discrimination (global - floor): ${(global - floor).toFixed(3)}`);
console.log(`p10 per-file: ${p10}   files below 0.7: ${below.length}`);
console.log(`Per layer:\n| layer | crs | loc |\n|---|---|---|\n${layerRows}`);
if (below.length > 0) {
  console.log(`Weak files (<0.7):\n  ${below.slice(0, 30).join('\n  ')}`);
}
process.exitCode = global >= 0.94 ? 0 : 1;
