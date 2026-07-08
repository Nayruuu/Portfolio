/** Every weapon id the registry declares, in registry (arsenal) order — the DOOM-archetype value set the
 *  level placements + ownership progression key off (no enum; `WEAPONS` is checked against it, so
 *  the union and the JSON can never drift silently). */
export const WEAPON_IDS = [
  'fist',
  'chainsaw',
  'pistol',
  'shotgun',
  'chaingun',
  'rocket',
  'plasma',
  'bfg',
] as const;

/** One weapon id (derived from the tuple — no enum). */
export type WeaponId = (typeof WEAPON_IDS)[number];
