import { describe, it, expect } from 'vitest';
import { collectKeys } from './keys';
import type { Keycard } from './types';

const pose = { x: 2, y: 2, dir: 0 };

describe('collectKeys', () => {
  it('collects an overlapping keycard, ORs its colour bit, and removes it', () => {
    const keys: Keycard[] = [{ x: 2, y: 2, color: 'yellow' }];
    const out = collectKeys(pose, keys, 0);

    expect(out.heldKeys).toBe(0b100); // yellow = bit 2
    expect(out.keys).toHaveLength(0);
  });

  it('ORs the new bit onto the existing mask (keeps already-held colours)', () => {
    const out = collectKeys(pose, [{ x: 2, y: 2, color: 'red' }], 0b100);

    expect(out.heldKeys).toBe(0b101); // red (bit 0) added to yellow (bit 2)
  });

  it('leaves a distant keycard untouched, mask unchanged', () => {
    const keys: Keycard[] = [{ x: 9, y: 9, color: 'blue' }];
    const out = collectKeys(pose, keys, 0);

    expect(out.heldKeys).toBe(0);
    expect(out.keys).toEqual(keys);
  });
});
