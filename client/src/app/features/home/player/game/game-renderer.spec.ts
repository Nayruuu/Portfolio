import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRenderer } from './game-renderer';
import { ENEMY_SIZE } from './game-textures';
import { LoadedImage } from '../../../../shared/game/loaded-image';
import { WeaponView } from '../../../../shared/game/weapon-view';
import { ClimbView } from '../../../../shared/game/climb-view';
import { CURRENT_WEAPON, WEAPON_VIEW_CONFIG } from '../../../../shared/game/weapons';
import {
  BASE_FLOOR_Z,
  DOOR_BASE,
  floorScreenY,
  FRONT_GAP,
  generateLevel,
  HIT_FLASH_DURATION,
  THEME_CYCLE,
  WALL_HEIGHT,
  type GameMap,
  type GameState,
  type Level,
  type Sector,
} from '../../../../core/lib';

const LEVEL_A = generateLevel(1, THEME_CYCLE[0], 0);
const LEVEL_B = generateLevel(2, THEME_CYCLE[1], 1);
// FRONT_GAP cells ahead of spawn are carved open by the generator — guaranteed open floor + visible.
const FRONT_X = LEVEL_A.spawn.x + FRONT_GAP;
const SPAWN_Y = LEVEL_A.spawn.y;
// An enemy/projectile at (FRONT_X, SPAWN_Y) sits dead ahead on the spawn row → perpendicular depth = FRONT_GAP.
const FRONT_DEPTH = FRONT_X - LEVEL_A.spawn.x;
// Mirrors the renderer's billboard floor-bias (game-textures baseY = 44 of SIZE = 48 → 4 px padding).
const SPRITE_FLOOR_BIAS = 4 / ENEMY_SIZE;

// A 5×3 corridor with a hand-authored sector table: the player at (1.5, 1.5) faces +x straight down the
// open middle row (2,1)→(3,1)→wall. Cell (3,1) sits in a RAISED-floor + LOW-ceiling sector, so the ray
// crosses a height boundary — the sector raycaster emits floor/ceiling strips plus a stepFloor + stepCeil
// riser, exercising the height path (`drawSpans`). Both sectors carry distinct flat materials.
const HEIGHT_RAISED_CELL = 8; // index of (3,1) in a 5-wide grid
const HEIGHT_SECTORS: readonly Sector[] = [
  { floorZ: BASE_FLOOR_Z, ceilZ: WALL_HEIGHT, floorMat: 1, ceilMat: 1 }, // 0 — base
  { floorZ: 0.4, ceilZ: 1, floorMat: 2, ceilMat: 1 }, // 1 — raised floor + dropped ceiling → two risers
];

/** A non-flat level: the corridor above, every cell in the base sector except (3,1) in the raised one. */
function heightLevel(): Level {
  const sectorId = new Array(15).fill(0);

  sectorId[HEIGHT_RAISED_CELL] = 1;
  const map: GameMap = {
    width: 5,
    height: 3,
    // prettier-ignore
    cells: [
      1, 1, 1, 1, 1,
      1, 0, 0, 0, 1,
      1, 1, 1, 1, 1,
    ],
    sectors: HEIGHT_SECTORS,
    sectorId,
  };

  return {
    ...LEVEL_A,
    map,
    floorFlats: new Array(15).fill(1),
    ceilFlats: new Array(15).fill(1),
    spawn: { x: 1.5, y: 1.5, dir: 0 },
  };
}

/** A typed view of the renderer's private fields/methods the height-path tests assert against (the gating
 *  flag + the two mutually-exclusive floor/ceiling passes) — `as unknown as` keeps it `any`-free. */
interface RendererInternals {
  levelIsFlat: boolean;
  drawFloorCeiling: (...args: unknown[]) => void;
  drawSpans: (...args: unknown[]) => void;
}

/** All 1-px-wide billboard sprite columns this frame: 9-arg drawImage with dest width 1 (walls use 2).
 *  Each column of a given sprite shares the same dest `top` (idx 6) and `size` (idx 8). */
function spritePasses(calls: unknown[][]): unknown[][] {
  return calls.filter((c) => c.length === 9 && c[7] === 1);
}

/** A fresh weapon viewmodel for `render`. Its sprite never decodes under jsdom, so `draw` is a no-op
 *  here — the renderer tests measure the world art, and one test spies on `draw` for the delegation. */
function weaponView(): WeaponView {
  return new WeaponView(CURRENT_WEAPON, WEAPON_VIEW_CONFIG);
}

/** A recording stub for the 2-D context (jsdom has no canvas rendering). ImageData calls back zeroed
 *  buffers so the floor/ceiling cast + the flat pre-read run without a real canvas. */
function fakeContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 0,
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    arc: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    restore: vi.fn(),
  };
}

function gameState(over: Partial<GameState> = {}): GameState {
  return {
    pose: { ...LEVEL_A.spawn },
    enemies: [],
    playerProjectiles: [],
    impacts: [],
    arcs: [],
    kills: 0,
    hits: 0,
    fireCooldown: 0,
    bobPhase: 0,
    playerHp: 100,
    playerArmor: 0,
    playerAmmo: { staples: 50 },
    mag: 0,
    reloadClock: 0,
    projectiles: [],
    pickups: [],
    ammoPickups: [],
    keys: [],
    heldKeys: 0,
    hurtFlash: 0,
    playerSlow: 0,
    ...over,
  };
}

describe('GameRenderer', () => {
  let ctx: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    ctx = fakeContext();
    // Every offscreen + display canvas shares the stub, so the art build + the frame draw both run.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sizes the backing store within the cap, landscape and CSS-rotated portrait', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.resize(canvas, false);
    expect(canvas.width).toBeGreaterThanOrEqual(2);
    expect(canvas.height).toBeGreaterThanOrEqual(2);

    renderer.resize(canvas, true); // portrait reads the swapped viewport dims
    expect(canvas.width).toBeLessThanOrEqual(1440); // capped at MAX_BACKING_WIDTH
    expect(canvas.width).toBeGreaterThanOrEqual(2);
  });

  it('applyLevel swaps theme art without throwing', () => {
    const renderer = new GameRenderer();

    renderer.prepare(LEVEL_A);
    expect(() => renderer.applyLevel(LEVEL_B)).not.toThrow();
  });

  it('casts the floor/ceiling and paints textured, shaded wall columns and the crosshair', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A); // builds the theme + enemy/weapon/switch art
    canvas.width = 64;
    canvas.height = 64;

    renderer.render(canvas, gameState(), LEVEL_A, weaponView());

    expect(ctx.putImageData).toHaveBeenCalled(); // the floor/ceiling cast
    expect(ctx.fillRect).toHaveBeenCalled(); // per-column depth shade
    expect(ctx.drawImage).toHaveBeenCalled(); // textured wall slices + weapon
    expect(ctx.stroke).toHaveBeenCalled(); // crosshair
  });

  it('draws extra columns for a billboarded enemy in front of the camera', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const withoutEnemy = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();

    const enemies = [
      {
        x: FRONT_X,
        y: SPAWN_Y,
        dir: 0,
        state: 'alive' as const,
        deathTime: 0,
        hp: 2,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0,
        kind: 'manager' as const,
      },
    ];

    renderer.render(canvas, gameState({ enemies }), LEVEL_A, weaponView());

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(withoutEnemy); // enemy sprite columns
  });

  // The ONLY automated net for the masked-canvas vertical anchoring: the live game is hidden in the
  // visual baselines, so the feet==floor / projectile==eye-level alignment is checked here numerically.
  it('seats a grounded enemy’s VISIBLE feet on the floor row at its depth (feet == floor)', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        enemies: [
          {
            x: FRONT_X,
            y: SPAWN_Y,
            dir: 0,
            state: 'alive' as const,
            deathTime: 0,
            hp: 2,
            fireCooldown: 0,
            hitFlash: 0, // no flash → no recoil offset; pure floor anchoring
            windup: 0,
            kind: 'manager' as const,
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    const pass = spritePasses(ctx.drawImage.mock.calls)[0];
    const top = Number(pass[6]); // dest y
    const size = Number(pass[8]); // dest height
    const feetY = top + size * (1 - SPRITE_FLOOR_BIAS);
    const floorY = floorScreenY(FRONT_DEPTH, 64);

    expect(feetY).toBeCloseTo(floorY, 0); // visible feet land on the floor cast, within ~1px
  });

  it('keeps an airborne projectile horizon-centred at eye level (centre == height/2)', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        projectiles: [
          { x: FRONT_X, y: SPAWN_Y, velocityX: 0, velocityY: 0, skin: 'invite' as const },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    const pass = spritePasses(ctx.drawImage.mock.calls)[0];
    const top = Number(pass[6]);
    const size = Number(pass[8]);

    expect(top + size / 2).toBeCloseTo(64 / 2, 0); // eye-level centre, WALL_HEIGHT-invariant
  });

  it('delegates the first-person weapon blit to the WeaponView each frame', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');
    const weapon = weaponView();
    const drawSpy = vi.spyOn(weapon, 'draw');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    renderer.render(canvas, { ...gameState(), bobPhase: 1.23 }, LEVEL_A, weapon);

    // the viewmodel owns its own sprite + sizing; the renderer forwards the engine's walk-bob phase to it
    expect(drawSpy).toHaveBeenCalledWith(ctx, 64, 64, 1.23);
  });

  it('mid-mantle, draws the climb overlay (at the hoist progress) instead of the weapon', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');
    const weapon = weaponView();
    const climb = new ClimbView();
    const weaponSpy = vi.spyOn(weapon, 'draw');
    const climbSpy = vi.spyOn(climb, 'draw');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    const mantle = { progress: 0.6, startZ: 0, targetZ: 1 };

    renderer.render(canvas, gameState({ mantle }), LEVEL_A, weapon, climb);

    expect(climbSpy).toHaveBeenCalledWith(ctx, 64, 64, 0.6, expect.any(Number)); // the ledge pull at the hoist fraction, anchored to the ledge edge
    expect(weaponSpy).not.toHaveBeenCalled(); // both hands are on the ledge — no weapon this frame
  });

  it('applies ctx.save/translate/restore around the scene on damage but not on a clean frame', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    // hurtFlash === 0: no screen-shake, translate must NOT be called.
    ctx.save.mockClear();
    ctx.translate.mockClear();
    ctx.restore.mockClear();
    renderer.render(canvas, gameState({ hurtFlash: 0 }), LEVEL_A, weaponView());
    expect(ctx.translate).not.toHaveBeenCalled();

    // hurtFlash > 0: save → translate → scene → restore (HUD drawn after restore — stays steady).
    ctx.save.mockClear();
    ctx.translate.mockClear();
    ctx.restore.mockClear();
    renderer.render(canvas, gameState({ hurtFlash: 0.3 }), LEVEL_A, weaponView());
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.translate).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the 2-D context is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    canvas.width = 16;
    canvas.height = 16;

    expect(() => renderer.render(canvas, gameState(), LEVEL_A, weaponView())).not.toThrow();
  });

  it('draws billboards for a projectile and a pickup in front of the camera', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();

    renderer.render(
      canvas,
      gameState({
        projectiles: [
          { x: FRONT_X, y: SPAWN_Y, velocityX: 0, velocityY: 0, skin: 'invite' as const },
        ],
        pickups: [{ x: FRONT_X - 1, y: SPAWN_Y, kind: 'health' as const }],
      }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(baseDraws); // extra sprite columns
  });

  it('textures a locked-door column (no hole) and billboards a keycard on the floor', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A); // builds the theme walls + the colour-coded door textures
    canvas.width = 64;
    canvas.height = 64;

    // A 5×3 corridor: the player at (1.5, 1.5) faces +x straight into the centre cell. Wall columns are
    // the 9-arg drawImage calls with dest width 2 (COLUMN_STEP + 1); a missing texture skips the draw.
    const flats = new Array(15).fill(0);
    const base = {
      ...LEVEL_A,
      floorFlats: flats,
      ceilFlats: flats,
      spawn: { x: 1.5, y: 1.5, dir: 0 },
    };
    const pose = { x: 1.5, y: 1.5, dir: 0 };
    // prettier-ignore
    const wallCells = [1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1];
    // prettier-ignore
    const doorCells = [1, 1, 1, 1, 1, 1, 0, DOOR_BASE, 0, 1, 1, 1, 1, 1, 1]; // red door dead ahead
    const wallColumns = (calls: unknown[][]) =>
      calls.filter((c) => c.length === 9 && c[7] === 2).length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ pose }),
      { ...base, map: { width: 5, height: 3, cells: wallCells } },
      weaponView(),
    );
    const plainWallDraws = wallColumns(ctx.drawImage.mock.calls);

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ pose }),
      { ...base, map: { width: 5, height: 3, cells: doorCells } },
      weaponView(),
    );
    const doorDraws = wallColumns(ctx.drawImage.mock.calls);
    const withoutKeycard = ctx.drawImage.mock.calls.length;

    expect(doorDraws).toBe(plainWallDraws); // the door textures the same columns a wall would (not a hole)

    // A keycard between the player and the door projects as extra 1-px billboard columns.
    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ pose, keys: [{ x: 1.8, y: 1.5, color: 'red' as const }] }),
      { ...base, map: { width: 5, height: 3, cells: doorCells } },
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(withoutKeycard); // keycard sprite columns
  });

  it('adds exactly one extra fill (the red overlay) when hurtFlash > 0', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    // Baseline: walls already `fillRect` per column, so compare against a no-flash frame — the flash
    // must add precisely one more fill (a regression that drops `drawHurt` would not).
    ctx.fillRect.mockClear();
    renderer.render(canvas, gameState({ hurtFlash: 0 }), LEVEL_A, weaponView());
    const baseCount = ctx.fillRect.mock.calls.length;

    ctx.fillRect.mockClear();
    renderer.render(canvas, gameState({ hurtFlash: 0.3 }), LEVEL_A, weaponView());
    expect(ctx.fillRect.mock.calls.length).toBe(baseCount + 1);
  });

  it('renders enemies of each kind and projectiles of each skin without throwing and calls drawImage', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    const enemies = [
      {
        x: FRONT_X,
        y: SPAWN_Y,
        dir: 0,
        state: 'alive' as const,
        deathTime: 0,
        hp: 2,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0,
        kind: 'manager' as const,
      },
      {
        x: FRONT_X,
        y: SPAWN_Y + 1,
        dir: 0,
        state: 'alive' as const,
        deathTime: 0,
        hp: 2,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0,
        kind: 'printer' as const,
      },
      {
        x: FRONT_X,
        y: SPAWN_Y - 1,
        dir: 0,
        state: 'alive' as const,
        deathTime: 0,
        hp: 2,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0,
        kind: 'hr' as const,
      },
      {
        x: FRONT_X,
        y: SPAWN_Y,
        dir: 0,
        state: 'dying' as const,
        deathTime: 500,
        hp: 0,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0,
        kind: 'manager' as const,
      },
    ];
    const projectiles = [
      { x: FRONT_X, y: SPAWN_Y, velocityX: 0, velocityY: 0, skin: 'invite' as const },
      { x: FRONT_X, y: SPAWN_Y + 0.5, velocityX: 0, velocityY: 0, skin: 'paper' as const },
      { x: FRONT_X, y: SPAWN_Y - 0.5, velocityX: 0, velocityY: 0, skin: 'memo' as const },
    ];

    expect(() =>
      renderer.render(canvas, gameState({ enemies, projectiles }), LEVEL_A, weaponView()),
    ).not.toThrow();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('renders an enemy mid-wind-up (throw-pose telegraph) without throwing', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    const enemies = [
      {
        x: FRONT_X,
        y: SPAWN_Y,
        dir: 0,
        state: 'alive' as const,
        deathTime: 0,
        hp: 2,
        fireCooldown: 0,
        hitFlash: 0,
        windup: 0.3, // mid-telegraph → the renderer swaps to the throw frame
        kind: 'printer' as const,
      },
    ];

    expect(() =>
      renderer.render(canvas, gameState({ enemies }), LEVEL_A, weaponView()),
    ).not.toThrow();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('adds the white hit-flash tint pass (more draws) when an enemy hitFlash > 0', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    const base = {
      x: FRONT_X,
      y: SPAWN_Y,
      dir: 0,
      state: 'alive' as const,
      deathTime: 0,
      hp: 2,
      fireCooldown: 0,
      windup: 0,
      kind: 'manager' as const,
    };

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ enemies: [{ ...base, hitFlash: 0 }] }),
      LEVEL_A,
      weaponView(),
    );
    const cleanDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ enemies: [{ ...base, hitFlash: HIT_FLASH_DURATION }] }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(cleanDraws); // extra additive tint pass
  });

  it('draws a pale kill-pop burst for a freshly-dying enemy (and nothing without one)', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    // `ctx.fill` is reached only by the kill-pop (walls/hurt use fillRect, the crosshair strokes).
    ctx.fill.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    expect(ctx.fill).not.toHaveBeenCalled();

    ctx.fill.mockClear();
    renderer.render(
      canvas,
      gameState({
        enemies: [
          {
            x: FRONT_X,
            y: SPAWN_Y,
            dir: 0,
            state: 'dying' as const,
            deathTime: 0.05, // < KILL_POP_DURATION → the burst is live
            hp: 0,
            fireCooldown: 0,
            hitFlash: 0,
            windup: 0,
            kind: 'manager' as const,
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );
    expect(ctx.fill).toHaveBeenCalled(); // the expanding death burst
  });

  it('strokes blue electric arcs between chained enemies (more strokes than a clean frame)', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    // A clean frame strokes only the crosshair; add a chain arc dead ahead (both ends on the open spawn
    // throat, in front + unoccluded) → the glow + core strokes land on top.
    ctx.stroke.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseStrokes = ctx.stroke.mock.calls.length;

    ctx.stroke.mockClear();
    renderer.render(
      canvas,
      gameState({ arcs: [{ ax: FRONT_X, ay: SPAWN_Y, bx: FRONT_X - 0.6, by: SPAWN_Y, age: 0 }] }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(baseStrokes); // the arc's glow + core strokes
  });

  it('billboards a travelling player-projectile sprite (more draws than a clean frame)', () => {
    // The effect sprites load via `LoadedImage`, which never decodes under jsdom — stub `ready()` so the
    // projectile sprite "exists" and `drawImage` records its billboard columns (`blitEffect` reads the
    // source dims from `effects.json`, not the image, so a placeholder object suffices).
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;
    // Warm up so the one-time floor/ceiling texel-buffer bakes are cached — we compare STEADY-STATE
    // per-frame draws, not the cold first frame's setup.
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());

    ctx.drawImage.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        playerProjectiles: [
          {
            x: FRONT_X,
            y: SPAWN_Y,
            vx: 1,
            vy: 0,
            directDamage: 55,
            splashDamage: 0,
            splashRadius: 0,
            knockback: 0,
            selfDamage: false,
            chain: null,
            kind: 'rocket',
            impactKind: 'explosion',
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(baseDraws); // the projectile sprite columns
  });

  it('billboards a rotating ammo box (grounded strip cell → more draws than a clean frame)', () => {
    // Same `LoadedImage.ready` stub as the projectile test: the strip "exists" so `blitGroundedCell`
    // records its column draws (it reads the cell dims from `ammo-pickups.json`, not the image).
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;
    // Warm up so the one-time floor/ceiling texel-buffer bakes are cached — we compare STEADY-STATE
    // per-frame draws, not the cold first frame's setup.
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());

    ctx.drawImage.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        ammoPickups: [
          {
            x: FRONT_X,
            y: SPAWN_Y,
            kind: 'box_staples',
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0.5, // a non-zero spin clock picks a mid-turntable frame
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(baseDraws); // the ammo-box sprite columns
  });

  it('draws overlapping ammo boxes FAR → NEAR, so the nearer one paints over the farther (painter’s order)', () => {
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        // Array order is NEAR-then-FAR: without the depth sort the FAR box would draw LAST and wrongly cover
        // the near one. Both sit dead-ahead (same screen column), at different depths, so they overlap.
        ammoPickups: [
          {
            x: FRONT_X - 0.5,
            y: SPAWN_Y,
            kind: 'box_staples',
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0,
          },
          {
            x: FRONT_X,
            y: SPAWN_Y,
            kind: 'box_staples',
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0,
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    const passes = spritePasses(ctx.drawImage.mock.calls);
    const firstSize = Number(passes[0]?.[8]); // first columns drawn = the FAR box (farther → smaller)
    const lastSize = Number(passes.at(-1)?.[8]); // last columns drawn = the NEAR box (nearer → larger)

    expect(lastSize).toBeGreaterThan(firstSize); // near painted AFTER far → correct depth priority
  });

  it('skips an ammo box with an unknown descriptor id (no extra draws)', () => {
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;
    // Warm up so the one-time floor/ceiling texel-buffer bakes are cached — we compare STEADY-STATE
    // per-frame draws, not the cold first frame's setup.
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());

    ctx.drawImage.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({
        ammoPickups: [
          {
            x: FRONT_X,
            y: SPAWN_Y,
            kind: 'box_unknown', // no descriptor → drawn nothing
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0,
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBe(baseDraws); // the unmapped box adds no draws
  });

  it('caps a close projectile to the max-height fraction and drops it below eye level (not screen-filling)', () => {
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    ctx.drawImage.mockClear();
    // A just-fired projectile ~0.6 cells ahead: the raw height/depth scale would nearly fill the canvas
    // dead-centre — the cap keeps it readable and the depth drop sinks it toward the weapon below the crosshair.
    renderer.render(
      canvas,
      gameState({
        playerProjectiles: [
          {
            x: LEVEL_A.spawn.x + 0.6,
            y: SPAWN_Y,
            vx: 1,
            vy: 0,
            directDamage: 55,
            splashDamage: 0,
            splashRadius: 0,
            knockback: 0,
            selfDamage: false,
            chain: null,
            kind: 'rocket',
            impactKind: 'explosion',
          },
        ],
      }),
      LEVEL_A,
      weaponView(),
    );

    const pass = spritePasses(ctx.drawImage.mock.calls)[0];

    expect(pass).toBeDefined();
    const top = Number(pass[6]); // dest y
    const size = Number(pass[8]); // dest height

    expect(size).toBeLessThanOrEqual(64 * 0.28 + 0.5); // capped — not the screen-filling raw height/depth
    expect(top).toBeGreaterThan((64 - size) / 2 + 1); // dropped below the eye-level centre, toward the weapon
  });

  it('animates an impact strip frame at a hit (more draws than a clean frame)', () => {
    vi.spyOn(LoadedImage.prototype, 'ready').mockReturnValue({} as HTMLImageElement);
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    // A clean frame draws no impact; add an explosion impact dead ahead on the open spawn throat.
    ctx.drawImage.mockClear();
    renderer.render(canvas, gameState(), LEVEL_A, weaponView());
    const baseDraws = ctx.drawImage.mock.calls.length;

    ctx.drawImage.mockClear();
    renderer.render(
      canvas,
      gameState({ impacts: [{ x: FRONT_X, y: SPAWN_Y, kind: 'explosion', age: 0 }] }),
      LEVEL_A,
      weaponView(),
    );

    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(baseDraws); // the impact strip-frame columns
  });

  it('leaves imageSmoothingEnabled false after render (hybrid smoothing: crisp sprites last)', () => {
    const renderer = new GameRenderer();
    const canvas = document.createElement('canvas');

    renderer.prepare(LEVEL_A);
    canvas.width = 64;
    canvas.height = 64;

    renderer.render(canvas, gameState(), LEVEL_A, weaponView());

    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  describe('height path', () => {
    it('flags a globally-flat level (sectors present but all base height) as flat', () => {
      const renderer = new GameRenderer();

      // `generateLevel` populates a sector table, but every sector is base floor + full-height ceiling, so
      // the predicate must still read FLAT — the legacy sweep, not the height path.
      renderer.prepare(LEVEL_A);
      expect((renderer as unknown as RendererInternals).levelIsFlat).toBe(true);

      renderer.applyLevel(LEVEL_B);
      expect((renderer as unknown as RendererInternals).levelIsFlat).toBe(true);
    });

    it('flags a level with a non-base sector as NOT flat', () => {
      const renderer = new GameRenderer();

      renderer.prepare(LEVEL_A);
      renderer.applyLevel(heightLevel());
      expect((renderer as unknown as RendererInternals).levelIsFlat).toBe(false);
    });

    it('renders a FLAT level through drawFloorCeiling, never the height path', () => {
      const renderer = new GameRenderer();
      const canvas = document.createElement('canvas');

      renderer.prepare(LEVEL_A);
      canvas.width = 64;
      canvas.height = 64;

      const internals = renderer as unknown as RendererInternals;
      const floorSpy = vi.spyOn(internals, 'drawFloorCeiling');
      const spansSpy = vi.spyOn(internals, 'drawSpans');

      renderer.render(canvas, gameState(), LEVEL_A, weaponView());

      expect(floorSpy).toHaveBeenCalledTimes(1); // legacy full-screen sweep
      expect(spansSpy).not.toHaveBeenCalled(); // height path stays off
      expect(ctx.putImageData).toHaveBeenCalled(); // the cast still lands
    });

    it('renders a HEIGHT level through drawSpans, skipping the legacy floor sweep', () => {
      const renderer = new GameRenderer();
      const canvas = document.createElement('canvas');
      const level = heightLevel();

      renderer.prepare(level); // applies the non-flat level
      canvas.width = 64;
      canvas.height = 64;

      const internals = renderer as unknown as RendererInternals;
      const floorSpy = vi.spyOn(internals, 'drawFloorCeiling');
      const spansSpy = vi.spyOn(internals, 'drawSpans');

      expect(() => renderer.render(canvas, gameState(), level, weaponView())).not.toThrow();

      expect(spansSpy).toHaveBeenCalledTimes(1); // the height-aware floor/ceiling + riser fill
      expect(floorSpy).not.toHaveBeenCalled(); // legacy full-screen sweep is absent
      expect(ctx.putImageData).toHaveBeenCalled(); // pass 1 — the flat strips' ImageData
      expect(ctx.drawImage).toHaveBeenCalled(); // pass 2 risers + the terminal wall slices
    });

    it('paints the riser pass: an extra fog fillRect over the flat strips on a height column', () => {
      const renderer = new GameRenderer();
      const canvas = document.createElement('canvas');
      const level = heightLevel();

      renderer.prepare(level);
      canvas.width = 64;
      canvas.height = 64;

      // The corridor's far cell raises the floor AND drops the ceiling, so the ray crosses two risers; each
      // riser shades with a fog fillRect on top of the per-row wall fillRects — strictly more than the flat
      // baseline, which fills nothing extra. (A regression that dropped the riser pass would not.)
      const pose = { x: 1.5, y: 1.5, dir: 0 };

      ctx.fillRect.mockClear();
      renderer.render(canvas, gameState({ pose }), level, weaponView());

      expect(ctx.fillRect).toHaveBeenCalled(); // wall + riser fog shades, never zero on a visible step
    });
  });
});
