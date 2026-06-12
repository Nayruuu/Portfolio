import {
  castColumns,
  doorColorIndex,
  flatAt,
  floorRow,
  floorZAt,
  isLockedDoor,
  spriteFeetClip,
  surfaceScreenY,
  ARC_DURATION,
  BASE_FLOOR_Z,
  CAMERA_Z,
  DEATH_DURATION,
  EXIT_SWITCH,
  EYE_FRACTION,
  GLASS_BASE,
  HIT_FLASH_DURATION,
  KEYCARD_COLORS,
  VIEW_PITCH_STRETCH,
  WALL_HEIGHT,
  type ColumnProfile,
  type Enemy,
  type EnemyKind,
  type GameMap,
  type GameState,
  type Level,
  type Pose,
  type ProjectileSkin,
  type StepSpan,
} from '../../../../core/lib';
import { impactEffect, projectileEffect } from '../../../../shared/game/effects';
import {
  DOOR_OPEN_STRIP_URL,
  FLAT_TILE_WORLD_SIZE,
  textureById,
  textureForSurface,
  wallTileWorldWidth,
  WALL_TILE_WORLD_WIDTH,
} from './textures';
import { ammoPickupById } from './ammo-pickups';
import {
  buildDoorTextures,
  buildEnemyFrames,
  buildKeycards,
  buildProjectiles,
  buildPickups,
  buildSwitchTexture,
  buildThemeArt,
  ENEMY_SIZE,
} from './game-textures';
import { LoadedImage } from '../../../../shared/game/loaded-image';
import type { WeaponView } from '../../../../shared/game/weapon-view';
import type { ClimbView } from '../../../../shared/game/climb-view';
import {
  enemyView,
  viewRotation,
  TPS_PROJECTILE_URL,
  TPS_PROJECTILE_FRAMES,
  CLIP_PROJECTILE_URL,
  CLIP_PROJECTILE_FRAMES,
  SPREAD_PROJECTILE_URL,
  SPREAD_PROJECTILE_FRAMES,
  type SpriteFrame,
} from './enemy-sprite';

/** 75° field of view; one ray **per backing pixel** (`COLUMN_STEP = 1`) so wall edges + shading are
 *  smooth, not 2-px-stepped. The per-frame column count is bounded by `MAX_BACKING_WIDTH`. */
const FOV = Math.PI / 2.4;
const COLUMN_STEP = 1;
/** Cap the canvas backing width so the per-frame column count stays bounded on big / hi-dpi phones. Sized
 *  to render near 1:1 on a desktop display so the `pixelated` upscale stays crisp (no bilinear smear). */
const MAX_BACKING_WIDTH = 1440;
/** Cap a wall slice at this many screen-heights. A column nearer than `WALL_HEIGHT / 15 ≈ 0.093` cell
 *  would otherwise project taller than the cap; collision (`RADIUS = 0.2`) keeps the camera farther than
 *  that, so it never bites in play — it only guards the per-column `drawImage` against a degenerate
 *  near-zero distance. (Set to 15 so the threshold stays well clear of `RADIUS` at `WALL_HEIGHT = 1.4`.) */
const MAX_SLICE_SCALE = 15;
const SPRITE_SCALE = 0.9; // enemy sprite size relative to a same-distance wall
/** Arm's-reach depth used to PROJECT the climbed ledge's top edge when the centre column has no step riser
 *  to read it from (the player is jammed ~`RADIUS` off the lip, so the face sits a touch beyond that). Only
 *  the fallback path uses it; the normal path reads the rendered riser's screen edge directly. */
const CLIMB_LEDGE_DEPTH = 0.3;
/** The visible band (fractions of screen height) the climbed-ledge grip line is held within: from the reach
 *  near the top down to well past centre, so the hands GRIP the lip then SLIDE DOWN it as the vault hoists
 *  the camera up past them (the pull-up traction), without sliding fully off the bottom. */
const CLIMB_LEDGE_MIN = 0.22;
const CLIMB_LEDGE_MAX = 0.72;
/** The transparent padding fraction below the art's feet (game-textures `baseY = 44` of `SIZE = 48` →
 *  `4 / ENEMY_SIZE = 0.0833`): seats a grounded billboard's VISIBLE feet on the floor row, not the
 *  frame's blank bottom edge. Tied to game-textures — keep `baseY` and this in sync. */
const SPRITE_FLOOR_BIAS = 4 / ENEMY_SIZE;
const FLAT_SIZE = 64; // must match the SIZE used by game-textures' flats
const HIT_RECOIL_PX = 6; // px the billboard flinches upward at full hit-flash
const KILL_POP_DURATION = 0.15; // seconds the pale death burst expands before it fades out
/** Maximum screen-shake amplitude (px) on a fresh damage hit; decays proportionally to hurtFlash. */
const SHAKE_PX = 4;
/** Mirrors the game-step const (0.35 s) — the shake-decay denominator. Must stay in sync. */
const HURT_FLASH_DURATION = 0.35;
/** On-screen HEIGHT of a travelling player-projectile sprite vs a same-distance wall (width follows the
 *  sprite's own aspect); smaller than an enemy so a staple / nail / rocket reads as an in-flight item. */
const PROJECTILE_EFFECT_SCALE = 0.42;
/** Cap a projectile's on-screen height at this fraction of the canvas. A just-fired projectile sits only
 *  ~0.6 cells away, where the raw `height / depth` scale would otherwise nearly FILL the screen dead-centre
 *  on the crosshair — the cap keeps it a readable in-flight item. */
const PROJECTILE_MAX_HEIGHT_FRACTION = 0.28;
/** Each projectile's downward shift is its per-kind `effects.json` `drop` (depth-attenuated, ÷ depth): a
 *  close projectile sits LOW — reading as fired from the weapon below — and climbs back to the crosshair as
 *  it recedes (→ 0 with distance). This is the hard cap on that drop; the one-handed staple/nail carry a
 *  larger per-kind `drop` than the rocket/plasma/BFG so they ride lower. */
const PROJECTILE_MAX_DROP_FRACTION = 0.28; // never drop a projectile more than this far below eye level
/** A just-fired player projectile reads as leaving FROM the crosshair: within this depth (cells) its
 *  on-screen X is pulled toward screen-centre, fading to its true world path as it recedes — so turning or
 *  strafing at the moment of the shot doesn't launch it off to the side ("en biais"). */
const PROJECTILE_CROSSHAIR_BLEND = 2;
/** On-screen HEIGHT of an impact-animation burst vs a same-distance wall — roughly an enemy billboard, so
 *  the spark / frost / explosion covers the struck foe. */
const IMPACT_EFFECT_SCALE = 0.9;
/** On-screen HEIGHT of a grounded vitals pickup (coffee / headphones / RAM) vs a same-distance wall. The
 *  enemy billboard is `SPRITE_SCALE` (0.9) × its `drawScale` (~0.85) ≈ 0.77, so a floor item reads clearly
 *  smaller than a foe. */
const VITALS_PICKUP_SCALE = 0.5;
/** On-screen HEIGHT of a grounded ammo-box billboard vs a same-distance wall — clearly smaller than the
 *  vitals pickups (and ~40% of an enemy billboard) so the spinning ammo boxes read as the smallest floor items. */
const AMMO_PICKUP_SCALE = 0.3;
/** On-screen HEIGHT of a thrown enemy projectile vs a same-distance wall. The binder clip (junior drone) is a
 *  small object → a smaller billboard than the paper/TPS items. */
const PROJECTILE_SCALE = 0.4;
const CLIP_PROJECTILE_SCALE = 0.24;

/** Wall material TEXTURE IDS by cell material id. Ids 1..3 are AMBIENT (zonal: base / cubicle / burnt-out);
 *  4..7 are FEATURE accents the generator PLACES at chosen cells (server room / screen / airlock door /
 *  pillar). The renderer selects by `hit.terminal.cell`; an absent (`present:false`) variant resolves to `undefined`
 *  and the base techbase stands in (so today every wall is base until the variant images are dropped in). */
const WALL_MATERIAL_IDS = [
  'wall_techbase', // 1 — ambient base
  'wall_cubicle', // 2 — ambient
  'wall_damaged', // 3 — ambient burnout
  'wall_servers', // 4 — feature: server room (emissive)
  'wall_screen', // 5 — feature: dashboard accent (emissive)
  'wall_door', // 6 — feature: airlock segment (tile:none)
  'wall_pillar', // 7 — structural: corners / columns
  'wall_servers_b', // 8 — feature: denser server-rack variant (emissive), alternates with 4 in the server room
] as const;

/** Ceiling material TEXTURE IDS by `ceilFlats` id (the generator assigns per room): id 1 → base techbase,
 *  2 → broken-neon, 3 → exposed pipes, 4 → stained/collapsed, 5 → raw concrete. (id 0 stays open sky;
 *  an absent variant falls back to the base ceiling.) */
const CEILING_MATERIAL_IDS = [
  'ceiling_techbase',
  'ceiling_neon_broken',
  'ceiling_technical',
  'ceiling_damaged',
  'ceiling_concrete',
] as const;

/** One queued grounded-billboard draw: its camera `depth` (for the shared FAR → NEAR painter's sort) and a
 *  `paint` closure that does the actual blit. Lets pickups, ammo, keycards and enemies share one z-ordered pass. */
interface SpriteJob {
  depth: number;
  paint: () => void;
}

/**
 * `GameRenderer` — the 2-D canvas painter for `sd-game`: builds the procedural art per theme (wall
 * textures, floor/ceiling flats, enemy frames, switch), sizes the backing store, and paints each frame
 * (floor/ceiling cast → walls → enemy billboards → weapon viewmodel → HUD). The weapon is owned by the
 * component's `WeaponView` (a real sprite); `render` takes it and `drawWeapon` delegates the blit. Co-
 * located plain class (no Angular); browser-only, all DOM access is lazy.
 */
export class GameRenderer {
  private walls: HTMLCanvasElement[] = []; // per-theme wall textures, indexed by wall id
  private floorFlats: Uint32Array[] = []; // each floor flat's pixels, pre-read for fast sampling
  private ceilFlats: Uint32Array[] = []; // each ceiling flat's pixels (index 0 = sky placeholder)
  private switchTexture: HTMLCanvasElement | null = null;
  private doorTextures: HTMLCanvasElement[] = []; // locked-door wall textures, indexed by doorColorIndex
  private keycards: HTMLCanvasElement[] = []; // keycard billboards, indexed by KEYCARD_COLORS
  private enemyFrames: Record<EnemyKind, HTMLCanvasElement[]> = {} as Record<
    EnemyKind,
    HTMLCanvasElement[]
  >;
  private projectiles: Record<ProjectileSkin, HTMLCanvasElement> = {} as Record<
    ProjectileSkin,
    HTMLCanvasElement
  >;
  /** The served enemy-projectile spin strips (TPS report / binder clip) + a reused single-frame canvas to
   *  billboard the current frame from (one cache is safe — each frame is drawn before the next is extracted). */
  private readonly tpsStrip = new LoadedImage(TPS_PROJECTILE_URL);
  private readonly clipStrip = new LoadedImage(CLIP_PROJECTILE_URL);
  private readonly spreadStrip = new LoadedImage(SPREAD_PROJECTILE_URL);
  private spinFrameCanvas: HTMLCanvasElement | null = null;
  /** Index (in `state.enemies`) of the enemy whose OPAQUE sprite pixel sits under the crosshair this frame —
   *  the nearest one not hidden by a wall, see-through its transparent gaps. `null` = nothing aimed at. The
   *  shell reads it via `aimTarget()` so single-ray weapons hit exactly the visible sprite, not a cone/point. */
  private crosshairTarget: number | null = null;
  private pickups: {
    health: HTMLCanvasElement;
    armor: HTMLCanvasElement;
  } | null = null;
  // The world-effects sprites (projectile sprites + impact strips), loaded once + cached by served URL —
  // the "pooling": each image decodes a single time and is reused every frame (no per-frame allocation).
  private readonly effectImages = new Map<string, LoadedImage>();
  // The wall MATERIAL registry, indexed by the cell's material id − 1 (the generator assigns 1..N zonally):
  // each PRESENT variant's served image (loaded once) + its square-pixel tile width, whether it's a unique
  // `tile:none` segment (per-cell, no repeat), and whether it's emissive (full-bright, no depth fog). An
  // absent (`present:false`) variant has a null image; the wall draw then falls back to the base techbase.
  private readonly wallMaterials = WALL_MATERIAL_IDS.map((id) => {
    const texture = textureById(id);

    return {
      image: texture ? new LoadedImage(texture.file) : null,
      tileWidth: wallTileWorldWidth(texture),
      perCell: texture?.tile === 'none',
      emissive: texture?.emissive ?? false,
    };
  });
  // The manifest-driven FLOOR + CEILING textures (`tile: both`): each image is read once into a packed-int
  // pixel buffer (cached by its `LoadedImage`) and sampled per floor/ceiling pixel, tiled at
  // `FLAT_TILE_WORLD_SIZE`. Undecoded / absent surface → the procedural per-theme flats stand in.
  private readonly floorSurface = textureForSurface('floor');
  private readonly floorImage = this.floorSurface ? new LoadedImage(this.floorSurface.file) : null;
  // The ceiling MATERIAL registry, indexed by `ceilFlats` id − 1 (the generator assigns 1..N per room): each
  // PRESENT variant's served image (loaded once), sampled per ceiling pixel. `ceilFlats` id 0 stays open sky;
  // an absent (`present:false`) variant is null and the base ceiling stands in.
  private readonly ceilingMaterials = CEILING_MATERIAL_IDS.map((id) => {
    const texture = textureById(id);

    return texture ? new LoadedImage(texture.file) : null;
  });
  private readonly surfaceTexels = new Map<LoadedImage, { pixels: Uint32Array; size: number }>();
  // The arted LOCKED-DOOR textures, indexed by `doorColorIndex` (= the KEYCARD_COLORS order red/blue/yellow):
  // each colour's served image (loaded once, `tile:none` → one texture per cell). Absent / undecoded → the
  // procedural `doorTextures` colour set stands in (the SSR + pre-decode fallback).
  private readonly lockedDoorImages = KEYCARD_COLORS.map((color) => {
    const texture = textureById(`wall_door_${color}`);

    return texture ? new LoadedImage(texture.file) : null;
  });
  // The 5-frame door-open strip (split-slide), played on the cells of the door currently opening. The shell
  // sets `doorAnimColor` (the opening door's colour index, or null = none) + `doorAnimFrame` (0..4) each
  // frame; `drawWalls` swaps the matching door's closed face for that strip cell. Square 512px frames. It is
  // an animation asset (not a tileable manifest surface), so it loads by its served path directly.
  private readonly doorOpenImage = new LoadedImage(DOOR_OPEN_STRIP_URL);
  private doorAnimColor: number | null = null;
  private doorAnimFrame = 0;
  // The zone-EXIT is drawn as the airlock `wall_door` (its closed face), opening via the same split-slide
  // strip when the shell sets `exitAnimFrame` (0..4 = opening, null = closed). Procedural switch art stands in
  // until the airlock image decodes / for SSR.
  private readonly exitDoorImage = (() => {
    const texture = textureById('wall_door');

    return texture ? new LoadedImage(texture.file) : new LoadedImage('');
  })();
  private exitAnimFrame: number | null = null;
  // The two SEE-THROUGH glass textures (per-pixel alpha: opaque frame, semi-transparent pane), drawn in the
  // transparent pass. Cell `GLASS_BASE` → the tinted partition, `GLASS_BASE + 1` → the clear window.
  private readonly glassImage = this.loadSurfaceImage('glass_partition');
  private readonly glassWindowImage = this.loadSurfaceImage('glass_window');
  // Per-column nearest glass-pane depth (∞ = none) + the current billboard phase relative to the glass.
  // The two-pass render sets `glassPhase` to `'behind'` then `'front'`; the blitters keep only the columns on
  // their side of `glassDepth`, so a pane reads as a transparent surface (front sprites over it, back tinted).
  private glassDepth = new Float32Array(0);
  private glassPhase: 'behind' | 'front' = 'front';
  private level: Level | null = null;
  // True when the current level is globally FLAT (no sectors, or every sector at the base floor + full
  // wall-height ceiling). The whole height-aware path (`drawSpans`) is gated off when set, so a flat level —
  // every shipping level today — renders through the byte-identical legacy `drawFloorCeiling` sweep.
  private levelIsFlat = true;
  private skyColor = '#000';
  private fogColor = '#000';

  /** Build the theme-invariant art (enemy/switch/pickup/projectiles) and the starting level's theme art. */
  public prepare(level: Level): void {
    this.enemyFrames = buildEnemyFrames();
    this.projectiles = buildProjectiles();
    this.switchTexture = buildSwitchTexture();
    this.doorTextures = buildDoorTextures();
    this.keycards = buildKeycards();
    this.pickups = buildPickups();
    this.applyLevel(level);
  }

  /** Swap to a level's theme: rebuild wall/flat art and stash the flat grids. Once per transition. */
  public applyLevel(level: Level): void {
    const art = buildThemeArt(level.theme);

    this.walls = art.walls;
    this.floorFlats = art.floorFlats.map(readPixels);
    this.ceilFlats = art.ceilFlats.map(readPixels);
    this.skyColor = level.theme.sky;
    this.fogColor = level.theme.fog;
    this.level = level;
    // A level is FLAT when it carries no sectors, or every sector sits at the base floor with a full
    // wall-height ceiling — then the height-aware `drawSpans` is skipped and the legacy floor/ceiling sweep
    // runs unchanged. The generator's `sectorize` populates flat sectors today, so this stays true in play.
    const sectors = level.map.sectors;

    this.levelIsFlat =
      !sectors ||
      sectors.every((sector) => sector.floorZ === BASE_FLOOR_Z && sector.ceilZ === WALL_HEIGHT);
  }

  /**
   * Size the canvas backing store to its **displayed** size at near-full resolution (so walls are crisp
   * and smooth, not stretched from a fixed 640×360). Un-rotated (desktop frame / landscape phone): the
   * canvas's own rendered box. Portrait phone: the overlay is CSS-rotated 90° to landscape (laid out at
   * `100dvh × 100dvw`), so its bounding box is the bbox — read the *swapped* viewport dims. Capped by
   * `MAX_BACKING_WIDTH` so the per-frame column count stays bounded. Re-run on resize / rotation.
   */
  public resize(canvas: HTMLCanvasElement, portrait: boolean): void {
    const rect = canvas.getBoundingClientRect();
    const displayWidth = portrait ? window.innerHeight : rect.width;
    const displayHeight = portrait ? window.innerWidth : rect.height;
    const scale = Math.min(1, MAX_BACKING_WIDTH / Math.max(1, displayWidth));

    canvas.width = Math.max(2, Math.round(displayWidth * scale));
    canvas.height = Math.max(2, Math.round(displayHeight * scale));
  }

  /** The shell sets the currently-OPENING keycard door each frame: `colorIndex` (the door colour being
   *  animated, or null = none) + `frame` (0..4 into the split-slide strip). `drawWalls` reads them to play the
   *  open animation on that colour's door cells; null leaves every door drawn closed. */
  public setDoorAnim(colorIndex: number | null, frame: number): void {
    this.doorAnimColor = colorIndex;
    this.doorAnimFrame = frame;
  }

  /** The shell sets the zone-EXIT airlock's open frame each frame: `0..4` while it is opening (the exit
   *  transition), or `null` when closed. `drawWalls` plays the split-slide on the exit cell accordingly. */
  public setExitAnim(frame: number | null): void {
    this.exitAnimFrame = frame;
  }

  /** Index (in `state.enemies`) of the enemy under the crosshair as of the LAST `render` — the nearest one
   *  whose opaque sprite pixel the centre column hits, not occluded by a wall (and see-through transparent
   *  gaps). The shell feeds it to `step` so single-ray weapons hit the visible sprite. `null` = none aimed. */
  public aimTarget(): number | null {
    return this.crosshairTarget;
  }

  /** Paint one frame: cast floor/ceiling, textured walls, depth-occluded enemies, the weapon, crosshair.
   *  The `weapon` viewmodel is blitted in-pipeline (inside the screen-shake, under the hurt flash + crosshair).
   *  Mid auto-mantle (`state.mantle`), the optional `climb` overlay REPLACES the weapon with the two-handed
   *  ledge pull; absent (or no mantle) the weapon draws as usual. */
  public render(
    canvas: HTMLCanvasElement,
    state: GameState,
    level: Level,
    weapon: WeaponView,
    climb?: ClimbView,
  ): void {
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const hits = castColumns(
      state.pose,
      FOV,
      level.map,
      Math.max(1, Math.floor(width / COLUMN_STEP)),
      height,
    );

    const camera = cameraBasis(state.pose);

    // Resolve what the crosshair is on (sprite-accurate) for the shell's next-frame aim. Done once here, not
    // in the twice-run sprite pass, and independent of draw order.
    this.crosshairTarget = this.resolveCrosshair(state, width, height, camera, hits);

    // Smooth sampling for the floor/ceiling cast; `drawWalls` flips to nearest for the pixel-art wall
    // panels, and it stays off for the crisp pixel-art sprites that follow.
    ctx.imageSmoothingEnabled = true;
    // Screen-shake on damage: deterministic jitter (no Math.random), decays with hurtFlash.
    // ctx.save/restore wraps the whole scene so the HUD crosshair remains rock-steady.
    if (state.hurtFlash > 0) {
      const amp = (state.hurtFlash / HURT_FLASH_DURATION) * SHAKE_PX;
      const shakeX = Math.sin(state.hurtFlash * 90) * amp;
      const shakeY = Math.cos(state.hurtFlash * 70) * amp;

      ctx.save();
      ctx.translate(shakeX, shakeY);
    }
    // FLAT level (every shipping level today): the byte-identical legacy sweep. NON-flat: the height-aware
    // span fill replaces it (`drawWalls` still paints the residual terminal-wall window in both cases).
    if (this.levelIsFlat) {
      this.drawFloorCeiling(ctx, width, height, state.pose, level);
    } else {
      this.drawSpans(ctx, width, height, state.pose, hits);
    }
    this.drawWalls(ctx, height, hits);
    ctx.imageSmoothingEnabled = false;
    // Real-glass ordering (a transparent PANE, not an opaque block): per column, the nearest glass depth
    // splits the billboards in two — those BEHIND the glass draw first (so the pane tints them like real
    // glass), then the glass, then those IN FRONT draw over it. The blitters read `glassPhase` + `glassDepth`
    // to keep only their correct-side columns. A column with no glass (depth ∞) draws once, in the front pass.
    if (this.glassDepth.length !== width) {
      this.glassDepth = new Float32Array(width);
    }
    for (let col = 0; col < width; col++) {
      const panes = hits[col].glass;

      this.glassDepth[col] = panes.length > 0 ? panes[0].dist : Number.POSITIVE_INFINITY;
    }

    this.glassPhase = 'behind';
    this.drawWorldSprites(ctx, width, height, state, camera, hits, level.map);
    this.drawGlass(ctx, height, hits);
    this.glassPhase = 'front';
    this.drawWorldSprites(ctx, width, height, state, camera, hits, level.map);
    this.drawArcs(ctx, width, height, state, camera, hits, level.map); // line FX, depth-independent of the pane → drawn once
    // Mid-mantle, the two-handed climb pull REPLACES the weapon (both hands grab the ledge); its frame tracks
    // the hoist's 0..1 `progress`. Otherwise the normal weapon viewmodel. `mantle` is only ever set on a tall
    // climbable ledge (never a staircase step), so this never flashes during ordinary movement.
    if (state.mantle && climb) {
      // Land the hands' grip on the ledge being climbed: anchor to the ACTUAL rendered top edge of the step
      // riser dead ahead (the centre column's `stepFloor` span yTop), so the fingers sit on the drawn lip and
      // track it as the hoist raises the camera. Fallback to the projected ledge top (`targetZ` at a nominal
      // arm's-reach depth) if no riser is in that column (e.g. the ledge is a full wall cell, not a sector step).
      const centre = hits[Math.floor(hits.length / 2)];
      const riser = centre?.spans.find((s): s is StepSpan => s.kind === 'stepFloor');
      const camZ = (state.pose.z ?? 0) + CAMERA_Z;
      const rawLedgeY = riser
        ? riser.yTop
        : surfaceScreenY(camZ - state.mantle.targetZ, CLIMB_LEDGE_DEPTH, height);
      // Keep the grip in a visible upper-middle band: a SHORT ledge's top edge sweeps off the bottom as the
      // camera rises above it within the brief hoist, which would drag the hands off-screen. Clamping holds
      // them gripping the lip in view (a taller ledge tracks freely inside the band).
      const ledgeY = Math.max(
        height * CLIMB_LEDGE_MIN,
        Math.min(height * CLIMB_LEDGE_MAX, rawLedgeY),
      );

      climb.draw(ctx, width, height, state.mantle.progress, ledgeY);
    } else {
      this.drawWeapon(ctx, width, height, weapon, state.bobPhase);
    }
    this.drawHurt(ctx, width, height, state);
    if (state.hurtFlash > 0) {
      ctx.restore();
      ctx.imageSmoothingEnabled = false; // restore() rewinds the state stack; re-assert crisp sprites.
    }
    this.drawHud(ctx, width, height);
  }

  /** Every world BILLBOARD pass (vitals, ammo, keycards, enemies, projectiles, impacts) — run twice by the
   *  render loop, once per glass phase, so each is split correctly around the transparent panes. (Arc line
   *  FX are NOT billboards and are drawn once, outside this.) */
  private drawWorldSprites(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): void {
    // GROUNDED billboards (vitals, ammo, keycards, enemies) all seat on the floor and must mutually occlude
    // by distance — a per-pass z-test only hides each against WALLS, so painting enemies in a separate later
    // pass made them stamp over any pickup regardless of who is nearer. Instead, gather every grounded sprite
    // into ONE queue, sort FAR → NEAR, and paint: now a closer ammo box correctly sits over a farther enemy.
    const grounded = [
      ...this.pickupJobs(ctx, width, height, state, camera, hits, map),
      ...this.ammoPickupJobs(ctx, width, height, state, camera, hits, map),
      ...this.keycardJobs(ctx, width, height, state, camera, hits, map),
      ...this.enemyJobs(ctx, width, height, state, camera, hits, map),
    ];

    grounded.sort((first, second) => second.depth - first.depth).forEach((job) => job.paint());

    // AIRBORNE FX (thrown items at eye level, impacts) ride on top of the grounded layer.
    this.drawProjectiles(ctx, width, height, state, camera, hits, map);
    this.drawPlayerProjectiles(ctx, width, height, state, camera, hits);
    this.drawImpacts(ctx, width, height, state, camera, hits);
  }

  /** Cast textured floor + ceiling per pixel below/above the horizon into one ImageData. Sky cells
   *  (ceil id 0) get the flat sky colour. */
  private drawFloorCeiling(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: Pose,
    level: Level,
  ): void {
    const image = ctx.createImageData(width, height);
    const out = new Uint32Array(image.data.buffer);
    const sky = packColor(this.skyColor);
    const horizon = height >> 1;
    const ceilZ = WALL_HEIGHT - CAMERA_Z; // the eye-to-ceiling height — larger than the eye-to-floor `CAMERA_Z`
    // The manifest floor image + the per-id ceiling material images once decoded (else the procedural per-theme
    // flats below stand in). `ceilTexels[id − 1]` is the baked pixels for `ceilFlats` id (1..N).
    const floorTex = this.surfacePixels(this.floorImage);
    const ceilTexels = this.ceilingMaterials.map((material) => this.surfacePixels(material));

    for (let y = horizon + 1; y < height; y++) {
      // With a LOW, asymmetric eye the floor and ceiling at the same screen distance are NOT mirror images:
      // cast each at the same `p` but its own `surfaceZ`, so the ceiling samples its (farther) world point.
      const floor = floorRow(pose, FOV, y, width, height);
      const ceil = floorRow(pose, FOV, y, width, height, ceilZ);
      const ceilY = height - 1 - y;
      let floorX = floor.worldX;
      let floorY = floor.worldY;
      let ceilX = ceil.worldX;
      let ceilY2 = ceil.worldY;

      for (
        let x = 0;
        x < width;
        x++, floorX += floor.stepX, floorY += floor.stepY, ceilX += ceil.stepX, ceilY2 += ceil.stepY
      ) {
        out[y * width + x] = floorTex
          ? floorTex.pixels[flatTexel(floorX, floorY, floorTex.size, FLAT_TILE_WORLD_SIZE)]
          : (this.floorFlats[flatAt(level.floorFlats, level.map, floorX, floorY)] ??
              this.floorFlats[0])[flatTexel(floorX, floorY, FLAT_SIZE, 1)];

        const ceilId = flatAt(level.ceilFlats, level.map, ceilX, ceilY2);
        const ceilTex = ceilId > 0 ? (ceilTexels[ceilId - 1] ?? ceilTexels[0]) : null;

        out[ceilY * width + x] =
          ceilId === 0
            ? sky
            : ceilTex
              ? ceilTex.pixels[flatTexel(ceilX, ceilY2, ceilTex.size, FLAT_TILE_WORLD_SIZE)]
              : (this.ceilFlats[ceilId] ?? this.ceilFlats[0])[
                  flatTexel(ceilX, ceilY2, FLAT_SIZE, 1)
                ];
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  /** A floor/ceiling texture image read once into a packed-int pixel buffer for per-pixel sampling, cached by
   *  its `LoadedImage`. `null` until the art decodes (browser-only → SSR/test-safe: an undecoded or absent
   *  surface keeps the procedural flats). Baked off-frame the first time it's decoded, then reused. */
  private surfacePixels(image: LoadedImage | null): { pixels: Uint32Array; size: number } | null {
    if (!image) {
      return null;
    }
    const cached = this.surfaceTexels.get(image);

    if (cached) {
      return cached;
    }
    const decoded = image.ready();

    if (!decoded) {
      return null;
    }
    const size = decoded.naturalWidth;
    const canvas = document.createElement('canvas');

    canvas.width = size;
    canvas.height = decoded.naturalHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }
    context.drawImage(decoded, 0, 0);
    const entry = {
      pixels: new Uint32Array(
        context.getImageData(0, 0, size, decoded.naturalHeight).data.buffer.slice(0),
      ),
      size,
    };

    this.surfaceTexels.set(image, entry);

    return entry;
  }

  /**
   * The HEIGHT-AWARE floor/ceiling + riser pass — the non-flat counterpart of `drawFloorCeiling`, run ONLY
   * when `!levelIsFlat` (flat levels keep the byte-identical legacy sweep). Each column's `spans` (near→far,
   * non-overlapping in screen-Y) carry the visible floor/ceiling strips of every sector the ray crossed plus
   * the partial-height risers between sectors of differing height; `drawWalls` still paints the residual
   * terminal-wall window. Two passes, so the `drawImage` risers composite OVER the pixel-filled flats:
   *  1. every FLAT span fills its screen rows into one ImageData via the shared `flatPixel` texel select —
   *     the SAME sampling math `drawFloorCeiling` uses, but at the span's signed eye height + its material;
   *  2. every STEP span blits a partial-height wall slice (like `drawWalls`, bounded to the riser's V range)
   *     with the same depth-fog + side shade.
   */
  private drawSpans(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: Pose,
    hits: ColumnProfile[],
  ): void {
    const camZ = (pose.z ?? 0) + CAMERA_Z;
    const sky = packColor(this.skyColor);
    // The manifest floor image + per-id ceiling material images once decoded (else the procedural flats stand
    // in), read exactly as `drawFloorCeiling` reads them so a shared `flatPixel` select stays consistent.
    const floorTex = this.surfacePixels(this.floorImage);
    const ceilTexels = this.ceilingMaterials.map((material) => this.surfacePixels(material));
    const image = ctx.createImageData(width, height);
    const out = new Uint32Array(image.data.buffer);

    // Pass 1 — the FLAT strips, pixel by pixel into one ImageData (like the legacy sweep).
    for (let col = 0; col < hits.length; col++) {
      for (const span of hits[col].spans) {
        if (span.kind !== 'floor' && span.kind !== 'ceil') {
          continue; // risers are blitted in pass 2, over the filled flats
        }
        // The surface sits at world height `worldZ`; its SIGNED eye-to-surface (negative for a ceiling above
        // the eye) drives the same projection `floorRow` casts the legacy sweep with.
        const eyeToSurface = camZ - span.worldZ;
        const yStart = Math.max(0, Math.round(span.yTop));
        const yEnd = Math.min(height, Math.round(span.yBottom));

        for (let y = yStart; y < yEnd; y++) {
          if (y * 2 === height) {
            continue; // the exact horizon row casts to infinity — never part of a finite strip
          }
          const row = floorRow(pose, FOV, y, width, height, eyeToSurface);
          const worldX = row.worldX + col * row.stepX;
          const worldY = row.worldY + col * row.stepY;

          out[y * width + col] = flatPixel(
            span.kind,
            span.material,
            worldX,
            worldY,
            this.floorFlats,
            this.ceilFlats,
            floorTex,
            ceilTexels,
            sky,
          );
        }
      }
    }
    ctx.putImageData(image, 0, 0);

    // Pass 2 — the STEP risers, blitted over the flats (drawImage can't write into ImageData). `camZ` is
    // the eye altitude already computed for pass 1.
    ctx.imageSmoothingEnabled = false; // nearest-neighbour, like the wall panels
    for (let col = 0; col < hits.length; col++) {
      const x = col * COLUMN_STEP;

      for (const span of hits[col].spans) {
        if (span.kind !== 'stepFloor' && span.kind !== 'stepCeil') {
          continue; // flats were handled in pass 1
        }
        // The riser textures with the base wall material its `cell` (= RISER_CELL) selects — the SAME
        // selection a normal wall id takes in `drawWalls`: the decoded image, else the procedural theme wall.
        const own = this.wallMaterials[span.cell - 1];
        const material = own?.image?.ready() ? own : this.wallMaterials[0];
        const pngWall = material.image?.ready() ?? null;
        const source: CanvasImageSource | undefined = pngWall ?? this.walls[span.cell];

        if (source) {
          const srcW = pngWall ? pngWall.naturalWidth : (source as HTMLCanvasElement).width;
          const srcH = pngWall ? pngWall.naturalHeight : (source as HTMLCanvasElement).height;

          if (srcW > 1) {
            // Tile HORIZONTALLY at the material's square-pixel world width (the continuous `wallU`, wrapped to
            // 0..1) — EXACTLY like `drawWalls`. The old per-cell `texX` crammed the whole texture across ONE
            // world cell, but a square-texel tile is `tileWidth` (≈2.8) cells wide, so the face stretched ~2.8×
            // wide (the "ça s'étire" step face). The procedural / `tile:none` fallback stays per-cell.
            const u =
              pngWall && !material.perCell
                ? (((span.wallU / material.tileWidth) % 1) + 1) % 1
                : span.texX;
            const textureX = Math.floor(u * srcW) % srcW;
            // VERTICAL TILING at world scale — the SAME fix `drawWalls` uses for point-blank stretch. The old
            // riser blit stretched its single `vTop`..`vBottom` V range over the clipped band; because the step
            // top sits near the eye horizon, the visible V range COLLAPSED toward one texel as you approached
            // (and `vTop > vBottom` even made the source height negative → flipped/degenerate), smearing the
            // face into the "sprite that rises". Instead, recover the riser's UNCLIPPED screen extent (high
            // floor edge `yFullTop` → low floor edge `yFullBot`), anchor the texture's bottom (V=1) at its foot,
            // lay copies `tileScreenH` tall (the texture's `tileWidth` world units projected), and clip each to
            // both the riser's real extent AND the occlusion window — upright, square-texeled, world-pinned.
            const yFullTop = surfaceScreenY(camZ - span.vTop * WALL_HEIGHT, span.depth, height); // high edge
            const yFullBot = surfaceScreenY(camZ - span.vBottom * WALL_HEIGHT, span.depth, height); // low edge
            const texWorldHeight = (srcH * material.tileWidth) / srcW;
            const tileScreenH = pngWall
              ? (VIEW_PITCH_STRETCH * height * texWorldHeight) / span.depth
              : yFullBot - yFullTop;
            const winTop = Math.max(span.yTop, yFullTop);
            const winBottom = Math.min(span.yBottom, yFullBot);

            if (tileScreenH > 0 && winBottom > winTop) {
              const skip = Math.max(0, Math.floor((yFullBot - winBottom) / tileScreenH));

              for (
                let yBottom = yFullBot - skip * tileScreenH;
                yBottom > winTop;
                yBottom -= tileScreenH
              ) {
                const yTop = yBottom - tileScreenH;
                const drawTop = Math.max(yTop, winTop);
                const drawBottom = Math.min(yBottom, winBottom);

                if (drawBottom <= drawTop) {
                  continue;
                }
                const v0 = (drawTop - yTop) / tileScreenH;
                const v1 = (drawBottom - yTop) / tileScreenH;

                ctx.drawImage(
                  source,
                  textureX,
                  v0 * srcH,
                  1,
                  (v1 - v0) * srcH,
                  x,
                  drawTop,
                  COLUMN_STEP + 1,
                  drawBottom - drawTop,
                );
              }
            }
          }
        }
        // The SAME depth-fog + side shade `drawWalls` applies to a (non-emissive) wall slice — `depth` for
        // the distance fog, `side` for the y-facing darkening.
        const shade = Math.max(0.2, 1 - span.depth / 9) * (span.side === 1 ? 0.72 : 1);

        ctx.globalAlpha = 1 - shade;
        ctx.fillStyle = this.fogColor;
        ctx.fillRect(x, span.yTop, COLUMN_STEP + 1, span.yBottom - span.yTop);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** The textured, depth-shaded wall columns. A generic wall samples the manifest wall image, tiled across
   *  cells at its square-pixel world width (`WALL_TILE_WORLD_WIDTH` via the continuous `hit.terminal.wallU`); a locked
   *  door / the exit switch keep their own per-cell art; the procedural theme wall stands in until the image
   *  decodes. Nearest-neighbour throughout for the retro pixel look. */
  private drawWalls(ctx: CanvasRenderingContext2D, height: number, hits: ColumnProfile[]): void {
    ctx.imageSmoothingEnabled = false; // nearest-neighbour: crisp pixel-art wall panels, no bilinear blur

    for (let column = 0; column < hits.length; column++) {
      const hit = hits[column];
      // Project the full `WALL_HEIGHT`-tall wall, vertically exaggerated by `VIEW_PITCH_STRETCH` (DOOM's
      // 1.2× pixel stretch), and split it around the horizon by the LOW eye (`EYE_FRACTION` below, the rest
      // above) so the player looks UP at the wall. The bottom lands on the floor cast, the top on the
      // ceiling cast (both eye-low + stretched to match). The cap only guards a degenerate near-zero
      // distance (see `MAX_SLICE_SCALE`); never reached in normal play.
      // FLAT levels: the legacy full-`WALL_HEIGHT` projection (byte-identical). HEIGHT levels: the wall fills
      // the residual occlusion window the sector march left at the terminal (`terminalTop`..`terminalBottom`),
      // so it MEETS the floor/ceiling spans exactly — the flat projection assumes floor 0 / ceiling WALL_HEIGHT
      // and would leave a gap (the "floor disappears" bug) wherever the terminal sector sits at another height.
      const flatSlice = Math.min(
        height * MAX_SLICE_SCALE,
        (VIEW_PITCH_STRETCH * height * WALL_HEIGHT) / hit.terminal.dist,
      );
      const top = this.levelIsFlat ? height / 2 - flatSlice * (1 - EYE_FRACTION) : hit.terminalTop;
      const sliceHeight = this.levelIsFlat
        ? flatSlice
        : Math.max(0, hit.terminalBottom - hit.terminalTop);
      const x = column * COLUMN_STEP;
      // A locked door textures from its colour set; the exit switch from its own art; a generic wall from
      // the MATERIAL its cell value selects (`hit.terminal.cell` 1..N → base / cubicle / burnt image, drawn directly —
      // null until it decodes / for door+switch), falling back to the procedural theme wall. (A bare
      // `walls[hit.terminal.cell]` would be undefined for door ids 10..12.)
      const door = isLockedDoor(hit.terminal.cell);
      const isSwitch = hit.terminal.cell === EXIT_SWITCH;
      // A DOOR-LIKE cell (a keycard door OR the airlock zone-EXIT) is per-cell `tile:none` art: a closed face
      // (the coloured keycard door / the exit airlock), swapped for the 5-frame split-slide strip while it is
      // OPENING. The open frame is `doorAnimFrame` for the matching keycard colour, or `exitAnimFrame` for the
      // exit; `null` = closed. Both fall back to the procedural switch/door canvas until the art decodes / SSR.
      const doorLike = door || isSwitch;
      const animFrame = door
        ? this.doorAnimColor === doorColorIndex(hit.terminal.cell)
          ? this.doorAnimFrame
          : null
        : isSwitch
          ? this.exitAnimFrame
          : null;
      const openingDoor = animFrame !== null ? (this.doorOpenImage.ready() ?? null) : null;
      const closedFace = door
        ? (this.lockedDoorImages[doorColorIndex(hit.terminal.cell)]?.ready() ?? null)
        : isSwitch
          ? (this.exitDoorImage.ready() ?? null)
          : null;
      const doorPng = openingDoor ?? closedFace;
      // Generic wall: the material its cell value selects, falling back to the BASE techbase when that
      // variant is absent (`present:false`) or still decoding. Door-like cells keep their own per-cell art.
      const own = !doorLike ? this.wallMaterials[hit.terminal.cell - 1] : undefined;
      const material = own?.image?.ready() ? own : this.wallMaterials[0];
      const pngWall = !doorLike ? (material.image?.ready() ?? null) : null;
      // An image source (a tiling wall material OR a per-cell arted door) vs the procedural canvas fallbacks.
      const pngImage = pngWall ?? doorPng;
      const source: CanvasImageSource | undefined = doorLike
        ? (doorPng ??
          (door
            ? this.doorTextures[doorColorIndex(hit.terminal.cell)]
            : (this.switchTexture ?? undefined)))
        : (pngWall ?? this.walls[hit.terminal.cell]);

      if (source) {
        const srcW = pngImage ? pngImage.naturalWidth : (source as HTMLCanvasElement).width;
        const srcH = pngImage ? pngImage.naturalHeight : (source as HTMLCanvasElement).height;

        if (srcW > 1) {
          let textureX: number;

          if (doorLike) {
            // A door-like cell is per-cell (`texX`, never tiled). An OPENING door maps that into its current
            // square 512px animation frame (`animFrame` × frame width); a closed door is its single frame.
            const frameW = openingDoor ? srcH : srcW;
            const local = Math.floor(hit.terminal.texX * frameW) % frameW;

            textureX = openingDoor ? (animFrame ?? 0) * frameW + local : local;
          } else {
            // A wall image tiles HORIZONTALLY at its material's square-pixel world width (the continuous `wallU`,
            // wrapped to 0..1) unless it's `tile:none` (per-cell `texX`); the procedural theme wall is per-cell.
            const u = pngWall
              ? material.perCell
                ? hit.terminal.texX
                : (((hit.terminal.wallU / material.tileWidth) % 1) + 1) % 1
              : hit.terminal.texX;

            textureX = Math.floor(u * srcW) % srcW;
          }

          // Vertical TILING (DOOM-style square texels): repeat the wall texture at a fixed WORLD scale up the
          // wall instead of stretching ONE copy 0→1 over the taller-than-square wall (which smears to a
          // point-blank vertical stretch). Recover the wall's full screen span + bottom edge, then lay copies
          // `tileScreenH` tall (= the texture's `tileWidth` world units projected) from the bottom up, each
          // clipped to the visible window. Doors / procedural art keep a single non-tiled copy (`tileScreenH`
          // = the whole wall span) → byte-identical for them.
          const winTop = top;
          const winBottom = top + sliceHeight;
          const vRange = hit.terminalVBottom - hit.terminalVTop;
          const span = this.levelIsFlat
            ? flatSlice
            : vRange > 0
              ? (hit.terminalBottom - hit.terminalTop) / vRange
              : sliceHeight;
          const wallBottomY =
            (this.levelIsFlat ? top : hit.terminalTop - hit.terminalVTop * span) + span;
          // One texture copy spans `texWorldHeight` world units — the SQUARE-texel height: the texture is
          // `srcW` texels over `tileWidth` world wide, so `srcH` texels span `srcH·tileWidth/srcW` world tall.
          const texWorldHeight = (srcH * material.tileWidth) / srcW;
          const tileScreenH = pngWall
            ? (VIEW_PITCH_STRETCH * height * texWorldHeight) / hit.terminal.dist
            : span;

          if (sliceHeight > 0 && tileScreenH > 0) {
            // Start at the lowest copy that still reaches into the window (skip copies entirely below it).
            const skip = Math.max(0, Math.floor((wallBottomY - winBottom) / tileScreenH));

            for (
              let yBottom = wallBottomY - skip * tileScreenH;
              yBottom > winTop;
              yBottom -= tileScreenH
            ) {
              const yTop = yBottom - tileScreenH;
              const drawTop = Math.max(yTop, winTop);
              const drawBottom = Math.min(yBottom, winBottom);

              if (drawBottom <= drawTop) {
                continue;
              }
              const v0 = (drawTop - yTop) / tileScreenH;
              const v1 = (drawBottom - yTop) / tileScreenH;

              ctx.drawImage(
                source,
                textureX,
                v0 * srcH,
                1,
                (v1 - v0) * srcH,
                x,
                drawTop,
                COLUMN_STEP + 1,
                drawBottom - drawTop,
              );
            }
          }
        }
      }
      // Depth + side cue: darken the slice with distance (and y-facing walls a touch more) — UNLESS the
      // material is emissive (server LEDs / live screens), which draws FULL-BRIGHT (no fog).
      if (!(pngWall && material.emissive)) {
        const shade =
          Math.max(0.2, 1 - hit.terminal.dist / 9) * (hit.terminal.side === 1 ? 0.72 : 1);

        ctx.globalAlpha = 1 - shade;
        ctx.fillStyle = this.fogColor;
        ctx.fillRect(x, top, COLUMN_STEP + 1, sliceHeight);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** A served texture loaded once (browser-only via `LoadedImage`), or `null` if the manifest declares no
   *  such surface. Used for the wall-adjacent surfaces (the two glass panes) drawn directly per column. */
  private loadSurfaceImage(surface: string): LoadedImage | null {
    const texture = textureForSurface(surface);

    return texture ? new LoadedImage(texture.file) : null;
  }

  /** The SEE-THROUGH glass pass: for every column, each glass pane the ray crossed (`hit.glass`) is blitted
   *  back-to-front (far → near) at its own depth, tiled horizontally at `WALL_TILE_WORLD_WIDTH` like a wall.
   *  The image's per-pixel alpha does the work — the metal frame is opaque, the pane is semi-transparent, so
   *  the already-drawn world behind it (opaque wall + floor/ceiling + enemies in the next room) shows
   *  through. Drawn over the whole scene: a sprite in FRONT of a pane therefore picks up a faint pane tint
   *  (a column renderer with no depth buffer can't crisply occlude it — a known, mild limitation). No fog. */
  private drawGlass(ctx: CanvasRenderingContext2D, height: number, hits: ColumnProfile[]): void {
    const partition = this.glassImage?.ready() ?? null;
    const window = this.glassWindowImage?.ready() ?? null;

    if (!partition && !window) {
      return; // no glass art decoded yet
    }
    ctx.imageSmoothingEnabled = false; // crisp pixel-art panes

    for (let column = 0; column < hits.length; column++) {
      const panes = hits[column].glass;

      if (panes.length === 0) {
        continue;
      }
      const x = column * COLUMN_STEP;

      // `panes` is near→far; draw far→near so a nearer pane blends over a farther one.
      for (let p = panes.length - 1; p >= 0; p--) {
        const pane = panes[p];
        const image = pane.cell === GLASS_BASE ? partition : window;

        if (!image) {
          continue;
        }
        const sliceHeight = Math.min(
          height * MAX_SLICE_SCALE,
          (VIEW_PITCH_STRETCH * height * WALL_HEIGHT) / pane.dist,
        );
        const top = height / 2 - sliceHeight * (1 - EYE_FRACTION);
        const srcW = image.naturalWidth;
        const u = (((pane.wallU / WALL_TILE_WORLD_WIDTH) % 1) + 1) % 1;
        const textureX = Math.floor(u * srcW) % srcW;

        ctx.drawImage(
          image,
          textureX,
          0,
          1,
          image.naturalHeight,
          x,
          top,
          COLUMN_STEP + 1,
          sliceHeight,
        );
      }
    }
  }

  /** The nearest ALIVE enemy whose silhouette the crosshair COLUMN crosses — i.e. the centre screen column
   *  hits at least one OPAQUE pixel of its sprite — not hidden by a wall, seen-through transparent gaps. The
   *  sprite-accurate aim target, or `null`. Because this engine has NO vertical aim (the crosshair rides the
   *  horizon), the test is the full vertical COLUMN of the sprite, not just the horizon row — so the hittable
   *  width is the body's actual silhouette at every height, not whatever the horizon happens to cross. */
  private resolveCrosshair(
    state: GameState,
    width: number,
    height: number,
    camera: Camera,
    hits: ColumnProfile[],
  ): number | null {
    const cx = width / 2;
    const col = Math.floor(cx);
    let target: number | null = null;
    let bestDepth = Infinity;

    if (col < 0 || col >= width) {
      return null;
    }
    for (let index = 0; index < state.enemies.length; index++) {
      const enemy = state.enemies[index];

      if (enemy.state !== 'alive') {
        continue;
      }
      const transform = project(enemy.x, enemy.y, state.pose, camera);

      // Skip a foe behind the camera, farther than the current best, or hidden by a wall at the crosshair column.
      if (
        transform.depth <= 0.1 ||
        transform.depth >= bestDepth ||
        transform.depth >= hits[col].terminal.dist
      ) {
        continue;
      }
      const view = enemyView(enemy.kind);
      const rotation = viewRotation(enemy.x, enemy.y, enemy.dir, state.pose.x, state.pose.y);
      const sprite = view?.frameFor(enemy, rotation);

      if (!sprite) {
        continue;
      }
      // Only the horizontal extent matters (no vertical aim): the billboard width + where its content sits.
      // NOTE: the on-screen size derives from `height / depth` (matching `drawEnemies`), NOT width — using
      // width here inflated the hitbox by the aspect of the backing store, so shots landed beside the sprite.
      const drawW =
        Math.abs(height / transform.depth) * SPRITE_SCALE * sprite.drawScale * sprite.aspect;
      const left =
        (width / 2) * (1 + transform.cameraX / transform.depth) - drawW * sprite.anchorXFrac;

      if (cx < left || cx >= left + drawW) {
        continue; // the crosshair column is outside this enemy's billboard
      }
      if (this.spriteColumnOpaque(sprite, left, drawW, cx)) {
        target = index;
        bestDepth = transform.depth;
      }
    }

    return target;
  }

  /** Whether the sprite's source COLUMN under screen-x `px` contains ANY opaque pixel — read once from its
   *  baked (hard-edged) atlas canvas. Treated as opaque when the source isn't a readable canvas (SSR / the
   *  un-baked fallback), so hit detection degrades to the billboard box rather than failing. */
  private spriteColumnOpaque(
    sprite: SpriteFrame,
    left: number,
    drawW: number,
    px: number,
  ): boolean {
    const canvas = sprite.image;

    if (!(typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement)) {
      return true;
    }
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return true;
    }
    const u = sprite.flip ? 1 - (px - left) / drawW : (px - left) / drawW;
    const srcX = Math.min(
      sprite.sx + sprite.sw - 1,
      Math.max(sprite.sx, Math.floor(sprite.sx + u * sprite.sw)),
    );

    try {
      const column = ctx.getImageData(srcX, sprite.sy, 1, sprite.sh).data;

      for (let i = 3; i < column.length; i += 4) {
        if (column[i] > 128) {
          return true; // an opaque pixel somewhere down this column → the crosshair is on the body
        }
      }

      return false;
    } catch {
      return true; // cross-origin / unreadable → fall back to the box
    }
  }

  /** Project each enemy (INCLUDING the 'dead' — a corpse stays on the floor, its death atlas frozen on the
   *  last frame, so kills leave a body behind) to a grounded-billboard job for the shared FAR → NEAR pass. */
  private enemyJobs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): SpriteJob[] {
    const camZ = (state.pose.z ?? 0) + CAMERA_Z;

    return state.enemies
      .map((enemy) => ({ enemy, transform: project(enemy.x, enemy.y, state.pose, camera) }))
      .filter((item) => item.transform.depth > 0.1)
      .map(({ enemy, transform }) => ({
        depth: transform.depth,
        paint: (): void =>
          this.paintEnemy(ctx, width, height, state, camera, hits, map, enemy, transform, camZ),
      }));
  }

  /** Paint one projected enemy billboard: pick its directional/procedural sprite, blit it depth-occluded,
   *  then the additive hit-flash wash and the kill-pop. (The body of the old `drawEnemies` loop, per enemy.) */
  private paintEnemy(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
    enemy: Enemy,
    transform: { cameraX: number; depth: number },
    camZ: number,
  ): void {
    const depth = transform.depth;
    const spriteSize = Math.abs(height / depth) * SPRITE_SCALE;
    const screenX = (width / 2) * (1 + transform.cameraX / depth);
    // A live, freshly-hit enemy flashes white + flinches up; a dying one carries a frozen flash, so
    // gate the tint to 'alive' and let the kill-pop own the death feedback.
    const flash =
      enemy.state === 'alive' && enemy.hitFlash > 0
        ? Math.min(1, enemy.hitFlash / HIT_FLASH_DURATION)
        : 0;
    // Anchor the sprite's VISIBLE feet to its SECTOR floor row at its depth (raised → higher, pit → lower).
    // A flat sector keeps `floorZAt` 0 → the legacy `floorScreenY` value.
    const floorZSprite = floorZAt(map, enemy.x, enemy.y);
    const floorY = surfaceScreenY(camZ - floorZSprite, depth, height);

    // An arted enemy uses its DIRECTIONAL billboard (8-octant + per-state animation, geometry carried on the
    // frame). A kind with no view — or one whose atlas hasn't decoded yet — falls back to the procedural frame.
    const view = enemyView(enemy.kind);
    const rotation = viewRotation(enemy.x, enemy.y, enemy.dir, state.pose.x, state.pose.y);
    const sprite = view?.frameFor(enemy, rotation) ?? null;

    let centerY: number;
    let paint: () => void;

    if (sprite) {
      const drawH = spriteSize * sprite.drawScale;
      const drawW = drawH * sprite.aspect; // the cell is taller than wide → a narrower billboard
      const top = floorY - drawH * sprite.anchorYFrac - flash * HIT_RECOIL_PX; // feet anchor on the floor
      const left = screenX - drawW * sprite.anchorXFrac;

      centerY = top + drawH / 2;
      paint = (): void =>
        this.blitDirectional(
          ctx,
          sprite,
          left,
          top,
          drawW,
          drawH,
          depth,
          hits,
          width,
          floorZSprite,
        );
    } else {
      const frame = this.frameFor(enemy);
      const startX = Math.floor(screenX - spriteSize / 2);
      const top = floorY - spriteSize * (1 - SPRITE_FLOOR_BIAS) - flash * HIT_RECOIL_PX;

      centerY = top + spriteSize / 2;
      paint = (): void =>
        this.blitBillboard(ctx, frame, startX, top, spriteSize, depth, hits, width, floorZSprite);
    }

    paint();
    if (flash > 0) {
      // Re-blit additively: 'lighter' tints only the opaque pixels, so the white wash clips to the sprite
      // footprint (a flat rect would glow the transparent margins too).
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flash;
      paint();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (enemy.state === 'dying' && enemy.deathTime < KILL_POP_DURATION) {
      this.drawKillPop(ctx, screenX, centerY, spriteSize, enemy.deathTime, depth, hits, width);
    }
  }

  /** Blit one depth-occluded enemy billboard column-by-column (the sprite pass + the hit-flash pass). */
  private blitBillboard(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
    startX: number,
    top: number,
    spriteSize: number,
    depth: number,
    hits: ColumnProfile[],
    width: number,
    floorZSprite: number,
  ): void {
    for (let col = startX; col < startX + spriteSize; col++) {
      if (col < 0 || col >= width || depth >= hits[col].terminal.dist) {
        continue; // off-screen or behind a wall
      }
      if (
        this.glassPhase === 'behind' ? depth <= this.glassDepth[col] : depth > this.glassDepth[col]
      ) {
        continue; // keep only this phase's side of the nearest glass pane
      }
      // Clip the feet against the nearer "hill in front" (a higher, closer floor surface hides the lower
      // body); a flat level has no higher floor strip → `spriteFeetClip` keeps the full height (byte-identical).
      const clipBottom = spriteFeetClip(hits[col].spans, depth, floorZSprite, top + spriteSize);
      const drawnHeight = clipBottom - top;

      if (drawnHeight <= 0) {
        continue; // fully hidden behind a nearer step
      }
      const sourceColumn = Math.floor(((col - startX) / spriteSize) * frame.width);

      ctx.drawImage(
        frame,
        sourceColumn,
        0,
        1,
        (drawnHeight / spriteSize) * frame.height,
        col,
        top,
        1,
        drawnHeight,
      );
    }
  }

  /** Blit a DIRECTIONAL atlas sprite (the zombie) column-by-column with the same depth + glass + feet-clip
   *  occlusion as `blitBillboard`, but from an atlas SOURCE RECT at an explicit screen `drawW`×`drawH` (the
   *  cell is taller than wide) and an optional horizontal MIRROR (the `rotation_map` flip). */
  private blitDirectional(
    ctx: CanvasRenderingContext2D,
    sprite: SpriteFrame,
    left: number,
    top: number,
    drawW: number,
    drawH: number,
    depth: number,
    hits: ColumnProfile[],
    width: number,
    floorZSprite: number,
  ): void {
    const startX = Math.floor(left);
    const span = Math.max(1, Math.round(drawW));

    for (let col = startX; col < startX + span; col++) {
      if (col < 0 || col >= width || depth >= hits[col].terminal.dist) {
        continue; // off-screen or behind a wall
      }
      if (
        this.glassPhase === 'behind' ? depth <= this.glassDepth[col] : depth > this.glassDepth[col]
      ) {
        continue; // keep only this phase's side of the nearest glass pane
      }
      const clipBottom = spriteFeetClip(hits[col].spans, depth, floorZSprite, top + drawH);
      const drawnHeight = clipBottom - top;

      if (drawnHeight <= 0) {
        continue; // fully hidden behind a nearer step
      }
      const u = (col - startX) / span; // 0..1 across the billboard
      const sampleU = sprite.flip ? 1 - u : u; // mirror right-facing octants
      const sourceColumn = sprite.sx + Math.min(sprite.sw - 1, Math.floor(sampleU * sprite.sw));

      ctx.drawImage(
        sprite.image,
        sourceColumn,
        sprite.sy,
        1,
        (drawnHeight / drawH) * sprite.sh,
        col,
        top,
        1,
        drawnHeight,
      );
    }
  }

  /** A brief pale burst at a freshly-killed enemy's centre — expands + fades across KILL_POP_DURATION. */
  private drawKillPop(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    spriteSize: number,
    deathTime: number,
    depth: number,
    hits: ColumnProfile[],
    width: number,
  ): void {
    const column = Math.floor(centerX);

    if (column < 0 || column >= width || depth >= hits[column].terminal.dist) {
      return; // centre off-screen or behind a wall
    }
    const progress = deathTime / KILL_POP_DURATION; // 0 → 1
    const radius = spriteSize * (0.18 + progress * 0.45);
    const alpha = (1 - progress) * 0.75;
    const burst = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

    burst.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    burst.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = burst;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Blit the first-person weapon viewmodel — delegated to its `WeaponView`, which owns the sprite +
   *  animation and draws nothing until the art decodes. */
  private drawWeapon(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    weapon: WeaponView,
    bobPhase: number,
  ): void {
    weapon.draw(ctx, width, height, bobPhase);
  }

  /** Draw one depth-occluded billboard sprite at world (wx,wy). Shared by pickups + projectiles. */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: Pose,
    camera: Camera,
    worldX: number,
    worldY: number,
    sprite: HTMLCanvasElement,
    scale: number,
    hits: ColumnProfile[],
    map: GameMap,
    airborne = false,
  ): void {
    const { cameraX, depth } = project(worldX, worldY, pose, camera);

    if (depth <= 0.1) {
      return;
    }
    const size = Math.abs(height / depth) * scale;
    const screenX = (width / 2) * (1 + cameraX / depth);
    const startX = Math.floor(screenX - size / 2);
    // Grounded sprites (pickups) seat their visible feet on their SECTOR floor row (raised → higher, pit →
    // lower; flat → the legacy `floorScreenY` value); airborne ones (projectiles) stay horizon-centred at eye
    // level, so a thrown item arcs at you rather than skidding on the floor.
    const camZ = (pose.z ?? 0) + CAMERA_Z;
    const floorZSprite = floorZAt(map, worldX, worldY);
    const floorY = surfaceScreenY(camZ - floorZSprite, depth, height);
    const top = airborne ? (height - size) / 2 : floorY - size * (1 - SPRITE_FLOOR_BIAS);

    for (let col = startX; col < startX + size; col++) {
      if (col < 0 || col >= width || depth >= hits[col].terminal.dist) {
        continue;
      }
      if (
        this.glassPhase === 'behind' ? depth <= this.glassDepth[col] : depth > this.glassDepth[col]
      ) {
        continue; // keep only this phase's side of the nearest glass pane
      }
      const sourceColumn = Math.floor(((col - startX) / size) * sprite.width);
      // Clip against the nearer "hill in front": for a grounded sprite the step's nosing hides its feet; for
      // an airborne one (a thrown item at eye level) a taller step/stage hides its lower body just the same.
      // A flat level has no higher floor → `spriteFeetClip` returns the full height (byte-identical).
      const clipBottom = spriteFeetClip(hits[col].spans, depth, floorZSprite, top + size);
      const drawnHeight = clipBottom - top;

      if (drawnHeight <= 0) {
        continue; // fully hidden behind a nearer step
      }
      ctx.drawImage(
        sprite,
        sourceColumn,
        0,
        1,
        (drawnHeight / size) * sprite.height,
        col,
        top,
        1,
        drawnHeight,
      );
    }
  }

  /** Vitals pickups (coffee / headphones / RAM) as grounded-billboard jobs for the shared z-ordered pass. */
  private pickupJobs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): SpriteJob[] {
    const art = this.pickups;

    if (!art) {
      return [];
    }

    return state.pickups
      .map((pickup) => ({ pickup, depth: project(pickup.x, pickup.y, state.pose, camera).depth }))
      .filter((item) => item.depth > 0.1)
      .map(({ pickup, depth }) => ({
        depth,
        paint: (): void => {
          const sprite = pickup.kind === 'health' ? art.health : art.armor;

          this.drawSprite(
            ctx,
            width,
            height,
            state.pose,
            camera,
            pickup.x,
            pickup.y,
            sprite,
            VITALS_PICKUP_SCALE,
            hits,
            map,
          );
        },
      }));
  }

  /** The rotating ammo boxes as grounded billboards: look the descriptor up by `kind`, fetch its cached
   *  turntable strip, pick the spin frame from `age` (`floor(age × 1000 / frameMs) % frames`), and blit the
   *  cell GROUNDED (feet on the floor row, like the vitals pickups), cell-sampled + aspect-preserved
   *  (cellW/cellH), NEAREST, occluded by the wall z-buffer. The spin is BAKED INTO THE FRAMES — the quad is
   *  never rotated. Data-driven: the same path serves every ammo type by swapping the descriptor + strip. */
  private ammoPickupJobs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): SpriteJob[] {
    return state.ammoPickups
      .map((pickup) => ({ pickup, depth: project(pickup.x, pickup.y, state.pose, camera).depth }))
      .filter((item) => item.depth > 0.1)
      .map(({ pickup, depth }) => ({
        depth,
        paint: (): void => {
          const descriptor = ammoPickupById(pickup.kind);

          if (!descriptor) {
            return; // an unmapped id → nothing to draw
          }
          const image = this.effectImage(descriptor.sprite.strip);

          if (!image) {
            return; // not decoded yet (SSR / first frames) → draw nothing
          }
          const { frames, frameMs, cellW, cellH, anchorX } = descriptor.sprite;
          const frame = Math.floor((pickup.age * 1000) / frameMs) % frames;

          this.blitGroundedCell(
            ctx,
            width,
            height,
            state.pose,
            camera,
            pickup.x,
            pickup.y,
            image,
            frame * cellW,
            cellW,
            cellH,
            AMMO_PICKUP_SCALE,
            hits,
            anchorX,
            map,
          );
        },
      }));
  }

  /** Billboard one strip cell GROUNDED at world (worldX, worldY): face-camera, distance-scaled (on-screen
   *  HEIGHT = |screenH / depth| × `scale`, width following the cell aspect), feet seated on the floor row
   *  (like `drawSprite`), NEAREST, occluded column-by-column by the wall z-buffer. `sourceX` / `sourceWidth`
   *  select the strip cell; the cell spans the full source height. The grounded, cell-sampled sibling of the
   *  airborne `blitEffect` — used by the rotating ammo boxes. */
  private blitGroundedCell(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: Pose,
    camera: Camera,
    worldX: number,
    worldY: number,
    image: CanvasImageSource,
    sourceX: number,
    sourceWidth: number,
    sourceHeight: number,
    scale: number,
    hits: ColumnProfile[],
    anchorX: number,
    map: GameMap,
  ): void {
    const { cameraX, depth } = project(worldX, worldY, pose, camera);

    if (depth <= 0.1) {
      return; // behind the camera
    }
    const drawHeight = Math.abs(height / depth) * scale;
    const drawWidth = drawHeight * (sourceWidth / sourceHeight);
    const screenX = (width / 2) * (1 + cameraX / depth);
    const startX = Math.floor(screenX - drawWidth * anchorX);
    // Feet on the cell's SECTOR floor row (raised → higher, pit → lower; flat → the legacy `floorScreenY`).
    const camZ = (pose.z ?? 0) + CAMERA_Z;
    const floorZSprite = floorZAt(map, worldX, worldY);
    const floorY = surfaceScreenY(camZ - floorZSprite, depth, height);
    const top = floorY - drawHeight * (1 - SPRITE_FLOOR_BIAS);

    for (let col = startX; col < startX + drawWidth; col++) {
      if (col < 0 || col >= width || depth >= hits[col].terminal.dist) {
        continue; // off-screen or behind a wall
      }
      if (
        this.glassPhase === 'behind' ? depth <= this.glassDepth[col] : depth > this.glassDepth[col]
      ) {
        continue; // keep only this phase's side of the nearest glass pane
      }
      // Clip the feet against the nearer "hill in front" (a flat level has none → full draw).
      const clipBottom = spriteFeetClip(hits[col].spans, depth, floorZSprite, top + drawHeight);
      const drawnHeight = clipBottom - top;

      if (drawnHeight <= 0) {
        continue; // fully hidden behind a nearer step
      }
      const sourceColumn = sourceX + Math.floor(((col - startX) / drawWidth) * sourceWidth);

      ctx.drawImage(
        image,
        sourceColumn,
        0,
        1,
        (drawnHeight / drawHeight) * sourceHeight,
        col,
        top,
        1,
        drawnHeight,
      );
    }
  }

  /** Keycards still on the floor, as grounded-billboard jobs (sprite chosen by colour) for the shared
   *  z-ordered pass — same grounded occlusion as `drawSprite`, like the pickups. */
  private keycardJobs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): SpriteJob[] {
    return state.keys
      .map((key) => ({ key, depth: project(key.x, key.y, state.pose, camera).depth }))
      .filter((item) => item.depth > 0.1)
      .map(({ key, depth }) => ({
        depth,
        paint: (): void => {
          const sprite = this.keycards[KEYCARD_COLORS.indexOf(key.color)];

          if (!sprite) {
            return;
          }
          this.drawSprite(
            ctx,
            width,
            height,
            state.pose,
            camera,
            key.x,
            key.y,
            sprite,
            VITALS_PICKUP_SCALE,
            hits,
            map,
          );
        },
      }));
  }

  /** Thrown office items as billboards, sprite chosen by the projectile's skin. */
  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): void {
    for (const projectile of state.projectiles) {
      // The TPS report, the binder clip + the staple spray use their served 4-frame spin strips when decoded
      // (spun by world position, since enemy projectiles carry no clock); every other skin — and these until
      // their strip loads — is a procedural sprite.
      const sprite =
        projectile.skin === 'tps'
          ? (this.spinFrame(this.tpsStrip, TPS_PROJECTILE_FRAMES, projectile.x, projectile.y) ??
            this.projectiles.tps)
          : projectile.skin === 'clip'
            ? (this.spinFrame(this.clipStrip, CLIP_PROJECTILE_FRAMES, projectile.x, projectile.y) ??
              this.projectiles.clip)
            : projectile.skin === 'spread'
              ? (this.spinFrame(
                  this.spreadStrip,
                  SPREAD_PROJECTILE_FRAMES,
                  projectile.x,
                  projectile.y,
                ) ?? this.projectiles.spread)
              : this.projectiles[projectile.skin];

      if (!sprite) {
        continue;
      }
      this.drawSprite(
        ctx,
        width,
        height,
        state.pose,
        camera,
        projectile.x,
        projectile.y,
        sprite,
        projectile.skin === 'clip' ? CLIP_PROJECTILE_SCALE : PROJECTILE_SCALE,
        hits,
        map,
        true, // airborne — thrown items stay at eye level, WALL_HEIGHT-invariant
      );
    }
  }

  /** The current spin frame of a served projectile strip (TPS report / binder clip), extracted into a reused
   *  canvas (the spin is keyed to the projectile's world position, since enemy projectiles carry no clock).
   *  `null` until the strip decodes → the caller falls back to the procedural sprite. */
  private spinFrame(
    strip: LoadedImage,
    frames: number,
    worldX: number,
    worldY: number,
  ): HTMLCanvasElement | null {
    const image = strip.ready();

    if (!image) {
      return null;
    }
    const fw = image.naturalWidth / frames;
    const fh = image.naturalHeight;
    const frame = ((Math.floor((worldX + worldY) * 6) % frames) + frames) % frames;

    if (!this.spinFrameCanvas) {
      this.spinFrameCanvas = document.createElement('canvas');
    }
    const canvas = this.spinFrameCanvas;

    canvas.width = fw;
    canvas.height = fh;
    const fctx = canvas.getContext('2d');

    if (!fctx) {
      return null;
    }
    fctx.clearRect(0, 0, fw, fh);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(image, frame * fw, 0, fw, fh, 0, 0, fw, fh);

    return canvas;
  }

  /** The plasma's chain-lightning: a short blue electric segment between each pair of chained enemy world
   *  points, faded by `age / ARC_DURATION`, occluded by the wall z-buffer (both ends behind a wall → the
   *  arc is dropped). Each endpoint projects to the chained enemy's billboard centre. */
  private drawArcs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
    map: GameMap,
  ): void {
    const camZ = (state.pose.z ?? 0) + CAMERA_Z;

    for (const arc of state.arcs) {
      const a = project(arc.ax, arc.ay, state.pose, camera);
      const b = project(arc.bx, arc.by, state.pose, camera);

      if (a.depth <= 0.1 || b.depth <= 0.1) {
        continue; // an endpoint behind the camera
      }
      const ax = (width / 2) * (1 + a.cameraX / a.depth);
      const bx = (width / 2) * (1 + b.cameraX / b.depth);
      const columnA = Math.floor(ax);
      const columnB = Math.floor(bx);

      if (columnA < 0 || columnA >= width || columnB < 0 || columnB >= width) {
        continue; // an endpoint off-screen
      }
      if (a.depth >= hits[columnA].terminal.dist && b.depth >= hits[columnB].terminal.dist) {
        continue; // both ends hidden behind a wall
      }
      const fade = Math.max(0, 1 - arc.age / ARC_DURATION);

      this.strokeArc(
        ctx,
        ax,
        billboardCenterY(a.depth, height, camZ - floorZAt(map, arc.ax, arc.ay)),
        bx,
        billboardCenterY(b.depth, height, camZ - floorZAt(map, arc.bx, arc.by)),
        fade,
      );
    }
  }

  /** Stroke one jagged blue lightning segment from (ax,ay) to (bx,by): a 3-segment polyline kinked at the
   *  thirds, a wide soft glow under a bright thin core, additive so it reads as light. Deterministic (the
   *  kink is a fixed perpendicular offset), so it stays test- + SSR-safe. */
  private strokeArc(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    fade: number,
  ): void {
    const deltaX = bx - ax;
    const deltaY = by - ay;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const perpX = -deltaY / length;
    const perpY = deltaX / length;
    const jag = Math.min(14, length * 0.16); // perpendicular kink (px), capped on a long segment
    const firstX = ax + deltaX / 3 + perpX * jag;
    const firstY = ay + deltaY / 3 + perpY * jag;
    const secondX = ax + (deltaX * 2) / 3 - perpX * jag;
    const secondY = ay + (deltaY * 2) / 3 - perpY * jag;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(firstX, firstY);
    ctx.lineTo(secondX, secondY);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = '#2f6bff'; // outer blue glow
    ctx.globalAlpha = fade * 0.4;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#cfe0ff'; // bright inner core
    ctx.globalAlpha = fade * 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  /** The player's travelling projectiles (the staple / nail / rocket / plasma bolt / BFG orb) as billboard
   *  SPRITES: the served `proj_<kind>.webp` face-cameras at the projectile's world point, distance-scaled
   *  (smaller with depth), NEAREST, occluded by the wall z-buffer. The data-driven replacement for the old
   *  procedural orb; the sprite image is cached by kind via `effectImage` (one decode, reused every frame). */
  private drawPlayerProjectiles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
  ): void {
    for (const projectile of state.playerProjectiles) {
      const effect = projectileEffect(projectile.kind);

      if (!effect) {
        continue; // an unmapped kind → nothing to draw
      }
      const image = this.effectImage(effect.sprite);

      if (!image) {
        continue; // not decoded yet (SSR / first frames) → draw nothing
      }
      this.blitEffect(
        ctx,
        width,
        height,
        state.pose,
        camera,
        projectile.x,
        projectile.y,
        image,
        0,
        effect.width,
        effect.height,
        // `size` scales BOTH the distance term and the height cap, so the projectile shrinks uniformly at
        // every range (the staple/nail are tiny next to the rocket, not the canvas-relative default size).
        PROJECTILE_EFFECT_SCALE * effect.size,
        hits,
        1, // projectiles keep their own aspect (no horizontal stretch)
        PROJECTILE_MAX_HEIGHT_FRACTION * effect.size,
        effect.drop,
        effect.anchorX,
        PROJECTILE_CROSSHAIR_BLEND, // fired-from-the-crosshair anchor near the muzzle
      );
    }
  }

  /** Animated hit impacts: each `state.impacts` plays its strip ONCE — frame `min(floor(age /
   *  frameDuration_s), frames − 1)` — billboarded at the hit's world point, distance-scaled, NEAREST,
   *  z-occluded. The data-driven replacement for the old procedural fireball disc; the strip image is
   *  cached by kind. (The plasma chain arcs stay separate — see `drawArcs`.) */
  private drawImpacts(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    camera: Camera,
    hits: ColumnProfile[],
  ): void {
    for (const impact of state.impacts) {
      const effect = impactEffect(impact.kind);

      if (!effect) {
        continue; // an unmapped kind → nothing to draw
      }
      const image = this.effectImage(effect.sheet);

      if (!image) {
        continue; // not decoded yet → draw nothing
      }
      const frame = Math.min(Math.floor(impact.age / effect.frameDuration_s), effect.frames - 1);

      this.blitEffect(
        ctx,
        width,
        height,
        state.pose,
        camera,
        impact.x,
        impact.y,
        image,
        frame * effect.frameWidth,
        effect.frameWidth,
        effect.frameHeight,
        IMPACT_EFFECT_SCALE * effect.size,
        hits,
        effect.widthScale, // a blast can spread WIDE without growing taller (the BFG's wide flash)
      );
    }
  }

  /** Billboard one sprite (or one strip cell) at world (worldX, worldY): face-camera, distance-scaled
   *  (on-screen HEIGHT = |screenH / depth| × `scale`, width following the source aspect), eye-level
   *  centred (airborne, like the thrown items), NEAREST, occluded column-by-column by the wall z-buffer.
   *  `sourceX` / `sourceWidth` select the strip cell (a whole sprite passes `sourceX = 0`, its full width);
   *  the cell spans the full source height. Shared by the player-projectile sprites + the impact frames. */
  private blitEffect(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: Pose,
    camera: Camera,
    worldX: number,
    worldY: number,
    image: CanvasImageSource,
    sourceX: number,
    sourceWidth: number,
    sourceHeight: number,
    scale: number,
    hits: ColumnProfile[],
    widthScale = 1,
    maxHeightFraction = Number.POSITIVE_INFINITY,
    dropFraction = 0,
    anchorX = 0.5,
    crosshairBlendDepth = 0,
  ): void {
    const { cameraX, depth } = project(worldX, worldY, pose, camera);

    if (depth <= 0.1) {
      return; // behind the camera
    }
    const drawHeight = Math.min(Math.abs(height / depth) * scale, height * maxHeightFraction);
    // `widthScale` stretches the billboard HORIZONTALLY only (height unchanged) — a wide blast that spreads
    // sideways rather than towering up (1 = the sprite's own aspect).
    const drawWidth = drawHeight * (sourceWidth / sourceHeight) * widthScale;
    const worldScreenX = (width / 2) * (1 + cameraX / depth);
    // A player projectile (`crosshairBlendDepth > 0`) is pulled toward the crosshair while it is near the
    // muzzle, fading to its true world path as it recedes — so a shot fired mid-turn/strafe still LEAVES from
    // the centre instead of off to the side. Impacts pass 0 (no anchor → their real hit point).
    const anchorBlend = crosshairBlendDepth > 0 ? Math.max(0, 1 - depth / crosshairBlendDepth) : 0;
    const screenX = worldScreenX + (width / 2 - worldScreenX) * anchorBlend;
    // Align the sprite's CONTENT centre (`anchorX`) to the firing line, not the frame centre — an off-centre
    // ball (the plasma/BFG sit at 0.6 of their frame) then reads centred on the weapon.
    const startX = Math.floor(screenX - drawWidth * anchorX);
    // Eye-level centred (airborne, WALL_HEIGHT-invariant), shifted DOWN toward the weapon when close; the
    // drop attenuates with depth so a receding projectile climbs back to the crosshair. (0 for impacts.)
    const drop = Math.min(height * PROJECTILE_MAX_DROP_FRACTION, (height * dropFraction) / depth);
    const top = (height - drawHeight) / 2 + drop;

    for (let col = startX; col < startX + drawWidth; col++) {
      if (col < 0 || col >= width || depth >= hits[col].terminal.dist) {
        continue; // off-screen or behind a wall
      }
      if (
        this.glassPhase === 'behind' ? depth <= this.glassDepth[col] : depth > this.glassDepth[col]
      ) {
        continue; // keep only this phase's side of the nearest glass pane
      }
      const sourceColumn = sourceX + Math.floor(((col - startX) / drawWidth) * sourceWidth);

      ctx.drawImage(image, sourceColumn, 0, 1, sourceHeight, col, top, 1, drawHeight);
    }
  }

  /** One effect sprite / strip, loaded once + cached by served URL (the pooling — reused every frame, no
   *  per-frame allocation) and decoded async; `undefined` until it decodes (SSR-safe, like the weapon). */
  private effectImage(src: string): HTMLImageElement | undefined {
    let loaded = this.effectImages.get(src);

    if (!loaded) {
      loaded = new LoadedImage(src);
      this.effectImages.set(src, loaded);
    }

    return loaded.ready();
  }

  /** Red full-frame damage flash, alpha rising with the remaining hurt time. */
  private drawHurt(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
  ): void {
    if (state.hurtFlash <= 0) {
      return;
    }
    ctx.globalAlpha = Math.min(0.5, state.hurtFlash);
    ctx.fillStyle = '#c80000';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  /** The centre crosshair. */
  private drawHud(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = '#fff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 8, height / 2);
    ctx.lineTo(width / 2 + 8, height / 2);
    ctx.moveTo(width / 2, height / 2 - 8);
    ctx.lineTo(width / 2, height / 2 + 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Pick the sprite frame from the per-kind array `[idle(0), throw(1), death1(2), death2(3)]`. Dying
   *  enemies animate across the two death frames (2, 3); an alive enemy mid-wind-up shows the throw
   *  pose (1) as the visible telegraph, otherwise idle (0). */
  private frameFor(enemy: Enemy): HTMLCanvasElement {
    const frames = this.enemyFrames[enemy.kind];

    if (enemy.state === 'dying') {
      // Map deathTime [0 .. DEATH_DURATION) onto death1 (index 2) then death2 (index 3).
      const progress = Math.min(1, Math.floor((enemy.deathTime / DEATH_DURATION) * 2));

      return frames[2 + progress];
    }

    return enemy.windup > 0 ? frames[1] : frames[0]; // throw-pose telegraph, else idle
  }
}

/** Screen-Y of a billboard's vertical centre at `depth` — the same SECTOR-floor anchoring `drawEnemies` uses
 *  (`eyeToFloor = camZ − floorZAt`), so a chain arc connects at the chained enemies' mid-body whatever their
 *  floor height. A flat sector keeps `eyeToFloor = CAMERA_Z` → the legacy `floorScreenY` value. */
function billboardCenterY(depth: number, height: number, eyeToFloor: number): number {
  const spriteSize = Math.abs(height / depth) * SPRITE_SCALE;
  const floorY = surfaceScreenY(eyeToFloor, depth, height);

  return floorY - spriteSize * (0.5 - SPRITE_FLOOR_BIAS);
}

/** Index into a square `size`×`size` flat/image pixel buffer for the world point `(worldX, worldY)`, tiling
 *  the texture every `tileWorld` cells (1 = a procedural per-cell flat; `FLAT_TILE_WORLD_SIZE` = an image that
 *  spans several cells). Wraps the world coordinate into 0..1 of the tile, then to a texel row/column. */
function flatTexel(worldX: number, worldY: number, size: number, tileWorld: number): number {
  const u = (((worldX / tileWorld) % 1) + 1) % 1;
  const v = (((worldY / tileWorld) % 1) + 1) % 1;

  return Math.floor(v * size) * size + Math.floor(u * size);
}

/** Pick the packed floor/ceiling pixel for a world point — the texel select shared with the height-aware
 *  span fill (`drawSpans`), mirroring `drawFloorCeiling`'s inline sampling exactly. A FLOOR samples the
 *  single manifest image (`floorTex`) when decoded, else the procedural per-material flat; a CEILING samples
 *  the per-material image (`ceilTexels[material − 1]`, falling back to index 0), else the procedural flat,
 *  with material 0 = open sky. The procedural flats are indexed by the material id directly (id 0 fallback),
 *  matching `drawFloorCeiling`. (Kept a free function so the flat sweep's perf-critical inline loop stays
 *  byte-identical — this is its height-path twin, not a refactor of it.) */
function flatPixel(
  kind: 'floor' | 'ceil',
  material: number,
  worldX: number,
  worldY: number,
  floorFlats: Uint32Array[],
  ceilFlats: Uint32Array[],
  floorTex: { pixels: Uint32Array; size: number } | null,
  ceilTexels: ({ pixels: Uint32Array; size: number } | null)[],
  sky: number,
): number {
  if (kind === 'floor') {
    return floorTex
      ? floorTex.pixels[flatTexel(worldX, worldY, floorTex.size, FLAT_TILE_WORLD_SIZE)]
      : (floorFlats[material] ?? floorFlats[0])[flatTexel(worldX, worldY, FLAT_SIZE, 1)];
  }
  if (material === 0) {
    return sky; // open sky cell
  }
  const ceilTex = ceilTexels[material - 1] ?? ceilTexels[0];

  return ceilTex
    ? ceilTex.pixels[flatTexel(worldX, worldY, ceilTex.size, FLAT_TILE_WORLD_SIZE)]
    : (ceilFlats[material] ?? ceilFlats[0])[flatTexel(worldX, worldY, FLAT_SIZE, 1)];
}

/** Read a flat canvas's pixels once as packed ints for fast per-pixel sampling. */
function readPixels(flat: HTMLCanvasElement): Uint32Array {
  const ctx = flat.getContext('2d');

  if (!ctx || flat.width < FLAT_SIZE) {
    return new Uint32Array(FLAT_SIZE * FLAT_SIZE); // blank placeholder (e.g. sky id 0)
  }

  return new Uint32Array(ctx.getImageData(0, 0, FLAT_SIZE, FLAT_SIZE).data.buffer.slice(0));
}

/** Pack a #rrggbb colour into the canvas ImageData byte order (0xAABBGGRR, opaque). */
function packColor(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** The camera basis for a pose — the view direction + the FOV plane, computed once per frame. */
interface Camera {
  dirX: number;
  dirY: number;
  planeX: number;
  planeY: number;
  invDet: number;
}

function cameraBasis(pose: Pose): Camera {
  const dirX = Math.cos(pose.dir);
  const dirY = Math.sin(pose.dir);
  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;

  return { dirX, dirY, planeX, planeY, invDet: 1 / (planeX * dirY - dirX * planeY) };
}

/** The lodev sprite transform: a world point → camera space (`cameraX` across the view, `depth` in front). */
function project(
  worldX: number,
  worldY: number,
  pose: Pose,
  camera: Camera,
): { cameraX: number; depth: number } {
  const relX = worldX - pose.x;
  const relY = worldY - pose.y;

  return {
    cameraX: camera.invDet * (camera.dirY * relX - camera.dirX * relY),
    depth: camera.invDet * (-camera.planeY * relX + camera.planeX * relY),
  };
}
