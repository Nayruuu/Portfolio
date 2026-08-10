import { describe, expect, it } from 'vitest';
import { PITCH_DOWN_MAX, PITCH_UP_MAX } from '../game-tuning';
import { applyLook } from './look';

describe('applyLook', () => {
  it('turns the heading left and tilts the pitch by the delta × sensitivity', () => {
    const next = applyLook(0, 0, 100, 10, 0.0035);

    expect(next.angle).toBeCloseTo(-0.35, 6); // dragging right turns right (angle decreases)
    expect(next.pitch).toBeCloseTo(-0.035, 6); // dragging down looks down
  });

  it('accumulates from the current orientation', () => {
    const next = applyLook(1, 0.2, -100, -20, 0.0035);

    expect(next.angle).toBeCloseTo(1.35, 6);
    expect(next.pitch).toBeCloseTo(0.27, 6);
  });

  it('clamps the pitch to the look-up limit', () => {
    expect(applyLook(0, 0, 0, -100000, 0.0035).pitch).toBe(PITCH_UP_MAX);
  });

  it('clamps the pitch to the look-down limit', () => {
    expect(applyLook(0, 0, 0, 100000, 0.0035).pitch).toBe(-PITCH_DOWN_MAX);
  });
});
