import type { ZonePortalDef } from './types';

// Operation order is load-bearing — it sets zone-swap timing.

export const SEAM_HYSTERESIS = 0.1;

export interface SeamSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly len: number;
  readonly nx: number; // unit normal pointing OUT of the room (the crossing direction)
  readonly ny: number;
}

export function isPassableSeam(portal: ZonePortalDef | undefined): portal is ZonePortalDef {
  return portal?.passable === true;
}

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
    return null;
  }
  const t = dFrom / (dFrom - dTo);
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
