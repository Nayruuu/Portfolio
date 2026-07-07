import type { EnemyCombat } from '../../core/lib';

/**
 * Enemy specs for the BSP demo — atlas layout + world sizing + combat tuning per kind, kept LOCAL to the
 * feature (the grid's `enemy-sprite.ts` is feature-coupled; a shared move comes if this grows). Four kinds:
 * the melee Corporate Husk, the hitscan-shotgun Security Guard, the projectile-lobbing Junior Office Drone,
 * and the fast melee-lunging Remote Consultant Husk.
 *
 * The art-free combat half ({@link EnemyCombat}, + its `EnemyShotgun` / `EnemyProjectile` sub-specs) lives in
 * `core/lib/game`; this file owns only the atlas/animation half ({@link EnemyArt}) and composes the two into
 * the full {@link EnemySpec}.
 */

/** The atlas layout + animation cadence of an enemy kind — the art half of {@link EnemySpec} (its combat +
 *  world-sizing half is {@link EnemyCombat}, in core). */
export interface EnemyArt {
  readonly texName: string; // walk atlas key
  readonly atlasUrl: string; // served walk atlas (a `walkCols`×`walkRows` grid)
  readonly walkCols: number;
  readonly walkRows: number; // angle rows (front · ¾front · side · ¾back · back)
  readonly deathTexName: string;
  readonly deathUrl: string;
  readonly deathFrames: number;
  readonly deathFps: number;
  readonly attackTexName: string;
  readonly attackUrl: string;
  readonly attackFrames: number;
  readonly attackFps: number; // plays once across the wind-up
  readonly attackAspect?: number; // cell width/height of the attack atlas if it differs from `aspect`
  readonly painTexName: string;
  readonly painUrl: string;
  readonly aspect: number; // cell width / height → billboard width : height
  readonly walkStepRate: number; // walk frames advanced per world cell travelled
}

/** A full enemy kind = its art ({@link EnemyArt}) + its combat/physics tuning ({@link EnemyCombat}). */
export interface EnemySpec extends EnemyArt, EnemyCombat {}

/** The "Corporate Husk" — a melee rusher. Walk cell 512×716, feet-anchored. */
export const PINKY_SPEC: EnemySpec = {
  texName: 'PINKY_WALK',
  atlasUrl: '/game/enemies/pinky/pinky_walk_atlas.webp',
  walkCols: 4,
  walkRows: 5,
  deathTexName: 'PINKY_DEATH',
  deathUrl: '/game/enemies/pinky/pinky_death_atlas.webp',
  deathFrames: 6,
  deathFps: 9,
  attackTexName: 'PINKY_ATTACK',
  attackUrl: '/game/enemies/pinky/pinky_attack_atlas.webp',
  attackFrames: 5,
  attackFps: 16,
  painTexName: 'PINKY_PAIN',
  painUrl: '/game/enemies/pinky/pinky_pain_atlas.webp',
  aspect: 512 / 716,
  worldHeight: 1.8,
  walkStepRate: 4.5,
  hitRadius: 0.4,
  hp: 80,
  speed: 2.2,
  standoff: 0.7,
  windup: 0.3,
  cooldownTime: 1,
  meleeReach: 1.3,
  meleeDamage: 12,
};

/** The "Security Guard" — a tanky SHOTGUNNER: closes to short range, fires an instant blast (a muzzle burst,
 *  no flying projectile), brawls if cornered. Wide cell 704×776, 4-frame attack. */
export const SHOTGUNGUY_SPEC: EnemySpec = {
  texName: 'SHOTGUNGUY_WALK',
  atlasUrl: '/game/enemies/shotgunguy/walk_atlas.webp',
  walkCols: 4,
  walkRows: 5,
  deathTexName: 'SHOTGUNGUY_DEATH',
  deathUrl: '/game/enemies/shotgunguy/death_atlas.webp',
  deathFrames: 6,
  deathFps: 9,
  attackTexName: 'SHOTGUNGUY_ATTACK',
  attackUrl: '/game/enemies/shotgunguy/attack_shotgun.webp', // raise → aim → FIRE (muzzle flash on frame 2)
  attackFrames: 4,
  attackFps: 5, // frames 0→1→2 land across the 0.5s wind-up so the flash (frame 2) hits ON the strike
  attackAspect: 272 / 590, // this atlas' cell is much narrower than the walk cell (704/776)
  painTexName: 'SHOTGUNGUY_PAIN',
  painUrl: '/game/enemies/shotgunguy/pain_atlas.webp',
  aspect: 704 / 776,
  worldHeight: 2,
  walkStepRate: 4.5,
  hitRadius: 0.5, // the wide guard body
  hp: 150,
  speed: 0.9,
  standoff: 2.5, // a shotgunner engages CLOSE (holds just inside blast range)
  windup: 0.5, // a clear blast telegraph (dodge by backing out of range)
  cooldownTime: 1.5, // pump between blasts
  meleeReach: 1.3,
  meleeDamage: 12,
  shotgun: {
    range: 3.5, // short — back out of this during the wind-up to dodge
    damage: 18, // a shotgun bites hard up close
  },
};

/** The "Junior Office Drone" — a fragile, nimble THROWER: holds a firing lane and lobs a spinning binder clip
 *  (dodgeable), swats if cornered. Dies fast. Cell 600×717; its attack atlas shares that cell (no per-state
 *  aspect). */
export const IMP_SPEC: EnemySpec = {
  texName: 'IMP_WALK',
  atlasUrl: '/game/enemies/imp/walk_atlas.webp',
  walkCols: 4,
  walkRows: 5,
  deathTexName: 'IMP_DEATH',
  deathUrl: '/game/enemies/imp/death_atlas.webp',
  deathFrames: 6,
  deathFps: 9,
  attackTexName: 'IMP_ATTACK',
  attackUrl: '/game/enemies/imp/attack_atlas.webp',
  attackFrames: 5,
  attackFps: 10, // 5 frames over the 0.5s wind-up; the clip leaves on release
  painTexName: 'IMP_PAIN',
  painUrl: '/game/enemies/imp/pain_atlas.webp',
  aspect: 600 / 717,
  worldHeight: 1.7,
  walkStepRate: 4.5,
  hitRadius: 0.35, // a slighter body
  hp: 45, // fragile — ~2 fist hits
  speed: 1.8, // nimble
  standoff: 4, // keeps a firing lane
  windup: 0.5, // telegraphs the throw (dodge by side-stepping the clip)
  cooldownTime: 1.6,
  meleeReach: 1.2,
  meleeDamage: 8,
  thrower: {
    texName: 'IMP_CLIP',
    url: '/game/enemies/imp/clip_strip.webp',
    frames: 4,
    speed: 7,
    damage: 8,
    worldHeight: 0.4,
    aspect: 305 / 284,
    spinRate: 10,
    range: 12,
  },
};

/** The "Remote Consultant Husk" — a FAST melee rusher: sprints in and lunges with a clawing swipe (a baked
 *  cyan remote-call shimmer trails the strike), hits harder than a plain Husk but folds about as fast. Walk
 *  cell 444×548; its lunge atlas cell is wider than the walk cell (332×451), so it carries its own aspect. */
export const LOSTSOUL_SPEC: EnemySpec = {
  texName: 'LOSTSOUL_WALK',
  atlasUrl: '/game/enemies/lostsoul/walk_atlas.webp',
  walkCols: 4,
  walkRows: 5,
  deathTexName: 'LOSTSOUL_DEATH',
  deathUrl: '/game/enemies/lostsoul/death_atlas.webp',
  deathFrames: 6,
  deathFps: 9,
  attackTexName: 'LOSTSOUL_ATTACK',
  attackUrl: '/game/enemies/lostsoul/attack_atlas.webp',
  attackFrames: 5,
  attackFps: 16, // the lunge plays across the 0.3s wind-up, claw extended on release
  attackAspect: 332 / 451, // the lunge cell is wider + shorter than the upright walk cell (444/548)
  painTexName: 'LOSTSOUL_PAIN',
  painUrl: '/game/enemies/lostsoul/pain_atlas.webp',
  aspect: 444 / 548,
  worldHeight: 1.85, // a tall figure (a hair over the Husk)
  walkStepRate: 5.5, // a quick sprint cadence
  hitRadius: 0.4,
  hp: 70, // medium — folds about as fast as a Husk
  speed: 2.8, // high — closes faster than a Husk (2.2)
  standoff: 0.7, // melee: right in your face
  windup: 0.3, // a fast lunge tell (dodge by backing out of reach)
  cooldownTime: 0.9, // aggressive — short recovery between lunges
  meleeReach: 1.4, // the lunge claw reaches a touch further than a Husk
  meleeDamage: 16, // medium-high — bites harder than a Husk (12)
};

/** Every enemy kind in play — the loader pulls all their atlases, the spawner places them. */
export const ENEMY_SPECS: readonly EnemySpec[] = [
  PINKY_SPEC,
  SHOTGUNGUY_SPEC,
  IMP_SPEC,
  LOSTSOUL_SPEC,
];
