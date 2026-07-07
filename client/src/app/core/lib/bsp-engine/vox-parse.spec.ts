import { describe, expect, it } from 'vitest';

import { parseVox } from './vox-parse';
import type { Texture } from './texture';

/** Little-endian int32 as 4 bytes. */
function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);

  new DataView(b.buffer).setInt32(0, v, true);

  return b;
}

/** A 4-char chunk tag as bytes. */
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

/** A chunk: `id · contentSize · childrenSize · content · children`. */
function chunk(
  id: string,
  content: Uint8Array,
  children: Uint8Array = new Uint8Array(0),
): Uint8Array {
  return concat(tag(id), u32(content.length), u32(children.length), content, children);
}

type Voxel = readonly [number, number, number, number]; // x, y, z, colorIndex

/** Assemble a `.vox` ArrayBuffer from dims + voxels (+ an optional RGBA palette chunk + extra chunks). */
function vox(opts: {
  dims: readonly [number, number, number];
  voxels: readonly Voxel[];
  palette?: Uint8Array; // 1024 bytes = the RGBA chunk content
  extra?: readonly Uint8Array[]; // pre-built child chunks appended after XYZI
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

/** A 1024-byte RGBA chunk from a sparse map of stored-entry index → [r,g,b,a] (rest black/opaque). */
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

/** Decode voxel (gx, gy, gz) — grid gz bottom-up, gy depth, gx lateral (the encoding contract). */
function voxelAt(
  grid: Texture,
  gx: number,
  gy: number,
  gz: number,
): readonly [number, number, number, number] {
  const ny = grid.voxelDepth ?? 0;
  const i = ((gz * ny + gy) * grid.width + gx) * 4;

  return [grid.pixels[i], grid.pixels[i + 1], grid.pixels[i + 2], grid.pixels[i + 3]];
}

function solidCount(grid: Texture): number {
  let total = 0;

  for (let i = 3; i < grid.pixels.length; i += 4) {
    if (grid.pixels[i] !== 0) {
      total++;
    }
  }

  return total;
}

describe('parseVox', () => {
  it('decodes a single voxel into the carve grid encoding (dims, voxelDepth, bottom-up slices)', () => {
    // n=3, ny=4, nz=5; one voxel at MV (2,1,3) → grid (gx=2, gy=1, gz=3).
    const grid = parseVox(vox({ dims: [3, 4, 5], voxels: [[2, 1, 3, 1]] }));

    expect(grid).toMatchObject({ width: 3, height: 4 * 5, voxelDepth: 4 });
    expect(solidCount(grid)).toBe(1);
    expect(voxelAt(grid, 2, 1, 3)[3]).toBe(255); // solid + opaque
    expect(voxelAt(grid, 0, 0, 0)[3]).toBe(0); // an untouched cell stays empty
  });

  it('maps MV (x,y,z) → grid (x, y, z) with no transposition (distinct sizes prove the axes)', () => {
    const grid = parseVox(vox({ dims: [5, 3, 7], voxels: [[4, 2, 6, 1]] }));

    expect(grid).toMatchObject({ width: 5, voxelDepth: 3, height: 3 * 7 });
    expect(voxelAt(grid, 4, 2, 6)[3]).toBe(255);
    // Neighbours along each axis are empty — proving the voxel sits at (x,y,z), not a swapped index.
    expect(voxelAt(grid, 3, 2, 6)[3]).toBe(0); // one less on x
    expect(voxelAt(grid, 4, 1, 6)[3]).toBe(0); // one less on y (depth)
    expect(voxelAt(grid, 4, 2, 5)[3]).toBe(0); // one less on z (height)
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
    // Default palette index 1 = 0xffffffff (white); index 255 = 0xff111111 (r=g=b=17).
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

    expect(voxelAt(grid, 0, 0, 0)).toEqual([10, 20, 30, 255]); // colorIndex 1 ← stored entry 0
    expect(voxelAt(grid, 1, 0, 0)).toEqual([40, 50, 60, 255]); // colorIndex 2 ← stored entry 1
  });

  it('forces a solid voxel opaque even when its palette alpha is 0 (alpha = occupancy)', () => {
    const palette = paletteChunk({ 0: [90, 90, 90, 0] });
    const grid = parseVox(vox({ dims: [1, 1, 1], voxels: [[0, 0, 0, 1]], palette }));

    expect(voxelAt(grid, 0, 0, 0)).toEqual([90, 90, 90, 255]);
  });

  it('skips unknown chunks (PACK / scene-graph / material) and keeps the first of each known chunk', () => {
    const dupSize = chunk('SIZE', concat(u32(9), u32(9), u32(9)));
    const dupXyzi = chunk('XYZI', concat(u32(1), new Uint8Array([5, 5, 5, 3])));
    const dupRgba = chunk('RGBA', paletteChunk({ 0: [1, 1, 1, 255] }));
    const material = chunk('MATL', new Uint8Array([1, 2, 3, 4, 5])); // unknown → skipped
    const grid = parseVox(
      vox({
        dims: [2, 1, 1],
        voxels: [[0, 0, 0, 1]],
        palette: paletteChunk({ 0: [77, 88, 99, 255] }),
        extra: [material, dupSize, dupXyzi, dupRgba],
      }),
    );

    expect(grid.width).toBe(2); // the FIRST SIZE (not the duplicate 9×9×9)
    expect(solidCount(grid)).toBe(1); // the FIRST XYZI (not the duplicate)
    expect(voxelAt(grid, 0, 0, 0)).toEqual([77, 88, 99, 255]); // the FIRST RGBA
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
    const bad = concat(tag('VOX '), u32(150), tag('MAIN')); // no content/children sizes

    expect(() => parseVox(bad)).toThrow(/truncated/);
  });

  it('throws on a truncated chunk tag inside MAIN', () => {
    const bad = concat(tag('VOX '), u32(150)); // MAIN tag itself is cut off

    expect(() => parseVox(bad)).toThrow(/truncated/);
  });

  it('throws on a truncated XYZI chunk (count exceeds the bytes present)', () => {
    // Claim 100 voxels but supply the payload for one.
    const xyzi = chunk('XYZI', concat(u32(100), new Uint8Array([0, 0, 0, 1])));
    const size = chunk('SIZE', concat(u32(2), u32(2), u32(2)));
    const main = chunk('MAIN', new Uint8Array(0), concat(size, xyzi));
    const bad = concat(tag('VOX '), u32(150), main);

    expect(() => parseVox(bad)).toThrow(/truncated XYZI/);
  });

  it('throws on a truncated RGBA chunk (fewer than 1024 bytes present)', () => {
    const rgba = chunk('RGBA', new Uint8Array(16)); // claims 16, needs 1024
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
