// Smooths a MagicaVoxel `.vox` for the per-voxel renderer:
// - COLOURS (always): each voxel takes the modal palette index of the occupied voxels in its 3×3×3
//   neighbourhood (self weighted ×2 so genuine material boundaries survive). Kills the salt-and-pepper
//   dither a noise-brush sculpt or a majority downsample leaves on flat surfaces.
// - SURFACE (--surface): conservative morphology — fill an empty cell with ≥20/26 occupied neighbours
//   (a one-voxel pit), clear a solid cell with ≤5/26 (a lone spike). ±1-voxel roughness otherwise makes
//   adjacent screen pixels hit different FACES of the DDA (top ×1.18 / side ×0.82 / front ×1.0) and read
//   as mottle. Thin parts (legs, stems: ~8–16 neighbours) sit far from both thresholds — untouched.
// - ROUND (--round=N): N iterations of a majority cellular automaton (solid iff ≥14 of the 27-cell
//   neighbourhood is solid) that ROUNDS the staircase a curved form leaves at voxel scale — concave step
//   corners fill, convex ones shave, flats and true right angles are stable. Solids whose min axis run is
//   < 4 voxels are FROZEN (never cleared) so stems/armrests don't erode.
//
// Run:  node client/scripts/smooth-vox.mjs <in.vox> [passes=1] [out.vox] [--surface] [--round=N]

import { readFileSync, writeFileSync } from 'node:fs';

const roundArg = process.argv.find((a) => a.startsWith('--round'));
const roundIters = roundArg === undefined ? 0 : Number(roundArg.split('=')[1] ?? 1);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const surface = process.argv.includes('--surface');
const inPath = args[0];
const passes = Number(args[1] ?? 1);
const outPath = args[2] ?? inPath;

if (!inPath || !Number.isInteger(passes) || passes <= 0 || !Number.isInteger(roundIters)) {
  console.error('usage: smooth-vox.mjs <in.vox> [passes=1] [out.vox] [--surface] [--round=N]');
  process.exit(1);
}

const b = readFileSync(inPath);

if (b.toString('ascii', 0, 4) !== 'VOX ') throw new Error('not a .vox');

// Read SIZE + XYZI + RGBA.
let o = 8;
let sx = 0;
let sy = 0;
let sz = 0;
let voxels = [];
let rgba = null;

while (o < b.length - 8) {
  const id = b.toString('ascii', o, o + 4);
  const cs = b.readInt32LE(o + 4);

  if (id === 'SIZE') {
    sx = b.readInt32LE(o + 12);
    sy = b.readInt32LE(o + 16);
    sz = b.readInt32LE(o + 20);
  } else if (id === 'XYZI') {
    const n = b.readInt32LE(o + 12);

    voxels = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = o + 16 + i * 4;

      voxels[i] = [b[p], b[p + 1], b[p + 2], b[p + 3]];
    }
  } else if (id === 'RGBA') {
    rgba = b.subarray(o + 12, o + 12 + 1024);
  }
  o += 12 + (id === 'MAIN' ? 0 : cs);
}

// −1 for out-of-bounds so neighbour probes at the grid faces never alias into a real cell.
const key = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -1 : (z * sy + y) * sx + x);
let colors = new Map(voxels.map(([x, y, z, c]) => [key(x, y, z), c]));

if (roundIters > 0) {
  // Min consecutive-solid run through a voxel along each axis — the local thickness of its limb.
  const axisRun = (x, y, z, dx, dy, dz) => {
    let run = 1;

    for (let s = 1; colors.has(key(x + dx * s, y + dy * s, z + dz * s)); s++) run++;
    for (let s = 1; colors.has(key(x - dx * s, y - dy * s, z - dz * s)); s++) run++;

    return run;
  };
  const frozen = new Set();

  for (const [x, y, z] of voxels) {
    const thickness = Math.min(axisRun(x, y, z, 1, 0, 0), axisRun(x, y, z, 0, 1, 0), axisRun(x, y, z, 0, 0, 1));

    if (thickness < 4) frozen.add(key(x, y, z));
  }

  const modalNeighbor = (x, y, z) => {
    const hist = new Map();

    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = colors.get(key(x + dx, y + dy, z + dz));

          if (c !== undefined) hist.set(c, (hist.get(c) ?? 0) + 1);
        }
    let best = 1;
    let bestN = -1;

    for (const [c, n] of hist)
      if (n > bestN) {
        bestN = n;
        best = c;
      }

    return best;
  };

  for (let iter = 0; iter < roundIters; iter++) {
    const next = new Map();
    const considered = new Set();

    for (const [k] of colors) {
      const x = k % sx;
      const y = Math.floor(k / sx) % sy;
      const z = Math.floor(k / (sx * sy));

      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny2 = y + dy;
            const nz = z + dz;

            if (nx < 0 || ny2 < 0 || nz < 0 || nx >= sx || ny2 >= sy || nz >= sz) continue;
            const nk = key(nx, ny2, nz);

            if (considered.has(nk)) continue;
            considered.add(nk);
            let solidCount = colors.has(nk) ? 1 : 0;

            for (let ddz = -1; ddz <= 1; ddz++)
              for (let ddy = -1; ddy <= 1; ddy++)
                for (let ddx = -1; ddx <= 1; ddx++) {
                  if (ddx === 0 && ddy === 0 && ddz === 0) continue;
                  if (colors.has(key(nx + ddx, ny2 + ddy, nz + ddz))) solidCount++;
                }
            const wasSolid = colors.has(nk);
            const nowSolid = frozen.has(nk) ? true : solidCount >= 14;

            if (nowSolid) next.set(nk, wasSolid ? colors.get(nk) : modalNeighbor(nx, ny2, nz));
          }
    }
    const before = colors.size;

    colors = next;
    console.log(`round ${iter + 1}: ${before} → ${colors.size} vox (${frozen.size} frozen)`);
  }
  voxels = [];
  for (const [k, c] of colors) {
    const x = k % sx;
    const y = Math.floor(k / sx) % sy;
    const z = Math.floor(k / (sx * sy));

    voxels.push([x, y, z, c]);
  }
}

if (surface) {
  // One conservative pass: fill deep pits, shave lone spikes. Rebuilds `voxels` before the colour passes.
  const FILL_AT = 20;
  const CLEAR_AT = 5;
  const occupiedNeighbors = (x, y, z) => {
    let count = 0;

    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (colors.has(key(x + dx, y + dy, z + dz))) count++;
        }

    return count;
  };
  const modalNeighborColor = (x, y, z) => {
    const hist = new Map();

    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = colors.get(key(x + dx, y + dy, z + dz));

          if (c !== undefined) hist.set(c, (hist.get(c) ?? 0) + 1);
        }
    let best = 1;
    let bestN = -1;

    for (const [c, n] of hist)
      if (n > bestN) {
        bestN = n;
        best = c;
      }

    return best;
  };
  const filled = [];
  const cleared = new Set();

  // Candidate pits = empty cells adjacent to a solid one (scan the solid set's neighbourhoods, dedup).
  const seen = new Set();

  for (const [x, y, z] of voxels) {
    if (occupiedNeighbors(x, y, z) <= CLEAR_AT) cleared.add(key(x, y, z));
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny2 = y + dy;
          const nz = z + dz;
          const k = key(nx, ny2, nz);

          if (nx < 0 || ny2 < 0 || nz < 0 || nx >= sx || ny2 >= sy || nz >= sz) continue;
          if (colors.has(k) || seen.has(k)) continue;
          seen.add(k);
          if (occupiedNeighbors(nx, ny2, nz) >= FILL_AT) filled.push([nx, ny2, nz]);
        }
  }
  for (const [x, y, z] of filled) colors.set(key(x, y, z), modalNeighborColor(x, y, z));
  for (const k of cleared) colors.delete(k);
  voxels = [];
  for (const [k, c] of colors) {
    const x = k % sx;
    const y = Math.floor(k / sx) % sy;
    const z = Math.floor(k / (sx * sy));

    voxels.push([x, y, z, c]);
  }
  console.log(`surface: +${filled.length} pits filled, −${cleared.size} spikes shaved`);
}

for (let pass = 0; pass < passes; pass++) {
  const next = new Map();

  for (const [x, y, z] of voxels) {
    const self = colors.get(key(x, y, z));
    const hist = new Map([[self, 2]]); // self ×2 — a lone dissenting voxel flips, a real edge holds

    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const c = colors.get(key(x + dx, y + dy, z + dz));

          if (c !== undefined) hist.set(c, (hist.get(c) ?? 0) + 1);
        }
    let best = self;
    let bestN = -1;

    for (const [c, n] of hist)
      if (n > bestN) {
        bestN = n;
        best = c;
      }
    next.set(key(x, y, z), best);
  }
  colors = next;
}

const out = voxels.map(([x, y, z]) => [x, y, z, colors.get(key(x, y, z))]);

// ---- Re-assemble ----
const u32 = (v) => {
  const buf = Buffer.alloc(4);

  buf.writeInt32LE(v, 0);

  return buf;
};
const tag = (s) => Buffer.from(s, 'ascii');
const chunk = (id, content, children = Buffer.alloc(0)) =>
  Buffer.concat([tag(id), u32(content.length), u32(children.length), content, children]);

const sizeChunk = chunk('SIZE', Buffer.concat([u32(sx), u32(sy), u32(sz)]));
const xyziBody = Buffer.alloc(4 + out.length * 4);

xyziBody.writeInt32LE(out.length, 0);
out.forEach(([x, y, z, c], i) => {
  const p = 4 + i * 4;

  xyziBody[p] = x;
  xyziBody[p + 1] = y;
  xyziBody[p + 2] = z;
  xyziBody[p + 3] = c;
});
const xyziChunk = chunk('XYZI', xyziBody);
const chunks = [sizeChunk, xyziChunk];

if (rgba !== null) chunks.push(chunk('RGBA', Buffer.from(rgba)));
const main = chunk('MAIN', Buffer.alloc(0), Buffer.concat(chunks));
const file = Buffer.concat([tag('VOX '), u32(150), main]);

writeFileSync(outPath, file);
console.log(`smoothed ${voxels.length} vox (${passes} pass${passes > 1 ? 'es' : ''}) → ${outPath}`);
