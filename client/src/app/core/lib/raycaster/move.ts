import { canEnter, floorZAt } from './sector';
import type { GameMap } from './game-map';
import type { MoveIntent, Pose } from './types';

/** Player collision radius — keeps the camera off the wall face. Must stay BELOW `PROBE_REACH` (0.3, the
 *  mantle look-ahead) so a forward push still reaches a climbable ledge directly ahead — a larger radius
 *  stops the player short of the probe and silently disables climbing the tall steps. */
const RADIUS = 0.2;

/**
 * Translate the pose by the intent (forward along `dir`, strafe along the perpendicular),
 * `speed` in cells/second, with **axis-separated** collision so a blocked axis still slides
 * along the other. `dir` itself is unchanged here (turning is handled in `step`).
 */
export function move(
  pose: Pose,
  intent: MoveIntent,
  map: GameMap,
  dt: number,
  speed: number,
): Pose {
  const dirX = Math.cos(pose.dir);
  const dirY = Math.sin(pose.dir);
  const dx = (dirX * intent.forward - dirY * intent.strafe) * speed * dt;
  const dy = (dirY * intent.forward + dirX * intent.strafe) * speed * dt;

  let x = pose.x;
  let y = pose.y;

  if (dx !== 0 && canEnter(map, pose.z ?? 0, x + dx + Math.sign(dx) * RADIUS, y)) {
    x += dx;
  }
  if (dy !== 0 && canEnter(map, pose.z ?? 0, x, y + dy + Math.sign(dy) * RADIUS)) {
    y += dy;
  }

  // Keep the player on the floor of whatever sector it ends up over (flat map → `floorZAt` is 0, so `z`
  // stays 0 — byte-identical until A2b/A2c read it). The sector heights vary only on A2 height maps.
  return { x, y, z: floorZAt(map, x, y), dir: pose.dir };
}
