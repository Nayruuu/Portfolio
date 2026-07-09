import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapSource } from '../../../core/lib/bsp-engine';
import { parseLevelParams, ZONE_FADE, zoneStates } from '../../../core/lib';
import { EYE_HEIGHT, ZoneRuntime, type MutableCamera, type ZoneRuntimeHooks } from './zone-runtime';

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
});
