import type { Texture } from './texture';

/**
 * VOXEL AMBIENT OCCLUSION — bake a per-voxel contact-shadow term into a voxel grid's own COLOURS at
 * load, so the renderer's flat per-face shading ({@link VOXEL_SHADE}) gains the crease/cavity darkening
 * a MagicaVoxel render has and our props lacked (a chair read as one grey blob because nothing shadowed
 * the seat↔backrest junction, the under-seat, the gas cylinder, the star base). AO lives entirely in the
 * grid RGB — the exact same bytes both backends already sample — so CPU and GPU stay pixel-identical for
 * free (no shader change, no new channel).
 *
 * THE OCCLUSION SIGNAL is a voxel's occupancy over a `(2·radius + 1)³` neighbourhood (out of bounds =
 * empty). The renderer only ever paints SURFACE voxels (the DDA stops at the first solid it enters), and
 * a surface voxel's occupied-neighbour count reads its local concavity directly. Against the number a
 * voxel on a FLAT exposed face has ({@link flatFaceNeighbors} — the neighbourhood minus its open
 * half-space):
 *   - a CONCAVE crease/valley has MORE occupied neighbours — it darkens, proportional to how far past
 *     the flat baseline it runs, toward {@link VoxelAoOptions.aoMin};
 *   - a FLAT face sits exactly at the baseline — no change;
 *   - a CONVEX edge/corner has FEWER — left at full brightness, or lifted slightly when
 *     {@link VoxelAoOptions.edge} > 0 (an optional "sunlit corner" rim, off by default).
 * Because a solid box's surface is only flat faces + convex edges/corners (all ≤ baseline), a clean prop
 * like the totem is left essentially untouched; only props with real cavities (the chair) gain shadows.
 *
 * WHY A RADIUS (not just the 26 immediate neighbours): the shipped chair is a 128³ grid, so a 1-voxel
 * probe darkens only a ~1/128-wide sliver at each crease — invisible at play distance. A radius a few
 * percent of the model spreads the occlusion into a soft gradient that actually READS, exactly what a
 * MagicaVoxel render does. The default scales with the grid so a 64³ carve and a 128³ `.vox` occlude by
 * the same visual fraction.
 *
 * ENCODING (identical to `voxel-carve.ts` / `vox-parse.ts`): the grid rides an ordinary {@link Texture} —
 * `width` = `n` lateral cells, `voxelDepth` = `ny` depth rows, `height` = `ny · nz` bottom-up slices;
 * voxel (gx, gy, gz) is the RGBA at offset `((gz · ny + gy) · n + gx) · 4`, alpha 0 = empty / 255 = solid.
 * Pure + deterministic: returns a NEW grid (never mutates the input); empty cells stay empty.
 */

/** Above this alpha a grid cell is solid (the occupancy is binary 0/255 by contract; the threshold
 *  just states the intent and tolerates any future non-255 "filled" marker). */
const SOLID_ALPHA = 128;

/** The default AO radius is the largest grid dimension over this — a few percent of the model, so the
 *  occlusion spread is a consistent visual fraction whatever the grid resolution. */
const RADIUS_DIVISOR = 34;

/** Clamp on the auto radius: at least 1 (the immediate neighbours), at most this (the kernel is cubic —
 *  a big radius on a big grid is a one-shot load cost, but there's no point past a coarse blur). */
const RADIUS_MAX = 6;

/** Occupied-neighbour count of a voxel on a FLAT exposed face at `radius`: the whole neighbourhood
 *  (`(2r+1)³ − 1`) minus the open half-space it faces (`r` layers of `(2r+1)²`). Equivalently the `r`
 *  solid layers behind it plus its own in-plane ring — the baseline at/below which nothing darkens. */
function flatFaceNeighbors(radius: number): number {
  const span = 2 * radius + 1;

  return radius * span * span + (span * span - 1);
}

/** Auto AO radius for a grid of these dimensions (see {@link RADIUS_DIVISOR} / {@link RADIUS_MAX}). */
function autoRadius(n: number, ny: number, nz: number): number {
  return Math.min(RADIUS_MAX, Math.max(1, Math.round(Math.max(n, ny, nz) / RADIUS_DIVISOR)));
}

/** Tunables for {@link bakeVoxelAo} (all optional — the defaults are the shipped calibration). */
export interface VoxelAoOptions {
  /** Neighbourhood half-extent in cells (a `(2·radius+1)³` cube). Larger = softer, wider shadows that
   *  read from farther away. Default: {@link autoRadius} of the grid. */
  readonly radius?: number;
  /** How hard a fully occluded crease darkens: the darkening scales `strength · (occluded fraction past
   *  the flat baseline)`, so 1 drives a fully buried surface to `1 − strength` before the `aoMin` clamp.
   *  Default {@link DEFAULT_AO.strength}. */
  readonly strength?: number;
  /** Floor on the AO multiplier — the darkest a crease may get, so cavities read as shadow, not holes.
   *  Default {@link DEFAULT_AO.aoMin}. */
  readonly aoMin?: number;
  /** Optional convex-edge LIFT: a voxel with fewer than the flat-baseline neighbours is brightened by up
   *  to `edge` (a sharp corner approaches `1 + edge`) for a rim-lit look. 0 = pure occlusion (the
   *  default, keeping the multiplier in `[aoMin, 1]`). Default {@link DEFAULT_AO.edge}. */
  readonly edge?: number;
}

/** The shipped AO calibration (chosen against the MagicaVoxel chair reference): concave creases fall to
 *  the ~0.45 floor, flat faces stay 1.0, convex edges are left alone (no lift). */
export const DEFAULT_AO = { strength: 1.6, aoMin: 0.45, edge: 0 } as const;

/**
 * Bake per-voxel ambient occlusion into a voxel grid's colours (see the module doc). Reads `n`/`ny`/`nz`
 * from the {@link Texture}'s `width`/`voxelDepth`/`height`; throws when `voxelDepth` is absent (not a
 * voxel grid) or the height is not a whole number of slices. Returns a NEW grid with every SOLID voxel's
 * RGB scaled by its AO factor and the input left untouched; empty cells stay empty.
 */
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
  const range = maxNeighbors - baseline; // > 0 for radius ≥ 1 (a full cube outweighs a half one)
  const source = grid.pixels;
  const pixels = new Uint8ClampedArray(source); // a copy — the input is never mutated
  // Occupancy plane (1 = solid) so the neighbourhood scan avoids the ×4 alpha lookup per probe.
  const occupied = new Uint8Array(n * ny * nz);

  for (let index = 0; index < occupied.length; index++) {
    occupied[index] = source[index * 4 + 3] > SOLID_ALPHA ? 1 : 0;
  }

  for (let gz = 0; gz < nz; gz++) {
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < n; gx++) {
        if (occupied[(gz * ny + gy) * n + gx] === 0) {
          continue; // empty cells stay empty
        }
        let fullCount = 0;

        for (let dz = -radius; dz <= radius; dz++) {
          const oz = gz + dz;

          if (oz < 0 || oz >= nz) {
            continue; // that whole neighbour layer is out of bounds → empty
          }
          for (let dy = -radius; dy <= radius; dy++) {
            const oy = gy + dy;

            if (oy < 0 || oy >= ny) {
              continue;
            }
            for (let dx = -radius; dx <= radius; dx++) {
              const ox = gx + dx;

              if ((dx === 0 && dy === 0 && dz === 0) || ox < 0 || ox >= n) {
                continue; // skip self and out-of-bounds columns
              }
              fullCount += occupied[(oz * ny + oy) * n + ox];
            }
          }
        }
        const excess = fullCount - baseline;
        // Concave (excess > 0) darkens; flat/convex (excess ≤ 0) stays 1, or lifts when `edge` > 0.
        const factor =
          excess > 0
            ? Math.max(aoMin, 1 - strength * (excess / range))
            : Math.min(1 + edge, 1 - (edge * excess) / baseline);
        const out = ((gz * ny + gy) * n + gx) * 4;

        pixels[out] = source[out] * factor;
        pixels[out + 1] = source[out + 1] * factor;
        pixels[out + 2] = source[out + 2] * factor;
        // alpha (occupancy) is copied verbatim by the Uint8ClampedArray(source) clone above
      }
    }
  }

  return { ...grid, pixels };
}
