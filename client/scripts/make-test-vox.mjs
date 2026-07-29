// Writes a small, deliberately ORIENTED MagicaVoxel `.vox` fixture used to prove the `.vox` importer
// (core/lib/bsp-engine/vox-parse.ts) renders in-game standing, right-side-up, and non-mirrored.
//
// The model is a chunky office chair authored in MagicaVoxel coordinates (X = lateral, Y = depth with
// Y=0 the FRONT face the player meets, Z = up with Z=0 the floor). It is deliberately self-documenting
// so a single glance in-game reveals every axis:
//   - 4 dark-grey legs at the bottom + a YELLOW cap on top  → proves UP/DOWN (legs on the floor, cap up);
//   - the seat + backrest are RED on the model's LEFT half (low X) and GREEN on the RIGHT half (high X)
//     → proves LEFT/RIGHT: head-on, red must be on the viewer's LEFT — red on the right ⇒ X is mirrored;
//   - a BLUE badge on the FRONT face only (low Y) + the backrest at the BACK (high Y) → proves FRONT/BACK.
//
// Run:  node client/scripts/make-test-vox.mjs   → client/public/game/props/prop_test.vox
// It carries an RGBA palette chunk (exercises the importer's palette path with exact colours).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE_X = 12; // lateral
const SIZE_Y = 12; // depth (Y=0 = front)
const SIZE_Z = 16; // height (Z=0 = floor)

// Palette colour indices (1-based).
const LEG = 1;
const BADGE = 2;
const LEFT = 3;
const CAP = 4;
const RIGHT = 5;

/** Stored RGBA entry i (0-based) is the colour for voxel colorIndex i+1 (the MagicaVoxel spec shift). */
const COLORS = {
  [LEG]: [60, 62, 68, 255], // dark grey legs
  [BADGE]: [40, 90, 210, 255], // blue FRONT badge
  [LEFT]: [215, 45, 40, 255], // red = the model's LEFT half (low X)
  [CAP]: [235, 205, 55, 255], // yellow top cap
  [RIGHT]: [40, 190, 70, 255], // green = the model's RIGHT half (high X)
};

const voxels = []; // { x, y, z, c }
const add = (x, y, z, c) => voxels.push([x, y, z, c]);
const box = (x0, x1, y0, y1, z0, z1, c) => {
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        add(x, y, z, c);
      }
    }
  }
};

// 4 legs (z 0..3).
for (const [lx0, lx1] of [[2, 3], [8, 9]]) {
  for (const [ly0, ly1] of [[2, 3], [8, 9]]) {
    box(lx0, lx1, ly0, ly1, 0, 3, LEG);
  }
}
box(1, 5, 1, 10, 5, 6, LEFT); // seat — LEFT half red
box(6, 10, 1, 10, 5, 6, RIGHT); // seat — RIGHT half green
box(1, 5, 9, 10, 7, 14, LEFT); // backrest (at the BACK) — LEFT half red
box(6, 10, 9, 10, 7, 14, RIGHT); // backrest — RIGHT half green
box(4, 7, 1, 2, 7, 9, BADGE); // blue badge on the FRONT face only (low Y)
box(1, 10, 9, 10, 15, 15, CAP); // yellow cap on top of the backrest

// ---- Assemble the .vox binary (RIFF-like: 'VOX ' + version, then MAIN > SIZE, XYZI, RGBA) ----
const u32 = (v) => {
  const b = Buffer.alloc(4);

  b.writeInt32LE(v, 0);

  return b;
};
const tag = (s) => Buffer.from(s, 'ascii');
const chunk = (id, content, children = Buffer.alloc(0)) =>
  Buffer.concat([tag(id), u32(content.length), u32(children.length), content, children]);

const sizeChunk = chunk('SIZE', Buffer.concat([u32(SIZE_X), u32(SIZE_Y), u32(SIZE_Z)]));

const xyziBody = Buffer.alloc(4 + voxels.length * 4);

xyziBody.writeInt32LE(voxels.length, 0);
voxels.forEach(([x, y, z, c], i) => {
  const o = 4 + i * 4;

  xyziBody[o] = x;
  xyziBody[o + 1] = y;
  xyziBody[o + 2] = z;
  xyziBody[o + 3] = c;
});
const xyziChunk = chunk('XYZI', xyziBody);

const rgbaBody = Buffer.alloc(1024); // 256 entries; entry i is colour index i+1

for (const [index, [r, g, b, a]] of Object.entries(COLORS)) {
  const o = (Number(index) - 1) * 4; // colorIndex c ⇒ stored entry c-1

  rgbaBody[o] = r;
  rgbaBody[o + 1] = g;
  rgbaBody[o + 2] = b;
  rgbaBody[o + 3] = a;
}
const rgbaChunk = chunk('RGBA', rgbaBody);

const main = chunk('MAIN', Buffer.alloc(0), Buffer.concat([sizeChunk, xyziChunk, rgbaChunk]));
const file = Buffer.concat([tag('VOX '), u32(150), main]);

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'game',
  'props',
  'prop_test.vox',
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, file);

console.log(`wrote ${voxels.length} voxels → ${outPath} (${file.length} bytes)`);
