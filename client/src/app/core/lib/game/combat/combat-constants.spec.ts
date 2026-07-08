import { describe, it, expect } from 'vitest';
import { AIM_CONE, AMMO_START, ARC_DURATION, MELEE_CONE, MELEE_RANGE } from './combat-constants';

describe('combat constants', () => {
  it('pins the shared combat tuning (a change here must be deliberate)', () => {
    expect(AMMO_START).toBe(50);
    expect(MELEE_RANGE).toBe(1.4);
    expect(MELEE_CONE).toBe(0.5);
    expect(AIM_CONE).toBe(0.13);
    expect(ARC_DURATION).toBe(0.35);
  });

  it('keeps the melee swing wider than the ranged aim cone', () => {
    expect(MELEE_CONE).toBeGreaterThan(AIM_CONE);
  });
});
