import type { Sprite } from './renderer';

// DOOM sprite-rotation: cell = f(rel), rel = bearing(thing→viewer) − facing, sectors CENTRED on their
// view direction. World angles CCW, 0 = +x; maps author y DOWN so a +90° offset is the thing's RIGHT.

export const PROP_ROTATIONS = 4;

const TWO_PI = 2 * Math.PI;

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
  // Half-sector shift centres each cell on its view direction; double modulo folds negatives (JS `%`
  // keeps the dividend's sign).
  const rel = (((bearing - facing + sector / 2) % TWO_PI) + TWO_PI) % TWO_PI;

  return Math.floor(rel / sector) % rotations;
}

// A view-independent sprite (no `rotations`) returns the SAME reference — no per-frame garbage.
export function orientSprite(sprite: Sprite, viewX: number, viewY: number): Sprite {
  if (sprite.rotations === undefined) {
    return sprite;
  }

  return {
    ...sprite,
    col: rotationCell(sprite.facing ?? 0, sprite.x, sprite.y, viewX, viewY, sprite.rotations),
  };
}
