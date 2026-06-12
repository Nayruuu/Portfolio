import { describe, it, expect } from 'vitest';
import { collectPickups } from './pickup';
import type { Pickup } from './types';

const pose = { x: 2, y: 2, dir: 0 };

describe('collectPickups', () => {
  it('collects an overlapping coffee (+25, capped at 100) and removes it', () => {
    const pickups: Pickup[] = [{ x: 2, y: 2, kind: 'health' }];
    const out = collectPickups(pose, pickups, 50, 0);

    expect(out.hp).toBe(75);
    expect(out.pickups).toHaveLength(0);
  });

  it('caps health at 100', () => {
    expect(collectPickups(pose, [{ x: 2, y: 2, kind: 'health' }], 90, 0).hp).toBe(100);
  });

  it('collects armor (+50, capped at 100)', () => {
    expect(collectPickups(pose, [{ x: 2, y: 2, kind: 'armor' }], 100, 0).armor).toBe(50);
  });

  it('caps armor at 100', () => {
    expect(collectPickups(pose, [{ x: 2, y: 2, kind: 'armor' }], 100, 80).armor).toBe(100);
  });

  it('leaves a distant pickup untouched', () => {
    const pickups: Pickup[] = [{ x: 9, y: 9, kind: 'health' }];
    const out = collectPickups(pose, pickups, 50, 0);

    expect(out.hp).toBe(50);
    expect(out.pickups).toHaveLength(1);
  });
});
