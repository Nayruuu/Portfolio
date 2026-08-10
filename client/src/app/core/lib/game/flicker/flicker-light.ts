// A dying/buzzing fluorescent tube: the light holds near its authored level, then drops out for a single
// short tick before catching again. DETERMINISTIC on purpose — a hashed time bucket, never Math.random /
// Date.now — so replays reproduce and the one per-frame value reaches every backend (CPU/worker/GPU) identical.

const FLICKER_TICK_MS = 70; // resample cadence — ~14 Hz, a nervous buzz rather than a smooth wave
const FLICKER_DIP_CHANCE = 0.14; // fraction of ticks that drop out (a failing tube, not a strobe)

// Integer hash → [0, 1). Two `imul` rounds mix the bits enough that adjacent ticks (and seeds) decorrelate.
function hashUnit(n: number): number {
  let h = n | 0;

  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The modulated 0..255 light for `timeMs`. `seed` desynchronises tubes that share the mains clock. */
export function flickerLight(baseLight: number, timeMs: number, seed: number): number {
  const tick = Math.floor(timeMs / FLICKER_TICK_MS) + seed * 0x9e37; // per-seed phase offset
  const jitter = hashUnit(tick * 2 + 1);
  const mult =
    hashUnit(tick) < FLICKER_DIP_CHANCE
      ? 0.3 + jitter * 0.25 // sharp dip: 0.30 .. 0.55×
      : 0.82 + jitter * 0.18; // near base: 0.82 .. 1.00×

  return Math.max(0, Math.min(255, Math.round(baseLight * mult)));
}
