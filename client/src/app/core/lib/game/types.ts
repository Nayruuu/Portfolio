// core/lib/game/types — the pure combat types the BSP game reuses (zero DOM, fully type-only bar the
// keycard tuple). The old raycaster engine's geometry / entity types were removed with that engine.

/** The chain-lightning rider on a projectile spec (the plasma cable): on impact the projectile hops
 *  between nearby enemies, each hop dealing `falloff^hop` of the base damage and drawing a visual arc.
 *  `null` on a spec marks an AOE-only projectile (the rocket); the plasma sets it AND zeroes the splash,
 *  so the chain wholly replaces the splash. */
export interface ChainSpec {
  targets: number; // maximum hops beyond the directly-hit enemy
  range: number; // cells a hop reaches from the last-hit enemy
  falloff: number; // damage multiplier per hop (hop 1 = the first jump → `falloff^1`)
}

/** The blast a projectile weapon spawns instead of a hitscan ray — the splash half of a rocket / AOE
 *  weapon. `null` on a `WeaponCombat` marks the existing hitscan/melee path; non-null makes the fire step
 *  launch a travelling projectile that detonates this spec on impact. (The direct-hit damage is
 *  `WeaponCombat.damage`; the blast knockback is `WeaponCombat.knockback` — both stay on the weapon.) */
export interface ProjectileSpec {
  speed: number; // cells/second the launched projectile travels
  splashDamage: number; // base blast damage, scaled by distance falloff over `splashRadius`
  splashRadius: number; // cells the blast reaches
  selfDamage: boolean; // whether the blast can hurt + rocket-jump the firing player
  chain: ChainSpec | null; // null = AOE-only (the rocket); non-null = the plasma chains between enemies on impact
  kind: string; // the projectile sprite name (a `projectiles` key in effects.json) the renderer billboards
}

/** A weapon reduced to the numbers the pure combat step needs — the shell derives one from the JSON
 *  arsenal (per-weapon `range`/`cone`/`fireCooldown`/`knockback`) so adding a weapon never touches core. */
export interface WeaponCombat {
  damage: number; // hp removed per landed hit (a projectile weapon's DIRECT-hit damage)
  range: number; // reach in cells
  cone: number; // aim half-angle, radians (wide for a melee swing, narrow for a ranged shot)
  fireCooldown: number; // seconds between hits
  knockback: number; // cells the hit enemy is shoved straight back (wall-clamped); also the blast shove for a projectile weapon
  costsAmmo: boolean; // whether a hit decrements `playerAmmo` (false for an ammo-less melee weapon)
  ammoType: string | null; // which `playerAmmo` reserve a reload / flat-pool shot draws from (null = ammo-less melee); non-null whenever `costsAmmo` or `magSize > 0`
  ammoPerShot: number; // rounds a single shot drains from the magazine (1 for every weapon but the BFG, which spends its whole 40-round mag at once)
  magSize: number; // rounds the active magazine holds (0 = no magazine — melee + any flat-pool weapon)
  reloadTime: number; // seconds a full reload takes (0 when the weapon has no magazine)
  pellets: number; // rays fired per shot: 1 = a single hitscan (the unchanged path); > 1 = a shotgun spread, fanned across `cone`, each ray landing on the nearest enemy it crosses
  selfKnockback: number; // cells the player recoils straight back on firing (the CO2 blast's self-recoil); 0 = none
  projectile: ProjectileSpec | null; // null = a hitscan / melee weapon (the existing path); non-null = launch a travelling projectile + AOE blast instead of a hitscan ray
  impactKind: string; // the hit-effect name (an `impacts` key in effects.json) the renderer plays at every hit (projectile detonation, hitscan, or melee)
}

/** The three keycard colours, in bit order (red = bit 0, blue = bit 1, yellow = bit 2). Consumers key
 *  their held-badge bitmask + door-colour lookups off this tuple's index. */
export const KEYCARD_COLORS = ['red', 'blue', 'yellow'] as const;

/** One keycard colour (derived from the tuple — no enum). */
export type KeycardColor = (typeof KEYCARD_COLORS)[number];
