import { describe, expect, it } from 'vitest';
import { joystickAxes } from './joystick';

const RADIUS = 60;
const DEADZONE = 0.15;

describe('joystickAxes', () => {
  it('maps up (negative dy) to forward and right (positive dx) to strafe', () => {
    expect(joystickAxes(60, -60, RADIUS, DEADZONE)).toEqual({ forward: 1, strafe: 1 });
    expect(joystickAxes(-60, 60, RADIUS, DEADZONE)).toEqual({ forward: -1, strafe: -1 });
  });

  it('scales linearly within the ring', () => {
    expect(joystickAxes(30, -15, RADIUS, DEADZONE)).toEqual({ forward: 0.25, strafe: 0.5 });
  });

  it('clamps each axis to the unit throw past the ring radius', () => {
    expect(joystickAxes(200, -200, RADIUS, DEADZONE)).toEqual({ forward: 1, strafe: 1 });
    expect(joystickAxes(-200, 200, RADIUS, DEADZONE)).toEqual({ forward: -1, strafe: -1 });
  });

  it('reads neutral inside the deadzone (a resting thumb never creeps)', () => {
    // ~0.14 of full throw — under the 0.15 deadzone
    expect(joystickAxes(5, -6, RADIUS, DEADZONE)).toEqual({ forward: 0, strafe: 0 });
    expect(joystickAxes(0, 0, RADIUS, DEADZONE)).toEqual({ forward: 0, strafe: 0 });
  });

  it('leaves a deflection just past the deadzone live', () => {
    const axes = joystickAxes(0, -12, RADIUS, DEADZONE); // magnitude 0.2 > 0.15

    expect(axes.forward).toBeCloseTo(0.2, 6);
    expect(axes.strafe).toBe(0);
  });
});
