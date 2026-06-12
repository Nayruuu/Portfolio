import type { AmmoPickup, Pose } from './types';

const PICKUP_RADIUS = 0.45; // cells — walk this close to collect (mirrors `collectPickups`)

/** Age + collect the rotating ammo boxes. Every survivor's `age` advances by `dt` (its spin clock); a box
 *  the player overlaps refills its OWN ammo type's reserve — `min(max, reserve + amount)` — and is dropped,
 *  UNLESS that reserve is already at `max`, in which case the box is KEPT (a full type never wastes a pickup).
 *  `amount`/`max` ride on the entity (descriptor-sourced), so the same step serves every ammo type. Pure +
 *  immutable: returns the surviving boxes and a NEW per-type reserve record. */
export function stepAmmoPickups(
  pose: Pose,
  ammoPickups: readonly AmmoPickup[],
  playerAmmo: Readonly<Record<string, number>>,
  dt: number,
): { ammoPickups: AmmoPickup[]; playerAmmo: Readonly<Record<string, number>> } {
  let nextAmmo = playerAmmo;
  const remaining: AmmoPickup[] = [];

  for (const pickup of ammoPickups) {
    const aged: AmmoPickup = { ...pickup, age: pickup.age + dt };
    const reserve = nextAmmo[pickup.ammoType] ?? 0;

    if (
      Math.hypot(pickup.x - pose.x, pickup.y - pose.y) >= PICKUP_RADIUS ||
      reserve >= pickup.max
    ) {
      remaining.push(aged); // out of reach, or the type is already full → keep the box
      continue;
    }
    nextAmmo = { ...nextAmmo, [pickup.ammoType]: Math.min(pickup.max, reserve + pickup.amount) };
    // collected — drop the box (not pushed)
  }

  return { ammoPickups: remaining, playerAmmo: nextAmmo };
}
