// The produced array's contents + ORDER are load-bearing (a changed list is a visual diff), so build order,
// culling, and atlas gating mirror the render contract exactly.
import { orientSprite, type Sprite } from '../../bsp-engine';
import { ENEMY_RECOIL, HIT_FLASH_DURATION, WEAPON_VOX_SPIN } from '../game-tuning';
import type { EnemyShot } from '../enemy';
import type { Foe } from '../world/enemy-runtime';
import type { WarmZone, ZoneExit } from '../world/zone-world';
import { EXIT_SPEC, pickupFrame, type Marker } from '../world/pickups';

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

/** (`viewX`,`viewY`) is the camera IN THAT ZONE'S coordinates — it picks each directional prop's rotation cell. */
export interface WorldSpritesInput {
  readonly world: WorldSpriteSource;
  readonly viewX: number;
  readonly viewY: number;
  /** texName → the voxel model's own lat/height ratio: a vox collectible is sized by ITS proportions,
   *  not the 2D icon's (the grid maps onto the sprite box, so a mismatched box distorts the model). */
  readonly voxAspects?: ReadonlyMap<string, number>;
}

export interface LiveSpritesInput {
  readonly world: WorldSpriteSource;
  readonly viewX: number;
  readonly viewY: number;
  readonly atlasesReady: boolean;
  readonly zoneExits: readonly ZoneExit[];
  readonly stress: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly voxAspects?: ReadonlyMap<string, number>;
}

/** `cameraX`/`cameraY` are in the ACTIVE zone's coordinates; the matching seam translates them into the warm
 *  zone's own coordinates. */
export interface WarmSpritesInput {
  readonly warm: WarmZone;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly seams: readonly { readonly zone: string; readonly dx: number; readonly dy: number }[];
  readonly voxAspects?: ReadonlyMap<string, number>;
}

interface SpinningPickupSpec {
  readonly texName: string;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly frames: number;
  readonly frameMs: number;
}

/** Animation-state priority: death → attack wind-up → pain → walk. */
function enemySprite(e: Foe): Sprite {
  const s = e.spec;
  const flash = e.dying ? 0 : e.hitFlash / HIT_FLASH_DURATION; // a dying enemy carries no flash

  const base = {
    x: e.x,
    y: e.y,
    z: e.z + flash * ENEMY_RECOIL,
    width: s.worldHeight * s.aspect,
    height: s.worldHeight,
    flash,
  };

  if (e.dying) {
    const col = Math.min(s.deathFrames - 1, Math.floor(e.deathTime * s.deathFps)); // freeze on the last frame — a corpse

    return { ...base, tex: s.deathTexName, cols: s.deathFrames, rows: 1, col, row: 0 };
  }
  if (e.windup > 0) {
    // The attack cell may have a different aspect than the walk cell → override the billboard width here.
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
    return { ...base, tex: s.painTexName, cols: 1, rows: 1, col: 0, row: 0 };
  }
  // Walk frame from cumulative travel; front row (row 0) — a foe faces the player in combat.
  const col = Math.floor(e.walkDist * s.walkStepRate) % s.walkCols;

  return { ...base, tex: s.texName, cols: s.walkCols, rows: s.walkRows, col, row: 0 };
}

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

/** A pickup whose hand-sculpted vox is loaded: voxel: true routes the renderer to the VOLUME walk —
 *  without it the grid texture would draw as a flat billboard (a ~97%-transparent smear). The volume
 *  TURNS with the pickup's age (the vox twin of the 2D icon's frame spin), sized by the MODEL's ratio. */
function voxPickupSprite(
  x: number,
  y: number,
  z: number,
  tex: string,
  height: number,
  ratio: number,
  age: number,
): Sprite {
  return {
    x,
    y,
    z,
    tex,
    width: height * ratio,
    height,
    voxel: true,
    facing: age * WEAPON_VOX_SPIN,
  };
}

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

/** Build order is load-bearing: targets → enemies → thrown shots → vitals → ammo → keycards → weapon pickups → exit. */
export function buildWorldSprites(input: WorldSpritesInput): Sprite[] {
  const { world, viewX, viewY } = input;
  const sprites = world.targets
    .filter((t) => t.alive)
    .map((t) => orientSprite(t.sprite, viewX, viewY));

  for (const e of world.enemies) {
    if (e.dormant) {
      continue; // no atlas yet — it is not in the world to be seen
    }
    sprites.push(enemySprite(e));
  }
  for (const shot of world.enemyShots) {
    sprites.push(enemyShotSprite(shot));
  }
  for (const v of world.vitals) {
    sprites.push(spinningSprite(v.x, v.y, v.z, v.spec, v.age, v.spec.spin));
  }
  for (const b of world.ammoBoxes) {
    const voxAspect = input.voxAspects?.get(b.spec.texName);

    if (voxAspect === undefined) {
      sprites.push(spinningSprite(b.x, b.y, b.z, b.spec, b.age));
      continue;
    }
    sprites.push(
      voxPickupSprite(b.x, b.y, b.z, b.spec.texName, b.spec.worldHeight, voxAspect, b.age),
    );
  }
  for (const k of world.keycards) {
    sprites.push(spinningSprite(k.x, k.y, k.z, k.spec, k.age));
  }
  for (const p of world.weaponPickups) {
    const voxAspect = input.voxAspects?.get(p.spec.texName);

    if (voxAspect === undefined) {
      sprites.push(spinningSprite(p.x, p.y, p.z, p.spec, p.age));
      continue;
    }
    sprites.push(
      voxPickupSprite(p.x, p.y, p.z, p.spec.texName, p.spec.voxHeight, voxAspect, p.age),
    );
  }
  if (world.exit !== null) {
    sprites.push(exitSprite(world.exit));
  }

  return sprites;
}

/** Projectiles are NOT here — they are painted screen-space over the frame by the world-fx painter. */
export function buildLiveSprites(input: LiveSpritesInput): Sprite[] {
  const { world, viewX, viewY, atlasesReady, zoneExits, stress } = input;
  const sprites = buildWorldSprites({ world, viewX, viewY, voxAspects: input.voxAspects });

  if (atlasesReady) {
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
  for (const e of stress) {
    sprites.push({ x: e.x, y: e.y, z: e.z, tex: 'BARREL', width: 0.8, height: 1.7 });
  }

  return sprites;
}

/** Built in the neighbour's OWN coordinates — props oriented for the camera translated through the seam, so a
 *  totem seen through the window turns exactly like a local one. */
export function buildWarmSprites(input: WarmSpritesInput): Sprite[] {
  const { warm, cameraX, cameraY, seams } = input;
  const seam = seams.find((s) => s.zone === warm.key);

  return buildWorldSprites({
    world: warm,
    viewX: cameraX - (seam?.dx ?? 0),
    viewY: cameraY - (seam?.dy ?? 0),
    voxAspects: input.voxAspects,
  });
}
