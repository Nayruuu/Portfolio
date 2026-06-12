/** Green armor absorbs 1/3 of incoming damage (DOOM rule). */
const ARMOR_ABSORB_DIVISOR = 3;

/** Apply `amount` damage: armor eats `floor(amount/3)` of it (capped at what's left), the rest hits hp.
 *  No low hp clamp — `hp <= 0` is the death signal the shell reads. Healing/caps live in `pickup.ts`. */
export function applyDamage(
  hp: number,
  armor: number,
  amount: number,
): { hp: number; armor: number } {
  const absorbed = Math.min(armor, Math.floor(amount / ARMOR_ABSORB_DIVISOR));

  return { hp: hp - (amount - absorbed), armor: armor - absorbed };
}
