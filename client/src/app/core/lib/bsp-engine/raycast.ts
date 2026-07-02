import { SLIDE_OPEN } from './physics';
import type { CompiledMap } from './types';

/** Where a hitscan ray met the world: the forward distance + the world point. */
export interface RayHit {
  readonly dist: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Cast a hitscan ray from `(ox, oy)` along the UNIT direction `(dx, dy)` and return the nearest solid wall
 * it strikes within `maxDist`, or `null` (it reached max range through open space). Only one-sided linedefs
 * (`back === null` — the solid edges of the world) block the ray; two-sided portals (steps, doorways) let a
 * shot pass, which is what we want for a chest-height bullet (and for line-of-sight through glass). The hit
 * drives a weapon's impact + caps how far an enemy can be shot along the same ray.
 *
 * With `blockGlass` (a flying PROJECTILE, not a sight line), a two-sided line also stops the ray when it is
 * solid GLASS — a glass window, or a SLIDING door still shut (`slides[i] < SLIDE_OPEN`; an open door lets it
 * through). Sight lines leave `blockGlass` false so foes can still see (and be seen) through the glass.
 */
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

      if (!solidGlass) {
        continue; // a two-sided portal (or an open glass door / a sight line) does not stop the ray
      }
    }
    const a = map.source.vertices[line.v1];
    const b = map.source.vertices[line.v2];
    // Ray (O + t·D) vs segment (A + u·(B−A)): solve for the ray distance t and the segment fraction u.
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

/** A billboard a hitscan can strike: a world position + the hit radius (its half-width). Give `zMin`/`zMax`
 *  (its vertical extent) for a 3D hit that respects the shot's pitch; omit them for a height-agnostic 2D hit. */
export interface Target {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly zMin?: number;
  readonly zMax?: number;
}

/** Which target a hitscan struck — its index in the input list — and the forward distance to it. */
export interface TargetHit {
  readonly index: number;
  readonly dist: number;
}

/**
 * Find the nearest `target` a hitscan ray from `(ox, oy)` along the UNIT direction `(dx, dy)` strikes within
 * `maxDist`, or `null`. Pass the wall distance from {@link castRay} as `maxDist` so a shot can't reach a
 * target standing behind a wall. A target is hit when the ray passes within `radius + proj·tan(cone)` of its
 * centre: its own half-width plus the weapon's `cone` (half-angle, radians) opening up with depth — so a
 * spread/imprecise weapon connects off-centre (mirrors the grid's `cone + atan2(radius, dist)` tolerance).
 *
 * When a target carries `zMin`/`zMax`, the hit is also checked VERTICALLY: the aim line's height at the
 * target's depth — `eyeZ + vSlope·proj` (eye height plus the pitch's vertical slope) — must fall within the
 * target's height (widened by the same cone), so a shot aimed over or under it misses.
 */
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
  const spread = Math.tan(cone); // the cone half-angle as a perpendicular widening per unit of forward depth
  let best = maxDist;
  let index = -1;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const proj = (t.x - ox) * dx + (t.y - oy) * dy; // distance along the ray to the closest approach

    if (proj < 0 || proj > best) {
      continue; // behind the shooter, or farther than the current nearest hit / max range
    }
    const perp = Math.hypot(t.x - (ox + dx * proj), t.y - (oy + dy * proj));

    if (perp > t.radius + proj * spread) {
      continue; // wide of the target horizontally
    }
    if (t.zMin !== undefined && t.zMax !== undefined) {
      const aimZ = eyeZ + vSlope * proj; // the aim line's height where it reaches the target

      if (Math.abs(aimZ - (t.zMin + t.zMax) / 2) > (t.zMax - t.zMin) / 2 + proj * spread) {
        continue; // aimed over or under the target
      }
    }
    best = proj;
    index = i;
  }

  return index < 0 ? null : { index, dist: best };
}
