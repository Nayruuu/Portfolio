export interface MovementDelta {
  readonly x: number;
  readonly y: number;
}

// forward (+1 ahead) runs along the heading; strafe (+1 right) along its right-hand side — camera-left is +y,
// so a right strafe at angle 0 moves toward −y.
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
