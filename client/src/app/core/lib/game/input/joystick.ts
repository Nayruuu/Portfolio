export interface JoystickAxes {
  readonly forward: number;
  readonly strafe: number;
}

// Floating left-thumb joystick: the drag vector in px (from the touch origin) → analog forward/strafe in
// [-1, 1] — `strafe = dx/radius`, `forward = -dy/radius` (dragging up is ahead), each clamped to the unit
// throw. A deflection whose magnitude is under `deadzone` (a fraction of full throw) reads neutral so a
// resting thumb never creeps the player forward.
export function joystickAxes(
  dx: number,
  dy: number,
  radius: number,
  deadzone: number,
): JoystickAxes {
  const strafe = clampUnit(dx / radius);
  const forward = clampUnit(-dy / radius);

  if (Math.hypot(strafe, forward) < deadzone) {
    return { forward: 0, strafe: 0 };
  }

  return { forward, strafe };
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
