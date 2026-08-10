import { describe, expect, it } from 'vitest';
import { flickerLight } from './index';

const BASE = 200;

// One tube's whole span, sampled per ~70 ms tick — enough ticks that both the near-base and the dip branch
// are exercised (and their proportions can be asserted).
function sweep(base: number, seed: number): number[] {
  const out: number[] = [];

  for (let t = 0; t <= 20_000; t += 35) {
    out.push(flickerLight(base, t, seed));
  }

  return out;
}

describe('flickerLight', () => {
  it('is deterministic — same (base, time, seed) always yields the same light', () => {
    expect(flickerLight(BASE, 1234, 3)).toBe(flickerLight(BASE, 1234, 3));
    expect(flickerLight(BASE, 5000, 0)).toBe(flickerLight(BASE, 5000, 0));
  });

  it('stays within [0, 255] across a full sweep', () => {
    for (const light of sweep(BASE, 0)) {
      expect(light).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(255);
    }
  });

  it('holds mostly near the base but occasionally drops out sharply (a failing tube)', () => {
    const values = sweep(BASE, 0);
    const nearBase = values.filter((v) => v >= 0.8 * BASE);
    const dips = values.filter((v) => v <= 0.6 * BASE);

    expect(dips.length).toBeGreaterThan(0); // the dip branch fires
    expect(nearBase.length).toBeGreaterThan(0); // the near-base branch fires
    expect(nearBase.length).toBeGreaterThan(values.length * 0.6); // …and dominates
    expect(dips.length).toBeLessThan(values.length * 0.4); // dropouts stay the minority
  });

  it('never exceeds the authored base (multiplier tops out at 1.0×)', () => {
    for (const light of sweep(BASE, 2)) {
      expect(light).toBeLessThanOrEqual(BASE);
    }
  });

  it('desynchronises tubes by seed — two seeds are not identical at every tick', () => {
    const a = sweep(BASE, 0);
    const b = sweep(BASE, 7);

    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });

  it('collapses to a dark tube: a zero base stays zero', () => {
    for (const light of sweep(0, 4)) {
      expect(light).toBe(0);
    }
  });
});
