import { describe, expect, it } from 'vitest';
import { downsampleVoxelGrid, trimVoxelGrid } from './vox-parse';

import { parseVox } from './vox-parse';
import { expandRgba, palettizeRgba } from './palettize';
import type { Texture } from './texture';

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);

  new DataView(b.buffer).setInt32(0, v, true);

  return b;
}

function tag(s: string): Uint8Array {
  return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;

  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }

  return out;
}

function chunk(
  id: string,
  content: Uint8Array,
  children: Uint8Array = new Uint8Array(0),
): Uint8Array {
  return concat(tag(id), u32(content.length), u32(children.length), content, children);
}

type Voxel = readonly [number, number, number, number];

function vox(opts: {
  dims: readonly [number, number, number];
  voxels: readonly Voxel[];
  palette?: Uint8Array;
  extra?: readonly Uint8Array[];
}): ArrayBuffer {
  const size = chunk('SIZE', concat(u32(opts.dims[0]), u32(opts.dims[1]), u32(opts.dims[2])));
  const xyzi = chunk(
    'XYZI',
    concat(u32(opts.voxels.length), ...opts.voxels.map((v) => new Uint8Array(v))),
  );
  const children = [size, xyzi];

  if (opts.palette !== undefined) {
    children.push(chunk('RGBA', opts.palette));
  }
  if (opts.extra !== undefined) {
    children.push(...opts.extra);
  }
  const main = chunk('MAIN', new Uint8Array(0), concat(...children));
  const file = concat(tag('VOX '), u32(150), main);

  return file.buffer as ArrayBuffer;
}

function paletteChunk(
  entries: Readonly<Record<number, readonly [number, number, number, number]>>,
): Uint8Array {
  const raw = new Uint8Array(1024);

  for (const [i, [r, g, b, a]] of Object.entries(entries)) {
    const off = Number(i) * 4;

    raw[off] = r;
    raw[off + 1] = g;
    raw[off + 2] = b;
    raw[off + 3] = a;
  }

  return raw;
}

// A voxel's RGBA resolved THROUGH the palette — the colour assertions stay byte-identical to the
// RGBA-era expectations.
function voxelAt(
  grid: Texture,
  gx: number,
  gy: number,
  gz: number,
): readonly [number, number, number, number] {
  const ny = grid.voxelDepth ?? 0;
  const p = grid.pixels[(gz * ny + gy) * grid.width + gx] * 4;

  return [grid.palette[p], grid.palette[p + 1], grid.palette[p + 2], grid.palette[p + 3]];
}

function solidCount(grid: Texture): number {
  let total = 0;

  for (const index of grid.pixels) {
    if (index !== 0) {
      total++;
    }
  }

  return total;
}

describe('parseVox', () => {
  it('decodes a single voxel into the carve grid encoding (dims, voxelDepth, bottom-up slices)', () => {
    const grid = parseVox(vox({ dims: [3, 4, 5], voxels: [[2, 1, 3, 1]] }));

    expect(grid).toMatchObject({ width: 3, height: 4 * 5, voxelDepth: 4 });
    expect(solidCount(grid)).toBe(1);
    expect(voxelAt(grid, 2, 1, 3)[3]).toBe(255);
    expect(voxelAt(grid, 0, 0, 0)[3]).toBe(0);
  });

  it('maps MV (x,y,z) → grid (x, y, z) with no transposition (distinct sizes prove the axes)', () => {
    const grid = parseVox(vox({ dims: [5, 3, 7], voxels: [[4, 2, 6, 1]] }));

    expect(grid).toMatchObject({ width: 5, voxelDepth: 3, height: 3 * 7 });
    expect(voxelAt(grid, 4, 2, 6)[3]).toBe(255);
    expect(voxelAt(grid, 3, 2, 6)[3]).toBe(0);
    expect(voxelAt(grid, 4, 1, 6)[3]).toBe(0);
    expect(voxelAt(grid, 4, 2, 5)[3]).toBe(0);
  });

  it('supports non-cubic models with many voxels', () => {
    const voxels: Voxel[] = [
      [0, 0, 0, 1],
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
    ];
    const grid = parseVox(vox({ dims: [2, 2, 2], voxels }));

    expect(solidCount(grid)).toBe(4);
    expect(voxelAt(grid, 1, 0, 0)[3]).toBe(255);
    expect(voxelAt(grid, 1, 1, 1)[3]).toBe(0);
  });

  it('uses the MagicaVoxel default palette when there is no RGBA chunk', () => {
    const grid = parseVox(
      vox({
        dims: [2, 1, 1],
        voxels: [
          [0, 0, 0, 1],
          [1, 0, 0, 255],
        ],
      }),
    );

    expect(voxelAt(grid, 0, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(voxelAt(grid, 1, 0, 0)).toEqual([17, 17, 17, 255]);
  });

  it('reads an RGBA chunk with the spec 1-based shift (stored entry i is colorIndex i+1)', () => {
    const palette = paletteChunk({ 0: [10, 20, 30, 255], 1: [40, 50, 60, 255] });
    const grid = parseVox(
      vox({
        dims: [2, 1, 1],
        voxels: [
          [0, 0, 0, 1],
          [1, 0, 0, 2],
        ],
        palette,
      }),
    );

    expect(voxelAt(grid, 0, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(voxelAt(grid, 1, 0, 0)).toEqual([40, 50, 60, 255]);
  });

  it("stores the file's own colour indices (1 byte per cell) over an index-aligned palette", () => {
    const palette = paletteChunk({ 0: [10, 20, 30, 255], 1: [40, 50, 60, 255] });
    const grid = parseVox(
      vox({
        dims: [3, 1, 1],
        voxels: [
          [0, 0, 0, 1],
          [2, 0, 0, 2],
        ],
        palette,
      }),
    );

    expect([...grid.pixels]).toEqual([1, 0, 2]); // no remap, no expansion — cell (1,0,0) stays empty
    expect([...grid.palette.slice(0, 4)]).toEqual([0, 0, 0, 0]); // index 0 IS the transparent slot
    expect([...grid.palette.slice(4, 12)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("forces a solid voxel's palette entry opaque even when the file's alpha is 0", () => {
    const palette = paletteChunk({ 0: [90, 90, 90, 0] });
    const grid = parseVox(vox({ dims: [1, 1, 1], voxels: [[0, 0, 0, 1]], palette }));

    expect(voxelAt(grid, 0, 0, 0)).toEqual([90, 90, 90, 255]);
  });

  it('skips unknown chunks (PACK / scene-graph / material) and keeps the first of each known chunk', () => {
    const dupSize = chunk('SIZE', concat(u32(9), u32(9), u32(9)));
    const dupXyzi = chunk('XYZI', concat(u32(1), new Uint8Array([5, 5, 5, 3])));
    const dupRgba = chunk('RGBA', paletteChunk({ 0: [1, 1, 1, 255] }));
    const material = chunk('MATL', new Uint8Array([1, 2, 3, 4, 5]));
    const grid = parseVox(
      vox({
        dims: [2, 1, 1],
        voxels: [[0, 0, 0, 1]],
        palette: paletteChunk({ 0: [77, 88, 99, 255] }),
        extra: [material, dupSize, dupXyzi, dupRgba],
      }),
    );

    expect(grid.width).toBe(2);
    expect(solidCount(grid)).toBe(1);
    expect(voxelAt(grid, 0, 0, 0)).toEqual([77, 88, 99, 255]);
  });

  it('accepts a Uint8Array as well as an ArrayBuffer', () => {
    const buf = vox({ dims: [1, 1, 1], voxels: [[0, 0, 0, 1]] });
    const grid = parseVox(new Uint8Array(buf));

    expect(solidCount(grid)).toBe(1);
  });

  it('is deterministic (same bytes → identical grid)', () => {
    const buf = vox({
      dims: [3, 3, 3],
      voxels: [
        [1, 1, 1, 4],
        [2, 0, 2, 7],
      ],
    });

    expect(parseVox(buf).pixels).toEqual(parseVox(buf).pixels);
  });

  it('throws on a too-short buffer', () => {
    expect(() => parseVox(new Uint8Array([1, 2, 3]))).toThrow(/not a MagicaVoxel/);
  });

  it("throws on a wrong magic (not 'VOX ')", () => {
    const bad = concat(tag('NOPE'), u32(150));

    expect(() => parseVox(bad)).toThrow(/not a MagicaVoxel/);
  });

  it("throws when the 'MAIN' chunk is missing", () => {
    const bad = concat(tag('VOX '), u32(150), tag('SIZE'), u32(0), u32(0));

    expect(() => parseVox(bad)).toThrow(/missing 'MAIN'/);
  });

  it("throws when 'SIZE' is missing", () => {
    const xyzi = chunk('XYZI', concat(u32(1), new Uint8Array([0, 0, 0, 1])));
    const main = chunk('MAIN', new Uint8Array(0), xyzi);
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/missing 'SIZE' or 'XYZI'/);
  });

  it("throws when 'XYZI' is missing", () => {
    const size = chunk('SIZE', concat(u32(2), u32(2), u32(2)));
    const main = chunk('MAIN', new Uint8Array(0), size);
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/missing 'SIZE' or 'XYZI'/);
  });

  it('throws on a degenerate model size (a zero dimension)', () => {
    expect(() => parseVox(vox({ dims: [0, 2, 2], voxels: [] }))).toThrow(/degenerate/);
  });

  it('throws on a voxel outside the model box', () => {
    expect(() => parseVox(vox({ dims: [2, 2, 2], voxels: [[2, 0, 0, 1]] }))).toThrow(/outside/);
    expect(() => parseVox(vox({ dims: [2, 2, 2], voxels: [[0, 2, 0, 1]] }))).toThrow(/outside/);
    expect(() => parseVox(vox({ dims: [2, 2, 2], voxels: [[0, 0, 2, 1]] }))).toThrow(/outside/);
  });

  it('throws on a truncated header (MAIN sizes cut off)', () => {
    const bad = concat(tag('VOX '), u32(150), tag('MAIN'));

    expect(() => parseVox(bad)).toThrow(/truncated/);
  });

  it('throws on a truncated chunk tag inside MAIN', () => {
    const bad = concat(tag('VOX '), u32(150));

    expect(() => parseVox(bad)).toThrow(/truncated/);
  });

  it('throws on a truncated XYZI chunk (count exceeds the bytes present)', () => {
    const xyzi = chunk('XYZI', concat(u32(100), new Uint8Array([0, 0, 0, 1])));
    const size = chunk('SIZE', concat(u32(2), u32(2), u32(2)));
    const main = chunk('MAIN', new Uint8Array(0), concat(size, xyzi));
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/truncated XYZI/);
  });

  it('throws on a truncated RGBA chunk (fewer than 1024 bytes present)', () => {
    const rgba = chunk('RGBA', new Uint8Array(16));
    const size = chunk('SIZE', concat(u32(1), u32(1), u32(1)));
    const xyzi = chunk('XYZI', concat(u32(1), new Uint8Array([0, 0, 0, 1])));
    const main = chunk('MAIN', new Uint8Array(0), concat(size, xyzi, rgba));
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/truncated RGBA/);
  });

  it('throws on a corrupt chunk with a negative size', () => {
    const badChild = concat(tag('SIZE'), u32(-1), u32(0));
    const main = chunk('MAIN', new Uint8Array(0), badChild);
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/negative size/);
  });
});

describe('trimVoxelGrid', () => {
  const grid = (n: number, ny: number, nz: number, solids: readonly [number, number, number][]) => {
    const rgba = new Uint8ClampedArray(n * ny * nz * 4);

    for (const [x, y, z] of solids) {
      const i = ((z * ny + y) * n + x) * 4;

      rgba[i] = 200;
      rgba[i + 3] = 255;
    }

    return palettizeRgba(n, ny * nz, rgba, { voxelDepth: ny });
  };

  it('crops empty border slices on all three axes — pure framing, no voxel touched', () => {
    // a single solid voxel at (2,1,3) inside an 8×4×6 box → trims to 1×1×1
    const trimmed = trimVoxelGrid(grid(8, 4, 6, [[2, 1, 3]]));

    expect(trimmed.width).toBe(1);
    expect(trimmed.voxelDepth).toBe(1);
    expect(trimmed.height).toBe(1);
    expect([...expandRgba(trimmed)]).toEqual([200, 0, 0, 255]); // the voxel survived, colour intact
  });

  it('keeps a tight grid byte-identical (nothing to trim)', () => {
    const tight = grid(2, 1, 2, [
      [0, 0, 0],
      [1, 0, 1],
    ]);
    const trimmed = trimVoxelGrid(tight);

    expect(trimmed.width).toBe(2);
    expect(trimmed.height).toBe(2);
    expect(trimmed.pixels).toEqual(tight.pixels);
  });

  it('spans the full occupied bbox (two far-apart voxels)', () => {
    const trimmed = trimVoxelGrid(
      grid(10, 5, 10, [
        [2, 1, 2],
        [7, 3, 8],
      ]),
    );

    expect(trimmed.width).toBe(6); // x 2..7
    expect(trimmed.voxelDepth).toBe(3); // y 1..3
    expect(trimmed.height / (trimmed.voxelDepth ?? 1)).toBe(7); // z 2..8
  });

  it('returns an all-empty grid unchanged (a degenerate crop would be zero-size)', () => {
    const empty = grid(4, 2, 4, []);

    expect(trimVoxelGrid(empty)).toBe(empty);
  });

  it('throws on a flat texture (no voxelDepth) — this is a voxel-grid tool', () => {
    expect(() => trimVoxelGrid(palettizeRgba(2, 2, new Uint8ClampedArray(16)))).toThrow(
      'not a voxel grid',
    );
  });
});

describe('downsampleVoxelGrid', () => {
  const grid = (
    n: number,
    ny: number,
    nz: number,
    solids: readonly [number, number, number, number][], // x,y,z,grey
  ) => {
    const rgba = new Uint8ClampedArray(n * ny * nz * 4);

    for (const [x, y, z, grey] of solids) {
      const i = ((z * ny + y) * n + x) * 4;

      rgba[i] = grey;
      rgba[i + 1] = grey;
      rgba[i + 2] = grey;
      rgba[i + 3] = 255;
    }

    return palettizeRgba(n, ny * nz, rgba, { voxelDepth: ny });
  };

  it('returns a grid already under budget UNTOUCHED (same object)', () => {
    const small = grid(4, 4, 4, [[1, 1, 1, 100]]);

    expect(downsampleVoxelGrid(small, 128)).toBe(small);
  });

  it('halves an over-budget grid with a box filter (dims rounded up)', () => {
    const big = grid(6, 3, 5, [[0, 0, 0, 100]]);
    const out = downsampleVoxelGrid(big, 3);

    expect(out.width).toBe(3); // 6/2
    expect(out.voxelDepth).toBe(2); // ceil(3/2)
    expect(out.height / (out.voxelDepth ?? 1)).toBe(3); // ceil(5/2)
  });

  it('keeps a cell occupied if ANY source voxel in its block is (thin parts survive)', () => {
    // one lone voxel at a block corner — a 2×2×2 block averages 1/8 occupancy, yet must stay solid
    const big = grid(4, 4, 4, [[3, 3, 3, 200]]);
    const out = downsampleVoxelGrid(big, 2);
    const rgba = expandRgba(out);
    const n = out.width;
    const ny = out.voxelDepth ?? 1;
    const i = ((1 * ny + 1) * n + 1) * 4; // block (1,1,1)

    expect(rgba[i + 3]).toBe(255);
    expect(rgba[i]).toBe(200);
  });

  it('colours a block by the MAJORITY colour of its occupied voxels', () => {
    // block (0,0,0) of a 2× downsample: three voxels grey 50, one grey 200 → 50 wins
    const big = grid(2, 2, 2, [
      [0, 0, 0, 50],
      [1, 0, 0, 50],
      [0, 1, 0, 50],
      [1, 1, 1, 200],
    ]);
    const out = downsampleVoxelGrid(big, 1);
    const rgba = expandRgba(out);

    expect(out.width).toBe(1);
    expect(rgba[0]).toBe(50);
    expect(rgba[3]).toBe(255);
  });

  it('clips edge blocks on a width not divisible by the factor (no read past the row)', () => {
    // width 5, k=2 → 3 blocks; the last block's second column (gx=5) is past the edge and must be skipped
    const odd = grid(5, 2, 2, [[4, 0, 0, 120]]);
    const out = downsampleVoxelGrid(odd, 3);
    const rgba = expandRgba(out);

    expect(out.width).toBe(3);
    expect(rgba[(0 * 3 + 2) * 4]).toBe(120); // the lone edge voxel lands in block x=2
    expect(rgba[(0 * 3 + 2) * 4 + 3]).toBe(255);
  });

  it('throws on a flat texture (no voxelDepth)', () => {
    expect(() => downsampleVoxelGrid(palettizeRgba(2, 2, new Uint8ClampedArray(16)), 128)).toThrow(
      'not a voxel grid',
    );
  });
});
