import type { WeaponCombat } from '../types';

export interface ArsenalState {
  readonly fireCooldown: number;
  readonly mag: number;
  readonly reserve: number;
  readonly reloadClock: number; // 0 = not reloading
}

export interface ArsenalIntent {
  readonly fire: boolean;
  readonly reload: boolean;
}

export interface ArsenalStep extends ArsenalState {
  readonly fired: boolean; // a shot left the weapon this tick — the caller resolves the HIT
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

  if (wasReloading && reloadClock <= 0) {
    const loaded = Math.min(weapon.magSize - mag, reserve);

    mag += loaded;
    reserve -= loaded;
  }

  let nextReload = reloadClock;

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

  // magSize === 0 = flat-pool weapon (spends one reserve round) or melee (free)
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
