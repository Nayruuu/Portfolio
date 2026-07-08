import { describe, expect, it } from 'vitest';

import { WEAPON_IDS, type WeaponId } from './weapon-id';

describe('WEAPON_IDS', () => {
  it('lists every weapon id in registry (arsenal) order', () => {
    expect(WEAPON_IDS).toEqual([
      'fist',
      'chainsaw',
      'pistol',
      'shotgun',
      'chaingun',
      'rocket',
      'plasma',
      'bfg',
    ]);
  });

  it('derives the WeaponId union from the tuple', () => {
    const id: WeaponId = 'fist';

    expect(WEAPON_IDS).toContain(id);
  });
});
