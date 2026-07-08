import { describe, it, expect } from 'vitest';
import { stepArsenal, type ArsenalState } from './arsenal';
import type { WeaponCombat } from '../types';

const COMBAT: WeaponCombat = {
  damage: 10,
  range: 8,
  cone: 0.1,
  fireCooldown: 0.5,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'bullet',
  ammoPerShot: 1,
  magSize: 10,
  reloadTime: 1.5,
  pellets: 1,
  selfKnockback: 0,
  projectile: null,
  impactKind: 'hit',
};
const weapon = (over: Partial<WeaponCombat>): WeaponCombat => ({ ...COMBAT, ...over });
const state = (over: Partial<ArsenalState>): ArsenalState => ({
  fireCooldown: 0,
  mag: 10,
  reserve: 50,
  reloadClock: 0,
  ...over,
});
const NO_INPUT = { fire: false, reload: false };

describe('stepArsenal', () => {
  it('counts the fire cooldown down by dt, clamped at 0', () => {
    expect(
      stepArsenal(COMBAT, state({ fireCooldown: 0.3 }), NO_INPUT, 0.1).fireCooldown,
    ).toBeCloseTo(0.2);
    expect(stepArsenal(COMBAT, state({ fireCooldown: 0.05 }), NO_INPUT, 0.1).fireCooldown).toBe(0);
  });

  it('fires a magazine weapon — spends ammoPerShot, arms the cooldown, reports fired', () => {
    const r = stepArsenal(
      weapon({ ammoPerShot: 2 }),
      state({ mag: 10 }),
      { fire: true, reload: false },
      0.016,
    );

    expect(r.fired).toBe(true);
    expect(r.mag).toBe(8);
    expect(r.fireCooldown).toBeCloseTo(0.5);
  });

  it('spends one reserve round for a flat-pool weapon (magSize 0, costsAmmo)', () => {
    const r = stepArsenal(
      weapon({ magSize: 0 }),
      state({ reserve: 50 }),
      { fire: true, reload: false },
      0.016,
    );

    expect(r.fired).toBe(true);
    expect(r.reserve).toBe(49);
  });

  it('fires a free melee weapon (magSize 0, no ammo cost) without spending', () => {
    const r = stepArsenal(
      weapon({ magSize: 0, costsAmmo: false }),
      state({ reserve: 0 }),
      { fire: true, reload: false },
      0.016,
    );

    expect(r.fired).toBe(true);
    expect(r.reserve).toBe(0);
  });

  it('blocks fire on cooldown, mid-reload, or an empty magazine', () => {
    expect(
      stepArsenal(COMBAT, state({ fireCooldown: 0.4 }), { fire: true, reload: false }, 0.016).fired,
    ).toBe(false);
    expect(
      stepArsenal(COMBAT, state({ reloadClock: 0.4 }), { fire: true, reload: false }, 0.05).fired,
    ).toBe(false);
    expect(
      stepArsenal(
        weapon({ ammoPerShot: 2 }),
        state({ mag: 1 }),
        { fire: true, reload: false },
        0.016,
      ).fired,
    ).toBe(false);
  });

  it('starts a reload (mag not full + reserve available) and completes it (reserve → mag)', () => {
    const started = stepArsenal(
      COMBAT,
      state({ mag: 3, reserve: 50 }),
      { fire: false, reload: true },
      0.016,
    );

    expect(started.reloadClock).toBeCloseTo(1.5);

    const done = stepArsenal(
      COMBAT,
      state({ mag: 3, reserve: 50, reloadClock: 0.01 }),
      NO_INPUT,
      0.1,
    );

    expect(done.reloadClock).toBe(0);
    expect(done.mag).toBe(10); // refilled to magSize
    expect(done.reserve).toBe(43); // 50 − 7 loaded
  });

  it('ignores a reload request when full, out of reserve, mid-reload, or for a magazine-less weapon', () => {
    expect(
      stepArsenal(COMBAT, state({ mag: 10 }), { fire: false, reload: true }, 0.016).reloadClock,
    ).toBe(0);
    expect(
      stepArsenal(COMBAT, state({ mag: 3, reserve: 0 }), { fire: false, reload: true }, 0.016)
        .reloadClock,
    ).toBe(0);
    expect(
      stepArsenal(COMBAT, state({ mag: 3, reloadClock: 1 }), { fire: false, reload: true }, 0.016)
        .reloadClock,
    ).toBeCloseTo(0.984); // already reloading → the request does not restart it
    expect(
      stepArsenal(weapon({ magSize: 0 }), state({ mag: 0 }), { fire: false, reload: true }, 0.016)
        .reloadClock,
    ).toBe(0);
  });
});
