import type { Sprite } from './renderer';

/**
 * DOOM-style directional billboard rotations. An ORIENTED decor prop (a whiteboard, a chair, a
 * monitor) is authored with a facing and drawn from a 1×N rotation sheet whose column is picked from
 * the VIEW angle: the angle between the thing's facing and the thing→viewer bearing. Walk around the
 * prop and the sheet cycles, so a flat billboard reads as a true 3D object (DOOM's sprite-rotation
 * mechanism — 8 rotations for its enemies; our props carry 4 or 8 per their def).
 *
 * Convention (world angles CCW in map coordinates, 0 = +x; the maps author y DOWN, which makes a
 * +90° offset the thing's RIGHT-hand side): let `rel = bearing(thing→viewer) − facing`. The N sectors
 * are CENTRED on their view directions (cell k covers rel ≈ k·360°/N, half-open toward +rel). At 4:
 *
 *   rel ∈ [−45°,  45°)  → column 0 FRONT (the viewer faces the prop's front)
 *   rel ∈ [ 45°, 135°)  → column 1 RIGHT (the viewer stands on the prop's right-hand side)
 *   rel ∈ [135°, 225°)  → column 2 BACK
 *   rel ∈ [225°, 315°)  → column 3 LEFT
 *
 * At 8 the same wheel inserts the diagonals: front · front-right · right · back-right · back ·
 * back-left · left · front-left, 45° per cell.
 */

/** The default view-angle cell count of a directional prop's rotation sheet (its atlas `cols`). */
export const PROP_ROTATIONS = 4;

const TWO_PI = 2 * Math.PI;

/**
 * The rotation-sheet column (cell k centred on rel = k·360°/`rotations`) of a billboard FACING
 * `facing` (radians, 0 = +x — a {@link Thing.angle}) seen from the world point (`viewX`,`viewY`).
 * Pure — sector boundaries as documented above; any angle wraps (negative facings, facings beyond 2π,
 * bearings across the ±π atan2 cut). A viewer exactly ON the thing reads as front (atan2(0,0) = 0).
 */
export function rotationCell(
  facing: number,
  x: number,
  y: number,
  viewX: number,
  viewY: number,
  rotations: number = PROP_ROTATIONS,
): number {
  const sector = TWO_PI / rotations;
  const bearing = Math.atan2(viewY - y, viewX - x);
  // Shift by half a sector so each cell is CENTRED on its view direction, then wrap into [0, 2π). The
  // double modulo folds negative relative angles (JS `%` keeps the dividend's sign).
  const rel = (((bearing - facing + sector / 2) % TWO_PI) + TWO_PI) % TWO_PI;

  return Math.floor(rel / sector) % rotations;
}

/**
 * Re-pick a sprite's rotation cell for the current viewpoint: a directional sprite (one carrying
 * `rotations` + `facing`) returns a copy with `col` set from {@link rotationCell}; a view-independent
 * sprite (no `rotations`) returns UNCHANGED (same reference — no per-frame garbage for the common
 * case). A `voxel` prop re-picks too: its volume path ignores `col`, but the cell is what its BILLBOARD
 * FALLBACK draws wherever the carved grid didn't decode. Pure — called where a frame's sprite list is
 * assembled, so the CPU painter and the GPU command builder consume the exact same cell through
 * `projectSprites`.
 */
export function orientSprite(sprite: Sprite, viewX: number, viewY: number): Sprite {
  if (sprite.rotations === undefined) {
    return sprite;
  }

  return {
    ...sprite,
    col: rotationCell(sprite.facing ?? 0, sprite.x, sprite.y, viewX, viewY, sprite.rotations),
  };
}
