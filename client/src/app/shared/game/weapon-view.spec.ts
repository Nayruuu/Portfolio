import { describe, it, expect, vi, afterEach } from 'vitest';
import { WeaponView } from './weapon-view';
import { CURRENT_WEAPON, RELOAD_VIEW_CONFIG, WEAPON_VIEW_CONFIG, weaponById } from './weapons';

const CONFIG = WEAPON_VIEW_CONFIG;
const FRAME = CONFIG.frameDuration_s; // 0.06 s per fire frame
// A synthetic strip: `frameCount` equal cells, each FRAME_WIDTH × FRAME_HEIGHT px. The view must DERIVE
// the per-frame size from the loaded strip (naturalWidth / frameCount × naturalHeight) — nothing is
// hardcoded, so the cells need not match any real asset, only stay internally consistent.
const FRAME_WIDTH = 120;
const FRAME_HEIGHT = 96;
const STRIP_WIDTH = CONFIG.frameCount * FRAME_WIDTH;

/** A loadable `Image` stand-in (jsdom never fetches) — mirrors the DoomHud spec's fake. */
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

/** Mark a `FakeImage` decoded at the synthetic strip resolution and fire its `onload`. */
function decode(img: FakeImage): void {
  img.complete = true;
  img.naturalWidth = STRIP_WIDTH;
  img.naturalHeight = FRAME_HEIGHT;
  img.onload?.();
}

/** The `FakeImage` whose `src` contains `part`. */
function imageBySrc(part: string): FakeImage {
  const img = FakeImage.instances.find((instance) => instance.src.includes(part));

  if (!img) {
    throw new Error(`no FakeImage for "${part}"`);
  }

  return img;
}

describe('WeaponView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeImage.instances.length = 0;
  });

  describe('animation', () => {
    it('idles silently, then a trigger fires the strike frame exactly once before returning to idle', () => {
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);

      expect(view.tick(FRAME)).toBe(false); // idle → no strike

      expect(view.tryTrigger()).toBe(true); // a fresh swing starts
      expect(view.tick(FRAME)).toBe(true); // reaches strikeIndex (1) → the single damage frame
      expect(view.tick(FRAME)).toBe(false); // recoil frame — never re-strikes within the swing
      expect(view.tick(FRAME)).toBe(false); // idle frame still playing
      expect(view.tick(FRAME)).toBe(false); // sequence end → back to idle
      // Idle again means a fresh trigger is allowed once the cooldown clears (covered below).
    });

    it('strikes once even when a single big tick advances through the whole sequence', () => {
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);

      view.tryTrigger();
      expect(view.tick(1)).toBe(true); // one strike across the whole run
      expect(view.tick(FRAME)).toBe(false); // idle afterwards
    });

    it('reports `swinging()` only while a swing animates — the switch guard the shell relies on', () => {
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);

      expect(view.swinging()).toBe(false); // idle → switching is allowed
      view.tryTrigger();
      expect(view.swinging()).toBe(true); // mid-animation → the shell refuses a weapon-switch
      view.tick(1); // advance past the whole sequence → back to idle
      expect(view.swinging()).toBe(false); // animation done (cooldown may still run) → switching allowed again
    });

    it('blocks a re-trigger until the fire cooldown (0.8 s) clears', () => {
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);

      expect(view.tryTrigger()).toBe(true);
      for (let frame = 0; frame < CONFIG.fireSequence.length; frame++) {
        view.tick(FRAME); // play the swing out to idle (~0.24 s elapsed, cooldown 0.8 s)
      }

      expect(view.tryTrigger()).toBe(false); // animation done but still on cooldown
      view.tick(0.8); // clear the remaining cooldown
      expect(view.tryTrigger()).toBe(true); // off cooldown → swings again
    });
  });

  describe('rendering', () => {
    it('is SSR-safe: with no Image it draws nothing, exposes no icon, and the logic still runs', () => {
      vi.stubGlobal('Image', undefined);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      expect(() => view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600)).not.toThrow();
      expect(ctx.drawImage).not.toHaveBeenCalled(); // no sprite decoded → transparent
      expect(view.icon()).toBeUndefined();
      expect(view.tryTrigger()).toBe(true); // pure animation logic is unaffected
    });

    it('derives the frame size from the loaded strip and blits it bottom-centre at the height ratio, NEAREST', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // starts the load — not decoded yet
      expect(ctx.drawImage).not.toHaveBeenCalled();

      decode(imageBySrc('fps.webp'));
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      const call = ctx.drawImage.mock.calls[0];
      const drawH = CONFIG.heightRatio * 600;
      const drawW = drawH * (FRAME_WIDTH / FRAME_HEIGHT);

      expect(call[0]).toBe(imageBySrc('fps.webp'));
      expect(call[1]).toBe(CONFIG.idleFrame * FRAME_WIDTH); // idle frame source x = 0
      expect(call[3]).toBe(FRAME_WIDTH); // derived: naturalWidth / frameCount
      expect(call[4]).toBe(FRAME_HEIGHT); // derived: naturalHeight
      expect(call[5]).toBeCloseTo((800 - drawW) / 2, 3); // bottom-centre x
      expect(call[6]).toBeCloseTo(600 * (1 - 0.2 + 0.04) - drawH * (1 - 0.06), 3); // base sunk into the bar top (HUD_BAR_HEIGHT_FRAC, WEAPON_BAR_OVERLAP, WEAPON_BASE_PAD)
      expect(call[8]).toBeCloseTo(drawH, 3); // height = ratio × screenH
      expect(ctx.imageSmoothingEnabled).toBe(false); // crisp pixel-art
    });

    it('advances the drawn source frame as the swing animates', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      decode(imageBySrc('fps.webp'));

      view.tryTrigger(); // seqIndex 0 → first fire frame (sequence[0])
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls.at(-1)?.[1]).toBe(CONFIG.fireSequence[0] * FRAME_WIDTH);

      view.tick(FRAME); // → the strike frame (sequence[1])
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls.at(-1)?.[1]).toBe(CONFIG.fireSequence[1] * FRAME_WIDTH);
    });

    it('arcs the sprite through a melee swing (swing_travel) but draws centred at rest', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, { ...CONFIG, swingTravel: 0.5 });
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // starts the load
      decode(imageBySrc('fps.webp'));
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // at rest, sheet ready
      const restX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const restY = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      view.tryTrigger();
      view.tick(FRAME * 1.5); // ~1.5 frames into the run — mid-arc, well off the zero-crossing ends
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      const swingX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const swingY = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      expect(swingX).not.toBeCloseTo(restX, 1); // swept sideways
      expect(swingY).not.toBeCloseTo(restY, 1); // and lifted off the resting line
    });

    it('walk-bobs the sprite by the engine bobPhase, and not at all when standing still (phase 0)', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // starts the load
      decode(imageBySrc('fps.webp'));

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0); // standing still
      const stillX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const stillY = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, Math.PI / 2); // mid-stride
      const bobX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const bobY = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      expect(bobX).not.toBeCloseTo(stillX, 1); // swayed sideways (sin at its peak)
      expect(bobY).toBeGreaterThan(stillY); // and dipped down (rectified sine ≥ 0)
    });

    it('derives a 4-frame weapon’s frame size from ITS OWN loaded strip — nothing hardcoded (the pistol)', () => {
      vi.stubGlobal('Image', FakeImage);
      const pistol = weaponById('pistol');

      if (!pistol) {
        throw new Error('weapons.json must declare the pistol');
      }
      const view = new WeaponView(pistol, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // starts the load
      const strip = imageBySrc('pistol/fps.webp');

      // SYNTHETIC cell size (not the real asset, which changes as the art is revised): the point is that
      // the view DERIVES `naturalWidth / frameCount × naturalHeight` from the loaded strip, hardcoding none.
      const CELL_WIDTH = 200;
      const CELL_HEIGHT = 150;

      strip.complete = true;
      strip.naturalWidth = CONFIG.frameCount * CELL_WIDTH;
      strip.naturalHeight = CELL_HEIGHT;
      strip.onload?.();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      const call = ctx.drawImage.mock.calls[0]; // the pre-decode draw blits nothing → this is the only call
      const drawH = CONFIG.heightRatio * 600;
      const drawW = drawH * (CELL_WIDTH / CELL_HEIGHT);

      expect(call[3]).toBe(CELL_WIDTH); // derived source frame width: naturalWidth / frameCount
      expect(call[4]).toBe(CELL_HEIGHT); // derived source frame height: naturalHeight
      expect(call[7]).toBeCloseTo(drawW, 3); // on-screen width follows the strip's own aspect
      expect(call[8]).toBeCloseTo(drawH, 3); // height = ratio × screenH
    });

    it('exposes the decoded HUD bay icon', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);

      expect(view.icon()).toBeUndefined(); // load starts on first ask, not yet decoded
      decode(imageBySrc('icon.webp'));
      expect(view.icon()).toBe(imageBySrc('icon.webp'));
    });
  });

  describe('run cycle (the fist guard bob)', () => {
    // The fist (CURRENT_WEAPON) ships a `sprite_run` walk cycle — a hand-drawn guard bob the view plays
    // as the resting/moving base instead of a static idle frame + the procedural sway.
    const RUN_CELL_WIDTH = 200;
    const RUN_FRAMES = 4; // CURRENT_WEAPON.run_frames

    /** Decode the run strip as `RUN_FRAMES` cells of `RUN_CELL_WIDTH × height` (the view derives the cell). */
    function decodeRun(height = FRAME_HEIGHT): FakeImage {
      const run = imageBySrc('run.webp');

      run.complete = true;
      run.naturalWidth = RUN_FRAMES * RUN_CELL_WIDTH;
      run.naturalHeight = height;
      run.onload?.();

      return run;
    }

    it('plays the run strip as the resting base (cell 0 at rest), at its own pixel scale — not the fire idle frame', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0); // starts the fps + run loads
      decode(imageBySrc('fps.webp')); // fire strip: naturalHeight = FRAME_HEIGHT (96)
      const RUN_HEIGHT = 60; // a SHORTER cell than the fire strip → drawn at the run strip's own pixel scale
      const run = decodeRun(RUN_HEIGHT);

      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0);

      const call = ctx.drawImage.mock.calls[0];

      expect(call[0]).toBe(run); // the RUN strip is the resting base, not the fire strip
      expect(call[1]).toBe(0); // cell 0 at bobPhase 0 — a stationary player holds the neutral guard
      expect(call[4]).toBe(RUN_HEIGHT); // derived source frame height
      // Drawn at the run strip's OWN pixel scale (its shorter cell × runH/fireH) so the fists match the jab strip:
      expect(call[8]).toBeCloseTo(CONFIG.heightRatio * 600 * (RUN_HEIGHT / FRAME_HEIGHT), 3);
    });

    it('cycles the run cell with the bob phase while suppressing the procedural positional sway', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0);
      decode(imageBySrc('fps.webp'));
      decodeRun();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0); // standing still → cell 0
      const restX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const restFrame = ctx.drawImage.mock.calls.at(-1)?.[1] as number;

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, Math.PI / 2); // a quarter through the sway
      const strideX = ctx.drawImage.mock.calls.at(-1)?.[5] as number;
      const strideFrame = ctx.drawImage.mock.calls.at(-1)?.[1] as number;

      expect(restFrame).toBe(0); // cell 0 at rest
      expect(strideFrame).toBe(1 * RUN_CELL_WIDTH); // floor(0.25 × 4) = cell 1 mid-stride
      expect(strideX).toBeCloseTo(restX, 5); // NO positional sway — the hand-drawn cycle carries the bob
    });

    it('draws the fire (jab) strip while swinging, returning to the run base once the swing ends', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = new WeaponView(CURRENT_WEAPON, CONFIG);
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, 0);
      decode(imageBySrc('fps.webp'));
      decodeRun();

      view.tryTrigger(); // a jab starts
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, Math.PI / 2); // moving AND swinging
      expect(ctx.drawImage.mock.calls.at(-1)?.[0]).toBe(imageBySrc('fps.webp')); // the jab strip owns the swing

      view.tick(1); // play the jab out → idle
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600, Math.PI / 2);
      expect(ctx.drawImage.mock.calls.at(-1)?.[0]).toBe(imageBySrc('run.webp')); // back to the run base
    });
  });

  describe('reload', () => {
    /** A magazine weapon (the pistol) carries a reload strip; build its view with the reload config. */
    function pistolView(): WeaponView {
      const pistol = weaponById('pistol');

      if (!pistol) {
        throw new Error('weapons.json must declare the pistol');
      }

      return new WeaponView(pistol, CONFIG, RELOAD_VIEW_CONFIG);
    }

    /** Decode the reload strip as a 1407×385 sheet (3 cells → 469×385 each, derived by the view). */
    function decodeReloadStrip(): FakeImage {
      const reload = imageBySrc('reload.webp');

      reload.complete = true;
      reload.naturalWidth = 1407;
      reload.naturalHeight = 385;
      reload.onload?.();

      return reload;
    }

    it('draws the reload strip frame for the elapsed fraction, deriving the frame size from the strip', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = pistolView();
      const ctx = fakeContext();

      view.setReloadProgress(0.5); // reloading → the draw asks the reload strip (starts its load)
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // not decoded yet → nothing drawn
      const reload = decodeReloadStrip();

      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      const call = ctx.drawImage.mock.calls[0];

      expect(call[0]).toBe(reload); // the RELOAD strip, not the fire strip
      expect(call[1]).toBe(1 * 469); // frame floor(0.5 × 3) = 1, source x = frame × derived frame width
      expect(call[3]).toBe(469); // derived frame width: naturalWidth 1407 / 3 cells
      expect(call[4]).toBe(385); // derived frame height: naturalHeight
      expect(ctx.imageSmoothingEnabled).toBe(false); // crisp pixel-art, same geometry as the fire strip
    });

    it('plays an empty-mag dry click: the reload strip down→up, skipping the insert frame', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = pistolView();
      const ctx = fakeContext();

      view.dryFire(); // empty fire → start the 0.18 s dry gesture
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // dry branch starts the reload-strip load
      const reload = decodeReloadStrip();

      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls[0]?.[0]).toBe(reload); // the RELOAD strip, not the fire strip
      expect(ctx.drawImage.mock.calls[0]?.[1]).toBe(0 * 469); // first half → frame 0 (down)

      view.tick(0.12); // past the half-way point of the gesture
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls[0]?.[1]).toBe(2 * 469); // second half → frame 2 (up); the insert (1) is skipped
    });

    it('clamps the reload frame to the last cell at the end of the reload (progress 1)', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = pistolView();
      const ctx = fakeContext();

      view.setReloadProgress(1);
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      decodeReloadStrip();
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      expect(ctx.drawImage.mock.calls[0][1]).toBe(2 * 469); // floor(1 × 3) = 3 → clamped to the last cell (2)
    });

    it('falls back to the fire strip when not reloading, even with the reload strip decoded', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = pistolView();
      const ctx = fakeContext();

      view.setReloadProgress(0.5); // create + decode the reload strip
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      decodeReloadStrip();
      decode(imageBySrc('fps.webp')); // the fire strip decodes too (synthetic 480×96)

      view.setReloadProgress(null); // not reloading
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      const call = ctx.drawImage.mock.calls[0];

      expect(call[0]).toBe(imageBySrc('fps.webp')); // the FIRE strip wins back
      expect(call[1]).toBe(CONFIG.idleFrame * FRAME_WIDTH); // its idle frame
    });

    it('is SSR-safe while reloading: no reload strip decoded falls back to the (also-absent) fire draw', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = pistolView();
      const ctx = fakeContext();

      view.setReloadProgress(0.5); // reloading, but nothing decoded yet
      expect(() => view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600)).not.toThrow();
      expect(ctx.drawImage).not.toHaveBeenCalled(); // neither strip decoded → transparent
    });

    it('builds no reload strip when a magazine weapon is constructed without a reload config', () => {
      vi.stubGlobal('Image', FakeImage);
      const pistol = weaponById('pistol');

      if (!pistol) {
        throw new Error('weapons.json must declare the pistol');
      }
      const view = new WeaponView(pistol, CONFIG); // omit the reload config → no reload viewmodel
      const ctx = fakeContext();

      view.setReloadProgress(0.5);
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      decode(imageBySrc('fps.webp')); // only the fire strip exists
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      expect(ctx.drawImage.mock.calls[0][0]).toBe(imageBySrc('fps.webp')); // falls back to the fire draw
    });
  });

  describe('auto fire (the chaingun)', () => {
    /** An AUTO weapon (the chaingun: `fireMode: 'auto'`, `fireFrameDuration_s: 0.035`), with its strip
     *  decoded so a draw blits a frame. */
    function chaingunView(ctx: ReturnType<typeof fakeContext>): WeaponView {
      const chaingun = weaponById('chaingun');

      if (!chaingun) {
        throw new Error('weapons.json must declare the chaingun');
      }
      const view = new WeaponView(chaingun, CONFIG, RELOAD_VIEW_CONFIG);

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // start the load
      decode(imageBySrc('chaingun/fps.webp'));

      return view;
    }

    /** The source-x (left edge in the strip) of the last blit, as a frame index. */
    function lastFrame(ctx: ReturnType<typeof fakeContext>): number {
      return (ctx.drawImage.mock.calls.at(-1)?.[1] as number) / FRAME_WIDTH;
    }

    it('loops every strip frame while the trigger is held, wrapping back to 0', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const view = chaingunView(ctx);

      view.setFiring(true);
      const frames: number[] = [];

      // Tick 0.04 s (> the 0.035 s burst duration, < 2×) so each tick advances exactly one cell.
      for (let step = 0; step < 5; step++) {
        view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
        frames.push(lastFrame(ctx));
        view.tick(0.04);
      }

      expect(frames).toEqual([0, 1, 2, 3, 0]); // a continuous loop over all four cells, then wrap
    });

    it('snaps to the idle frame the instant the trigger is released', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const view = chaingunView(ctx);

      view.setFiring(true);
      view.tick(0.04); // advance off frame 0 into the loop
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(lastFrame(ctx)).toBe(1); // mid-burst (a non-idle cell)

      view.setFiring(false); // release
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(lastFrame(ctx)).toBe(CONFIG.idleFrame); // snapped straight back to idle (0)
    });

    it('blits the separate flash-free cold-idle sprite at rest, the fire strip while firing', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const view = chaingunView(ctx); // fire strip decoded, not firing

      decode(imageBySrc('chaingun/idle.webp')); // the cold-idle sprite decodes too

      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls[0][0]).toBe(imageBySrc('chaingun/idle.webp')); // at rest → cold barrel, no flash

      view.setFiring(true);
      view.tick(0.04); // into the burst loop
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls[0][0]).toBe(imageBySrc('chaingun/fps.webp')); // firing → the muzzle-flash strip
    });

    it('recoilKick dips the drawn weapon down, then `tick` decays it back to rest', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const view = chaingunView(ctx);

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      const restingDy = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      view.recoilKick();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      const kickedDy = ctx.drawImage.mock.calls.at(-1)?.[6] as number;

      expect(kickedDy).toBeGreaterThan(restingDy); // the kick adds a positive `dy` (a downward jolt)

      view.tick(0.08); // the kick fades over ~0.08 s
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls.at(-1)?.[6] as number).toBeCloseTo(restingDy, 1); // back to rest
    });

    it('never reports a strike edge from `tick` (the core auto-fires off the held intent, not the animation)', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const view = chaingunView(ctx);

      view.setFiring(true);
      expect(view.tick(0.04)).toBe(false); // no strike frame — auto fire never goes through the swing path
      expect(view.tick(1)).toBe(false); // even a huge tick crosses no strike index
    });

    it('loops a MULTI-frame cold-idle strip at rest (the chainsaw idling chain), wrapping back to 0', () => {
      vi.stubGlobal('Image', FakeImage);
      const ctx = fakeContext();
      const chainsaw = weaponById('chainsaw');

      if (!chainsaw) {
        throw new Error('weapons.json must declare the chainsaw');
      }
      // Only the idle LOOP is under test here, which reads `idle_frames` (4), not the fire config — so the
      // shared 4-cell CONFIG stands in for the rev strip (never drawn at rest).
      const view = new WeaponView(chainsaw, CONFIG, RELOAD_VIEW_CONFIG);

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // start the loads
      decode(imageBySrc('chainsaw/fps.webp'));
      decode(imageBySrc('chainsaw/idle.webp'));

      const frames: number[] = [];

      // At rest (never fired) the idle strip advances one cell per IDLE_FRAME_DURATION_S (0.13 s); tick 0.14 s
      // (> the frame duration, < 2×) so each tick steps exactly one cell, clear of the float boundary.
      for (let step = 0; step < 5; step++) {
        ctx.drawImage.mockClear();
        view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
        const call = ctx.drawImage.mock.calls[0];

        expect(call[0]).toBe(imageBySrc('chainsaw/idle.webp')); // the idling-chain strip, not the rev strip
        frames.push((call[1] as number) / (call[3] as number)); // source-x / frameWidth = idle cell index
        view.tick(0.14);
      }

      expect(frames).toEqual([0, 1, 2, 3, 0]); // a continuous 4-cell loop, then wrap

      // Pulling the trigger swaps to the spinning rev strip (and resets the idle clock for next time).
      view.setFiring(true);
      view.tick(0.05);
      ctx.drawImage.mockClear();
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);

      expect(ctx.drawImage.mock.calls[0][0]).toBe(imageBySrc('chainsaw/fps.webp')); // firing → the rev strip
    });
  });

  describe('charge (the datacenter BFG)', () => {
    /** The CHARGE weapon (the datacenter BFG: `fireMode: 'charge'`, `chargeTime_s: 0.7`). */
    function bfg(): WeaponView {
      const weapon = weaponById('bfg');

      if (!weapon) {
        throw new Error('weapons.json must declare the bfg');
      }

      return new WeaponView(weapon, CONFIG, RELOAD_VIEW_CONFIG);
    }

    it('holds the charge for `chargeTime_s`, then strikes once on the discharge', () => {
      const view = bfg();

      expect(view.tryTrigger()).toBe(true); // the spin-up starts
      expect(view.charging()).toBe(true);

      expect(view.tick(0.3)).toBe(false); // mid spin-up (0.3 < 0.7) → no strike, still charging
      expect(view.charging()).toBe(true);
      expect(view.chargeProgress()).toBeCloseTo(0.3 / 0.7, 5);

      expect(view.tick(0.5)).toBe(true); // crosses 0.7 s → the discharge strike fires the core shot
      expect(view.charging()).toBe(false); // spin-up done
      expect(view.chargeProgress()).toBe(0); // 0 once it stops charging

      expect(view.tick(FRAME)).toBe(false); // the recoil → idle tail never re-strikes
      expect(view.tick(FRAME)).toBe(false);
    });

    it('strikes once even when a single big tick blows past the whole charge', () => {
      const view = bfg();

      view.tryTrigger();
      expect(view.tick(5)).toBe(true); // one strike across the whole spin-up
      expect(view.tick(FRAME)).toBe(false); // no re-strike afterwards
    });

    it('is engaged once started: a release (no further trigger) still discharges, a re-press is ignored', () => {
      const view = bfg();

      view.tryTrigger(); // press, then "release" — the shell simply stops triggering
      expect(view.tryTrigger()).toBe(false); // a re-press mid-charge cannot restart / cancel it

      let struck = false;

      for (let frame = 0; frame < 30 && !struck; frame++) {
        struck = view.tick(0.06); // keep ticking with NO further trigger
      }

      expect(struck).toBe(true); // the charge still released — a mid-charge release does not cancel it
    });

    it('reports `swinging()` through the whole charge so the shell cannot swap away mid-charge', () => {
      const view = bfg();

      expect(view.swinging()).toBe(false); // idle → switching is allowed
      view.tryTrigger();
      expect(view.swinging()).toBe(true); // spinning up → the swap guard holds
      view.tick(0.4); // still charging
      expect(view.swinging()).toBe(true);
      expect(view.tick(0.5)).toBe(true); // 0.9 s ≥ 0.7 → the discharge fires
      expect(view.swinging()).toBe(true); // still playing the recoil → idle tail (no swap yet)
      view.tick(1); // play the tail out → back to idle
      expect(view.swinging()).toBe(false);
    });

    it('draws the charge cell while spinning up, then the discharge cell on the strike', () => {
      vi.stubGlobal('Image', FakeImage);
      const view = bfg();
      const ctx = fakeContext();

      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600); // start the load
      decode(imageBySrc('bfg/fps.webp'));

      view.tryTrigger(); // → charging: holds the charge cell (fireSequence[0] = fire_start)
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls.at(-1)?.[1]).toBe(CONFIG.fireSequence[0] * FRAME_WIDTH);

      view.tick(0.8); // → the discharge: snaps to the strike cell (fireSequence[strikeIndex] = fire_peak)
      view.draw(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.drawImage.mock.calls.at(-1)?.[1]).toBe(
        CONFIG.fireSequence[CONFIG.strikeIndex] * FRAME_WIDTH,
      );
    });
  });
});
