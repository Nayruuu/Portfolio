import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoomHud } from './doom-hud';
import atlas from './doom-hud-atlas.json';

// All expected coordinates are computed FROM the imported atlas (never magic numbers): zones come from
// the NORMALIZED fractions × the canvas size, and glyphs/face/arms crop from their strips at `index ×
// cell` — where each cell is DERIVED from the (synthetic) loaded image's dimensions, exactly as the HUD
// derives them at runtime (so the strips' `naturalWidth`/`naturalHeight` are seeded to `count × cell`).
const NORM = atlas.hud_bar.zones_normalized;
const DIGIT_W = atlas.digits_red.cell[0];
const FACE_W = atlas.faces.cell[0];
const FACE_H = atlas.faces.cell[1];
const GREY_W = atlas.arms_grey.cell[0];
const YELLOW_W = atlas.arms_yellow.cell[0];
const CARD_DIM = 100; // arbitrary square for the card / weapon-placeholder images (only the ratio matters)

function fakeContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
}

/** Loadable stand-in for `Image` so we can drive the async art loads (jsdom never fetches). */
class FakeImage {
  public static readonly instances: FakeImage[] = [];
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public complete = false;
  public naturalWidth = 0;
  public naturalHeight = 0;
  public width = 0;
  public height = 0;
  public src = '';

  constructor() {
    FakeImage.instances.push(this);
  }
}

type Ctx = ReturnType<typeof fakeContext>;
type Call = unknown[];

/** A canvas sized to the bar's native resolution, so the x1.0 tier is selected and the normalized zones
 *  resolve to (essentially) the atlas' absolute pixels. */
function barCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  canvas.width = atlas.hud_bar.size[0];
  canvas.height = atlas.hud_bar.size[1];

  return canvas;
}

/** Resolve a normalized zone (`0..1`) to pixels for `canvas`, mirroring the HUD's runtime math. */
function zonePx(name: keyof typeof NORM, canvas: HTMLCanvasElement) {
  const norm = NORM[name];

  return {
    x: norm.x * canvas.width,
    y: norm.y * canvas.height,
    w: norm.w * canvas.width,
    h: norm.h * canvas.height,
  };
}

/** The natural `[width, height]` to seed a decoded `FakeImage` by its `src`, so the HUD's per-tier cell
 *  derivation (`naturalWidth / count`, `naturalHeight / rows`) recovers exactly the atlas cell sizes. */
function naturalSizeFor(src: string): [number, number] {
  if (src.includes('digits_red')) {
    return [atlas.digits_red.order.length * atlas.digits_red.cell[0], atlas.digits_red.cell[1]];
  }
  if (src.includes('arms_grey')) {
    return [atlas.arms_grey.order.length * atlas.arms_grey.cell[0], atlas.arms_grey.cell[1]];
  }
  if (src.includes('arms_yellow')) {
    return [atlas.arms_yellow.order.length * atlas.arms_yellow.cell[0], atlas.arms_yellow.cell[1]];
  }
  if (src.includes('face.webp')) {
    return [atlas.faces.cols * atlas.faces.cell[0], atlas.faces.rows * atlas.faces.cell[1]];
  }
  if (src.includes('hud_bar')) {
    return [atlas.hud_bar.size[0], atlas.hud_bar.size[1]];
  }

  return [CARD_DIM, CARD_DIM]; // cards / weapon placeholder
}

/** Mark a `FakeImage` decoded with the right natural size for its `src`, then fire its `onload`. */
function decode(img: FakeImage): void {
  const [width, height] = naturalSizeFor(img.src);

  img.complete = true;
  img.naturalWidth = width;
  img.naturalHeight = height;
  img.width = width;
  img.height = height;
  img.onload?.();
}

/** The decoded `FakeImage` whose `src` contains `part` (e.g. `'face.webp'`, `'digits_red'`). */
function imageBySrc(part: string): FakeImage {
  const img = FakeImage.instances.find((instance) => instance.src.includes(part));

  if (!img) {
    throw new Error(`no FakeImage for "${part}"`);
  }

  return img;
}

/** Every `drawImage` call whose source image is `image` (arg 0 of the call). */
function blitsOf(ctx: Ctx, image: FakeImage): Call[] {
  return ctx.drawImage.mock.calls.filter((call) => call[0] === image);
}

/** Source `(sx, sy)` of the most recent `drawImage` blit of `image` (args 1 and 2 of the 9-arg form). */
function lastBlit(ctx: Ctx, image: FakeImage): { sx: number; sy: number } {
  const calls = blitsOf(ctx, image);
  const last = calls[calls.length - 1];

  return { sx: last[1] as number, sy: last[2] as number };
}

/** A `DoomHud` whose bar + face + digits + arms art are all decoded, so `render` blits the overlays. */
function loadedHud(): { hud: DoomHud; canvas: HTMLCanvasElement } {
  const hud = new DoomHud();
  const canvas = barCanvas();

  hud.render(canvas, 0); // first pass creates + starts every base image load
  for (const img of [...FakeImage.instances]) {
    decode(img);
  }

  return { hud, canvas };
}

describe('DoomHud', () => {
  let ctx: Ctx;

  beforeEach(() => {
    FakeImage.instances.length = 0;
    ctx = fakeContext();
    // The mock's parameter type collapses to getContext's LAST overload — the WebGPU one now that
    // @webgpu/types is loaded (for gpu-renderer.ts) — so the runtime-irrelevant cast must match it.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as GPUCanvasContext,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is inert under SSR (no Image): renders without throwing and never draws', () => {
    vi.stubGlobal('Image', undefined);
    const hud = new DoomHud();

    expect(() => hud.render(barCanvas(), 0.016)).not.toThrow();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('leaves the canvas transparent until the bar art has decoded', () => {
    vi.stubGlobal('Image', FakeImage);
    const hud = new DoomHud();

    hud.render(barCanvas(), 0);
    expect(ctx.drawImage).not.toHaveBeenCalled(); // bar not decoded → nothing painted
    expect(imageBySrc('hud_bar').src).toContain('/game/hud/sizes/x1.0/hud_bar.webp');
  });

  it('selects the smallest art tier that still covers the canvas width', () => {
    vi.stubGlobal('Image', FakeImage);

    // Native bar widths: x0.35 = 740, x0.6 = 1270, x1.0 = 2117 → the smallest tier ≥ the canvas width.
    for (const [width, tier] of [
      [700, 'x0.35'],
      [1100, 'x0.6'],
      [1800, 'x1.0'],
    ] as const) {
      FakeImage.instances.length = 0;
      const hud = new DoomHud();
      const canvas = document.createElement('canvas');

      canvas.width = width;
      canvas.height = Math.round((width * atlas.hud_bar.size[1]) / atlas.hud_bar.size[0]);
      hud.render(canvas, 0);

      expect(imageBySrc('hud_bar').src).toContain(`/game/hud/sizes/${tier}/`);
    }
  });

  it('blits the bar and its overlays once every base image has loaded', () => {
    vi.stubGlobal('Image', FakeImage);
    const { canvas } = loadedHud();
    const bar = imageBySrc('hud_bar');

    // The bar fills the whole backing store (5-arg blit → dest w/h at indices 3/4); the face + digits
    // overlays draw on top.
    const barBlit = blitsOf(ctx, bar).find((call) => call[1] === 0 && call[2] === 0);

    expect(barBlit?.[3]).toBe(canvas.width);
    expect(barBlit?.[4]).toBe(canvas.height);
    expect(blitsOf(ctx, imageBySrc('face.webp')).length).toBeGreaterThan(0);
    expect(blitsOf(ctx, imageBySrc('digits_red')).length).toBeGreaterThan(0);
    expect(blitsOf(ctx, imageBySrc('arms_grey')).length).toBeGreaterThan(0);
  });

  it('enables smoothing before compositing so the digit art does not magnify into harsh light specks', () => {
    vi.stubGlobal('Image', FakeImage);
    loadedHud();

    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it('selects the face row from health: 100 % → top row, 0 % → bottom row', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const face = imageBySrc('face.webp');

    hud.setHealth(100);
    hud.render(canvas, 0);
    expect(lastBlit(ctx, face).sy).toBe(0); // row 0 (full health)

    hud.setHealth(0);
    hud.render(canvas, 0);
    expect(lastBlit(ctx, face).sy).toBe(6 * FACE_H); // row 6 (near-death)
  });

  it('draws the health value as right-aligned digits + the pct glyph (100 → 1,0,0,pct)', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const digits = imageBySrc('digits_red');
    const health = zonePx('health', canvas);

    hud.setHealth(73);
    hud.render(canvas, 0); // paint at 73 so the next frame is a genuine state change
    ctx.drawImage.mockClear();
    hud.setHealth(100);
    hud.render(canvas, 0);

    // Crop indices of the digit blits landing inside the health zone, mapped via `order`:
    // '1' → 1, '0' → 0, '0' → 0, '%' → order.indexOf('pct') = 10. (The leftmost glyph sits at the zone's
    // left edge, so allow a sub-pixel float undershoot; the mental zone starts far to the right.)
    const indices = blitsOf(ctx, digits)
      .filter(
        (call) => (call[5] as number) >= health.x - 1 && (call[5] as number) < health.x + health.w,
      )
      .map((call) => Math.round((call[1] as number) / DIGIT_W))
      .sort((first, second) => first - second);

    expect(indices).toEqual([0, 0, 1, atlas.digits_red.order.indexOf('pct')]);
  });

  it('aims the face column from the gaze: centre by default, far-left/right at the extremes', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const face = imageBySrc('face.webp');
    const center = atlas.faces.col_order.indexOf('look_center');

    hud.render(canvas, 0);
    expect(lastBlit(ctx, face).sx).toBe(center * FACE_W); // default = look_center (col 2)

    hud.lookAt(-2);
    hud.render(canvas, 0);
    expect(lastBlit(ctx, face).sx).toBe(0); // far-left = col 0

    hud.lookAt(2);
    hud.render(canvas, 0);
    expect(lastBlit(ctx, face).sx).toBe((center + 2) * FACE_W); // far-right = col 4
  });

  it('flashes the face hit column on a hit, then reverts to the gaze once it elapses', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const face = imageBySrc('face.webp');
    const center = atlas.faces.col_order.indexOf('look_center');
    const hit = atlas.faces.col_order.indexOf('hit');

    hud.lookAt(1); // looking right (col 3)
    hud.onHit();
    hud.render(canvas, 0.05);
    expect(lastBlit(ctx, face).sx).toBe(hit * FACE_W); // grimace column overrides the gaze

    hud.render(canvas, 0.4); // > HIT_GRIMACE_DURATION → grimace elapses
    expect(lastBlit(ctx, face).sx).toBe((center + 1) * FACE_W); // back to the gaze column
  });

  it('draws owned weapons from the yellow strip and the rest from grey', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const grey = imageBySrc('arms_grey');
    const yellow = imageBySrc('arms_yellow');

    hud.setArms([1, 3]);
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);

    // Owned 1 & 3 → yellow strip cells '1' (idx 0) and '3' (idx 2).
    const yellowIdx = blitsOf(ctx, yellow)
      .map((call) => Math.round((call[1] as number) / YELLOW_W))
      .sort((first, second) => first - second);

    expect(yellowIdx).toEqual([
      atlas.arms_yellow.order.indexOf('1'),
      atlas.arms_yellow.order.indexOf('3'),
    ]);

    // The other six (2,4,5,6,7,8) → grey strip.
    const greyIdx = blitsOf(ctx, grey)
      .map((call) => Math.round((call[1] as number) / GREY_W))
      .sort((first, second) => first - second);

    expect(greyIdx).toEqual(
      ['2', '4', '5', '6', '7', '8'].map((n) => atlas.arms_grey.order.indexOf(n)),
    );
  });

  it('overlays the ammo count as digits in the lower weapon zone', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const digits = imageBySrc('digits_red');
    const weapon = zonePx('weapon', canvas);
    const lowerY = weapon.y + weapon.h * 0.7;

    hud.setAmmo(46);
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);

    const ammoIdx = blitsOf(ctx, digits)
      .filter((call) => (call[6] as number) >= lowerY) // dest-y inside the lower weapon zone
      .map((call) => Math.round((call[1] as number) / DIGIT_W))
      .sort((first, second) => first - second);

    expect(ammoIdx).toEqual([4, 6]); // '4', '6'
  });

  it('renders a magazine readout as a single "loaded/reserve" slash fraction in the lower bay', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const digits = imageBySrc('digits_red');
    const weapon = zonePx('weapon', canvas);
    const lowerY = weapon.y + weapon.h * 0.7;
    const slash = atlas.digits_red.order.indexOf('slash'); // the slash glyph's cell index in the digit strip

    hud.setAmmo(12, 192); // mag 12 loaded, reserve 192 → "12/192"
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);

    // The whole readout sits along the bottom of the bay (one row), digits + the slash separator.
    const readout = blitsOf(ctx, digits)
      .filter((call) => (call[6] as number) >= lowerY)
      .map((call) => Math.round((call[1] as number) / DIGIT_W))
      .sort((first, second) => first - second);

    expect(readout).toEqual([1, 1, 2, 2, 9, slash].sort((a, b) => a - b)); // 1,2,/,1,9,2
  });

  it('draws no ammo digits for a melee weapon (setAmmo null) — the bay shows the icon only', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const digits = imageBySrc('digits_red');
    const weapon = zonePx('weapon', canvas);

    hud.setAmmo(null);
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);

    const weaponDigits = blitsOf(ctx, digits).filter((call) => (call[5] as number) >= weapon.x);

    expect(weaponDigits).toHaveLength(0); // no mag/reserve digits in the weapon bay
  });

  it('lights both owned arms slots when the arsenal occupies slots 1 and 2', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const yellow = imageBySrc('arms_yellow');
    const grey = imageBySrc('arms_grey');

    hud.setArms([1, 2]);
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);

    // Slots 1 AND 2 → the yellow (owned) strip.
    const yellowIdx = blitsOf(ctx, yellow)
      .map((call) => Math.round((call[1] as number) / YELLOW_W))
      .sort((first, second) => first - second);

    expect(yellowIdx).toEqual([
      atlas.arms_yellow.order.indexOf('1'),
      atlas.arms_yellow.order.indexOf('2'),
    ]);

    // The other six (3..8) stay grey.
    const greyIdx = blitsOf(ctx, grey)
      .map((call) => Math.round((call[1] as number) / GREY_W))
      .sort((first, second) => first - second);

    expect(greyIdx).toEqual(
      ['3', '4', '5', '6', '7', '8'].map((n) => atlas.arms_grey.order.indexOf(n)),
    );
  });

  it('shows a held keycard in its zone and removes it on clearCards', () => {
    vi.stubGlobal('Image', FakeImage);
    const { hud, canvas } = loadedHud();
    const cardZone = zonePx('card_red', canvas);

    hud.addCard('red');
    hud.render(canvas, 0); // creates the card_red image (not decoded yet → no blit)
    const card = imageBySrc('card_red');

    ctx.drawImage.mockClear();
    decode(card); // decoded → repaint draws the card

    const cardBlit = blitsOf(ctx, card)[0];

    expect(cardBlit?.[5]).toBeGreaterThanOrEqual(cardZone.x); // dest-x inside the red card zone
    expect(cardBlit?.[5]).toBeLessThan(cardZone.x + cardZone.w);

    hud.clearCards();
    ctx.drawImage.mockClear();
    hud.render(canvas, 0);
    expect(blitsOf(ctx, card)).toHaveLength(0); // no longer held → not drawn
  });
});
