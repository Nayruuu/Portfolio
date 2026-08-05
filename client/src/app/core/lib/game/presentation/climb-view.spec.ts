import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClimbView } from './climb-view';
import { CLIMB_FRAME_URLS } from './climb-frames';

// The frames' native cell (469×519) — the view must DERIVE its draw width from the loaded image's aspect,
// so the exact numbers only need to stay internally consistent.
const CELL_W = 469;
const CELL_H = 519;
const SCREEN_W = 800;
const SCREEN_H = 600;

/** A loadable `Image` stand-in (jsdom never fetches) — mirrors the WeaponView / DoomHud spec fakes. */
class FakeImage {
  public static readonly instances: FakeImage[] = [];
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public complete = false;
  public naturalWidth = 0;
  public naturalHeight = 0;
  public src = '';

  constructor() {
    FakeImage.instances.push(this);
  }
}

function fakeContext() {
  return { imageSmoothingEnabled: true, drawImage: vi.fn() };
}

/** Mark a `FakeImage` decoded at the native cell resolution and fire its `onload`. */
function decode(img: FakeImage): void {
  img.complete = true;
  img.naturalWidth = CELL_W;
  img.naturalHeight = CELL_H;
  img.onload?.();
}

/** The `FakeImage` whose `src` contains `part` (or undefined if none was created yet). */
function imageBySrc(part: string): FakeImage | undefined {
  return FakeImage.instances.find((instance) => instance.src.includes(part));
}

describe('ClimbView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeImage.instances.length = 0;
  });

  const LEDGE_Y = 240; // a representative ledge-top screen-Y the renderer would feed in
  const GRIP_FRAC_FROM_TOP = 0.14; // keep in sync with climb-view.ts

  it('is SSR-safe: with no Image it draws nothing and never throws', () => {
    vi.stubGlobal('Image', undefined);
    const view = new ClimbView();
    const ctx = fakeContext();

    expect(() =>
      view.draw(ctx as unknown as CanvasRenderingContext2D, SCREEN_W, SCREEN_H, 0.5, LEDGE_Y),
    ).not.toThrow();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('preloads every frame up front (so the first vault never shows a blank)', () => {
    vi.stubGlobal('Image', FakeImage);
    const view = new ClimbView();

    view.preload();

    for (const url of CLIMB_FRAME_URLS) {
      expect(imageBySrc(url)).toBeDefined(); // a load was kicked off for each frame
    }
  });

  it('draws nothing until the frame decodes, then blits it centred with the grip on the ledge edge', () => {
    vi.stubGlobal('Image', FakeImage);
    const view = new ClimbView();
    const ctx = fakeContext();

    view.draw(ctx as unknown as CanvasRenderingContext2D, SCREEN_W, SCREEN_H, 0, LEDGE_Y); // starts load — not decoded
    expect(ctx.drawImage).not.toHaveBeenCalled();

    decode(imageBySrc('climb/0.webp')!);
    view.draw(ctx as unknown as CanvasRenderingContext2D, SCREEN_W, SCREEN_H, 0, LEDGE_Y);

    const call = ctx.drawImage.mock.calls.at(-1)!;
    const drawH = SCREEN_H; // CLIMB_HEIGHT_RATIO = 1 → full screen height
    const drawW = drawH * (CELL_W / CELL_H);

    expect(call[3]).toBeCloseTo(drawW, 5); // width by the frame's own aspect
    expect(call[4]).toBe(drawH);
    expect(call[1]).toBeCloseTo((SCREEN_W - drawW) / 2, 5); // horizontally centred
    expect(call[2]).toBeCloseTo(LEDGE_Y - GRIP_FRAC_FROM_TOP * drawH, 5); // grip line pinned to the ledge edge
  });

  it('selects the frame from the mantle progress (reach → pull), clamped at the ends', () => {
    vi.stubGlobal('Image', FakeImage);
    const view = new ClimbView();
    const ctx = fakeContext();
    // Each half of the 0..1 progress maps to one of the two frames; below 0 and at/above 1 clamp.
    const cases: readonly [number, number][] = [
      [-0.5, 0],
      [0, 0],
      [0.3, 0],
      [0.6, 1],
      [0.9, 1],
      [1, 1],
      [1.5, 1],
    ];

    for (const [progress, frame] of cases) {
      view.draw(ctx as unknown as CanvasRenderingContext2D, SCREEN_W, SCREEN_H, progress, LEDGE_Y); // create the image
      decode(imageBySrc(CLIMB_FRAME_URLS[frame])!);
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, SCREEN_W, SCREEN_H, progress, LEDGE_Y);

      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
      expect(ctx.drawImage.mock.calls[0][0]).toBe(imageBySrc(CLIMB_FRAME_URLS[frame]));
    }
  });
});
