import { describe, expect, it } from 'vitest';
import { ZoneStates, zoneStates, type ZoneSnapshot } from './zone-state';

/** A representative snapshot: a moved+hurt enemy, a corpse, a popped barrel, taken pickups, an open door. */
function sample(): ZoneSnapshot {
  return {
    enemies: [
      { x: 12.5, y: 48, hp: 20, dead: false },
      { x: 33, y: 102, hp: 0, dead: true },
    ],
    barrels: [true, false, true],
    vitalsTaken: [true, false],
    ammoTaken: [false, false, true, false, false, false],
    cardsTaken: [true],
    doors: [1, 0.4],
  };
}

describe('ZoneStates', () => {
  it('round-trips a snapshot by zone key', () => {
    const store = new ZoneStates();

    store.snapshot('m1', sample());
    expect(store.restore('m1')).toEqual(sample());
  });

  it('returns null for a zone that was never snapshotted', () => {
    expect(new ZoneStates().restore('hangar')).toBeNull();
  });

  it('replaces the previous snapshot of the same zone', () => {
    const store = new ZoneStates();

    store.snapshot('m1', sample());
    store.snapshot('m1', { ...sample(), barrels: [false, false, false] });
    expect(store.restore('m1')?.barrels).toEqual([false, false, false]);
  });

  it('keeps zones independent', () => {
    const store = new ZoneStates();

    store.snapshot('m1', sample());
    store.snapshot('hangar', { ...sample(), doors: [0] });
    expect(store.restore('m1')?.doors).toEqual([1, 0.4]);
    expect(store.restore('hangar')?.doors).toEqual([0]);
  });

  it('reset forgets every zone (a new game)', () => {
    const store = new ZoneStates();

    store.snapshot('m1', sample());
    store.snapshot('hangar', sample());
    store.reset();
    expect(store.restore('m1')).toBeNull();
    expect(store.restore('hangar')).toBeNull();
  });

  it('stores a deep copy — mutating the input after snapshot never leaks in', () => {
    const store = new ZoneStates();
    const input = {
      enemies: [{ x: 1, y: 2, hp: 30, dead: false }],
      barrels: [true],
      vitalsTaken: [false],
      ammoTaken: [false],
      cardsTaken: [false],
      doors: [0],
    };

    store.snapshot('m1', input);
    (input.enemies[0] as { x: number }).x = 99;
    input.barrels[0] = false;
    input.doors[0] = 1;
    expect(store.restore('m1')).toEqual({
      enemies: [{ x: 1, y: 2, hp: 30, dead: false }],
      barrels: [true],
      vitalsTaken: [false],
      ammoTaken: [false],
      cardsTaken: [false],
      doors: [0],
    });
  });

  it('freezes the stored snapshot (deeply) so it cannot be mutated after restore', () => {
    const store = new ZoneStates();

    store.snapshot('m1', sample());
    const restored = store.restore('m1');

    expect(restored).not.toBeNull();
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.enemies)).toBe(true);
    expect(Object.isFrozen(restored?.enemies[0])).toBe(true);
    expect(Object.isFrozen(restored?.barrels)).toBe(true);
    expect(Object.isFrozen(restored?.doors)).toBe(true);
  });

  it('exposes the module-scoped building singleton', () => {
    expect(zoneStates).toBeInstanceOf(ZoneStates);
  });
});
