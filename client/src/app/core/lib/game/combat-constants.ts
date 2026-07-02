// core/lib/game/combat-constants — pure combat tuning constants shared across the game shell + renderer.

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
