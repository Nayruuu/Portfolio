import { describe, expect, it } from 'vitest';
import { nextOwnedIndex, shouldAutoEquip } from './weapon-progression';

describe('nextOwnedIndex', () => {
  const owned = [true, false, false, true, false, false, false, true];

  it('cycles forward to the next owned index, skipping unowned slots', () => {
    expect(nextOwnedIndex(owned, 0, 1)).toBe(3);
    expect(nextOwnedIndex(owned, 3, 1)).toBe(7);
  });

  it('cycles backward to the previous owned index, skipping unowned slots', () => {
    expect(nextOwnedIndex(owned, 3, -1)).toBe(0);
    expect(nextOwnedIndex(owned, 7, -1)).toBe(3);
  });

  it('wraps around both ends', () => {
    expect(nextOwnedIndex(owned, 7, 1)).toBe(0);
    expect(nextOwnedIndex(owned, 0, -1)).toBe(7);
  });

  it('scans past a run of unowned slots that spans the wrap', () => {
    const sparse = [false, true, false, false, false, false, false, false];

    expect(nextOwnedIndex(sparse, 1, 1)).toBe(1);
    expect(nextOwnedIndex(sparse, 1, -1)).toBe(1);
  });

  it('returns the current index when it is the only owned slot (fists-only start)', () => {
    const fistsOnly = [true, false, false, false, false, false, false, false];

    expect(nextOwnedIndex(fistsOnly, 0, 1)).toBe(0);
    expect(nextOwnedIndex(fistsOnly, 0, -1)).toBe(0);
  });

  it('returns the current index when nothing is owned or the list is empty (degenerate guards)', () => {
    expect(nextOwnedIndex([false, false, false], 1, 1)).toBe(1);
    expect(nextOwnedIndex([], 0, 1)).toBe(0);
  });
});

describe('shouldAutoEquip', () => {
  it('ALWAYS auto-equips a first pickup — the new tool in hand is the reward, whatever its slot', () => {
    expect(shouldAutoEquip(false)).toBe(true);
  });

  it('never auto-equips a repeat pickup (an ammo top-up, not an upgrade)', () => {
    expect(shouldAutoEquip(true)).toBe(false);
  });
});
