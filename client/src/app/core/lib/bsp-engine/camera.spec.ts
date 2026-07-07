import { describe, it, expect } from 'vitest';
import { clampPitch, focalFor, projectColumn, projectRow, toCamera, type Camera } from './camera';

const ORIGIN: Camera = { x: 0, y: 0, angle: 0, z: 0.5 };

describe('camera projection', () => {
  it('derives focal length from width + FOV (90° → half-width)', () => {
    expect(focalFor(320, Math.PI / 2)).toBeCloseTo(160, 6);
  });

  it('maps world points into camera space (forward along view, side to the left)', () => {
    expect(toCamera(ORIGIN, { x: 5, y: 0 })).toEqual({ forward: 5, side: 0 }); // dead ahead
    expect(toCamera(ORIGIN, { x: 0, y: 5 })).toMatchObject({ forward: 0, side: 5 }); // to the left

    // Looking +y: a point at +y is now dead ahead.
    const up: Camera = { ...ORIGIN, angle: Math.PI / 2 };
    const ahead = toCamera(up, { x: 0, y: 5 });

    expect(ahead.forward).toBeCloseTo(5, 6);
    expect(ahead.side).toBeCloseTo(0, 6);
  });

  it('projects a dead-ahead point to screen centre, a left point further left', () => {
    const focal = focalFor(320, Math.PI / 2);

    expect(projectColumn({ forward: 5, side: 0 }, 320, focal)).toBeCloseTo(160, 6); // centre
    expect(projectColumn({ forward: 5, side: 5 }, 320, focal)).toBeCloseTo(0, 6); // 45° left edge
  });

  it('projects heights above the eye above the horizon and below below it', () => {
    const focal = focalFor(320, Math.PI / 2);
    const ceil = projectRow(1, 5, ORIGIN, 200, focal); // ceiling at z=1, eye z=0.5
    const floor = projectRow(0, 5, ORIGIN, 200, focal); // floor at z=0

    expect(ceil).toBeLessThan(100); // above the horizon (y < height/2)
    expect(floor).toBeGreaterThan(100); // below
    expect(ceil).toBeCloseTo(84, 6);
    expect(floor).toBeCloseTo(116, 6);
  });
});

describe('clampPitch', () => {
  it('leaves a pitch within range untouched', () => {
    expect(clampPitch(0.3, 2.0, 0.85)).toBe(0.3);
  });

  it('clamps to the shallower look-up limit', () => {
    expect(clampPitch(1.5, 2.0, 0.85)).toBe(0.85);
  });

  it('clamps to the deeper look-down limit (kept as a positive magnitude)', () => {
    expect(clampPitch(-3.0, 2.0, 0.85)).toBe(-2.0);
  });
});
