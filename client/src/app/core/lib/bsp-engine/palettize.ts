import type { Texture } from './texture';

// RGBA → palettized-Texture intake. ENGINE-WIDE INVARIANT (every producer funnels through here or
// through parseVox, which enforces the same): index 0 is the ONLY transparent entry — every alpha-0
// source pixel maps to 0 and palette[0] is (0,0,0,0) — so `index !== 0` IS the per-texel alpha /
// occupancy test on every sampling path. Sources with ≤255 opaque colours palettize EXACTLY
// (bit-identical render output); richer sources (lossy WebP, baked AO) quantize by median cut.

export const PALETTE_SIZE = 256; // entries — fixed, so the SAB pack and the GPU buffer stride by it
export const PALETTE_BYTES = PALETTE_SIZE * 4;
const MAX_OPAQUE = PALETTE_SIZE - 1; // slot 0 is reserved for transparent
// The renderer's stamped-vs-clear glass threshold (blendGlass / the WGSL twin / voxel-carve's
// SOLID_ALPHA): a HARD semantic boundary quantization must never average a colour across.
const ALPHA_CLASS = 128;

interface WeightedColor {
  readonly key: number; // packed (a<<24)|(b<<16)|(g<<8)|r — the dedup identity AND the sort tiebreak
  readonly count: number;
}

// A median-cut box caches its own widest channel so only the two halves of a split are re-scanned.
interface Box {
  items: WeightedColor[];
  channel: number;
  range: number;
}

function channelOf(key: number, channel: number): number {
  return (key >>> (channel * 8)) & 0xff;
}

function widest(items: readonly WeightedColor[]): { channel: number; range: number } {
  let widestChannel = 0;
  let range = 0;

  for (let channel = 0; channel < 4; channel++) {
    let lo = 255;
    let hi = 0;

    for (const item of items) {
      const v = channelOf(item.key, channel);

      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (hi - lo > range) {
      range = hi - lo;
      widestChannel = channel;
    }
  }

  return { channel: widestChannel, range };
}

// Weighted mean of a box, rounded per channel — the palette entry its colours collapse to.
function boxEntry(items: readonly WeightedColor[]): readonly [number, number, number, number] {
  let total = 0;
  const sums = [0, 0, 0, 0];

  for (const item of items) {
    total += item.count;
    for (let c = 0; c < 4; c++) {
      sums[c] += channelOf(item.key, c) * item.count;
    }
  }

  return [
    Math.round(sums[0] / total),
    Math.round(sums[1] / total),
    Math.round(sums[2] / total),
    Math.round(sums[3] / total),
  ];
}

// Splits boxes until MAX_OPAQUE palette slots exist (or nothing is splittable), always cutting the box
// with the widest channel range at its weighted median. Deterministic: ties resolve to the earliest box,
// and item order inside a sort ties-break on the packed key.
function medianCut(uniques: ReadonlyMap<number, number>): Box[] {
  // One seed box per ALPHA CLASS: a box only ever averages within its own side of the glass
  // threshold, so no texel can flip stamped ⇄ clear under quantization.
  const translucent: WeightedColor[] = [];
  const stamped: WeightedColor[] = [];

  for (const [key, count] of uniques) {
    (channelOf(key, 3) < ALPHA_CLASS ? translucent : stamped).push({ key, count });
  }
  const boxes: Box[] = [translucent, stamped]
    .filter((items) => items.length > 0)
    .map((items) => ({ items, ...widest(items) }));

  // A splittable box always exists in this loop: >MAX_OPAQUE uniques over <MAX_OPAQUE boxes puts ≥2
  // DISTINCT keys in some box, and two distinct keys differ in at least one channel — range > 0.
  while (boxes.length < MAX_OPAQUE) {
    let pick = 0;
    let range = 0;

    boxes.forEach((box, i) => {
      if (box.range > range) {
        range = box.range;
        pick = i;
      }
    });
    const box = boxes[pick];
    const c = box.channel;

    box.items.sort((a, b) => channelOf(a.key, c) - channelOf(b.key, c) || a.key - b.key);
    const total = box.items.reduce((sum, item) => sum + item.count, 0);
    let cut = 0;
    let below = 0;

    // First index where the cumulative weight reaches half — clamped so both halves stay non-empty.
    while (cut < box.items.length - 1 && below + box.items[cut].count < total / 2) {
      below += box.items[cut].count;
      cut++;
    }
    cut = Math.max(1, cut);
    const left = box.items.slice(0, cut);
    const right = box.items.slice(cut);

    boxes[pick] = { items: left, ...widest(left) };
    boxes.push({ items: right, ...widest(right) });
  }

  return boxes;
}

export interface PalettizeMeta {
  readonly worldSize?: number;
  readonly voxelDepth?: number;
}

/** Palettize an RGBA buffer into the engine's 1-byte-index Texture. Exact (first-appearance slot order)
 *  when the source has ≤255 opaque colours; median-cut quantized above that. Alpha-0 pixels map to
 *  index 0 whatever their RGB; quantization may merge nearby alphas but NEVER across the glass
 *  threshold (128) — a stamped texel stays stamped, a clear one stays clear. */
export function palettizeRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  meta: PalettizeMeta = {},
): Texture {
  if (rgba.length !== width * height * 4) {
    throw new Error('palettize: rgba length does not match width×height×4');
  }
  const uniques = new Map<number, number>(); // insertion order = first appearance → deterministic slots

  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) {
      continue;
    }
    const key = (rgba[i + 3] << 24) | (rgba[i + 2] << 16) | (rgba[i + 1] << 8) | rgba[i];

    uniques.set(key, (uniques.get(key) ?? 0) + 1);
  }
  const palette = new Uint8ClampedArray(PALETTE_BYTES); // [0] stays (0,0,0,0) — the transparent slot
  const slotOf = new Map<number, number>();

  if (uniques.size <= MAX_OPAQUE) {
    let slot = 1;

    for (const key of uniques.keys()) {
      slotOf.set(key, slot);
      for (let c = 0; c < 4; c++) {
        palette[slot * 4 + c] = channelOf(key, c);
      }
      slot++;
    }
  } else {
    medianCut(uniques).forEach((box, i) => {
      const entry = boxEntry(box.items);

      for (let c = 0; c < 4; c++) {
        palette[(i + 1) * 4 + c] = entry[c];
      }
      for (const item of box.items) {
        slotOf.set(item.key, i + 1);
      }
    });
  }
  const pixels = new Uint8ClampedArray(width * height);

  for (let i = 0; i < pixels.length; i++) {
    const p = i * 4;

    if (rgba[p + 3] === 0) {
      continue; // stays index 0
    }
    pixels[i] = slotOf.get(
      (rgba[p + 3] << 24) | (rgba[p + 2] << 16) | (rgba[p + 1] << 8) | rgba[p],
    ) as number;
  }

  return { width, height, pixels, palette, ...meta };
}

/** RGBA reconstruction of a palettized texture — the intake-side working form (AO bakes on it) and the
 *  test-side content assertion. */
export function expandRgba(tex: Texture): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tex.width * tex.height * 4);

  for (let i = 0; i < tex.pixels.length; i++) {
    const p = tex.pixels[i] * 4;
    const o = i * 4;

    out[o] = tex.palette[p];
    out[o + 1] = tex.palette[p + 1];
    out[o + 2] = tex.palette[p + 2];
    out[o + 3] = tex.palette[p + 3];
  }

  return out;
}
