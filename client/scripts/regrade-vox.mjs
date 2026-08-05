// Re-grades a MagicaVoxel `.vox` palette toward a DOOM-1993 look: the clean neutral greys a generator
// emits become a tight, warm, grimy ramp (khaki/brown-grey, boosted contrast, limited steps) — the
// palette is the ONLY thing rewritten, geometry is byte-identical. Reusable for every hand-sculpted prop.
//
// Run:  node client/scripts/regrade-vox.mjs <in.vox> [out.vox]   (defaults to in-place)

import { readFileSync, writeFileSync } from 'node:fs';

const inPath = process.argv[2];
const outPath = process.argv[3] ?? inPath;

if (!inPath) {
  console.error('usage: regrade-vox.mjs <in.vox> [out.vox]');
  process.exit(1);
}

// DOOM ramp: luminance (0..255) → grimy warm RGB, as control points, linearly interpolated. Warm bias
// grows with brightness (highlights read dusty/sepia), shadows crush toward a near-black brown.
const RAMP = [
  [0, [16, 13, 12]],
  [38, [46, 40, 34]],
  [90, [92, 80, 62]], // main body — khaki grey-brown
  [125, [130, 112, 86]],
  [160, [166, 146, 112]],
  [200, [200, 180, 142]],
  [255, [226, 208, 170]],
];

/** A gentle S-curve to widen contrast before the ramp lookup (darks darker, lights lighter). */
const contrast = (t) => {
  const x = t / 255;
  const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);

  return s * 255;
};

function grade(r, g, b) {
  const lum = contrast(0.3 * r + 0.59 * g + 0.11 * b);

  for (let i = 1; i < RAMP.length; i++) {
    const [l0, c0] = RAMP[i - 1];
    const [l1, c1] = RAMP[i];

    if (lum <= l1) {
      const f = (lum - l0) / (l1 - l0 || 1);

      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }

  return RAMP[RAMP.length - 1][1];
}

const b = readFileSync(inPath);

if (b.toString('ascii', 0, 4) !== 'VOX ') throw new Error('not a .vox');

// Find the RGBA chunk and re-grade every non-empty entry in place.
let o = 8;
let graded = 0;

while (o < b.length - 8) {
  const id = b.toString('ascii', o, o + 4);
  const cs = b.readInt32LE(o + 4);

  if (id === 'RGBA') {
    const base = o + 12;

    for (let e = 0; e < 256; e++) {
      const p = base + e * 4;

      if (b[p + 3] === 0 && b[p] === 0 && b[p + 1] === 0 && b[p + 2] === 0) continue; // untouched slot
      const [nr, ng, nb] = grade(b[p], b[p + 1], b[p + 2]);

      b[p] = nr;
      b[p + 1] = ng;
      b[p + 2] = nb;
      graded++;
    }
  }
  o += 12 + (id === 'MAIN' ? 0 : cs);
}

writeFileSync(outPath, b);
console.log(`re-graded ${graded} palette entries → ${outPath}`);
