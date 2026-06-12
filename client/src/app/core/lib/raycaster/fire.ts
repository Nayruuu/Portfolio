import { isWall } from './game-map';
import { floorZAt } from './sector';
import { CAMERA_Z } from './floor-cast';
import { ENEMY_CONFIG } from './enemy';
import type { GameMap } from './game-map';
import type { Enemy, Pose } from './types';

const LOS_STEP = 0.1; // line-of-sight march resolution (cells)

/** Per-enemy pellet-hit counts for one shotgun blast: `pellets` rays fanned evenly across ±`fanHalfAngle`
 *  around the aim; each ray lands on the nearest alive enemy whose silhouette it crosses (within `range`
 *  + clear LOS). Returns an array indexed like `enemies` (0 for an unhit enemy). */
export function resolveSpread(
  pose: Pose,
  enemies: readonly Enemy[],
  map: GameMap,
  range: number,
  fanHalfAngle: number,
  pellets: number,
): number[] {
  const hits = new Array<number>(enemies.length).fill(0);

  for (let pellet = 0; pellet < pellets; pellet++) {
    const fraction = pellets === 1 ? 0.5 : pellet / (pellets - 1);
    const pelletAngle = pose.dir + (-fanHalfAngle + 2 * fanHalfAngle * fraction);
    let best: number | null = null;
    let bestDist = Infinity;

    for (let index = 0; index < enemies.length; index++) {
      const enemy = enemies[index];

      if (enemy.state !== 'alive') {
        continue;
      }
      const deltaX = enemy.x - pose.x;
      const deltaY = enemy.y - pose.y;
      const dist = Math.hypot(deltaX, deltaY);

      if (dist > range || dist >= bestDist) {
        continue;
      }
      const silhouette = Math.atan2(ENEMY_CONFIG[enemy.kind].radius, dist); // angular half-width at this distance
      const angle = Math.abs(normalizeAngle(Math.atan2(deltaY, deltaX) - pelletAngle));

      if (angle > silhouette || !hasLineOfSight(pose.x, pose.y, enemy.x, enemy.y, map)) {
        continue;
      }
      best = index;
      bestDist = dist;
    }
    if (best !== null) {
      hits[best] += 1;
    }
  }

  return hits;
}

/** Nearest alive enemy under the crosshair within `range` + `cone` (radians half-angle) with clear LOS, or null. */
export function resolveFire(
  pose: Pose,
  enemies: readonly Enemy[],
  map: GameMap,
  range: number,
  cone: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;

  for (let index = 0; index < enemies.length; index++) {
    const enemy = enemies[index];

    if (enemy.state !== 'alive') {
      continue;
    }
    const deltaX = enemy.x - pose.x;
    const deltaY = enemy.y - pose.y;
    const dist = Math.hypot(deltaX, deltaY);

    if (dist > range || dist >= bestDist) {
      continue;
    }
    // Aim tolerance = the weapon's cone WIDENED by the enemy's angular half-width, so a shot landing anywhere
    // on the visible sprite connects (a wide middle manager is easier to hit than a thin husk), not only its
    // exact centre point.
    const aim = cone + Math.atan2(ENEMY_CONFIG[enemy.kind].radius, dist);
    const angle = Math.abs(normalizeAngle(Math.atan2(deltaY, deltaX) - pose.dir));

    if (angle > aim || !hasLineOfSight(pose.x, pose.y, enemy.x, enemy.y, map)) {
      continue;
    }
    best = index;
    bestDist = dist;
  }

  return best;
}

/** True if nothing solid sits on the segment (ax,ay)→(bx,by). Shared by player fire + enemy sight. */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  map: GameMap,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(dist / LOS_STEP);
  const dx = (bx - ax) / steps;
  const dy = (by - ay) / steps;
  // Eye altitude at each end (its sector floor + the camera height); the sightline lerps between them.
  const eyeA = floorZAt(map, ax, ay) + CAMERA_Z;
  const eyeB = floorZAt(map, bx, by) + CAMERA_Z;

  for (let stepIndex = 1; stepIndex < steps; stepIndex++) {
    const x = ax + dx * stepIndex;
    const y = ay + dy * stepIndex;

    if (isWall(map, x, y)) {
      return false;
    }
    // Terrain that rises ABOVE the eye-to-eye sightline blocks vision (a tall step/barrier), like a wall.
    // On a flat level every floor sits at 0, well below the eye height, so this never fires (byte-identical).
    if (floorZAt(map, x, y) > eyeA + (eyeB - eyeA) * (stepIndex / steps)) {
      return false;
    }
  }

  return true;
}

/** Wrap an angle to (-π, π]. */
function normalizeAngle(angle: number): number {
  let wrapped = angle;

  while (wrapped > Math.PI) {
    wrapped -= 2 * Math.PI;
  }
  while (wrapped <= -Math.PI) {
    wrapped += 2 * Math.PI;
  }

  return wrapped;
}
