import { describe, expect, it } from 'vitest';

import type { Sprite } from '../../bsp-engine';
import { ENEMY_RECOIL, HIT_FLASH_DURATION } from '../game-tuning';
import { EXIT_SPEC } from '../world/pickups';
import type { WarmZone } from '../world/zone-world';
import type { Foe } from '../world/enemy-runtime';
import {
  buildLiveSprites,
  buildWarmSprites,
  buildWorldSprites,
  type WorldSpriteSource,
} from './sprite-builder';

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
    const sprites = buildWorldSprites({ world: fixtureWorld(), viewX: 0, viewY: 0 });

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

    const sprites = buildWorldSprites({ world, viewX: 0, viewY: 0 });

    expect(sprites.some((s) => s.tex === 'EXIT_MARKER')).toBe(false);
  });
});

function statefulFoe(over: Partial<Record<string, unknown>>): Foe {
  return {
    x: 3,
    y: 3,
    z: 0,
    dying: false,
    deathTime: 0,
    hitFlash: 0,
    windup: 0,
    walkDist: 0,
    spec: {
      texName: 'WALK',
      painTexName: 'PAIN',
      attackTexName: 'ATTACK',
      deathTexName: 'DEATH',
      worldHeight: 1.7,
      aspect: 0.5,
      attackAspect: 0.8,
      walkStepRate: 1,
      walkCols: 4,
      walkRows: 1,
      windup: 1,
      attackFrames: 3,
      attackFps: 4,
      deathFrames: 5,
      deathFps: 10,
    },
    ...over,
  } as unknown as Foe;
}

describe('enemySprite animation states', () => {
  it('draws the death sheet (no recoil flash) for a dying foe', () => {
    const [s] = buildWorldSprites({
      world: {
        ...fixtureWorld(),
        enemies: [statefulFoe({ dying: true, deathTime: 0.25, hitFlash: 5 })],
      },
      viewX: 0,
      viewY: 0,
    }).slice(1, 2);

    expect(s.tex).toBe('DEATH');
    expect(s.cols).toBe(5);
    expect(s.flash).toBe(0); // a dying enemy carries no flash → no z recoil
    expect(s.z).toBe(0);
  });

  it('draws the attack sheet with its own aspect during wind-up', () => {
    const [s] = buildWorldSprites({
      world: { ...fixtureWorld(), enemies: [statefulFoe({ windup: 0.5 })] },
      viewX: 0,
      viewY: 0,
    }).slice(1, 2);

    expect(s.tex).toBe('ATTACK');
    expect(s.cols).toBe(3);
    expect(s.width).toBeCloseTo(1.7 * 0.8); // worldHeight × attackAspect
  });

  it('falls back to the walk aspect when the attack cell declares none', () => {
    const foe = statefulFoe({ windup: 0.5 });

    (foe.spec as unknown as { attackAspect?: number }).attackAspect = undefined;

    const [s] = buildWorldSprites({
      world: { ...fixtureWorld(), enemies: [foe] },
      viewX: 0,
      viewY: 0,
    }).slice(1, 2);

    expect(s.width).toBeCloseTo(1.7 * 0.5); // worldHeight × walk aspect
  });

  it('draws the pain frame and applies the hit-flash recoil for a flashing foe', () => {
    const [s] = buildWorldSprites({
      world: { ...fixtureWorld(), enemies: [statefulFoe({ hitFlash: HIT_FLASH_DURATION })] },
      viewX: 0,
      viewY: 0,
    }).slice(1, 2);

    expect(s.tex).toBe('PAIN');
    expect(s.flash).toBe(1);
    expect(s.z).toBeCloseTo(ENEMY_RECOIL); // z shifted by flash × ENEMY_RECOIL
  });
});

describe('buildLiveSprites', () => {
  const zoneExits = [{ x: 6, y: 6, z: 0, to: 'z2', entry: 'a' }];
  const stress = [{ x: 7, y: 7, z: 0 }];

  it('appends the zone-graph exit signs (once atlases are ready) and the stress barrels, after the world', () => {
    const sprites = buildLiveSprites({
      world: fixtureWorld(),
      viewX: 0,
      viewY: 0,
      atlasesReady: true,
      zoneExits,
      stress,
    });

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
    const sprites = buildLiveSprites({
      world: fixtureWorld(),
      viewX: 0,
      viewY: 0,
      atlasesReady: false,
      zoneExits,
      stress,
    });

    expect(sprites.filter((s) => s.tex === EXIT_SPEC.texName)).toHaveLength(0);
    expect(sprites.filter((s) => s.tex === 'BARREL')).toHaveLength(1);
  });
});

describe('buildWarmSprites', () => {
  it("builds the neighbour list in its own coordinates, translated by the matching seam's offset", () => {
    const warm = { key: 'z2', ...fixtureWorld() } as unknown as WarmZone;
    const seams = [{ zone: 'z2', dx: 10, dy: 20 }];

    expect(buildWarmSprites({ warm, cameraX: 100, cameraY: 200, seams })).toEqual(
      buildWorldSprites({ world: warm, viewX: 90, viewY: 180 }),
    );
  });

  it('falls back to a zero offset when no seam matches the warm key', () => {
    const warm = { key: 'z2', ...fixtureWorld() } as unknown as WarmZone;

    expect(buildWarmSprites({ warm, cameraX: 100, cameraY: 200, seams: [] })).toEqual(
      buildWorldSprites({ world: warm, viewX: 100, viewY: 200 }),
    );
  });
});
