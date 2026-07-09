import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineDef, MapSource, SideDef } from '../../bsp-engine';
import { LEVELS, parseLevelParams } from '../registry';
import { PINKY_SPEC } from '../enemy';
import { ZONE_FADE } from '../game-tuning';
import type { Level } from '../level';
import { zoneStates } from '../zone';
import type { Foe } from './enemy-runtime';
import { EYE_HEIGHT, ZoneRuntime, type MutableCamera, type ZoneRuntimeHooks } from './zone-runtime';

// A self-contained closed room with NO seam portals — its own floor, no warm neighbour.
const ROOM_SIDE: SideDef = {
  sector: 0,
  xOffset: 0,
  yOffset: 0,
  upperTex: 'w',
  lowerTex: 'w',
  middleTex: 'w',
};
const roomWall = (v1: number, v2: number): LineDef => ({ v1, v2, front: ROOM_SIDE, back: null });
const SYNTHETIC_LEVEL: Level = {
  map: {
    sectors: [{ floorZ: 0, ceilZ: 4, floorTex: 'f', ceilTex: 'c', light: 200 }],
    things: [],
    vertices: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    linedefs: [roomWall(0, 1), roomWall(1, 2), roomWall(2, 3), roomWall(3, 0)],
  },
  spawn: { x: 10, y: 10, angle: 0 },
  enemies: [{ spec: PINKY_SPEC, x: 8, y: 8 }],
  health: [[6, 6]],
  armor: [],
  ammo: [
    [4, 4],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 4],
    [9, 4],
  ], // one coord per AMMO_BOX_SPECS entry, in order
  keycards: [],
  exits: [{ x: 5, y: 5, to: 'm1', entry: 'main' }], // a graph exit, no weapons field
  doors: [],
};

function makeCamera(): MutableCamera {
  return { x: 0, y: 0, angle: 0, z: 0, pitch: 0 };
}

function makeRuntime(camera: MutableCamera = makeCamera()): {
  runtime: ZoneRuntime;
  camera: MutableCamera;
  hooks: {
    onGeometryLoaded: ReturnType<typeof vi.fn>;
    onSeamSwap: ReturnType<typeof vi.fn>;
    onZoneReset: ReturnType<typeof vi.fn>;
    onSeamTranslate: ReturnType<typeof vi.fn>;
  };
} {
  const hooks = {
    onGeometryLoaded: vi.fn<ZoneRuntimeHooks['onGeometryLoaded']>(),
    onSeamSwap: vi.fn<ZoneRuntimeHooks['onSeamSwap']>(),
    onZoneReset: vi.fn<ZoneRuntimeHooks['onZoneReset']>(),
    onSeamTranslate: vi.fn<ZoneRuntimeHooks['onSeamTranslate']>(),
  };
  const runtime = new ZoneRuntime({ camera, params: parseLevelParams(''), ...hooks });

  return { runtime, camera, hooks };
}

beforeEach(() => {
  zoneStates.reset();
});

describe('ZoneRuntime — active world load', () => {
  it('reifies the loaded floor as the active world and seats the player at its spawn', () => {
    const { runtime, camera } = makeRuntime();

    runtime.loadZone('m1');

    expect(runtime.world.key).toBe('m1');
    expect(runtime.world.sectors.length).toBeGreaterThan(0);
    expect(runtime.world.map).toBeDefined();
    expect(runtime.currentKey).toBe('m1');
    expect(camera.x).toBe(26);
    expect(camera.y).toBe(131);
    expect(camera.z).toBeCloseTo(runtime.world.level.map.sectors[0].floorZ + EYE_HEIGHT, 5);
    expect(camera.pitch).toBe(0);
  });

  it('notifies the component of the new geometry + a world reset on load', () => {
    const { runtime, hooks } = makeRuntime();

    runtime.loadZone('m1');

    expect(hooks.onGeometryLoaded).toHaveBeenCalledTimes(1);
    const [key, source] = hooks.onGeometryLoaded.mock.calls[0] as [string, MapSource];

    expect(key).toBe('m1');
    expect(source.linedefs.length).toBeGreaterThan(0);
    expect(hooks.onZoneReset).toHaveBeenCalledTimes(1);
  });

  it('loads bare geometry before the atlases decode, then populates in place on markAtlasesReady', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    expect(runtime.atlasesReady).toBe(false);
    expect(runtime.world.populated).toBe(false);
    expect(runtime.world.enemies).toHaveLength(0);
    expect(runtime.world.vitals).toHaveLength(0);

    runtime.markAtlasesReady();

    expect(runtime.atlasesReady).toBe(true);
    expect(runtime.world.populated).toBe(true);
    expect(runtime.world.enemies.length).toBeGreaterThan(0);
    expect(runtime.world.vitals.length).toBeGreaterThan(0);
  });

  it('falls back to the default level on an unknown key (never crashes on a bad load)', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('does-not-exist');

    expect(runtime.world.key).toBe('m1');
  });
});

describe('ZoneRuntime — warm neighbour', () => {
  it('warms the zone behind the active map’s passable seam, populated once the atlases exist', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    expect(runtime.warm).not.toBeNull();
    expect(runtime.warm?.key).toBe('m2');
    expect(runtime.warm?.populated).toBe(false);

    runtime.markAtlasesReady();

    expect(runtime.warm?.populated).toBe(true);
    expect(runtime.warm?.map).toBeDefined();
    expect(runtime.warm?.enemies.length ?? 0).toBeGreaterThan(0);
  });

  it('exposes the active map’s passable seams for the crossing test', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');

    expect(runtime.seams.length).toBeGreaterThan(0);
    expect(runtime.seams.some((seam) => seam.zone === 'm2')).toBe(true);
  });

  it('steps the warm neighbour’s pickups forward each frame', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const warm = runtime.warm;

    expect(warm).not.toBeNull();
    if (warm === null || warm.vitals.length === 0) {
      throw new Error('expected a populated warm neighbour with vitals to age');
    }
    const before = warm.vitals[0].age;

    runtime.stepWarm(0.5);

    expect(warm.vitals[0].age).toBeCloseTo(before + 0.5, 5);
  });
});

describe('ZoneRuntime — seamless seam crossing', () => {
  it('swaps the active and warm worlds and translates the player across the seam', () => {
    const camera = makeCamera();
    const { runtime, hooks } = makeRuntime(camera);

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const crossed = runtime.crossSeam(26, 31, 26, 29);

    expect(crossed).toBe(true);
    expect(runtime.world.key).toBe('m2');
    expect(runtime.warm?.key).toBe('m1');
    expect(camera.x).toBeCloseTo(26, 5);
    expect(camera.y).toBeCloseTo(129, 5);
    expect(hooks.onSeamSwap).toHaveBeenCalledWith('m2', expect.anything());
    expect(hooks.onSeamTranslate).toHaveBeenCalledWith(0, -100);
  });

  it('does not cross (or swap) when the step never reaches the seam’s back side', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const crossed = runtime.crossSeam(26, 33, 26, 32);

    expect(crossed).toBe(false);
    expect(runtime.world.key).toBe('m1');
  });

  it('re-derives the active seams after a crossing so the reverse crossing is armed', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    runtime.crossSeam(26, 31, 26, 29);

    expect(runtime.seams.some((seam) => seam.zone === 'm1')).toBe(true);
  });
});

describe('ZoneRuntime — snapshot / restore round-trip', () => {
  it('persists a killed enemy as a corpse and a taken pickup as gone across a load away and back', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const vitalCount = runtime.world.vitals.length;

    expect(runtime.world.enemies.length).toBeGreaterThan(0);
    expect(vitalCount).toBeGreaterThan(0);

    runtime.world.enemies[0].dying = true;
    runtime.world.enemies[0].hp = 0;
    runtime.world.vitals = runtime.world.vitals.slice(1);

    runtime.loadZone('m2');
    runtime.loadZone('m1');

    expect(runtime.world.enemies[0].dying).toBe(true);
    expect(runtime.world.enemies[0].hp).toBe(0);
    expect(runtime.world.vitals).toHaveLength(vitalCount - 1);
  });

  it('respawns everything on a fresh (new-game) load', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const vitalCount = runtime.world.vitals.length;

    runtime.world.enemies[0].dying = true;
    runtime.world.enemies[0].hp = 0;
    runtime.world.vitals = runtime.world.vitals.slice(1);
    runtime.loadZone('m2');

    runtime.loadZone('m1', undefined, true);

    expect(runtime.world.enemies[0].dying).toBe(false);
    expect(runtime.world.enemies[0].hp).toBeGreaterThan(0);
    expect(runtime.world.vitals).toHaveLength(vitalCount);
  });
});

describe('ZoneRuntime — fade transition', () => {
  it('holds the current floor through the fade-out, swaps at black, then clears', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    runtime.beginTransition('accueil', 'main');

    expect(runtime.transition).not.toBeNull();

    runtime.stepTransition(ZONE_FADE * 0.5);
    expect(runtime.transition?.swapped).toBe(false);
    expect(runtime.world.key).toBe('m1');

    runtime.stepTransition(ZONE_FADE * 0.6);
    expect(runtime.transition?.swapped).toBe(true);
    expect(runtime.world.key).toBe('accueil');

    runtime.stepTransition(ZONE_FADE);
    expect(runtime.transition).toBeNull();
  });

  it('cancels an in-flight transition (the new-game restart)', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.beginTransition('accueil', 'main');
    runtime.cancelTransition();

    expect(runtime.transition).toBeNull();
  });

  it('is a no-op to step a transition when none is pending', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.stepTransition(1);

    expect(runtime.transition).toBeNull();
    expect(runtime.world.key).toBe('m1');
  });
});

describe('ZoneRuntime — the read-only indexes', () => {
  it('exposes the graph exits, sliding-door index, neighbour sources and the arrival lock', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');

    expect(Array.isArray(runtime.exits)).toBe(true);
    expect(Array.isArray(runtime.slidingDoors)).toBe(true);
    expect(runtime.neighborSources.has('m2')).toBe(true);

    runtime.exitsLocked = false;
    expect(runtime.exitsLocked).toBe(false);
    runtime.exitsLocked = true;
    expect(runtime.exitsLocked).toBe(true);
  });

  it('compiles the neighbour render maps, attaching per-zone sprite lists when supplied', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();

    const bare = runtime.zoneNeighbors(undefined);

    expect(bare.get('m2')?.map).toBeDefined();
    expect(bare.get('m2')?.sprites).toBeUndefined();

    const withSprites = runtime.zoneNeighbors(new Map([['m2', []]]));

    expect(withSprites.get('m2')?.sprites).toEqual([]);
  });
});

describe('ZoneRuntime — the art-inspection foe strip', () => {
  it('populates zero foes once enemy spawning is switched off', () => {
    const { runtime } = makeRuntime();

    runtime.setSpawnEnemies(false);
    runtime.loadZone('m1');
    runtime.markAtlasesReady();

    expect(runtime.world.enemies).toHaveLength(0);
    expect(runtime.world.vitals.length).toBeGreaterThan(0); // pickups still populate
  });
});

describe('ZoneRuntime — a self-contained graph-exit floor', () => {
  const KEY = 'synthfixture';

  afterEach(() => {
    delete (LEVELS as Record<string, Level>)[KEY];
  });

  it('exposes its graph exits, warms no neighbour, and snapshots its weaponless roster on leaving', () => {
    (LEVELS as Record<string, Level>)[KEY] = SYNTHETIC_LEVEL;
    const { runtime } = makeRuntime();

    runtime.loadZone(KEY);
    runtime.markAtlasesReady();

    expect(runtime.currentKey).toBe(KEY);
    expect(runtime.exits).toHaveLength(1); // the graph-exit map runs (exits-defined branch)
    expect(runtime.exits[0].to).toBe('m1');
    expect(runtime.warm).toBeNull(); // a seam-less room warms no neighbour

    runtime.stepWarm(0.1); // early-returns with no warm neighbour

    runtime.loadZone('m1'); // snapshots the weaponless floor on the way out (weapons?.length ?? 0)

    expect(runtime.currentKey).toBe('m1');
  });
});

describe('ZoneRuntime — a crossing that has to build (not reuse) the incoming zone', () => {
  const KEY = 'synthportal';
  // A room north of the y=30 seam line, portalling SOUTH into M1 (same seam span M1 uses toward M2).
  const PORTAL_SIDE: SideDef = {
    sector: 0,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'w',
    lowerTex: 'w',
    middleTex: 'w',
  };
  const PORTAL_LEVEL: Level = {
    map: {
      sectors: [{ floorZ: 0, ceilZ: 4, floorTex: 'f', ceilTex: 'c', light: 200 }],
      things: [],
      vertices: [
        { x: 24, y: 30 },
        { x: 28, y: 30 },
        { x: 28, y: 40 },
        { x: 24, y: 40 },
      ],
      linedefs: [
        // the seam (front faces the room to the north), a passable portal into M1 with no translation
        {
          v1: 1,
          v2: 0,
          front: PORTAL_SIDE,
          back: null,
          zonePortal: { zone: 'm1', dx: 0, dy: 0, passable: true },
        },
        { v1: 0, v2: 3, front: PORTAL_SIDE, back: null },
        { v1: 3, v2: 2, front: PORTAL_SIDE, back: null },
        { v1: 2, v2: 1, front: PORTAL_SIDE, back: null },
      ],
    },
    spawn: { x: 26, y: 35, angle: 0 },
    enemies: [],
    health: [],
    armor: [],
    ammo: [
      [25, 35],
      [25, 36],
      [25, 37],
      [26, 35],
      [26, 36],
      [26, 37],
    ],
    keycards: [],
    doors: [],
  };

  afterEach(() => {
    delete (LEVELS as Record<string, Level>)[KEY];
  });

  it('reuses the warm neighbour on the first crossing, then BUILDS a fresh zone on the next', () => {
    (LEVELS as Record<string, Level>)[KEY] = PORTAL_LEVEL;
    const { runtime } = makeRuntime();

    runtime.loadZone(KEY);
    runtime.markAtlasesReady();
    expect(runtime.warm?.key).toBe('m1'); // the seam warms M1

    // First cross portal→M1: the warm neighbour IS M1 → the reuse arm.
    expect(runtime.crossSeam(26, 31, 26, 29)).toBe(true);
    expect(runtime.world.key).toBe('m1');
    expect(runtime.warm?.key).toBe(KEY); // the room we came from is now warm

    // Cross M1→M2 (M1's own seam): the warm neighbour is the portal room, NOT M2 → the BUILD arm.
    expect(runtime.crossSeam(26, 31, 26, 29)).toBe(true);
    expect(runtime.world.key).toBe('m2');
  });
});

describe('ZoneRuntime — a warm foe’s (no-op) reach across the seam', () => {
  it('winds a warm melee foe up and releases its harmless swing at the seam-side player', () => {
    const camera = makeCamera();
    const { runtime } = makeRuntime(camera);

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    runtime.crossSeam(26, 31, 26, 29); // → active m2, warm m1

    const warm = runtime.warm;
    const seam = runtime.seams.find((s) => s.zone === 'm1');

    expect(warm).not.toBeNull();
    expect(seam).toBeDefined();
    if (warm === null || seam === undefined) {
      throw new Error('expected a warm m1 neighbour reachable through the seam');
    }
    // Sit a fresh melee foe right on the warm-frame player (camera translated through the seam).
    const foe = {
      spec: PINKY_SPEC,
      x: camera.x - seam.dx,
      y: camera.y - seam.dy,
      z: 0,
      walkDist: 0,
      hp: 100,
      dying: false,
      deathTime: 0,
      hitFlash: 0,
      windup: 0,
      cooldown: 0,
    } as unknown as Foe;

    warm.enemies = [foe];

    runtime.stepWarm(0.5); // in melee range + off cooldown → arm the wind-up
    expect(foe.windup).toBeGreaterThan(0);

    runtime.stepWarm(1); // wind-up elapses → the swing lands its (no-op) hurt on the seam-side player

    expect(foe.windup).toBe(0);
    expect(foe.cooldown).toBeGreaterThan(0); // the swing resolved
  });
});

describe('ZoneRuntime — snapshotting an un-decoded floor', () => {
  it('persists the authored roster untouched when leaving before the atlases decode', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1'); // bare — no markAtlasesReady, so world.enemies is still empty
    expect(runtime.world.enemies).toHaveLength(0);

    runtime.loadZone('m2'); // snapshots m1 off the authored spawns (enemy === undefined branch)
    runtime.loadZone('m1');
    runtime.markAtlasesReady();

    expect(runtime.world.enemies.length).toBeGreaterThan(0);
    expect(runtime.world.enemies.every((foe) => !foe.dying)).toBe(true);
  });
});
