import type { ZonePortalDef } from './types';

/**
 * Pure seam-crossing geometry — the small math kernels the zone shell calls to decide when a movement step
 * hops zones through a passable live seam, and by how much to nudge the landing so a graze can't oscillate.
 * The stateful world-ownership (loading/warming/swapping zones) stays in the feature shell; this is only the
 * float math that DECIDES a crossing, so its exact operation order is load-bearing (it sets swap timing).
 */

/** Cells the player lands INSIDE the new zone past a crossed seam — the positional hysteresis that keeps
 *  grazing the line from oscillating swaps. */
export const SEAM_HYSTERESIS = 0.1;

/** A passable live seam's pure GEOMETRY: the segment endpoints, its length, and the unit normal pointing OUT
 *  of the room (the crossing direction — the seam's back side). A structural subset of the feature `SeamEdge`. */
export interface SeamSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly len: number;
  readonly nx: number;
  readonly ny: number;
}

/** Is this zone-portal a PASSABLE (walk-through) crossing? A missing portal or a stage-2 window is not.
 *  A type guard: a passable portal is necessarily a defined {@link ZonePortalDef}. */
export function isPassableSeam(portal: ZonePortalDef | undefined): portal is ZonePortalDef {
  return portal?.passable === true;
}

/**
 * Does the movement step `from → to` cross the seam FRONT → BACK, within its span? Returns the signed
 * distance the destination lands BEYOND the seam line (≥ 0, the hysteresis input) on a crossing, or `null`
 * when the path never reaches the back side or meets the infinite line off the seam's actual segment.
 */
export function seamCrossing(
  seam: SeamSegment,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number | null {
  const dFrom = (fromX - seam.ax) * seam.nx + (fromY - seam.ay) * seam.ny; // signed dist, + = beyond
  const dTo = (toX - seam.ax) * seam.nx + (toY - seam.ay) * seam.ny;

  if (dFrom >= 0 || dTo < 0) {
    return null; // no front → back crossing on this step
  }
  const t = dFrom / (dFrom - dTo); // where along the step the line is met
  const cx = fromX + (toX - fromX) * t;
  const cy = fromY + (toY - fromY) * t;
  const u =
    ((cx - seam.ax) * (seam.bx - seam.ax) + (cy - seam.ay) * (seam.by - seam.ay)) /
    (seam.len * seam.len);

  if (u < 0 || u > 1) {
    return null; // crossed the infinite line, but off the seam's actual span
  }

  return dTo;
}

/** The positional hysteresis nudge: push the destination along the seam's outward normal so it lands at
 *  least {@link SEAM_HYSTERESIS} beyond the line, so a graze can't instantly re-cross. */
export function seamHysteresisPush(
  toX: number,
  toY: number,
  nx: number,
  ny: number,
  beyond: number,
): { readonly x: number; readonly y: number } {
  const push = Math.max(0, SEAM_HYSTERESIS - beyond);

  return { x: toX + nx * push, y: toY + ny * push };
}
