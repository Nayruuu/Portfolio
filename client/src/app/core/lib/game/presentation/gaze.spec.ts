import { describe, it, expect } from 'vitest';
import { gazeForTurn, smoothTurnRate } from './gaze';

describe('smoothTurnRate', () => {
  it('advances the EMA toward the turn rate by the blend factor (8 * dt)', () => {
    // one step from rest: 0 + (1 - 0) * min(1, 8 * 0.05) = 0.4
    expect(smoothTurnRate(0, 1, 0.05)).toBeCloseTo(0.4, 10);
  });

  it('a steady turn drives the EMA monotonically toward the turn rate', () => {
    let ema = 0;
    const previous: number[] = [];

    for (let i = 0; i < 50; i++) {
      previous.push(ema);
      ema = smoothTurnRate(ema, 3, 1 / 60);
    }

    expect(ema).toBeGreaterThan(2.9); // converged near the target
    expect(ema).toBeLessThan(3); // never overshoots
    expect(previous.every((v, i) => i === 0 || v > previous[i - 1])).toBe(true); // strictly rising
  });

  it('decays back toward centre once the turn stops', () => {
    let ema = 3;

    for (let i = 0; i < 50; i++) {
      ema = smoothTurnRate(ema, 0, 1 / 60);
    }

    expect(ema).toBeGreaterThan(0);
    expect(ema).toBeLessThan(0.1); // relaxed toward the centre
  });

  it('clamps the blend factor at 1 for a large dt (jumps to the target, no overshoot)', () => {
    // 8 * dt = 8 → min(1, 8) = 1 → previous + (target - previous) * 1 = target exactly
    expect(smoothTurnRate(0, 2, 1)).toBe(2);
    expect(smoothTurnRate(5, -1, 1)).toBe(-1);
  });
});

describe('gazeForTurn', () => {
  it('looks dead ahead below the near-glance threshold (0.6 rad/s)', () => {
    expect(gazeForTurn(0)).toBe(0);
    expect(gazeForTurn(0.59)).toBe(0);
    expect(gazeForTurn(-0.59)).toBe(0);
  });

  it('glances toward the turn (±1) between the near and far thresholds', () => {
    expect(gazeForTurn(0.6)).toBe(1); // at the near threshold
    expect(gazeForTurn(2.49)).toBe(1); // just below the far threshold
    expect(gazeForTurn(-1)).toBe(-1); // signed toward a left turn
  });

  it('throws the extreme glance (±2) at/above the far threshold (2.5 rad/s)', () => {
    expect(gazeForTurn(2.5)).toBe(2); // at the far threshold
    expect(gazeForTurn(4)).toBe(2);
    expect(gazeForTurn(-3)).toBe(-2);
  });
});
