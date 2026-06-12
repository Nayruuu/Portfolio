/** Deterministic seeded PRNG (mulberry32) — pure integer math, no `Math.random`/`Date`. Same seed →
 *  same sequence, so generated levels are reproducible + testable. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0; // mulberry32 fixed increment
    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in `[0, maxExclusive)`. */
export function randInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** A random member of `items`. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[randInt(rng, items.length)];
}
