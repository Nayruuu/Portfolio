import { describe, it, expect } from 'vitest';
import { makeRng, randInt, pick } from './rng';

describe('makeRng', () => {
  it('is deterministic — same seed yields the same sequence', () => {
    const rngA = makeRng(123);
    const rngB = makeRng(123);

    expect([rngA(), rngA(), rngA()]).toEqual([rngB(), rngB(), rngB()]);
  });

  it('different seeds diverge', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('returns values in [0, 1)', () => {
    const rng = makeRng(7);

    for (let i = 0; i < 50; i++) {
      const value = rng();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('randInt / pick', () => {
  it('randInt stays in [0, max)', () => {
    const rng = makeRng(9);

    for (let i = 0; i < 50; i++) {
      const result = randInt(rng, 5);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(5);
    }
  });

  it('pick returns a member of the array', () => {
    const items = ['a', 'b', 'c'];

    expect(items).toContain(pick(makeRng(3), items));
  });
});
