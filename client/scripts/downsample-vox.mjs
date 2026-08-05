// Downsamples a MagicaVoxel `.vox` to a lower cubic resolution (box filter): each output cell samples the
// input region it covers — occupied if ANY input voxel is (preserves thin parts like chair arms), coloured
// by the majority palette index in that region. Lets a heavy high-res model (perf-costly in quantity) drop
// to a lighter grid while staying far smoother than a natively low-res one.
//
// Run:  node client/scripts/downsample-vox.mjs <in.vox> <outRes> [out.vox]

import { readFileSync, writeFileSync } from 'node:fs';

const inPath = process.argv[2];
const outRes = Number(process.argv[3]);
const outPath = process.argv[4] ?? inPath;

if (!inPath || !Number.isInteger(outRes) || outRes <= 0) {
  console.error('usage: downsample-vox.mjs <in.vox> <outRes> [out.vox]');
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

const maxIn = Math.max(sx, sy, sz);
const scale = maxIn / outRes; // input cells per output cell (keeps aspect; smaller axes get fewer cells)
const oX = Math.max(1, Math.round(sx / scale));
const oY = Math.max(1, Math.round(sy / scale));
const oZ = Math.max(1, Math.round(sz / scale));

// For each output cell, collect the palette indices of the input voxels that fall in it.
const buckets = new Map(); // key = ox,oy,oz → Map(colorIndex → count)

for (const [x, y, z, c] of voxels) {
  const ox = Math.min(oX - 1, Math.floor(x / scale));
  const oy = Math.min(oY - 1, Math.floor(y / scale));
  const oz = Math.min(oZ - 1, Math.floor(z / scale));
  const key = (oz * oY + oy) * oX + ox;
  let hist = buckets.get(key);

  if (hist === undefined) {
    hist = new Map();
    buckets.set(key, hist);
  }
  hist.set(c, (hist.get(c) ?? 0) + 1);
}

const out = [];

for (const [key, hist] of buckets) {
  const ox = key % oX;
  const oy = Math.floor(key / oX) % oY;
  const oz = Math.floor(key / (oX * oY));
  let best = 0;
  let bestN = -1;

  for (const [c, n] of hist)
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  out.push([ox, oy, oz, best]);
}

// ---- Re-assemble ----
const u32 = (v) => {
  const buf = Buffer.alloc(4);

  buf.writeInt32LE(v, 0);

  return buf;
};
const tag = (s) => Buffer.from(s, 'ascii');
const chunk = (id, content, children = Buffer.alloc(0)) =>
  Buffer.concat([tag(id), u32(content.length), u32(children.length), content, children]);

const sizeChunk = chunk('SIZE', Buffer.concat([u32(oX), u32(oY), u32(oZ)]));
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
console.log(
  `downsampled ${sx}×${sy}×${sz} (${voxels.length} vox) → ${oX}×${oY}×${oZ} (${out.length} vox) → ${outPath}`,
);
