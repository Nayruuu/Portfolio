import { LoadedImage } from '../../../../shared/game/loaded-image';
import type { Enemy, EnemyKind } from '../../../../core/lib';

/** The animation states the directional billboards drive off an enemy's live fields. */
type AnimState = 'walk' | 'attack' | 'pain' | 'death';

/** One atlas state: its served strip, grid (cols = frames, rows = drawn angles), the per-state `fps` (used by
 *  the attack wind-up + death-timer mappings; the WALK loop is distance-driven, not fps-driven), and the
 *  8→drawn `rotation` table (row index + horizontal mirror) that turns a view octant into a cell. */
interface StateDef {
  readonly atlas: string;
  readonly frames: number;
  readonly fps: number;
  readonly rotation: Readonly<Record<number, { readonly row: number; readonly flip: boolean }>>;
}

/** A whole enemy's directional art: cell size + feet anchor (in cell px), the on-screen scale + aspect, the
 *  distance→walk-frame rate, and its four state atlases. Shared shape across every arted enemy. */
interface EnemyArt {
  readonly cellW: number;
  readonly cellH: number;
  readonly anchorXFrac: number;
  readonly anchorYFrac: number;
  readonly aspect: number;
  readonly drawScale: number;
  readonly walkStepRate: number; // walk frames advanced per world cell travelled (ties the legs to motion)
  readonly states: Readonly<Record<AnimState, StateDef>>;
}

/** Resolve a `rotation_map` (1..8 → { rowName, flip }) against an atlas row order into row INDEX + flip. */
function rot(
  rowNames: readonly string[],
  map: Record<number, { row: string; flip: boolean }>,
): StateDef['rotation'] {
  const out: Record<number, { row: number; flip: boolean }> = {};

  for (let r = 1; r <= 8; r++) {
    out[r] = { row: rowNames.indexOf(map[r].row), flip: map[r].flip };
  }

  return out;
}

// The WALK rotation table is IDENTICAL across enemies (verified from both packs' zombie.json /
// middle_manager.json). ATTACK, PAIN and DEATH are all single-angle (front only): an enemy ATTACKS while
// turned to face the player (the AI always points its `dir` at you), so its side/¾ attack frames never show
// in combat — the atlases ship the front row only. WALK keeps all 5 angles (you DO see a foe walk in profile
// while it patrols / approaches, before it spots you).
const WALK_ROWS = ['front', '34front', 'side', '34back', 'back'] as const;
const FRONT_ONLY = ['front'] as const;

const WALK_ROT = rot(WALK_ROWS, {
  1: { row: 'front', flip: false },
  2: { row: '34front', flip: false },
  3: { row: 'side', flip: false },
  4: { row: '34back', flip: false },
  5: { row: 'back', flip: false },
  6: { row: '34back', flip: true },
  7: { row: 'side', flip: true },
  8: { row: '34front', flip: true },
});
// attack + pain + death are single-angle (front only), shown for every octant.
const FRONT_ROT = rot(
  FRONT_ONLY,
  Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [i + 1, { row: 'front', flip: false }]),
  ) as Record<number, { row: string; flip: boolean }>,
);

/** Build the four shared-layout states for one enemy from its atlas URLs + per-state timings. `attackFrames`
 *  is the attack strip's frame count (most packs ship 5; the security guard's cropped attack ships 4). */
function states(
  atlas: Readonly<Record<AnimState, string>>,
  fps: { readonly attack: number; readonly death: number },
  attackFrames: number,
): EnemyArt['states'] {
  return {
    walk: { atlas: atlas.walk, frames: 4, fps: 0, rotation: WALK_ROT },
    attack: { atlas: atlas.attack, frames: attackFrames, fps: fps.attack, rotation: FRONT_ROT },
    pain: { atlas: atlas.pain, frames: 1, fps: 1, rotation: FRONT_ROT },
    death: { atlas: atlas.death, frames: 6, fps: fps.death, rotation: FRONT_ROT },
  };
}

/** Build an `EnemyArt` from a cell, feet anchor (cell px) + atlas set. `attackFrames` defaults to 5 (the
 *  shared pack layout); pass a different count for an enemy whose attack strip is cropped differently. */
function art(opts: {
  cellW: number;
  cellH: number;
  anchorX: number;
  anchorY: number;
  drawScale: number;
  attackFrames?: number;
  atlas: Readonly<Record<AnimState, string>>;
}): EnemyArt {
  return {
    cellW: opts.cellW,
    cellH: opts.cellH,
    anchorXFrac: opts.anchorX / opts.cellW,
    anchorYFrac: opts.anchorY / opts.cellH,
    aspect: opts.cellW / opts.cellH,
    drawScale: opts.drawScale,
    walkStepRate: 4.5, // walk frames per world cell — high enough that the stride reads as steps, not a slide
    states: states(opts.atlas, { attack: 10, death: 9 }, opts.attackFrames ?? 5),
  };
}

/** The zombie "Corporate Husk" (melee) — kept under the legacy `manager` kind id. Exported so a test can
 *  build a FRESH `EnemyView(HUSK)` per case (the registry's `enemyView('manager')` is a shared singleton
 *  whose baked-atlas cache would otherwise leak across tests). */
export const HUSK = art({
  cellW: 512,
  cellH: 716,
  anchorX: 268,
  anchorY: 703,
  drawScale: 0.85,
  atlas: {
    walk: '/game/enemies/pinky/pinky_walk_atlas.webp',
    attack: '/game/enemies/pinky/pinky_attack_atlas.webp',
    pain: '/game/enemies/pinky/pinky_pain_atlas.webp',
    death: '/game/enemies/pinky/pinky_death_atlas.webp',
  },
});

/** The "Middle Manager" — a wider suited husk (its TPS-report throw lands in a later slice; melee for now). */
const MIDDLE_MANAGER = art({
  cellW: 678,
  cellH: 716,
  anchorX: 334,
  anchorY: 703,
  drawScale: 0.85,
  atlas: {
    walk: '/game/enemies/middle_manager/walk_atlas.webp',
    attack: '/game/enemies/middle_manager/attack_atlas.webp',
    pain: '/game/enemies/middle_manager/pain_atlas.webp',
    death: '/game/enemies/middle_manager/death_atlas.webp',
  },
});

/** The "Junior Office Drone" — a slimmer RANGED foe (weaker than the manager), drawn a touch smaller; lobs a
 *  spinning binder clip (the `clip` projectile below). Same shared layout as the others. */
const JUNIOR_DRONE = art({
  cellW: 600,
  cellH: 717,
  anchorX: 282,
  anchorY: 704,
  drawScale: 0.8,
  atlas: {
    walk: '/game/enemies/imp/walk_atlas.webp',
    attack: '/game/enemies/imp/attack_atlas.webp',
    pain: '/game/enemies/imp/pain_atlas.webp',
    death: '/game/enemies/imp/death_atlas.webp',
  },
});

/** The "Security Guard" — the TOUGHEST ranged foe, drawn the BIGGEST (an imposing body, `drawScale` 0.9);
 *  fires a spinning staple spray (the `spread` projectile below). Its attack atlas ships the FRONT row only,
 *  cropped to 4 frames (vs the others' 5) — threaded through `attackFrames`. Same shared layout otherwise. */
const SECURITY_GUARD = art({
  cellW: 704,
  cellH: 776,
  anchorX: 318,
  anchorY: 761,
  drawScale: 0.9,
  attackFrames: 4,
  atlas: {
    walk: '/game/enemies/shotgunguy/walk_atlas.webp',
    attack: '/game/enemies/shotgunguy/attack_atlas.webp',
    pain: '/game/enemies/shotgunguy/pain_atlas.webp',
    death: '/game/enemies/shotgunguy/death_atlas.webp',
  },
});

/** The arted enemies, by kind. Kinds absent here (printer/hr) fall back to the procedural billboard. */
const ART: Partial<Record<EnemyKind, EnemyArt>> = {
  manager: HUSK,
  middle_manager: MIDDLE_MANAGER,
  junior_office_drone: JUNIOR_DRONE,
  security_guard: SECURITY_GUARD,
};

/** The Middle Manager's thrown TPS-report projectile: a 4-frame horizontal spin strip (served), billboarded
 *  by `drawProjectiles` (spun by the projectile's world position, since enemy projectiles carry no clock). */
export const TPS_PROJECTILE_URL = '/game/enemies/middle_manager/tps_strip.webp';
export const TPS_PROJECTILE_FRAMES = 4;

/** The Junior Office Drone's binder-clip projectile: a 4-frame spin strip (served), billboarded the same way
 *  as the TPS report. */
export const CLIP_PROJECTILE_URL = '/game/enemies/imp/clip_strip.webp';
export const CLIP_PROJECTILE_FRAMES = 4;

/** The Security Guard's staple-spray projectile: a 4-frame spin strip (served), billboarded the same way as
 *  the TPS report + binder clip. */
export const SPREAD_PROJECTILE_URL = '/game/enemies/shotgunguy/spread_strip.webp';
export const SPREAD_PROJECTILE_FRAMES = 4;

/** Every arted enemy's state atlases + the thrown-projectile spin strips, for the loading screen to preload
 *  (deduped). */
export const ENEMY_ATLAS_URLS: readonly string[] = [
  ...new Set([
    ...Object.values(ART).flatMap((a) => Object.values(a.states).map((s) => s.atlas)),
    TPS_PROJECTILE_URL,
    CLIP_PROJECTILE_URL,
    SPREAD_PROJECTILE_URL,
  ]),
];

/** A resolved frame to blit: the atlas image + source rect + mirror, plus the cell's draw geometry so the
 *  renderer needs no per-kind constants. */
export interface SpriteFrame {
  readonly image: CanvasImageSource; // the hard-edged atlas canvas (`hardenEdges`), or the raw image (SSR/fallback)
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly flip: boolean;
  readonly anchorXFrac: number;
  readonly anchorYFrac: number;
  readonly aspect: number;
  readonly drawScale: number;
}

/** The view octant 1..8 of an enemy as seen from the camera: 1 = facing the viewer (front), stepping every
 *  45° as it turns away. `enemyDir` is the enemy's heading; `(camX,camY)` the eye. Pure. */
export function viewRotation(
  enemyX: number,
  enemyY: number,
  enemyDir: number,
  camX: number,
  camY: number,
): number {
  const toCam = Math.atan2(camY - enemyY, camX - enemyX); // enemy → eye
  const rel = enemyDir - toCam; // 0 when the enemy faces the eye (its front shows)
  const oct = Math.round(rel / (Math.PI / 4));

  return (((oct % 8) + 8) % 8) + 1; // 1..8
}

/** Below this alpha a sprite edge pixel is dropped to fully transparent (above it → fully opaque): the AI art
 *  is chroma-keyed off a green screen, leaving a SOFT anti-aliased fringe that floats over the crisp low-res
 *  world. Thresholding it gives a hard, pixel-art silhouette that sits in the scene. */
const EDGE_ALPHA_THRESHOLD = 140;

/** Bake an atlas into a copy with a HARD alpha edge (no soft chroma fringe). One-time per atlas; returns the
 *  raw image unchanged when there is no canvas (SSR / jsdom) or the pixels can't be read. */
function hardenEdges(img: HTMLImageElement): CanvasImageSource {
  if (typeof document === 'undefined') {
    return img;
  }
  const canvas = document.createElement('canvas');

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return img;
  }
  ctx.drawImage(img, 0, 0);
  let data: ImageData;

  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return img; // tainted / unreadable → leave the soft edges
  }
  const px = data.data;

  for (let i = 3; i < px.length; i += 4) {
    px[i] = px[i] >= EDGE_ALPHA_THRESHOLD ? 255 : 0;
  }
  ctx.putImageData(data, 0, 0);

  return canvas;
}

/**
 * `EnemyView` — directional billboard art for one enemy kind, driven by a shared `EnemyArt` config. Owns the
 * four state atlases (`LoadedImage`, SSR-safe + preloaded) and resolves an enemy's STATE (death → pain →
 * attack → walk) × view ROTATION × FRAME into a `SpriteFrame`. DOOM-style: 5 drawn walk angles (3 attack, 1
 * pain/death) mirrored into 8 octants. The WALK cycle advances with DISTANCE TRAVELLED (the enemy's world
 * position), not a wall clock — so the legs plant on the ground instead of sliding, and a still enemy holds a
 * frame. Each atlas is baked ONCE with a hard alpha edge (`hardenEdges`) so its silhouette is crisp, not a
 * soft chroma fringe floating over the pixel world. Pure of any canvas — the renderer owns the blit.
 */
export class EnemyView {
  private readonly atlases: Record<AnimState, LoadedImage>;
  /** Per-state atlas baked with a hard alpha edge, cached on first decode (raw image until then). */
  private readonly hardened: Partial<Record<AnimState, CanvasImageSource>> = {};

  constructor(private readonly cfg: EnemyArt) {
    this.atlases = {
      walk: new LoadedImage(cfg.states.walk.atlas),
      attack: new LoadedImage(cfg.states.attack.atlas),
      pain: new LoadedImage(cfg.states.pain.atlas),
      death: new LoadedImage(cfg.states.death.atlas),
    };
  }

  /** Resolve the frame for an enemy this tick, or `null` until its atlas decodes. `rotation` is `viewRotation`. */
  public frameFor(enemy: Enemy, rotation: number): SpriteFrame | null {
    const { state, frame } = this.resolve(enemy);
    const def = this.cfg.states[state];
    const image = this.atlasImage(state);

    if (!image) {
      return null;
    }
    const r = def.rotation[rotation] ?? def.rotation[1];

    return {
      image,
      sx: frame * this.cfg.cellW,
      sy: r.row * this.cfg.cellH,
      sw: this.cfg.cellW,
      sh: this.cfg.cellH,
      flip: r.flip,
      anchorXFrac: this.cfg.anchorXFrac,
      anchorYFrac: this.cfg.anchorYFrac,
      aspect: this.cfg.aspect,
      drawScale: this.cfg.drawScale,
    };
  }

  /** Load + bake ALL four state atlases up front (driven by the loading screen), resolving once they are
   *  ready — so the very first rendered frame already shows the directional sprite, never the procedural
   *  fallback. Each state polls per animation frame until its atlas decodes + bakes (or a ~3 s cap, after
   *  which the renderer simply falls back gracefully); with no scheduler (SSR / tests) it resolves at once. */
  public warm(): Promise<void> {
    const states: readonly AnimState[] = ['walk', 'attack', 'pain', 'death'];

    return Promise.all(states.map((state) => this.warmState(state))).then(() => undefined);
  }

  private warmState(state: AnimState): Promise<void> {
    return new Promise<void>((resolve) => {
      let attempts = 0;
      const tick = (): void => {
        if (this.atlasImage(state) || attempts++ > 180) {
          resolve(); // decoded + baked, or gave up (the procedural fallback covers it)
        } else if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(tick);
        } else {
          resolve(); // no scheduler (SSR / tests) → don't hang; the first real frame bakes it lazily
        }
      };

      tick();
    });
  }

  /** The hard-edged atlas for a state, baked once on first decode, or `null` until it decodes. */
  private atlasImage(state: AnimState): CanvasImageSource | null {
    const cached = this.hardened[state];

    if (cached) {
      return cached;
    }
    const img = this.atlases[state].ready();

    if (!img) {
      return null;
    }
    const baked = hardenEdges(img);

    this.hardened[state] = baked;

    return baked;
  }

  /** Pick the state + frame index from the enemy's live fields. */
  private resolve(enemy: Enemy): { state: AnimState; frame: number } {
    const { walk, attack, death } = this.cfg.states;

    if (enemy.state === 'dying' || enemy.state === 'dead') {
      const f = Math.floor(enemy.deathTime * death.fps);

      return { state: 'death', frame: Math.min(f, death.frames - 1) };
    }
    if (enemy.windup > 0) {
      // Telegraphed swing: play the attack strip across the wind-up window (clamped to the last frame).
      const span = attack.frames / attack.fps; // full strip duration
      const f = Math.floor((1 - Math.min(enemy.windup, span) / span) * attack.frames);

      return { state: 'attack', frame: Math.min(Math.max(f, 0), attack.frames - 1) };
    }
    if (enemy.hitFlash > 0) {
      return { state: 'pain', frame: 0 };
    }
    // Walk cycle keyed to world position → the stride tracks actual movement (no sliding), holding when still.
    const f = Math.floor((enemy.x + enemy.y) * this.cfg.walkStepRate) % walk.frames;

    return { state: 'walk', frame: ((f % walk.frames) + walk.frames) % walk.frames };
  }
}

/** One singleton view per ARTED kind, derived from `ART` so the two never drift (a kind in `ART` is
 *  automatically given a directional view; kinds absent from `ART` keep the procedural billboard). */
const VIEWS: Partial<Record<EnemyKind, EnemyView>> = Object.fromEntries(
  (Object.entries(ART) as [EnemyKind, EnemyArt][]).map(([kind, cfg]) => [kind, new EnemyView(cfg)]),
);

/** The directional view for an enemy kind, or `undefined` for a kind that still uses procedural art. */
export function enemyView(kind: EnemyKind): EnemyView | undefined {
  return VIEWS[kind];
}

/** Warm EVERY arted enemy's atlases (load + bake) before the game loop starts — the loading screen awaits
 *  this so a foe never flashes its procedural placeholder while its directional atlas decodes. */
export function warmEnemyViews(): Promise<void> {
  return Promise.all(Object.values(VIEWS).map((view) => view.warm())).then(() => undefined);
}
