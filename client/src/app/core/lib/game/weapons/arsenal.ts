import type { WeaponCombat } from '../types';

/**
 * The pure MAGAZINE / fire-rate / reload subsystem for the active weapon — the shared core behind both
 * engines' combat (lifted out of the grid's `step` so the BSP engine reuses the exact logic, not a copy).
 *
 * It counts down the fire cooldown + reload clock, completes a finished reload (reserve → mag) and starts a
 * requested one, then DECIDES + spends a shot: the cooldown must be up, no reload in progress, and a magazine
 * weapon needs `ammoPerShot` loaded rounds (a flat-pool weapon spends one reserve round; melee is free). The
 * actual HIT — a hitscan ray, a shotgun spread, a launched projectile — is the caller's job, gated on `fired`,
 * because that part is engine-specific (it queries the level + enemies).
 */
export interface ArsenalState {
  readonly fireCooldown: number; // seconds until the next shot is allowed
  readonly mag: number; // rounds currently in the loaded magazine
  readonly reserve: number; // rounds in the active weapon's ammo-type pool
  readonly reloadClock: number; // seconds left on an in-progress reload (0 = not reloading)
}

/** Edge-triggered weapon input for one tick. */
export interface ArsenalIntent {
  readonly fire: boolean;
  readonly reload: boolean;
}

/** The stepped state plus whether a shot left the weapon this tick (→ the caller resolves the hit). */
export interface ArsenalStep extends ArsenalState {
  readonly fired: boolean;
}

export function stepArsenal(
  weapon: WeaponCombat,
  state: ArsenalState,
  intent: ArsenalIntent,
  dt: number,
): ArsenalStep {
  const wasReloading = state.reloadClock > 0;
  const reloadClock = Math.max(0, state.reloadClock - dt);
  let mag = state.mag;
  let reserve = state.reserve;

  // A reload that elapses THIS tick moves reserve → mag (capped by the empty mag space and the reserve).
  if (wasReloading && reloadClock <= 0) {
    const loaded = Math.min(weapon.magSize - mag, reserve);

    mag += loaded;
    reserve -= loaded;
  }

  let nextReload = reloadClock;

  // Start a reload: requested, not already reloading, a magazine weapon, mag not full, reserve available.
  if (
    intent.reload &&
    reloadClock <= 0 &&
    weapon.magSize > 0 &&
    mag < weapon.magSize &&
    reserve > 0
  ) {
    nextReload = weapon.reloadTime;
  }

  let fireCooldown = Math.max(0, state.fireCooldown - dt);
  let fired = false;

  // Fire: cooldown up, not mid-reload, and a magazine weapon has the rounds. Spend from mag (or one reserve
  // round for a flat-pool weapon; melee is free) and arm the cooldown — the HIT itself is resolved by the caller.
  if (
    intent.fire &&
    fireCooldown <= 0 &&
    nextReload <= 0 &&
    (weapon.magSize === 0 || mag >= weapon.ammoPerShot)
  ) {
    fired = true;
    fireCooldown = weapon.fireCooldown;
    if (weapon.magSize > 0) {
      mag -= weapon.ammoPerShot;
    } else if (weapon.costsAmmo) {
      reserve -= 1;
    }
  }

  return { fireCooldown, mag, reserve, reloadClock: nextReload, fired };
}
