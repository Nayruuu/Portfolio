import type { Pickup, Pose } from './types';

const PICKUP_RADIUS = 0.45; // cells — walk this close to collect
const HEALTH_PICKUP = 25;
const ARMOR_PICKUP = 50;
const VITAL_MAX = 100;

/** Collect any VITALS pickups the player overlaps (health +25 / armor +50, each capped at 100), returning
 *  the surviving pickups and the new hp/armor. Ammo is its own descriptor-driven path (`stepAmmoPickups`). */
export function collectPickups(
  pose: Pose,
  pickups: readonly Pickup[],
  hp: number,
  armor: number,
): { pickups: Pickup[]; hp: number; armor: number } {
  let nextHp = hp;
  let nextArmor = armor;
  const remaining = pickups.filter((pickup) => {
    if (Math.hypot(pickup.x - pose.x, pickup.y - pose.y) >= PICKUP_RADIUS) {
      return true; // out of reach — keep it
    }
    if (pickup.kind === 'health') {
      nextHp = Math.min(VITAL_MAX, nextHp + HEALTH_PICKUP);
    } else {
      nextArmor = Math.min(VITAL_MAX, nextArmor + ARMOR_PICKUP);
    }

    return false; // collected — drop it
  });

  return { pickups: remaining, hp: nextHp, armor: nextArmor };
}
