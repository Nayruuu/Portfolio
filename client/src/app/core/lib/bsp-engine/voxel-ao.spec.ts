import { describe, expect, it } from 'vitest';

import { expandRgba, palettizeRgba } from './palettize';
import type { Texture } from './texture';
import { bakeVoxelAo, DEFAULT_AO } from './voxel-ao';

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

  return palettizeRgba(n, ny * nz, pixels, { voxelDepth: ny });
}

function rgbAt(grid: Texture, n: number, ny: number, gx: number, gy: number, gz: number): number[] {
  const rgba = expandRgba(grid);
  const out = ((gz * ny + gy) * n + gx) * 4;

  return [rgba[out], rgba[out + 1], rgba[out + 2], rgba[out + 3]];
}

describe('bakeVoxelAo', () => {
  it('throws when the texture is not a voxel grid (no voxelDepth)', () => {
    const flat: Texture = palettizeRgba(2, 2, new Uint8ClampedArray(2 * 2 * 4));

    expect(() => bakeVoxelAo(flat)).toThrow(/not a voxel grid/);
  });

  it('throws when the height is not a whole number of depth slices', () => {
    const bad: Texture = palettizeRgba(2, 5, new Uint8ClampedArray(2 * 5 * 4), { voxelDepth: 2 });

    expect(() => bakeVoxelAo(bad)).toThrow(/whole number of depth slices/);
  });

  it('leaves flat-face surface voxels at full brightness (baseline = 17 neighbours)', () => {
    const grid = makeGrid(5, 5, 4, (_gx, _gy, gz) => gz < 2);
    const baked = bakeVoxelAo(grid);

    expect(rgbAt(baked, 5, 5, 2, 2, 1)).toEqual([200, 200, 200, 255]);
  });

  it('darkens a concave voxel proportional to its excess neighbours (no clamp)', () => {
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid, { strength: 0.2, aoMin: 0.1 });

    expect(rgbAt(baked, 3, 3, 1, 1, 1)).toEqual([160, 160, 160, 255]);
  });

  it('clamps the darkest crease at aoMin', () => {
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid, { strength: 0.95, aoMin: 0.5 });

    expect(rgbAt(baked, 3, 3, 1, 1, 1)).toEqual([100, 100, 100, 255]);
  });

  it('leaves convex edges/corners untouched by default (edge = 0)', () => {
    const grid = makeGrid(3, 3, 3, () => true);
    const baked = bakeVoxelAo(grid);

    expect(rgbAt(baked, 3, 3, 0, 0, 0)).toEqual([200, 200, 200, 255]);
  });

  it('lifts convex voxels when edge > 0', () => {
    const grid = makeGrid(3, 3, 3, () => true, [100, 100, 100]);
    const baked = bakeVoxelAo(grid, { edge: 0.34 });

    expect(rgbAt(baked, 3, 3, 0, 0, 0)).toEqual([120, 120, 120, 255]);
  });

  it('keeps empty cells empty and never mutates the input', () => {
    const grid = makeGrid(3, 3, 3, (_gx, _gy, gz) => gz === 0);
    const before = Uint8ClampedArray.from(grid.pixels);
    const baked = bakeVoxelAo(grid);

    expect(baked.pixels).not.toBe(grid.pixels);
    expect(grid.pixels).toEqual(before);
    expect(rgbAt(baked, 3, 3, 1, 1, 2)).toEqual([0, 0, 0, 0]);
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
    const grid = makeGrid(5, 5, 5, () => true);
    const baked = bakeVoxelAo(grid, { radius: 2, strength: 0.5, aoMin: 0.1 });

    expect(rgbAt(baked, 5, 5, 2, 2, 2)).toEqual([100, 100, 100, 255]);
  });

  it('exposes its shipped calibration', () => {
    expect(DEFAULT_AO).toEqual({ strength: 1.6, aoMin: 0.45, edge: 0 });
  });
});
