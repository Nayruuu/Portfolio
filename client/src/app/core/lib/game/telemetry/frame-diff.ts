export interface FrameDiff {
  readonly pixelCount: number;
  readonly maxChannelDiff: number; // max |Δ| over the R/G/B channels, 0…255
  readonly mismatchCount: number; // pixels where any RGB channel exceeds the tolerance
}

// The GPU walks the columns in f32; the CPU renderer mixes i32/f64. Identical geometry still lands a channel
// or two apart from rounding, so backend parity is "within tolerance", never bit-exact.
export const RENDER_PARITY_TOLERANCE = 2;

/**
 * Per-pixel RGB agreement between two equal-size RGBA byte framebuffers. Alpha is skipped — both backends
 * write opaque frames and alpha carries no visible signal. Throws on a length mismatch: that is a caller bug
 * (mismatched resolutions), not a soft image difference to fold into the score.
 */
export function diffFrames(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  tolerance: number,
): FrameDiff {
  if (a.length !== b.length) {
    throw new RangeError(`frame length mismatch: ${a.length} vs ${b.length}`);
  }

  let maxChannelDiff = 0;
  let mismatchCount = 0;

  for (let i = 0; i < a.length; i += 4) {
    let exceeds = false;

    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);

      if (d > maxChannelDiff) {
        maxChannelDiff = d;
      }
      if (d > tolerance) {
        exceeds = true;
      }
    }
    if (exceeds) {
      mismatchCount++;
    }
  }

  return { pixelCount: a.length >> 2, maxChannelDiff, mismatchCount };
}
