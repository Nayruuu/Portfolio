// core/lib/game/weapon-progression — the pure OWNERSHIP rules of the DOOM weapon progression: the run
// starts fists-only and every other weapon is a level pickup, so switching must skip unowned slots and a
// pickup must decide whether it auto-equips. Indexes are ARSENAL positions (the 1..8 key row), matching
// the HUD arms grid — the fist ⇄ chainsaw slot-1 pair keeps distinct positions there on purpose.

/**
 * The next OWNED arsenal index cycling from `from` in `dir` (+1 = wheel down, −1 = wheel up), skipping
 * every unowned slot with wrap-around. When no OTHER slot is owned (the fists-only start) — or nothing is
 * owned at all (a degenerate guard) — the cycle stays put and returns `from`.
 */
export function nextOwnedIndex(owned: readonly boolean[], from: number, dir: number): number {
  const count = owned.length;

  if (count === 0) {
    return from;
  }
  const step = dir >= 0 ? 1 : -1;

  for (let hop = 1; hop <= count; hop++) {
    const index = (((from + step * hop) % count) + count) % count;

    if (owned[index]) {
      return index;
    }
  }

  return from;
}

/**
 * The auto-equip rule: a weapon pickup switches to the new weapon on its FIRST collection — ALWAYS,
 * whatever its arsenal position (vanilla DOOM's behaviour, and the user's explicit call: the new tool in
 * hand IS the reward). A repeat pickup is just an ammo top-up and never re-switches.
 */
export function shouldAutoEquip(alreadyOwned: boolean): boolean {
  return !alreadyOwned;
}
