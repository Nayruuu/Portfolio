import { describe, expect, it } from 'vitest';
import { nextOwnedIndex, shouldAutoEquip } from './weapon-progression';

describe('nextOwnedIndex', () => {
  // owned flags for an 8-deep arsenal where only the fist (0), the shotgun (3) and the BFG (7) are owned
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
    expect(nextOwnedIndex(owned, 7, 1)).toBe(0); // forward off the end → back to the fist
    expect(nextOwnedIndex(owned, 0, -1)).toBe(7); // backward off the start → the BFG
  });

  it('scans past a run of unowned slots that spans the wrap', () => {
    const sparse = [false, true, false, false, false, false, false, false];

    expect(nextOwnedIndex(sparse, 1, 1)).toBe(1); // full loop lands back on the only owned slot
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
  it('auto-equips a FIRST pickup into a strictly better arsenal position (the DOOM upgrade moment)', () => {
    expect(shouldAutoEquip(false, 0, 2)).toBe(true); // fist → pistol
    expect(shouldAutoEquip(false, 0, 1)).toBe(true); // fist → chainsaw (slot-1 alt, still a step up the row)
    expect(shouldAutoEquip(false, 2, 3)).toBe(true); // pistol → shotgun
  });

  it('never auto-equips a repeat pickup (an ammo top-up, not an upgrade)', () => {
    expect(shouldAutoEquip(true, 0, 2)).toBe(false);
    expect(shouldAutoEquip(true, 2, 7)).toBe(false);
  });

  it('never downgrades: a pickup at or below the current position stays holstered', () => {
    expect(shouldAutoEquip(false, 3, 2)).toBe(false); // shotgun in hand, pistol found
    expect(shouldAutoEquip(false, 3, 3)).toBe(false); // same position (degenerate)
  });
});
