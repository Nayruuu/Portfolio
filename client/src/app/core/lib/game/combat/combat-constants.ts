// core/lib/game/combat/combat-constants — pure combat tuning constants shared across the game shell + renderer.

/** Per-type reserve seed: each ammo type starts at min(AMMO_START, its max) — see `startingAmmo()` in weapons.ts. */
export const AMMO_START = 50;

/** Shared aim geometry the shell folds into each weapon's `WeaponCombat`: a melee swing's reach + wide
 *  cone, and the narrow cone a ranged weapon aims through. (Per-weapon damage / cooldown / reach for a
 *  ranged weapon all live in the JSON arsenal.) */
export const MELEE_RANGE = 1.4; // melee reach (cells)
export const MELEE_CONE = 0.5; // melee swing half-angle (radians)
export const AIM_CONE = 0.13; // ranged aim half-angle (radians)

/** Seconds a chain-lightning arc lives before the step drops it — shared with the renderer, which fades
 *  it across `age / ARC_DURATION`. Purely visual, but deterministic (no wall-clock) so it stays
 *  unit-testable + SSR-safe. */
export const ARC_DURATION = 0.35;

/** Hysteresis around an enemy's `standoff` distance: it holds within ±this of the standoff, and only
 *  advances (outside the far edge) or retreats (inside the near edge) — so grazing the standoff does not
 *  jitter it back and forth. */
export const STANDOFF_BAND = 0.25;

/** Minimum centre-to-centre distance kept between two living enemies — closer than this, `separateEnemies`
 *  pushes the overlapping pair apart so foes never stack into one billboard. */
export const ENEMY_SEP_DIST = 0.85;

/** A thrown enemy projectile within this distance of the camera counts as a hit on the player (the shot's
 *  landing radius). */
export const PLAYER_HIT_RADIUS = 0.45;

/** Cells a launched projectile flies before it despawns (a hitscan uses the weapon's own `range` instead). */
export const MAX_SHOT_RANGE = 40;

/** Cells a shot clears before its floor/ceiling collision counts — lets a steep shot off a raised platform
 *  clear its own lip instead of bursting at the shooter's feet (wider than a pedestal half-width). Shared by
 *  the hitscan resolution and the projectile stepper (the latter subtracts the distance already flown). */
export const MUZZLE_CLEAR = 1.5;

/** The barrel's SOLID half-width (its art fills only the middle 50% of the 0.8 billboard) — the collision
 *  radius a hitscan / projectile tests against, before any per-shot inflation. */
export const BARREL_HIT_RADIUS = 0.2;

/** Cells ahead of the camera a launched projectile spawns — close, so the shot reads as leaving the gun. */
export const PROJECTILE_SPAWN_AHEAD = 0.25;
