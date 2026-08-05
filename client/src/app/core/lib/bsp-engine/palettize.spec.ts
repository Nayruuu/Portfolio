import { describe, expect, it } from 'vitest';
import { expandRgba, palettizeRgba, PALETTE_BYTES } from './palettize';

// 2×2 exact fixture: red, green, TRANSPARENT-with-junk-RGB, red again.
function exactFixture(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    200,
    10,
    30,
    255, //
    12,
    180,
    40,
    255, //
    99,
    99,
    99,
    0, // junk RGB under alpha 0 — must still collapse to index 0
    200,
    10,
    30,
    255,
  ]);
}

// side×side ramp where EVERY pixel is a distinct colour (forces the median-cut path for side ≥ 16).
function rampFixture(side: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(side * side * 4);

  for (let i = 0; i < side * side; i++) {
    rgba[i * 4] = i & 0xff;
    rgba[i * 4 + 1] = (i * 3) & 0xff;
    rgba[i * 4 + 2] = (i * 7) & 0xff;
    rgba[i * 4 + 3] = 255;
  }

  return rgba;
}

describe('palettizeRgba — exact path (≤255 opaque colours)', () => {
  it('maps colours to first-appearance slots and alpha-0 to index 0, palette content-exact', () => {
    const tex = palettizeRgba(2, 2, exactFixture());

    expect([...tex.pixels]).toEqual([1, 2, 0, 1]);
    expect([...tex.palette.slice(0, 4)]).toEqual([0, 0, 0, 0]); // slot 0 = transparent, always
    expect([...tex.palette.slice(4, 8)]).toEqual([200, 10, 30, 255]);
    expect([...tex.palette.slice(8, 12)]).toEqual([12, 180, 40, 255]);
    expect(tex.palette.length).toBe(PALETTE_BYTES);
    expect(tex.pixels.length).toBe(4); // 1 byte per texel
  });

  it('keeps same-RGB different-alpha as DISTINCT entries (glass glints)', () => {
    const rgba = new Uint8ClampedArray([214, 228, 242, 255, 214, 228, 242, 150]);
    const tex = palettizeRgba(2, 1, rgba);

    expect([...tex.pixels]).toEqual([1, 2]);
    expect(tex.palette[4 + 3]).toBe(255);
    expect(tex.palette[8 + 3]).toBe(150);
  });

  it('a fully transparent image is all index 0 over an all-zero palette', () => {
    const tex = palettizeRgba(2, 1, new Uint8ClampedArray(8));

    expect([...tex.pixels]).toEqual([0, 0]);
    expect(tex.palette.every((byte) => byte === 0)).toBe(true);
  });

  it('threads worldSize / voxelDepth through untouched', () => {
    const tex = palettizeRgba(2, 2, exactFixture(), { worldSize: 4, voxelDepth: 2 });

    expect(tex.worldSize).toBe(4);
    expect(tex.voxelDepth).toBe(2);
  });

  it('throws when the buffer does not match the dimensions', () => {
    expect(() => palettizeRgba(2, 2, new Uint8ClampedArray(12))).toThrow(/does not match/);
  });

  it('expandRgba round-trips the exact path byte-identically', () => {
    const rgba = exactFixture();

    rgba[8] = 0; // zero the junk RGB under alpha 0 — expansion reads slot 0 as (0,0,0,0)
    rgba[9] = 0;
    rgba[10] = 0;
    expect([...expandRgba(palettizeRgba(2, 2, rgba))]).toEqual([...rgba]);
  });
});

describe('palettizeRgba — median-cut path (>255 opaque colours)', () => {
  it('quantizes a 4096-colour ramp within a tight mean error, no opaque pixel on index 0', () => {
    const side = 64;
    const rgba = rampFixture(side);
    const tex = palettizeRgba(side, side, rgba);
    const back = expandRgba(tex);
    let error = 0;

    for (let i = 0; i < side * side; i++) {
      expect(tex.pixels[i]).toBeGreaterThan(0); // transparency must never be invented
      expect(back[i * 4 + 3]).toBe(255);
      for (let c = 0; c < 3; c++) {
        error += Math.abs(back[i * 4 + c] - rgba[i * 4 + c]);
      }
    }

    expect(error / (side * side * 3)).toBeLessThan(12); // mean |Δ| per channel, 255 slots on 4096 colours
  });

  it('is deterministic — the same input yields identical pixels and palette', () => {
    const side = 32;
    const a = palettizeRgba(side, side, rampFixture(side));
    const b = palettizeRgba(side, side, rampFixture(side));

    expect([...a.pixels]).toEqual([...b.pixels]);
    expect([...a.palette]).toEqual([...b.palette]);
  });

  it('keeps a DOMINANT colour byte-exact when it outweighs half its cut (low end)', () => {
    // 257 uniques: black dominates 500 texels and sorts FIRST on the widest channel — the median
    // cut lands on it alone, so its palette entry averages nothing and stays exact.
    const rgba = new Uint8ClampedArray(757 * 4);

    for (let i = 0; i < 500; i++) {
      rgba[i * 4 + 3] = 255; // (0,0,0,255)
    }
    for (let i = 0; i < 256; i++) {
      const o = (500 + i) * 4;

      rgba[o] = i;
      rgba[o + 1] = 40;
      rgba[o + 2] = 90;
      rgba[o + 3] = 255;
    }
    rgba[756 * 4] = 200;
    rgba[756 * 4 + 1] = 255;
    rgba[756 * 4 + 2] = 90;
    rgba[756 * 4 + 3] = 255;
    const back = expandRgba(palettizeRgba(757, 1, rgba));

    expect([...back.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it('keeps a DOMINANT colour byte-exact when it sorts LAST on the cut channel (high end)', () => {
    const rgba = new Uint8ClampedArray(757 * 4);

    for (let i = 0; i < 500; i++) {
      const o = i * 4;

      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = 255;
    }
    for (let i = 0; i < 256; i++) {
      const o = (500 + i) * 4;

      rgba[o] = i;
      rgba[o + 1] = 40;
      rgba[o + 2] = 90;
      rgba[o + 3] = 255;
    }
    rgba[756 * 4] = 10;
    rgba[756 * 4 + 1] = 0;
    rgba[756 * 4 + 2] = 200;
    rgba[756 * 4 + 3] = 255;
    const back = expandRgba(palettizeRgba(757, 1, rgba));

    expect([...back.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('never merges colours ACROSS the glass alpha threshold (128) — stamped stays stamped, clear stays clear', () => {
    // >255 uniques with alphas straddling 128: blendGlass stamps ≥128 and tints below, so a texel
    // changing CLASS under quantization is a ghost mullion (writes the z-buffer) or a vanished glint.
    const side = 32;
    const rgba = rampFixture(side);

    for (let i = 0; i < side * side; i++) {
      rgba[i * 4 + 3] = 100 + (i % 61); // a CONTINUOUS 100..160 spread — boxes straddle the boundary
    }
    const back = expandRgba(palettizeRgba(side, side, rgba));

    for (let i = 0; i < side * side; i++) {
      expect(back[i * 4 + 3] >= 128).toBe(rgba[i * 4 + 3] >= 128);
    }
  });

  it('preserves alpha-0 → index 0 across quantization', () => {
    const side = 32;
    const rgba = rampFixture(side);

    rgba[3] = 0; // first texel goes transparent
    const tex = palettizeRgba(side, side, rgba);

    expect(tex.pixels[0]).toBe(0);
    expect([...tex.palette.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  });
});
