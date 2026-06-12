import { KEYCARD_COLORS } from './types';
import type { Keycard, Pose } from './types';

const PICKUP_RADIUS = 0.45; // cells — walk this close to collect (mirrors `collectPickups`)

/** Collect any keycards the player overlaps, OR-ing each collected colour's bit into `heldKeys` and
 *  dropping it from the floor. Returns the surviving keycards and the new bitmask. Pure — parallel to
 *  `collectPickups`. */
export function collectKeys(
  pose: Pose,
  keys: readonly Keycard[],
  heldKeys: number,
): { keys: Keycard[]; heldKeys: number } {
  let held = heldKeys;
  const remaining = keys.filter((key) => {
    if (Math.hypot(key.x - pose.x, key.y - pose.y) >= PICKUP_RADIUS) {
      return true; // out of reach — keep it
    }
    held |= 1 << KEYCARD_COLORS.indexOf(key.color);

    return false; // collected — drop it
  });

  return { keys: remaining, heldKeys: held };
}
