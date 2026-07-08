import type { RoomPoint } from '../../bsp-engine';

/** Pair a flat coordinate list into a polygon: `poly([x0,y0, x1,y1, …])`. */
export function poly(coords: readonly number[]): readonly RoomPoint[] {
  if (coords.length % 2 !== 0) {
    throw new Error('poly: odd coordinate count');
  }

  return Array.from({ length: coords.length / 2 }, (_, i) => [coords[2 * i], coords[2 * i + 1]]);
}

/** The 4-corner polygon of an axis-aligned rectangle, `(x1,y1)` = NW corner, `(x2,y2)` = SE. */
export const rect = (x1: number, y1: number, x2: number, y2: number): readonly RoomPoint[] =>
  poly([x1, y1, x1, y2, x2, y2, x2, y1]);
