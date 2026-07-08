import { describe, expect, it } from 'vitest';

import type { Sprite } from '../../../core/lib/bsp-engine';
import { EXIT_SPEC } from '../world/pickups';
import type { WarmZone } from '../world/zone-world';
import type { Foe } from '../world/enemy-runtime';
import {
  buildLiveSprites,
  buildWarmSprites,
  buildWorldSprites,
  type WorldSpriteSource,
} from './sprite-builder';

/** A minimal walking foe — the walk branch reads only these fields; cast past the full art+combat spec. */
function walkingFoe(tex: string): Foe {
  return {
    x: 3,
    y: 3,
    z: 0,
    dying: false,
    hitFlash: 0,
    windup: 0,
    walkDist: 0,
    spec: {
      texName: tex,
      worldHeight: 1.7,
      aspect: 0.5,
      walkStepRate: 1,
      walkCols: 4,
      walkRows: 1,
    },
  } as unknown as Foe;
}

/** A spinning-pickup spec + instance stub shaped for the turntable billboard build. */
function pickup(tex: string): { x: number; y: number; z: number; age: number; spec: SpinningStub } {
  return {
    x: 1,
    y: 1,
    z: 0,
    age: 0,
    spec: { texName: tex, worldHeight: 0.5, aspect: 1, frames: 1, frameMs: 100, spin: true },
  };
}
interface SpinningStub {
  readonly texName: string;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly frames: number;
  readonly frameMs: number;
  readonly spin: boolean;
}

/** A small fixture zone: one alive + one culled barrel, one foe, one thrown shot, one of each pickup, and an
 *  exit marker — enough to pin the build ORDER and the aliveness cull. */
function fixtureWorld(): WorldSpriteSource {
  const barrel = (tex: string, alive: boolean): { sprite: Sprite; alive: boolean } => ({
    sprite: { x: 2, y: 2, z: 0, tex, width: 0.8, height: 1.5 },
    alive,
  });

  return {
    targets: [barrel('B_ALIVE', true), barrel('B_DEAD', false)],
    enemies: [walkingFoe('ENEMY_WALK')],
    enemyShots: [
      {
        x: 4,
        y: 4,
        z: 1,
        traveled: 0,
        proj: { texName: 'SHOT', worldHeight: 0.3, aspect: 1, frames: 1, spinRate: 1 },
      },
    ] as unknown as WorldSpriteSource['enemyShots'],
    vitals: [pickup('VITAL')] as unknown as WorldSpriteSource['vitals'],
    ammoBoxes: [pickup('AMMO')] as unknown as WorldSpriteSource['ammoBoxes'],
    keycards: [pickup('CARD')] as unknown as WorldSpriteSource['keycards'],
    weaponPickups: [pickup('WEAPON')] as unknown as WorldSpriteSource['weaponPickups'],
    exit: {
      x: 5,
      y: 5,
      z: 0,
      spec: { texName: 'EXIT_MARKER', worldHeight: 1, aspect: 1 },
    } as unknown as WorldSpriteSource['exit'],
  };
}

describe('buildWorldSprites', () => {
  it('builds one billboard per live entity, in a fixed order, culling dead barrels', () => {
    const sprites = buildWorldSprites(fixtureWorld(), 0, 0);

    // The dead barrel drops out; the rest keep the build order: target → enemy → shot → pickups → exit.
    expect(sprites.map((s) => s.tex)).toEqual([
      'B_ALIVE',
      'ENEMY_WALK',
      'SHOT',
      'VITAL',
      'AMMO',
      'CARD',
      'WEAPON',
      'EXIT_MARKER',
    ]);
  });

  it('omits the exit billboard when the zone has no exit marker', () => {
    const world = { ...fixtureWorld(), exit: null };

    const sprites = buildWorldSprites(world, 0, 0);

    expect(sprites.some((s) => s.tex === 'EXIT_MARKER')).toBe(false);
  });
});

describe('buildLiveSprites', () => {
  const zoneExits = [{ x: 6, y: 6, z: 0, to: 'z2', entry: 'a' }];
  const stress = [{ x: 7, y: 7, z: 0 }];

  it('appends the zone-graph exit signs (once atlases are ready) and the stress barrels, after the world', () => {
    const sprites = buildLiveSprites(fixtureWorld(), 0, 0, true, zoneExits, stress);

    expect(sprites.map((s) => s.tex)).toEqual([
      'B_ALIVE',
      'ENEMY_WALK',
      'SHOT',
      'VITAL',
      'AMMO',
      'CARD',
      'WEAPON',
      'EXIT_MARKER',
      EXIT_SPEC.texName,
      'BARREL',
    ]);
  });

  it('gates the zone-graph exit signs on the atlases having decoded', () => {
    const sprites = buildLiveSprites(fixtureWorld(), 0, 0, false, zoneExits, stress);

    // Still the world + the stress barrel, but no exit-sign billboard.
    expect(sprites.filter((s) => s.tex === EXIT_SPEC.texName)).toHaveLength(0);
    expect(sprites.filter((s) => s.tex === 'BARREL')).toHaveLength(1);
  });
});

describe('buildWarmSprites', () => {
  it("builds the neighbour list in its own coordinates, translated by the matching seam's offset", () => {
    const warm = { key: 'z2', ...fixtureWorld() } as unknown as WarmZone;
    const seams = [{ zone: 'z2', dx: 10, dy: 20 }];

    // Equivalent to building the warm world at the seam-translated camera point.
    expect(buildWarmSprites(warm, 100, 200, seams)).toEqual(buildWorldSprites(warm, 90, 180));
  });

  it('falls back to a zero offset when no seam matches the warm key', () => {
    const warm = { key: 'z2', ...fixtureWorld() } as unknown as WarmZone;

    expect(buildWarmSprites(warm, 100, 200, [])).toEqual(buildWorldSprites(warm, 100, 200));
  });
});
