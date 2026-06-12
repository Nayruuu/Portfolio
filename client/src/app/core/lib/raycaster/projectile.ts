import type { GameMap } from './game-map';
import { isWall } from './game-map';
import type { Pose, Projectile } from './types';

const PROJECTILE_RADIUS = 0.3; // cells — how close to the player counts as a hit

/** Advance one thrown projectile; returns null (despawn) when it enters a wall. */
export function stepProjectile(
  projectile: Projectile,
  map: GameMap,
  dt: number,
): Projectile | null {
  const x = projectile.x + projectile.velocityX * dt;
  const y = projectile.y + projectile.velocityY * dt;

  if (isWall(map, x, y)) {
    return null;
  }

  return { ...projectile, x, y };
}

/** True when the projectile is within hit range of the player. */
export function hitsPlayer(projectile: Projectile, pose: Pose): boolean {
  return Math.hypot(projectile.x - pose.x, projectile.y - pose.y) < PROJECTILE_RADIUS;
}
