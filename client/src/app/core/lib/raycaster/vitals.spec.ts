import { describe, it, expect } from 'vitest';
import { applyDamage } from './vitals';

describe('applyDamage', () => {
  it('takes full damage off hp when there is no armor', () => {
    expect(applyDamage(100, 0, 12)).toEqual({ hp: 88, armor: 0 });
  });

  it('green armor absorbs 1/3 (floored) and depletes', () => {
    // floor(12/3)=4 absorbed → hp -8, armor -4
    expect(applyDamage(100, 50, 12)).toEqual({ hp: 92, armor: 46 });
  });

  it('armor never goes below 0 — absorbs only what it has', () => {
    // floor(12/3)=4 wanted, only 2 armor → absorb 2, hp -10
    expect(applyDamage(100, 2, 12)).toEqual({ hp: 90, armor: 0 });
  });

  it('lethal damage drives hp to/under 0 (the death signal)', () => {
    expect(applyDamage(8, 0, 12).hp).toBeLessThanOrEqual(0);
  });
});
