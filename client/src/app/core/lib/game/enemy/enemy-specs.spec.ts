import { describe, expect, it } from 'vitest';
import { ENEMY_SPECS, IMP_SPEC, LOSTSOUL_SPEC, PINKY_SPEC, SHOTGUNGUY_SPEC } from './enemy-specs';

// ENEMY_SPECS is pure data with zero branches: its 100% under the core guard is met only by evaluating the
// module. This spec pins the roster so dropping a spec reference from a level can never strand a const
// uncovered — it asserts the list references EVERY per-enemy const and that the walk-atlas key set is exact.
describe('ENEMY_SPECS roster', () => {
  it('references every per-enemy spec const, in authoring order', () => {
    expect(ENEMY_SPECS).toEqual([PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC]);
  });

  it('exposes the exact walk-atlas key set', () => {
    expect(ENEMY_SPECS.map((spec) => spec.texName)).toEqual([
      'PINKY_WALK',
      'SHOTGUNGUY_WALK',
      'IMP_WALK',
      'LOSTSOUL_WALK',
    ]);
  });

  it('splits the ranged kinds by their attack sub-spec (shotgunner vs thrower)', () => {
    expect(SHOTGUNGUY_SPEC.shotgun).toBeDefined();
    expect(SHOTGUNGUY_SPEC.thrower).toBeUndefined();
    expect(IMP_SPEC.thrower).toBeDefined();
    expect(IMP_SPEC.shotgun).toBeUndefined();
    expect(PINKY_SPEC.shotgun).toBeUndefined();
    expect(PINKY_SPEC.thrower).toBeUndefined();
    expect(LOSTSOUL_SPEC.shotgun).toBeUndefined();
    expect(LOSTSOUL_SPEC.thrower).toBeUndefined();
  });
});
