import { describe, expect, it } from 'vitest';
import { diffFrames, RENDER_PARITY_TOLERANCE } from './frame-diff';

// one RGBA pixel
const px = (r: number, g: number, b: number, a = 255): number[] => [r, g, b, a];
const buf = (...pixels: number[][]): Uint8ClampedArray => new Uint8ClampedArray(pixels.flat());

describe('diffFrames', () => {
  it('reports zero difference for identical frames', () => {
    const a = buf(px(10, 20, 30), px(200, 100, 50));

    expect(diffFrames(a, buf(px(10, 20, 30), px(200, 100, 50)), 2)).toEqual({
      pixelCount: 2,
      maxChannelDiff: 0,
      mismatchCount: 0,
    });
  });

  it('tracks the max channel delta without counting a mismatch inside the tolerance', () => {
    const a = buf(px(100, 100, 100));
    const b = buf(px(102, 99, 100)); // Δ = 2, 1, 0 — all ≤ tolerance 2

    expect(diffFrames(a, b, 2)).toEqual({ pixelCount: 1, maxChannelDiff: 2, mismatchCount: 0 });
  });

  it('counts a pixel as a mismatch when any RGB channel exceeds the tolerance', () => {
    const a = buf(px(0, 0, 0), px(50, 50, 50));
    const b = buf(px(0, 0, 5), px(50, 50, 50)); // pixel 0: blue Δ = 5 > 2

    expect(diffFrames(a, b, 2)).toEqual({ pixelCount: 2, maxChannelDiff: 5, mismatchCount: 1 });
  });

  it('ignores the alpha channel', () => {
    const a = buf(px(10, 10, 10, 255));
    const b = buf(px(10, 10, 10, 0)); // only alpha differs

    expect(diffFrames(a, b, 0)).toEqual({ pixelCount: 1, maxChannelDiff: 0, mismatchCount: 0 });
  });

  it('throws on a length (resolution) mismatch rather than scoring it', () => {
    expect(() => diffFrames(buf(px(0, 0, 0)), buf(px(0, 0, 0), px(1, 1, 1)), 2)).toThrow(
      RangeError,
    );
  });

  it('exposes a small non-zero default tolerance for GPU↔CPU f32 rounding', () => {
    expect(RENDER_PARITY_TOLERANCE).toBeGreaterThan(0);
  });
});
