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

describe('weapon pickups — the vox aspect override', () => {
  it('sizes a voxel collectible by its MODEL ratio, not the 2D icon ratio', () => {
    const world = {
      ...fixtureWorld(),
      weaponPickups: [
        {
          x: 1,
          y: 2,
          z: 0,
          age: 0,
          idx: 0,
          spec: {
            id: 'pistol' as const,
            texName: 'PICKUP_WEAPON_PISTOL',
            url: '/icon.webp',
            worldHeight: 0.5,
            voxHeight: 0.5,
            aspect: 0.89,
            frames: 1,
            frameMs: 100,
            ammoType: 'bullets',
          },
        },
      ],
    };
    const flat = buildWorldSprites({ world, viewX: 0, viewY: 0 });
    const voxed = buildWorldSprites({
      world,
      viewX: 0,
      viewY: 0,
      voxAspects: new Map([['PICKUP_WEAPON_PISTOL', 1.4]]),
    });
    const pick = (
      list: readonly { tex: string; width: number; height: number; voxel?: boolean }[],
    ) => list.find((s) => s.tex === 'PICKUP_WEAPON_PISTOL');

    expect(pick(flat)?.width).toBeCloseTo(0.5 * 0.89, 5); // no vox → the icon ratio
    expect(pick(flat)?.voxel).toBeUndefined(); // …and a plain billboard
    expect(pick(voxed)?.width).toBeCloseTo(0.5 * 1.4, 5); // vox → the model's own ratio
    expect(pick(voxed)?.height).toBe(0.5); // height is the design knob, untouched
    // the flag is what routes the renderer to the VOLUME walk — without it the grid texture
    // draws as a flat billboard: a 97%-transparent smear (the bug this test pins)
    expect(pick(voxed)?.voxel).toBe(true);
  });

  it('spins a vox collectible with its age, and sizes it by its OWN display height', () => {
    const pickupAt = (age: number) => ({
      x: 1,
      y: 2,
      z: 0,
      age,
      idx: 0,
      spec: {
        id: 'pistol' as const,
        texName: 'PICKUP_WEAPON_PISTOL',
        url: '/icon.webp',
        worldHeight: 0.55,
        voxHeight: 0.4,
        aspect: 0.89,
        frames: 1,
        frameMs: 100,
        ammoType: 'bullets',
      },
    });
    const at = (age: number) =>
      buildWorldSprites({
        world: { ...fixtureWorld(), weaponPickups: [pickupAt(age)] },
        viewX: 0,
        viewY: 0,
        voxAspects: new Map([['PICKUP_WEAPON_PISTOL', 1.4]]),
      }).find((s) => s.tex === 'PICKUP_WEAPON_PISTOL');

    expect(at(0)?.height).toBe(0.4); // the per-weapon vox height, not the shared 0.55
    expect(at(0)?.width).toBeCloseTo(0.4 * 1.4, 5);
    expect(at(0)?.facing).toBe(0);
    expect(at(1)?.facing).toBeGreaterThan(0); // the volume turns as the pickup ages
    expect(at(1)?.facing).not.toBe(at(2)?.facing);
  });
});

describe('ammo boxes — the vox branch', () => {
  it('renders an ammo box as a rotating volume when its vox is loaded, billboard otherwise', () => {
    const box = {
      x: 3,
      y: 4,
      z: 0,
      age: 2,
      idx: 0,
      spec: {
        id: 'box_staples',
        texName: 'AMMO_BOX_STAPLES',
        url: '/game/weapons/pistol/ammo/staples_turn_strip.webp',
        frames: 7,
        frameMs: 100,
        worldHeight: 0.5,
        aspect: 150 / 168,
        ammoType: 'bullets',
        amount: 20,
        max: 100,
      },
    };
    const build = (voxAspects?: ReadonlyMap<string, number>) =>
      buildWorldSprites({
        world: { ...fixtureWorld(), ammoBoxes: [box] },
        viewX: 0,
        viewY: 0,
        voxAspects,
      }).find((s) => s.tex === 'AMMO_BOX_STAPLES');

    const flat = build();
    const voxed = build(new Map([['AMMO_BOX_STAPLES', 1.33]]));

    expect(flat?.voxel).toBeUndefined(); // no vox → the spinning billboard
    expect(flat?.cols).toBe(7);
    expect(voxed?.voxel).toBe(true); // vox → a true volume…
    expect(voxed?.width).toBeCloseTo(0.5 * 1.33, 5); // …sized by the model's own ratio
    expect(voxed?.facing).toBeGreaterThan(0); // …turning with its age
  });
});

describe('enemySprite animation states', () => {
  it('draws NOTHING for a dormant foe — its atlas has not landed, it is not in the world to be seen', () => {
    const awake = buildWorldSprites({
      world: { ...fixtureWorld(), enemies: [statefulFoe({})] },
      viewX: 0,
      viewY: 0,
    });
    const asleep = buildWorldSprites({
      world: { ...fixtureWorld(), enemies: [statefulFoe({ dormant: true })] },
      viewX: 0,
      viewY: 0,
    });

    expect(asleep).toHaveLength(awake.length - 1);
  });

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
