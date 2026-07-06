import type { Sprite } from './renderer';

/**
 * DOOM-style directional billboard rotations. An ORIENTED decor prop (a whiteboard, a chair, a
 * monitor) is authored with a facing and drawn from a 1×4 rotation sheet — front · right · back ·
 * left — whose column is picked from the VIEW angle: the angle between the thing's facing and the
 * thing→viewer bearing. Walk around the prop and the sheet cycles, so a flat billboard reads as a
 * true 3D object (DOOM's sprite-rotation mechanism, reduced from 8 rotations to 4).
 *
 * Convention (world angles CCW in map coordinates, 0 = +x; the maps author y DOWN, which makes a
 * +90° offset the thing's RIGHT-hand side): let `rel = bearing(thing→viewer) − facing`. The four
 * quadrants are centred on the axes, boundaries at the ±45° diagonals (half-open toward +rel):
 *
 *   rel ∈ [−45°,  45°)  → column 0 FRONT (the viewer faces the prop's front)
 *   rel ∈ [ 45°, 135°)  → column 1 RIGHT (the viewer stands on the prop's right-hand side)
 *   rel ∈ [135°, 225°)  → column 2 BACK
 *   rel ∈ [225°, 315°)  → column 3 LEFT
 */

/** How many view-angle cells a directional prop's rotation sheet carries (its atlas `cols`). */
export const PROP_ROTATIONS = 4;

const TWO_PI = 2 * Math.PI;
const QUADRANT = Math.PI / 2;

/**
 * The rotation-sheet column (0 front · 1 right · 2 back · 3 left) of a billboard FACING `facing`
 * (radians, 0 = +x — a {@link Thing.angle}) seen from the world point (`viewX`,`viewY`). Pure —
 * quadrant boundaries as documented above; any angle wraps (negative facings, facings beyond 2π,
 * bearings across the ±π atan2 cut). A viewer exactly ON the thing reads as front (atan2(0,0) = 0).
 */
export function rotationCell(
  facing: number,
  x: number,
  y: number,
  viewX: number,
  viewY: number,
): number {
  const bearing = Math.atan2(viewY - y, viewX - x);
  // Shift by half a quadrant so each cell is CENTRED on its axis, then wrap into [0, 2π). The double
  // modulo folds negative relative angles (JS `%` keeps the dividend's sign).
  const rel = (((bearing - facing + QUADRANT / 2) % TWO_PI) + TWO_PI) % TWO_PI;

  return Math.floor(rel / QUADRANT) % PROP_ROTATIONS;
}

/**
 * Re-pick a sprite's rotation cell for the current viewpoint: a directional BILLBOARD sprite (one
 * carrying `rotations` + `facing`) returns a copy with `col` set from {@link rotationCell}; a
 * view-independent sprite — no `rotations`, or a `block` prop whose cells are bound to its world
 * faces at projection time (see `sprite-block.ts`) — returns UNCHANGED (same reference — no per-frame
 * garbage for the common case). Pure — called where a frame's sprite list is assembled, so the CPU
 * painter and the GPU command builder consume the exact same cell through `projectSprites`.
 */
export function orientSprite(sprite: Sprite, viewX: number, viewY: number): Sprite {
  if (sprite.rotations === undefined || sprite.block === true) {
    return sprite;
  }

  return { ...sprite, col: rotationCell(sprite.facing ?? 0, sprite.x, sprite.y, viewX, viewY) };
}
