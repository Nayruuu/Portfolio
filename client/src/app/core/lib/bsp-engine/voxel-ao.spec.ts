import { describe, expect, it } from 'vitest';

import type { Texture } from './texture';
import { bakeVoxelAo, DEFAULT_AO } from './voxel-ao';

/** Build a voxel-grid Texture (the `((gz·ny+gy)·n+gx)·4` encoding): every cell `solid()` reports true is
 *  painted `[r,g,b,255]`, the rest are left transparent (alpha 0). */
function makeGrid(
  n: number,
  ny: number,
  nz: number,
  solid: (gx: number, gy: number, gz: number) => boolean,
  color: readonly [number, number, number] = [200, 200, 200],
): Texture {
  const pixels = new Uint8ClampedArray(n * ny * nz * 4);

  for (let gz = 0; gz < nz; gz++) {
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < n; gx++) {
        if (solid(gx, gy, gz)) {
          const out = ((gz * ny + gy) * n + gx) * 4;

          pixels[out] = color[0];
          pixels[out + 1] = color[1];
          pixels[out + 2] = color[2];
          pixels[out + 3] = 255;
        }
      }
    }
  }

  return { width: n, height: ny * nz, pixels, voxelDepth: ny };
}

/** RGB triple of voxel (gx, gy, gz). */
function rgbAt(grid: Texture, n: number, ny: number, gx: number, gy: number, gz: number): number[] {
  const out = ((gz * ny + gy) * n + gx) * 4;

  return [grid.pixels[out], grid.pixels[out + 1], grid.pixels[out + 2], grid.pixels[out + 3]];
}

describe('bakeVoxelAo', () => {
  it('throws when the texture is not a voxel grid (no voxelDepth)', () => {
    const flat: Texture = { width: 2, height: 2, pixels: new Uint8ClampedArray(2 * 2 * 4) };

    expect(() => bakeVoxelAo(flat)).toThrow(/not a voxel grid/);
  });

  it('throws when the height is not a whole number of depth slices', () => {
    const bad: Texture = {
      width: 2,
      height: 5,
      pixels: new Uint8ClampedArray(2 * 5 * 4),
      voxelDepth: 2,
    };

    expect(() => bakeVoxelAo(bad)).toThrow(/whole number of depth slices/);
  });

  it('leaves flat-face surface voxels at full brightness (baseline = 17 neighbours)', () => {
    // A 2-thick slab: the centre voxel of the top face has 9 (below) + 8 (same layer) = 17 neighbours.
    const grid = makeGrid(5, 5, 4, (_gx, _gy, gz) => gz < 2);
    const baked = bakeVoxelAo(grid);

    expect(rgbAt(baked, 5, 5, 2, 2, 1)).toEqual([200, 200, 200, 255]);
  });

  it('darkens a concave voxel proportional to its excess neighbours (no clamp)', () => {
    // All-solid 3×3×3: the centre has all 26 neighbours → excess 9 → full occlusion.
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid, { strength: 0.2, aoMin: 0.1 });

    // factor = 1 − 0.2·(9/9) = 0.8 → 200·0.8 = 160.
    expect(rgbAt(baked, 3, 3, 1, 1, 1)).toEqual([160, 160, 160, 255]);
  });

  it('clamps the darkest crease at aoMin', () => {
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid, { strength: 0.95, aoMin: 0.5 });

    // factor = max(0.5, 1 − 0.95) = 0.5 → 200·0.5 = 100.
    expect(rgbAt(baked, 3, 3, 1, 1, 1)).toEqual([100, 100, 100, 255]);
  });

  it('leaves convex edges/corners untouched by default (edge = 0)', () => {
    // A corner voxel of the all-solid cube has 7 neighbours → excess −10 → no darkening, no lift.
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid);

    expect(rgbAt(baked, 3, 3, 0, 0, 0)).toEqual([200, 200, 200, 255]);
  });

  it('lifts convex voxels when edge > 0', () => {
    const grid = makeGrid(3, 3, 3, () => true, [100, 100, 100]);
    const baked = bakeVoxelAo(grid, { edge: 0.34 });

    // corner count 7 → excess −10 → factor = 1 + 0.34·(10/17) = 1.2 → 100·1.2 = 120.
    expect(rgbAt(baked, 3, 3, 0, 0, 0)).toEqual([120, 120, 120, 255]);
  });

  it('keeps empty cells empty and never mutates the input', () => {
    const grid = makeGrid(3, 3, 3, (_gx, _gy, gz) => gz === 0);
    const before = Uint8ClampedArray.from(grid.pixels);
    const baked = bakeVoxelAo(grid);

    expect(baked.pixels).not.toBe(grid.pixels); // a fresh buffer
    expect(grid.pixels).toEqual(before); // input untouched
    expect(rgbAt(baked, 3, 3, 1, 1, 2)).toEqual([0, 0, 0, 0]); // an empty cell stays empty
  });

  it('preserves the grid dimensions and metadata', () => {
    const grid: Texture = { ...makeGrid(4, 3, 2, () => true), worldSize: 4 };
    const baked = bakeVoxelAo(grid);

    expect(baked.width).toBe(4);
    expect(baked.height).toBe(6);
    expect(baked.voxelDepth).toBe(3);
    expect(baked.worldSize).toBe(4);
  });

  it('is deterministic (same grid → identical bytes)', () => {
    const grid = makeGrid(4, 4, 4, (gx, gy, gz) => gx + gy + gz > 2);

    expect(bakeVoxelAo(grid).pixels).toEqual(bakeVoxelAo(grid).pixels);
  });

  it('honours an explicit radius (wider neighbourhood, larger flat baseline)', () => {
    // 5×5×5 all-solid, radius 2: the centre sees all 124 neighbours; the flat baseline is
    // 2·25 + 24 = 74, so excess = 50 = range (124 − 74) → full occlusion.
    const grid = makeGrid(5, 5, 5, () => true);
    const baked = bakeVoxelAo(grid, { radius: 2, strength: 0.5, aoMin: 0.1 });

    // factor = max(0.1, 1 − 0.5·(50/50)) = 0.5 → 200·0.5 = 100.
    expect(rgbAt(baked, 5, 5, 2, 2, 2)).toEqual([100, 100, 100, 255]);
  });

  it('exposes its shipped calibration', () => {
    expect(DEFAULT_AO).toEqual({ strength: 1.6, aoMin: 0.45, edge: 0 });
  });
});
