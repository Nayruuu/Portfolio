#!/usr/bin/env node
// Builds the blind rebuild workspace repro/ from the seed manifest, then guards that no REPRODUCED
// source (.ts/.html/.scss) leaked in. Reused content .json under src/app/core/content is allowed.
import { cpSync, rmSync, mkdirSync, globSync } from 'node:fs';
import { COPY, isForbidden, SCORED_EXCLUDE } from './lib/seed-manifest.mjs';

rmSync('repro', { recursive: true, force: true });
mkdirSync('repro');
for (const pattern of COPY) {
  for (const match of globSync(pattern)) {
    if (isForbidden(match)) {
      throw new Error(`Refusing to seed forbidden path into blind workspace: ${match}`);
    }
    cpSync(match, `repro/${match.replace(/^client\//, '')}`, { recursive: true });
  }
}

const provided = new Set(SCORED_EXCLUDE.map((path) => `repro/${path}`));
const leaked = [
  ...globSync('repro/src/app/**/*.ts'),
  ...globSync('repro/src/app/**/*.html'),
  ...globSync('repro/src/app/**/*.scss'),
  ...globSync('repro/src/styles/**/*.scss'),
  ...globSync('repro/src/styles.scss'),
].filter((path) => !provided.has(path));
if (leaked.length > 0) {
  throw new Error(`Blindness violated — reproduced source present in repro/: ${leaked.slice(0, 5).join(', ')}`);
}

console.log('Seeded blind workspace at repro/ (kit + reused data + config; no reproduced source).');
