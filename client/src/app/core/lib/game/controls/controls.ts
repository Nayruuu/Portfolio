// core/lib/game/controls — the pure game-INPUT kernel: turn the movement intent (the forward/back and
// strafe axes the held keys resolve to) plus the facing angle into the world-space displacement the
// physics solver consumes. Zero DOM — the shell reads the keys, this maps intent → motion, the shell
// applies the result through movePlayer.

/** The world-space want-displacement for one movement tick, before collision resolution. */
export interface MovementDelta {
  readonly x: number;
  readonly y: number;
}

/**
 * Map the movement axes to a world-space want-displacement over `reach` (the tick's travel budget,
 * MOVE_SPEED·dt). `forward` is the forward/back axis (+1 straight ahead, −1 back), `strafe` the right/left
 * axis (+1 to the right), and `angle` the facing (radians, 0 = +x). Forward runs along the heading; strafe
 * runs along its right-hand side (camera-left is +y, so a right strafe at angle 0 moves toward −y).
 */
export function movementDelta(
  angle: number,
  forward: number,
  strafe: number,
  reach: number,
): MovementDelta {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: (cos * forward + sin * strafe) * reach,
    y: (sin * forward - cos * strafe) * reach,
  };
}
