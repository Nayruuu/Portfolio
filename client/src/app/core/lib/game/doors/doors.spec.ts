import { describe, expect, it } from 'vitest';
import {
  DOOR_OPEN_SPEED,
  DOOR_TRIGGER_RADIUS,
  SLIDE_OPEN_SPEED,
  SLIDE_TRIGGER_RADIUS,
  doorCeilZ,
  stepDoorOpenness,
  stepSlideOpenness,
} from './index';

describe('door tuning constants', () => {
  it('pins the authored door + slide tuning (a flip must ripple to a red test)', () => {
    expect(DOOR_OPEN_SPEED).toBe(2.2);
    expect(DOOR_TRIGGER_RADIUS).toBe(2.4);
    expect(SLIDE_OPEN_SPEED).toBe(4);
    expect(SLIDE_TRIGGER_RADIUS).toBe(4);
  });
});

describe('stepDoorOpenness', () => {
  it('opens toward 1 while the player is in range and holds the badge', () => {
    // dt = 0.1 → advance by DOOR_OPEN_SPEED(2.2) * 0.1 = 0.22 from a shut door
    expect(stepDoorOpenness(0, 0.1, true, true)).toBeCloseTo(0.22, 10);
  });

  it('clamps a nearly-open door to a fully open 1 (never overshoots)', () => {
    expect(stepDoorOpenness(0.95, 0.1, true, true)).toBe(1);
  });

  it('stays shut for a locked door approached WITHOUT the badge', () => {
    expect(stepDoorOpenness(0, 0.1, true, false)).toBe(0);
  });

  it('holds its openness when the player leaves range (a permanent unlock — never auto-closes)', () => {
    expect(stepDoorOpenness(0.6, 0.1, false, true)).toBe(0.6);
    expect(stepDoorOpenness(1, 0.1, false, true)).toBe(1);
  });
});

describe('doorCeilZ', () => {
  it('sits at the closed ceiling when fully shut', () => {
    expect(doorCeilZ(2, 5, 0)).toBe(2);
  });

  it('sits at the open ceiling when fully open', () => {
    expect(doorCeilZ(2, 5, 1)).toBe(5);
  });

  it('interpolates the ceiling linearly across the openness', () => {
    expect(doorCeilZ(2, 5, 0.5)).toBeCloseTo(3.5, 10); // 2 + (5-2)*0.5
  });
});

describe('stepSlideOpenness', () => {
  it('opens toward 1 while the player is near', () => {
    // dt = 0.1 → step = SLIDE_OPEN_SPEED(4) * 0.1 = 0.4 from a shut panel
    expect(stepSlideOpenness(0, 0.1, true)).toBeCloseTo(0.4, 10);
  });

  it('clamps a nearly-open panel to 1 (never overshoots open)', () => {
    expect(stepSlideOpenness(0.95, 0.1, true)).toBe(1);
  });

  it('auto-closes toward 0 when the player is far', () => {
    // from fully open, dt = 0.1 → retract by 0.4 → 0.6
    expect(stepSlideOpenness(1, 0.1, false)).toBeCloseTo(0.6, 10);
  });

  it('clamps a nearly-shut panel to 0 (never overshoots closed)', () => {
    expect(stepSlideOpenness(0.05, 0.1, false)).toBe(0);
  });
});
