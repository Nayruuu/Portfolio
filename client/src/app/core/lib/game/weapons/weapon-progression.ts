// Indexes are ARSENAL positions (the 1..8 key row) — the fist ⇄ chainsaw slot-1 pair keeps distinct
// positions on purpose.

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

export function shouldAutoEquip(alreadyOwned: boolean): boolean {
  return !alreadyOwned;
}
