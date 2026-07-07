import { describe, it, expect } from 'vitest';
import { isPassableSeam, seamCrossing, seamHysteresisPush, SEAM_HYSTERESIS } from './seams';
import type { SeamSegment } from './seams';

// A horizontal seam along y = 0 spanning x ∈ [0, 4], its outward normal pointing +y (the "back" side).
// "Front" is the y < 0 half-plane; a FRONT → BACK crossing steps from y < 0 to y ≥ 0 within x ∈ [0, 4].
const SEAM: SeamSegment = { ax: 0, ay: 0, bx: 4, by: 0, len: 4, nx: 0, ny: 1 };

describe('isPassableSeam', () => {
  it('is true only for a portal explicitly flagged passable', () => {
    expect(isPassableSeam({ zone: 'z', dx: 0, dy: 0, passable: true })).toBe(true);
  });

  it('is false for a stage-2 window (passable false or unset) and for no portal', () => {
    expect(isPassableSeam({ zone: 'z', dx: 0, dy: 0, passable: false })).toBe(false);
    expect(isPassableSeam({ zone: 'z', dx: 0, dy: 0 })).toBe(false);
    expect(isPassableSeam(undefined)).toBe(false);
  });
});

describe('seamCrossing', () => {
  it('reports a crossing when the path steps front → back through the span', () => {
    // (2,-1) → (2,1): perpendicular, meeting the line at (2,0), mid-span → crosses; lands +1 beyond.
    expect(seamCrossing(SEAM, 2, -1, 2, 1)).toBeCloseTo(1, 6);
  });

  it('returns the destination distance BEYOND the line as the crossing result', () => {
    // A shallow overshoot lands only 0.05 past the line.
    expect(seamCrossing(SEAM, 2, -1, 2, 0.05)).toBeCloseTo(0.05, 6);
  });

  it('does NOT cross when the path meets the infinite line BESIDE the segment span', () => {
    // (6,-1) → (6,1) crosses y=0 at x=6, which is off the [0,4] span → no crossing.
    expect(seamCrossing(SEAM, 6, -1, 6, 1)).toBeNull();
  });

  it('does NOT cross when moving back → front (wrong side/direction)', () => {
    // (2,1) → (2,-1) starts already beyond (dFrom ≥ 0) → never a front → back crossing.
    expect(seamCrossing(SEAM, 2, 1, 2, -1)).toBeNull();
  });

  it('does NOT cross when both endpoints stay on the front side', () => {
    expect(seamCrossing(SEAM, 2, -2, 2, -1)).toBeNull();
  });

  it('crosses right at the near span edge but not just outside it', () => {
    expect(seamCrossing(SEAM, 0, -1, 0, 1)).toBeCloseTo(1, 6); // u = 0, on the edge → crosses
    expect(seamCrossing(SEAM, -0.01, -1, -0.01, 1)).toBeNull(); // u < 0 → off the span
  });
});

describe('seamHysteresisPush', () => {
  it('pins the hysteresis margin to its load-bearing 0.1-cell value', () => {
    expect(SEAM_HYSTERESIS).toBe(0.1); // this constant sets swap timing — a drift changes when zones swap
  });

  it('nudges a destination on the line off it by exactly the hysteresis margin', () => {
    const p = seamHysteresisPush(2, 0, 0, 1, 0);

    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(0.1, 6); // 0 beyond → pushed the full 0.1 margin
  });

  it('pushes only the remaining shortfall when the destination already overshoots part-way', () => {
    expect(seamHysteresisPush(2, 0, 0, 1, 0.04).y).toBeCloseTo(0.06, 6);
  });

  it('leaves a destination already past the margin untouched (no pull-back)', () => {
    const p = seamHysteresisPush(2, 0.5, 0, 1, 0.5);

    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(0.5, 6); // beyond > margin → push clamps to 0
  });
});
