import { expandRgba, palettizeRgba } from './palettize';
import type { Texture } from './texture';

// Bakes a per-voxel contact-shadow term into a voxel grid's RGB — the same bytes both backends sample, so
// CPU and GPU stay pixel-identical for free. Signal: a surface voxel's occupied-neighbour count over a
// (2·radius+1)³ cube vs a flat face's baseline — concave darkens, flat unchanged, convex lifts when `edge`>0.
// Grid encoding (identical to voxel-carve / vox-parse): voxel (gx,gy,gz) at offset (gz·ny+gy)·n+gx.
// The bake multiplies CONTINUOUS factors into the colours, so it expands the palettized grid to RGBA,
// shades, then re-palettizes (quantized when the shaded colours outgrow 255 — occupancy stays exact).

// Auto radius = largest grid dimension over this (a few percent of the model, a consistent visual fraction).
const RADIUS_DIVISOR = 34;

// Cubic kernel is a one-shot load cost, but no point past a coarse blur.
const RADIUS_MAX = 6;

// Occupied-neighbour count of a FLAT-face voxel: the whole neighbourhood minus its open half-space — the
// baseline at/below which nothing darkens.
function flatFaceNeighbors(radius: number): number {
  const span = 2 * radius + 1;

  return radius * span * span + (span * span - 1);
}

function autoRadius(n: number, ny: number, nz: number): number {
  return Math.min(RADIUS_MAX, Math.max(1, Math.round(Math.max(n, ny, nz) / RADIUS_DIVISOR)));
}

export interface VoxelAoOptions {
  readonly radius?: number; // neighbourhood half-extent; larger = softer, wider shadows
  readonly strength?: number; // 1 drives a fully buried surface to (1 − strength) before the aoMin clamp
  readonly aoMin?: number; // floor so cavities read as shadow, not holes
  readonly edge?: number; // convex-edge LIFT (a sharp corner → ~1 + edge); 0 = pure occlusion
}

// Calibrated against the MagicaVoxel chair reference.
export const DEFAULT_AO = { strength: 1.6, aoMin: 0.45, edge: 0 } as const;

// Returns a NEW grid (input untouched); throws when `voxelDepth` is absent or height isn't whole slices.
export function bakeVoxelAo(grid: Texture, options: VoxelAoOptions = {}): Texture {
  const ny = grid.voxelDepth;

  if (ny === undefined) {
    throw new Error('bakeVoxelAo: not a voxel grid (no voxelDepth)');
  }
  const n = grid.width;
  const nz = grid.height / ny;

  if (!Number.isInteger(nz)) {
    throw new Error('bakeVoxelAo: grid height is not a whole number of depth slices');
  }
  const radius = options.radius ?? autoRadius(n, ny, nz);
  const strength = options.strength ?? DEFAULT_AO.strength;
  const aoMin = options.aoMin ?? DEFAULT_AO.aoMin;
  const edge = options.edge ?? DEFAULT_AO.edge;
  const baseline = flatFaceNeighbors(radius);
  const maxNeighbors = (2 * radius + 1) ** 3 - 1;
  const range = maxNeighbors - baseline; // > 0 for radius ≥ 1
  const source = expandRgba(grid); // the bake's RGBA working copy — the input is never mutated
  const pixels = new Uint8ClampedArray(source);
  // 0/1 occupancy plane (the scan SUMS it) — index 0 = empty, straight off the index plane.
  const occupied = new Uint8Array(n * ny * nz);

  for (let index = 0; index < occupied.length; index++) {
    occupied[index] = grid.pixels[index] !== 0 ? 1 : 0;
  }

  for (let gz = 0; gz < nz; gz++) {
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < n; gx++) {
        if (occupied[(gz * ny + gy) * n + gx] === 0) {
          continue;
        }
        let fullCount = 0;

        for (let dz = -radius; dz <= radius; dz++) {
          const oz = gz + dz;

          if (oz < 0 || oz >= nz) {
            continue;
          }
          for (let dy = -radius; dy <= radius; dy++) {
            const oy = gy + dy;

            if (oy < 0 || oy >= ny) {
              continue;
            }
            for (let dx = -radius; dx <= radius; dx++) {
              const ox = gx + dx;

              if ((dx === 0 && dy === 0 && dz === 0) || ox < 0 || ox >= n) {
                continue;
              }
              fullCount += occupied[(oz * ny + oy) * n + ox];
            }
          }
        }
        const excess = fullCount - baseline;
        // Concave (excess > 0) darkens; flat/convex (≤ 0) stays 1, or lifts when `edge` > 0.
        const factor =
          excess > 0
            ? Math.max(aoMin, 1 - strength * (excess / range))
            : Math.min(1 + edge, 1 - (edge * excess) / baseline);
        const out = ((gz * ny + gy) * n + gx) * 4;

        pixels[out] = source[out] * factor;
        pixels[out + 1] = source[out + 1] * factor;
        pixels[out + 2] = source[out + 2] * factor;
        // alpha (occupancy) rides the source clone verbatim — never rewritten here
      }
    }
  }

  return palettizeRgba(grid.width, grid.height, pixels, {
    worldSize: grid.worldSize,
    voxelDepth: ny,
  });
}
