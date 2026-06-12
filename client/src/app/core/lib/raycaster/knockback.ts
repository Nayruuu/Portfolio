import { isWall } from './game-map';
import type { GameMap } from './game-map';
import type { Enemy, Pose } from './types';

/** Shove the point `(px, py)` `distance` cells straight away from the origin `(ox, oy)`. **Axis-separated**
 *  collision (mirrors `move`): a wall on one axis still lets the point slide along the other, and never lets
 *  it cross into solid space. The shared core of `knockback` (an enemy away from the player) and the rocket
 *  jump (the player away from a blast). A point sitting exactly on the origin stays put (no divide-by-zero). */
export function pushAway(
  ox: number,
  oy: number,
  px: number,
  py: number,
  map: GameMap,
  distance: number,
): { x: number; y: number } {
  const dx = px - ox;
  const dy = py - oy;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return { x: px, y: py };
  }
  const pushX = (dx / length) * distance;
  const pushY = (dy / length) * distance;
  let x = px;
  let y = py;

  if (!isWall(map, x + pushX, y)) {
    x += pushX;
  }
  if (!isWall(map, x, y + pushY)) {
    y += pushY;
  }

  return { x, y };
}

/** Shove a hit enemy `distance` cells straight away from the player — `pushAway` from the player's point.
 *  Returns the new `{x, y}`; an enemy sitting exactly on the player stays put. */
export function knockback(
  pose: Pose,
  enemy: Enemy,
  map: GameMap,
  distance: number,
): { x: number; y: number } {
  return pushAway(pose.x, pose.y, enemy.x, enemy.y, map, distance);
}

/** Shove the player straight back (opposite their facing) by `distance` cells, wall-clamped per axis like
 *  `knockback` — the CO2 blast's self-recoil. */
export function recoil(pose: Pose, map: GameMap, distance: number): Pose {
  const backX = pose.x - Math.cos(pose.dir) * distance;
  const backY = pose.y - Math.sin(pose.dir) * distance;
  const x = isWall(map, backX, pose.y) ? pose.x : backX;
  const y = isWall(map, x, backY) ? pose.y : backY; // y-axis checked at the RESOLVED x (as `move`/`knockback` do)

  return { ...pose, x, y };
}
