import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapSource } from '../../../core/lib/bsp-engine';
import { parseLevelParams, zoneStates } from '../../../core/lib';
import {
  EYE_HEIGHT,
  ZONE_FADE,
  ZoneRuntime,
  type MutableCamera,
  type ZoneRuntimeHooks,
} from './zone-runtime';

/**
 * Characterization of the zone/world lifecycle — the behaviour the seam-crossing / zone-swap / warm-neighbour
 * paths rely on (they are NOT fully covered by the Playwright net). Exercised over the real M1 ⇄ M2 seam pair:
 * M1 (`m1`) carries a PASSABLE live seam into M2 (`m2`) at the north hall stub, so loading M1 warms M2 and
 * walking through the seam swaps them. `zoneStates` is a module singleton, so each test resets it.
 */

/** A fresh camera object — the runtime places + translates it by reference; tests read it back. */
function makeCamera(): MutableCamera {
  return { x: 0, y: 0, angle: 0, z: 0, pitch: 0 };
}

/** A runtime wired to spies over a fresh camera; the pool/transient hooks record their calls. */
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
  zoneStates.reset(); // the building is module-scoped — never leak one test's snapshots into the next
});

describe('ZoneRuntime — active world load', () => {
  it('reifies the loaded floor as the active world and seats the player at its spawn', () => {
    const { runtime, camera } = makeRuntime();

    runtime.loadZone('m1');

    expect(runtime.world.key).toBe('m1');
    expect(runtime.world.sectors.length).toBeGreaterThan(0);
    expect(runtime.world.map).toBeDefined();
    expect(runtime.currentKey).toBe('m1');
    // M1's authored spawn — the runtime writes the SHARED camera in place (not a copy).
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
    // Pre-atlas: geometry only — no entities, and the world must not read as "populated".
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

    expect(runtime.world.key).toBe('m1'); // DEFAULT_LEVEL_KEY
  });
});

describe('ZoneRuntime — warm neighbour', () => {
  it('warms the zone behind the active map’s passable seam, populated once the atlases exist', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    // Before the atlases: the warm world exists as bare geometry.
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
    // The M1→M2 seam runs x∈[24,28] at y=30, its outward normal pointing −y into M2 (dx 0, dy −100).
    // Step from just south of the line (front) to just north (back): a valid front→back crossing.
    const crossed = runtime.crossSeam(26, 31, 26, 29);

    expect(crossed).toBe(true);
    expect(runtime.world.key).toBe('m2'); // the warm world is adopted as active
    expect(runtime.warm?.key).toBe('m1'); // the outgoing world becomes the reverse-portal warm neighbour
    // Player translated by the seam transform (dx 0, dy −100): (26, 29) → (26, 129) in M2 coordinates.
    expect(camera.x).toBeCloseTo(26, 5);
    expect(camera.y).toBeCloseTo(129, 5);
    // The component seams fire: pool.swapTo + the transient translation by the seam offset.
    expect(hooks.onSeamSwap).toHaveBeenCalledWith('m2', expect.anything());
    expect(hooks.onSeamTranslate).toHaveBeenCalledWith(0, -100);
  });

  it('does not cross (or swap) when the step never reaches the seam’s back side', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    // A step that stays on the front side of the seam — no crossing.
    const crossed = runtime.crossSeam(26, 33, 26, 32);

    expect(crossed).toBe(false);
    expect(runtime.world.key).toBe('m1');
  });

  it('re-derives the active seams after a crossing so the reverse crossing is armed', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    runtime.crossSeam(26, 31, 26, 29);

    // Now in M2 — its own passable seam back into M1 must be indexed.
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

    // Kill the first enemy (a dying-through corpse) and collect the first vital (drop it from the live list).
    runtime.world.enemies[0].dying = true;
    runtime.world.enemies[0].hp = 0;
    runtime.world.vitals = runtime.world.vitals.slice(1);

    runtime.loadZone('m2'); // leaving M1 snapshots the corpse + the taken vital
    runtime.loadZone('m1'); // returning restores them — nothing respawns behind the player

    expect(runtime.world.enemies[0].dying).toBe(true);
    expect(runtime.world.enemies[0].hp).toBe(0);
    expect(runtime.world.vitals).toHaveLength(vitalCount - 1); // the collected vital stays gone
  });

  it('respawns everything on a fresh (new-game) load', () => {
    const { runtime } = makeRuntime();

    runtime.loadZone('m1');
    runtime.markAtlasesReady();
    const vitalCount = runtime.world.vitals.length;

    runtime.world.enemies[0].dying = true;
    runtime.world.enemies[0].hp = 0;
    runtime.world.vitals = runtime.world.vitals.slice(1);
    runtime.loadZone('m2'); // snapshot the changes

    runtime.loadZone('m1', undefined, true); // fresh: the whole building resets

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

    // Fade-out (< ZONE_FADE): still on the old floor.
    runtime.stepTransition(ZONE_FADE * 0.5);
    expect(runtime.transition?.swapped).toBe(false);
    expect(runtime.world.key).toBe('m1');

    // Past ZONE_FADE (at black): the floor swaps.
    runtime.stepTransition(ZONE_FADE * 0.6);
    expect(runtime.transition?.swapped).toBe(true);
    expect(runtime.world.key).toBe('accueil');

    // Past 2·ZONE_FADE: the transition clears.
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
