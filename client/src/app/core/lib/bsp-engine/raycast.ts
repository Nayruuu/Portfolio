import { SLIDE_OPEN } from './physics';
import type { CompiledMap } from './types';

export interface RayHit {
  readonly dist: number;
  readonly x: number;
  readonly y: number;
}

// Two-sided portals let a ray pass (chest-height bullet / sight through glass). `blockGlass` (a
// projectile, not a sight line) also stops on solid glass or a still-shut sliding door. A live
// zonePortal always blocks — shots never cross zones, even a passable seam.
export function castRay(
  map: CompiledMap,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  blockGlass = false,
  slides?: readonly number[],
): RayHit | null {
  let best = maxDist;
  let hit: RayHit | null = null;
  const lines = map.source.linedefs;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.back !== null) {
      const solidGlass =
        blockGlass &&
        line.glass === true &&
        (line.sliding !== true || (slides?.[i] ?? 0) < SLIDE_OPEN);

      // A live zonePortal blocks the ray like a solid wall, even on a two-sided line.
      if (!solidGlass && line.zonePortal === undefined) {
        continue;
      }
    }
    const a = map.source.vertices[line.v1];
    const b = map.source.vertices[line.v2];
    // Ray (O + t·D) vs segment (A + u·(B−A)): solve for ray distance t and segment fraction u.
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;

    if (denom === 0) {
      continue; // ray parallel to the wall
    }
    const sx = a.x - ox;
    const sy = a.y - oy;
    const t = (sx * ey - sy * ex) / denom; // forward distance (D is unit length)
    const u = (sx * dy - sy * dx) / denom; // position along the wall

    if (t >= 0 && t < best && u >= 0 && u <= 1) {
      best = t;
      hit = { dist: t, x: ox + dx * t, y: oy + dy * t };
    }
  }

  return hit;
}

// zMin/zMax: give them for a 3D hit respecting the shot's pitch; omit for a height-agnostic 2D hit.
export interface Target {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly zMin?: number;
  readonly zMax?: number;
}

export interface TargetHit {
  readonly index: number;
  readonly dist: number;
}

// Pass castRay's wall distance as `maxDist` so a shot can't reach a target behind a wall.
export function nearestTargetHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  targets: readonly Target[],
  cone = 0,
  eyeZ = 0,
  vSlope = 0,
): TargetHit | null {
  const spread = Math.tan(cone); // cone half-angle as perpendicular widening per unit of forward depth
  let best = maxDist;
  let index = -1;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    // Clamped to the ray START so a centre slightly behind the origin still hits when the origin is
    // INSIDE the body (a point-blank rusher / a shot spawned ahead of the camera).
    const proj = Math.max(0, (t.x - ox) * dx + (t.y - oy) * dy);

    if (proj > best) {
      continue;
    }
    const perp = Math.hypot(t.x - (ox + dx * proj), t.y - (oy + dy * proj));

    if (perp > t.radius + proj * spread) {
      continue;
    }
    if (t.zMin !== undefined && t.zMax !== undefined) {
      const aimZ = eyeZ + vSlope * proj;

      if (Math.abs(aimZ - (t.zMin + t.zMax) / 2) > (t.zMax - t.zMin) / 2 + proj * spread) {
        continue;
      }
    }
    best = proj;
    index = i;
  }

  return index < 0 ? null : { index, dist: best };
}
