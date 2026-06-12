import { WALL_HEIGHT } from './floor-cast';
import { isWall } from './game-map';
import type { GameMap } from './game-map';

/**
 * A volume of space at a given floor/ceiling height with its own materials — the first-class unit the
 * height-aware engine renders + collides against (sub-project A of the level-design overhaul). Today every
 * sector is FLAT (`floorZ` 0, `ceilZ` `WALL_HEIGHT`); variable heights arrive in sub-project A2, so the
 * model is introduced + populated here but not yet consumed by the renderer/physics.
 */
export interface Sector {
  floorZ: number; // floor altitude (world units; 0 = base level)
  ceilZ: number; // ceiling altitude (> floorZ for a standable space)
  floorMat: number; // floor material id (the floorFlats ids)
  ceilMat: number; // ceiling material id (the ceilFlats ids; 0 = open sky)
}

/** The base floor altitude every flat sector sits at. */
export const BASE_FLOOR_Z = 0;

/** Max rise (world units) a mover steps onto automatically — DOOM's 24/128 of a wall. A bigger rise blocks
 *  (sub-project A2c-2 makes the band above this up to a climb limit MANTLE-able). */
export const STEP_UP_MAX = 0.25 * WALL_HEIGHT; // 0.35

/** A mover needs this much head-to-floor clearance to enter a sector (else a low ceiling blocks). Below the
 *  flat WALL_HEIGHT (1.4), so a flat level never blocks on clearance. */
export const PLAYER_HEIGHT = 0.9;

/** Max rise (world units) a mantle can hoist over — beyond this a step is a true wall. ~1 wall-height. */
export const CLIMB_MAX = WALL_HEIGHT; // 1.4

/** Derive the sector table + per-cell `sectorId` from the per-cell floor/ceiling flats: one FLAT sector per
 *  distinct `(floorFlat, ceilFlat)` pair, every cell mapped to the sector matching its pair. Pure. */
export function sectorize(
  floorFlats: readonly number[],
  ceilFlats: readonly number[],
): { sectors: Sector[]; sectorId: number[] } {
  const sectors: Sector[] = [];
  const byPair = new Map<number, number>(); // pair key → sector index
  const sectorId: number[] = new Array(floorFlats.length);

  for (let i = 0; i < floorFlats.length; i++) {
    const floorMat = floorFlats[i];
    const ceilMat = ceilFlats[i];
    const key = floorMat * 1000 + ceilMat; // flats are small ids → collision-free packing
    let id = byPair.get(key);

    if (id === undefined) {
      id = sectors.length;
      sectors.push({ floorZ: BASE_FLOOR_Z, ceilZ: WALL_HEIGHT, floorMat, ceilMat });
      byPair.set(key, id);
    }
    sectorId[i] = id;
  }

  return { sectors, sectorId };
}

/** The sector under a world point (`x`, `y` in cells), or `undefined` if the map carries no sectors or the
 *  point is out of bounds. */
export function sectorAt(map: GameMap, x: number, y: number): Sector | undefined {
  if (!map.sectors || !map.sectorId) {
    return undefined;
  }
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);

  if (cellX < 0 || cellX >= map.width || cellY < 0 || cellY >= map.height) {
    return undefined;
  }

  return map.sectors[map.sectorId[cellY * map.width + cellX]];
}

/** The floor altitude under a world point — `BASE_FLOOR_Z` when no sector is defined (a flat map). */
export function floorZAt(map: GameMap, x: number, y: number): number {
  return sectorAt(map, x, y)?.floorZ ?? BASE_FLOOR_Z;
}

/** The ceiling altitude under a world point — `WALL_HEIGHT` when no sector is defined (a flat map). */
export function ceilZAt(map: GameMap, x: number, y: number): number {
  return sectorAt(map, x, y)?.ceilZ ?? WALL_HEIGHT;
}

/** Whether a mover currently standing at floor altitude `fromZ` may enter the cell at world point (x, y).
 *  Blocks a solid wall/door/glass (via `isWall`), a step too tall to climb (`Δfloor > STEP_UP_MAX` — stepping
 *  DOWN is always allowed, so pits are walk-into/fall-into), and a sector too short to stand in (ceiling
 *  clearance `< PLAYER_HEIGHT`). On a flat map (no sectors) `Δfloor` is 0 and clearance is WALL_HEIGHT, so it
 *  reduces to `!isWall` — byte-identical to today. Pure. */
export function canEnter(map: GameMap, fromZ: number, x: number, y: number): boolean {
  if (isWall(map, x, y)) {
    return false;
  }
  const floorZ = floorZAt(map, x, y);

  if (floorZ - fromZ > STEP_UP_MAX) {
    return false; // too tall a step UP (down is allowed)
  }

  if (ceilZAt(map, x, y) - floorZ < PLAYER_HEIGHT) {
    return false; // too low a ceiling to fit
  }

  return true;
}

/** The target floor altitude if the cell at (x, y) is MANTLE-able from `fromZ` — a rise in
 *  `(STEP_UP_MAX, CLIMB_MAX]` with head clearance to stand at the top, and not a solid wall — else `null`
 *  (already walkable, or a true wall). The player-only auto-climb in `step` reads this to classify a too-tall
 *  obstacle as a climbable ledge; a flat level has rise 0 ≤ STEP_UP_MAX, so it always returns null there. Pure. */
export function climbTarget(map: GameMap, fromZ: number, x: number, y: number): number | null {
  if (isWall(map, x, y)) {
    return null;
  }
  const floorZ = floorZAt(map, x, y);
  const rise = floorZ - fromZ;

  if (rise <= STEP_UP_MAX || rise > CLIMB_MAX) {
    return null; // walkable (a normal step), or too tall = a true wall
  }

  if (ceilZAt(map, x, y) - floorZ < PLAYER_HEIGHT) {
    return null; // can't stand at the top
  }

  return floorZ;
}
