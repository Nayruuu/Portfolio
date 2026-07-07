import { describe, it, expect } from 'vitest';
import { movementDelta } from './controls';

describe('movementDelta', () => {
  it('walks forward along the +x heading (angle 0)', () => {
    // cos 1, sin 0 → x = (1·1 + 0·0)·reach, y = (0·1 − 1·0)·reach
    expect(movementDelta(0, 1, 0, 2)).toEqual({ x: 2, y: 0 });
  });

  it('strafes right of the +x heading toward −y (camera-left is +y)', () => {
    // cos 1, sin 0, strafe 1 → x = (1·0 + 0·1)·reach, y = (0·0 − 1·1)·reach
    expect(movementDelta(0, 0, 1, 2)).toEqual({ x: 0, y: -2 });
  });

  it('combines forward + strafe into the diagonal want-displacement (angle 0)', () => {
    // x = (1·1 + 0·1)·1 = 1 ; y = (0·1 − 1·1)·1 = −1
    expect(movementDelta(0, 1, 1, 1)).toEqual({ x: 1, y: -1 });
  });

  it('rotates the heading: forward faces +y at a quarter turn', () => {
    const delta = movementDelta(Math.PI / 2, 1, 0, 1);

    expect(delta.x).toBeCloseTo(0, 12); // cos(π/2)·1
    expect(delta.y).toBeCloseTo(1, 12); // sin(π/2)·1
  });

  it('strafes along the rotated right-hand side (a quarter turn exercises the sin·strafe term)', () => {
    // angle π/2 → cos 0, sin 1 ; strafe 1 → x = (0·0 + 1·1)·1 = 1, y = (1·0 − 0·1)·1 = 0
    const delta = movementDelta(Math.PI / 2, 0, 1, 1);

    expect(delta.x).toBeCloseTo(1, 12); // sin·strafe drives +x here — mutating this term is now caught
    expect(delta.y).toBeCloseTo(0, 12);
  });

  it('scales the whole displacement by the tick reach', () => {
    const near = movementDelta(0.7, 1, 0, 1);
    const far = movementDelta(0.7, 1, 0, 3);

    expect(far.x).toBeCloseTo(near.x * 3, 12);
    expect(far.y).toBeCloseTo(near.y * 3, 12);
  });
});
