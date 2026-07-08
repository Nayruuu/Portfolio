/**
 * The world → `Sprite[]` builders for the BSP demo: they turn ONE zone's live entity state (barrels,
 * enemies, thrown projectiles, floor pickups, the legacy exit sign) into the per-frame billboard list the
 * renderer depth-sorts. The active zone's list ({@link buildLiveSprites}) also carries the zone-graph exit
 * signs + stress-test barrels; a WARM neighbour's list ({@link buildWarmSprites}) is built in its OWN
 * coordinates so props seen through a seam window orient for the camera translated across the seam.
 *
 * Pure functions of their explicit arguments — the component sources the zone state at the call site. The
 * produced array's contents + order are load-bearing (a changed list is a visual diff), so the build order,
 * the distance/aliveness culling, and the atlas gating here mirror the render contract exactly.
 */
import { orientSprite, type Sprite } from '../../../core/lib/bsp-engine';
import type { EnemyShot } from '../../../core/lib';
import type { Foe } from '../enemy-runtime';
import type { WarmZone, ZoneExit } from '../zone-world';
import { EXIT_SPEC, pickupFrame, type Marker } from '../pickups';

export const HIT_FLASH_DURATION = 0.12; // seconds an enemy flashes white after a hit (mirrors the grid)
const ENEMY_RECOIL = 0.18; // world units an enemy flinches UP at full hit-flash (the grid's recoil, in world z)

/** The subset of a zone's live state the world-sprite build reads — the active zone (assembled at the call
 *  site) or a {@link WarmZone} neighbour both satisfy it. */
export type WorldSpriteSource = Pick<
  WarmZone,
  | 'targets'
  | 'enemies'
  | 'enemyShots'
  | 'vitals'
  | 'ammoBoxes'
  | 'keycards'
  | 'weaponPickups'
  | 'exit'
>;

/** The shared shape every rotating floor pickup's spec exposes to the turntable billboard build. */
interface SpinningPickupSpec {
  readonly texName: string;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly frames: number;
  readonly frameMs: number;
}

/** One enemy → its billboard for this frame. Priority of animation state: death → attack wind-up → pain →
 *  walk; the hit-flash decays over its duration (0→1 additive brighten) and flinches the body UP with it. */
function enemySprite(e: Foe): Sprite {
  const s = e.spec;
  // A dying enemy carries no flash — the death animation owns its feedback.
  const flash = e.dying ? 0 : e.hitFlash / HIT_FLASH_DURATION;
  const base = {
    x: e.x,
    y: e.y,
    z: e.z + flash * ENEMY_RECOIL,
    width: s.worldHeight * s.aspect,
    height: s.worldHeight,
    flash,
  };

  if (e.dying) {
    // Death atlas (front-only strip): advance by deathTime, then freeze on the last frame — a corpse.
    const col = Math.min(s.deathFrames - 1, Math.floor(e.deathTime * s.deathFps));

    return { ...base, tex: s.deathTexName, cols: s.deathFrames, rows: 1, col, row: 0 };
  }
  if (e.windup > 0) {
    // Attack atlas (front-only): the wind-up animation plays once across the telegraph. Its cell may have a
    // different aspect than the walk cell, so override the billboard width for this state.
    const col = Math.min(s.attackFrames - 1, Math.floor((s.windup - e.windup) * s.attackFps));

    return {
      ...base,
      width: s.worldHeight * (s.attackAspect ?? s.aspect),
      tex: s.attackTexName,
      cols: s.attackFrames,
      rows: 1,
      col,
      row: 0,
    };
  }
  if (e.hitFlash > 0) {
    // Pain: a single front-only flinch frame while the hit-flash lasts (priority: attack → pain → walk).
    return { ...base, tex: s.painTexName, cols: 1, rows: 1, col: 0, row: 0 };
  }
  // Walk frame from cumulative travel (legs tied to motion); front row — a foe faces the player in combat.
  const col = Math.floor(e.walkDist * s.walkStepRate) % s.walkCols;

  return { ...base, tex: s.texName, cols: s.walkCols, rows: s.walkRows, col, row: 0 };
}

/** A thrower's flying projectile → a spinning front-strip billboard at its world point. */
function enemyShotSprite(shot: EnemyShot): Sprite {
  const col = Math.floor(shot.traveled * shot.proj.spinRate) % shot.proj.frames;

  return {
    x: shot.x,
    y: shot.y,
    z: shot.z,
    tex: shot.proj.texName,
    width: shot.proj.worldHeight * shot.proj.aspect,
    height: shot.proj.worldHeight,
    cols: shot.proj.frames,
    rows: 1,
    col,
    row: 0,
  };
}

/** A grounded turntable pickup (vitals · ammo box · access badge · weapon unlock) → its billboard: a
 *  turntable when `spin`, else a static frame-0 quad. The quad never rotates; only the atlas cell advances. */
function spinningSprite(
  x: number,
  y: number,
  z: number,
  spec: SpinningPickupSpec,
  age: number,
  spin = true,
): Sprite {
  const col = pickupFrame(age, spec.frameMs, spec.frames, spin);

  return {
    x,
    y,
    z,
    tex: spec.texName,
    width: spec.worldHeight * spec.aspect,
    height: spec.worldHeight,
    cols: spec.frames,
    rows: 1,
    col,
    row: 0,
  };
}

/** The legacy exit sign → a grounded single-frame billboard (the level goal). */
function exitSprite(exit: Marker): Sprite {
  return {
    x: exit.x,
    y: exit.y,
    z: exit.z,
    tex: exit.spec.texName,
    width: exit.spec.worldHeight * exit.spec.aspect,
    height: exit.spec.worldHeight,
  };
}

/** ONE zone's entity billboards — the active zone's (via {@link buildLiveSprites}) or a WARM neighbour's
 *  (via {@link buildWarmSprites}), in that zone's own coordinates. (`viewX`,`viewY`) is the camera IN THAT
 *  ZONE'S coordinates — it picks each directional prop's rotation cell per frame. Build order is load-bearing:
 *  targets → enemies → thrown shots → vitals → ammo → keycards → weapon pickups → exit. */
export function buildWorldSprites(
  world: WorldSpriteSource,
  viewX: number,
  viewY: number,
): Sprite[] {
  const sprites = world.targets
    .filter((t) => t.alive)
    .map((t) => orientSprite(t.sprite, viewX, viewY));

  for (const e of world.enemies) {
    sprites.push(enemySprite(e));
  }
  for (const shot of world.enemyShots) {
    sprites.push(enemyShotSprite(shot));
  }
  for (const v of world.vitals) {
    sprites.push(spinningSprite(v.x, v.y, v.z, v.spec, v.age, v.spec.spin));
  }
  for (const b of world.ammoBoxes) {
    sprites.push(spinningSprite(b.x, b.y, b.z, b.spec, b.age));
  }
  for (const k of world.keycards) {
    sprites.push(spinningSprite(k.x, k.y, k.z, k.spec, k.age));
  }
  for (const p of world.weaponPickups) {
    sprites.push(spinningSprite(p.x, p.y, p.z, p.spec, p.age));
  }
  if (world.exit !== null) {
    sprites.push(exitSprite(world.exit));
  }

  return sprites;
}

/** The active zone's live billboards this frame — the world sprites plus the zone-graph exit signs (gated on
 *  the pickup atlases having decoded) and the stress-test barrels. Projectiles are NOT here: they are painted
 *  screen-space over the frame by the world-fx painter. */
export function buildLiveSprites(
  world: WorldSpriteSource,
  viewX: number,
  viewY: number,
  atlasesReady: boolean,
  zoneExits: readonly ZoneExit[],
  stressEnemies: readonly { readonly x: number; readonly y: number; readonly z: number }[],
): Sprite[] {
  const sprites = buildWorldSprites(world, viewX, viewY);

  if (atlasesReady) {
    // Each zone-graph exit shows the same exit sign (its art decodes with the pickup atlases). Active zone
    // only — a warm neighbour's graph exits stay signless behind the window.
    for (const e of zoneExits) {
      sprites.push({
        x: e.x,
        y: e.y,
        z: e.z,
        tex: EXIT_SPEC.texName,
        width: EXIT_SPEC.worldHeight * EXIT_SPEC.aspect,
        height: EXIT_SPEC.worldHeight,
      });
    }
  }
  for (const e of stressEnemies) {
    sprites.push({ x: e.x, y: e.y, z: e.z, tex: 'BARREL', width: 0.8, height: 1.7 }); // synthetic enemy billboard
  }

  return sprites;
}

/** A WARM neighbour's live billboards for the render's neighbour-sprites channel, in ITS own coordinates —
 *  directional props oriented for the camera translated through the seam (the same ghost point the warm AI
 *  tracks), so a totem seen through the window turns exactly like a local one. */
export function buildWarmSprites(
  warm: WarmZone,
  cameraX: number,
  cameraY: number,
  seams: readonly { readonly zone: string; readonly dx: number; readonly dy: number }[],
): Sprite[] {
  const seam = seams.find((s) => s.zone === warm.key);

  return buildWorldSprites(warm, cameraX - (seam?.dx ?? 0), cameraY - (seam?.dy ?? 0));
}
