import { WALL_HEIGHT } from './floor-cast';
import { STEP_UP_MAX } from './sector';
import type { Sector } from './sector';
import type { Level } from './levels';

/** Band width (world units) the per-cell floor height snaps to. Set just BELOW `STEP_UP_MAX` (×0.9) so a
 *  one-band step is always auto-walkable — never a wall — which is what keeps a heightified level exactly
 *  as reachable as its flat original. */
const STEP = STEP_UP_MAX * 0.9; // 0.315

/** Height-field amplitude (world units): each axis contributes ±AMP, so the raw field spans ±2·AMP = ±1. */
const AMP = 0.5;

/** Height-field spatial frequency (radians per cell). With `AMP`, the per-cell change in `raw` is at most
 *  `AMP · 2·sin(FREQ/2)` ≈ 0.223 < STEP, so neighbours land in the same or an adjacent band — the floor step
 *  between any two adjacent cells is therefore ≤ STEP ≤ STEP_UP_MAX (the reachability invariant, asserted in
 *  the spec). Tune `AMP`/`FREQ`/`STEP` together if that bound is ever broken. */
const FREQ = 0.45;

/** Lifts every band non-negative so the packed dedupe key stays a clean small integer (raw ∈ [−1, 1] →
 *  band ∈ [−3, 3], so 8 is ample headroom). */
const BAND_OFFSET = 8;

/**
 * Post-process a (flat) generated level into one with real floor/ceiling HEIGHTS — gently. Returns a NEW
 * `Level` whose `map.sectors`/`map.sectorId` are rebuilt so EACH cell sits at a smooth, position-derived,
 * band-quantised floor altitude, while EVERYTHING ELSE (cells, flats, spawn, enemies, pickups, keys, …) is
 * carried through untouched. Pure + deterministic — no DOM, no `Math.random`/`Date`.
 *
 * Per cell the floor altitude is a bounded `sin`-field quantised to `STEP` bands (`AMP`/`FREQ` chosen so
 * adjacent cells differ by ≤ STEP ≤ STEP_UP_MAX → `canEnter` never blocks on height, so the level stays as
 * walkable as the flat one); the ceiling rides `WALL_HEIGHT` above the floor (constant headroom, so clearance
 * is always WALL_HEIGHT ≥ PLAYER_HEIGHT → no ceiling ever blocks); and floor/ceiling materials mirror the
 * level's per-cell flats, so the look is preserved. Sectors are deduped by `(band, floorMat, ceilMat)`.
 */
export function heightify(level: Level): Level {
  const { map, floorFlats, ceilFlats } = level;
  const sectors: Sector[] = [];
  const sectorId: number[] = new Array(map.cells.length);
  const byKey = new Map<number, number>(); // packed (band, floorMat, ceilMat) → sector index

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const raw = AMP * (Math.sin(x * FREQ) + Math.sin(y * FREQ));
      const band = Math.round(raw / STEP);
      const floorZ = band * STEP;
      const ceilZ = floorZ + WALL_HEIGHT; // constant headroom → clearance always WALL_HEIGHT ≥ PLAYER_HEIGHT
      const floorMat = floorFlats[i];
      const ceilMat = ceilFlats[i];
      const key = ((band + BAND_OFFSET) * 1000 + floorMat) * 100 + ceilMat; // small ids → collision-free
      let id = byKey.get(key);

      if (id === undefined) {
        id = sectors.length;
        sectors.push({ floorZ, ceilZ, floorMat, ceilMat });
        byKey.set(key, id);
      }
      sectorId[i] = id;
    }
  }

  return { ...level, map: { ...map, sectors, sectorId } };
}
