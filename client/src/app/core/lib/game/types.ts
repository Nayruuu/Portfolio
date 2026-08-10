export interface ChainSpec {
  targets: number; // max hops BEYOND the directly-hit enemy
  range: number;
  falloff: number; // damage multiplier per hop (hop 1 = first jump → falloff^1)
}

export interface ProjectileSpec {
  speed: number;
  splashDamage: number;
  splashRadius: number;
  selfDamage: boolean;
  chain: ChainSpec | null; // null = AOE-only (rocket); non-null = plasma chains between enemies
  kind: string;
}

export interface WeaponCombat {
  damage: number;
  range: number;
  cone: number;
  fireCooldown: number;
  knockback: number;
  costsAmmo: boolean;
  ammoType: string | null; // non-null whenever costsAmmo or magSize > 0
  ammoPerShot: number; // 1 except the BFG, which spends its whole 40-round mag at once
  magSize: number; // 0 = no magazine (melee + flat-pool)
  reloadTime: number;
  pellets: number; // 1 = single hitscan; > 1 = shotgun spread fanned across cone
  selfKnockback: number;
  projectile: ProjectileSpec | null; // null = hitscan/melee; non-null = launch projectile + AOE blast
  impactKind: string;
}

// Bit order (red = bit 0, blue = bit 1, yellow = bit 2) — held-badge bitmasks + door lookups key off the index.
export const KEYCARD_COLORS = ['red', 'blue', 'yellow'] as const;

export type KeycardColor = (typeof KEYCARD_COLORS)[number];
