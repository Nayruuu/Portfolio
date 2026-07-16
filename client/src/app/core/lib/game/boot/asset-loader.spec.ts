import { describe, expect, it, vi } from 'vitest';
import type { Texture } from '../../bsp-engine';
import type { AtlasJob, EnemyAtlasGroup } from '../render/load-textures';
import { AssetLoader, type AssetDecoders, type AssetLoaderHooks } from './asset-loader';

const TEXTURE = { width: 1, height: 1, pixels: new Uint8ClampedArray(4) } satisfies Texture;
const PICKUP: AtlasJob = { name: 'AMMO', url: '/ammo.webp', rows: 1 };
const GROUPS: EnemyAtlasGroup[] = [
  { texName: 'PINKY_WALK', jobs: [{ name: 'PINKY_WALK', url: '/pinky.webp', rows: 4 }] },
  { texName: 'IMP_WALK', jobs: [{ name: 'IMP_WALK', url: '/imp.webp', rows: 4 }] },
];

function decoders(overrides: Partial<AssetDecoders> = {}): AssetDecoders {
  return {
    loadWorldTextures: async (onProgress) => {
      onProgress?.(1, 1);

      return new Map<string, Texture>([['FLOOR', TEXTURE]]);
    },
    loadPropTextures: async () => new Map<string, Texture>([['PROP_CHAIR', TEXTURE]]),
    loadWeaponPickupVox: async () => new Map<string, Texture>(),
    buildPickupJobs: () => [PICKUP],
    buildEnemyGroups: () => GROUPS,
    decodeAtlas: async () => TEXTURE,
    ...overrides,
  };
}

function spyHooks(overrides: Partial<AssetLoaderHooks> = {}): AssetLoaderHooks {
  return {
    applyTextures: vi.fn(),
    onEnvTexturesLoaded: vi.fn(),
    onProgress: vi.fn(),
    markPopulated: vi.fn(),
    markSpeciesDecoded: vi.fn(),
    seedReserves: vi.fn(),
    isDisposed: () => false,
    ...overrides,
  };
}

describe('AssetLoader — the critical phase (what the loading card waits on)', () => {
  it('applies the world, the decor and the objects, populates and seeds ONCE — the floor is playable', async () => {
    const applied: string[] = [];
    const hooks = spyHooks({
      applyTextures: (loaded) => applied.push([...loaded.keys()].sort().join(',')),
    });

    await new AssetLoader(hooks, decoders()).loadCritical();

    // the decor belongs here: its VOXEL CARVE is the boot's heaviest main-thread work, and a freeze
    // behind a static card is invisible while one under the player's feet is not
    expect(applied).toEqual(['AMMO,FLOOR,PROP_CHAIR']);
    expect(hooks.onEnvTexturesLoaded).toHaveBeenCalledExactlyOnceWith(true);
    expect(hooks.markPopulated).toHaveBeenCalledTimes(1);
    expect(hooks.seedReserves).toHaveBeenCalledTimes(1);
    expect(hooks.markSpeciesDecoded).not.toHaveBeenCalled(); // the bestiary is NOT in the critical set
  });

  it('lets a weapon pickup.vox OVERRIDE its 2D icon under the same name (voxel collectible wins)', async () => {
    const vox = { ...TEXTURE, voxelDepth: 4 } satisfies Texture; // a voxel grid, not a flat sheet
    const applied = new Map<string, Texture>();
    const hooks = spyHooks({
      applyTextures: (loaded) => loaded.forEach((t, k) => applied.set(k, t)),
    });

    await new AssetLoader(
      hooks,
      decoders({
        buildPickupJobs: () => [{ name: 'PICKUP_WEAPON_CHAINSAW', url: '/icon.webp', rows: 1 }],
        loadWeaponPickupVox: async () =>
          new Map<string, Texture>([['PICKUP_WEAPON_CHAINSAW', vox]]),
      }),
    ).loadCritical();

    expect(applied.get('PICKUP_WEAPON_CHAINSAW')?.voxelDepth).toBe(4); // the vox, not the flat icon
  });

  it('reports progress over the whole critical set (world assets + object atlases)', async () => {
    const hooks = spyHooks();

    await new AssetLoader(hooks, decoders()).loadCritical();

    // 1 env asset + 1 pickup job = 2 pieces; the last call must read done
    expect(hooks.onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it('never populates when nothing decodes (SSR / a dead asset host keeps the procedural fallback)', async () => {
    const hooks = spyHooks();

    await new AssetLoader(
      hooks,
      decoders({
        loadWorldTextures: async () => new Map(),
        loadPropTextures: async () => new Map(),
        decodeAtlas: async () => null,
      }),
    ).loadCritical();

    expect(hooks.onEnvTexturesLoaded).toHaveBeenCalledExactlyOnceWith(false);
    expect(hooks.markPopulated).not.toHaveBeenCalled();
    expect(hooks.seedReserves).not.toHaveBeenCalled();
  });

  it('drops every completion when disposed — nothing touches a torn-down game', async () => {
    const hooks = spyHooks({ isDisposed: () => true });

    await new AssetLoader(hooks, decoders()).loadCritical();

    expect(hooks.applyTextures).not.toHaveBeenCalled();
    expect(hooks.onEnvTexturesLoaded).not.toHaveBeenCalled();
    expect(hooks.markPopulated).not.toHaveBeenCalled();
    expect(hooks.seedReserves).not.toHaveBeenCalled();
  });
});

describe('AssetLoader — the deferred phase (the tower wakes up during play)', () => {
  it('decodes ONE SPECIES AT A TIME and announces each as it lands', async () => {
    const hooks = spyHooks();

    await new AssetLoader(hooks, decoders()).loadDeferred();

    expect(hooks.applyTextures).toHaveBeenCalledTimes(2); // one apply per species, not one big batch
    expect(hooks.markSpeciesDecoded).toHaveBeenNthCalledWith(1, 'PINKY_WALK');
    expect(hooks.markSpeciesDecoded).toHaveBeenNthCalledWith(2, 'IMP_WALK');
  });

  it('puts a species’ sheets on the wire together — the pixel work is off-thread, nothing to spread', async () => {
    let live = 0;
    let peak = 0;
    const group: EnemyAtlasGroup = {
      texName: 'PINKY_WALK',
      jobs: [
        { name: 'A', url: '/a.webp', rows: 1 },
        { name: 'B', url: '/b.webp', rows: 1 },
        { name: 'C', url: '/c.webp', rows: 1 },
      ],
    };

    await new AssetLoader(
      spyHooks(),
      decoders({
        buildEnemyGroups: () => [group],
        decodeAtlas: async () => {
          live++;
          peak = Math.max(peak, live);
          await Promise.resolve();
          live--;

          return TEXTURE;
        },
      }),
    ).loadDeferred();

    expect(peak).toBe(3); // all three were in flight at once
  });

  it('skips a species whose art is missing, and keeps loading the others', async () => {
    const hooks = spyHooks();
    const decode = vi
      .fn<AssetDecoders['decodeAtlas']>()
      .mockResolvedValueOnce(null) // the pinky's sheet 404s
      .mockResolvedValue(TEXTURE);

    await new AssetLoader(hooks, decoders({ decodeAtlas: decode })).loadDeferred();

    expect(hooks.markSpeciesDecoded).toHaveBeenCalledExactlyOnceWith('IMP_WALK');
  });

  it('drops a species that lands AFTER teardown — a late decode must not wake a dead game', async () => {
    let disposed = false;
    const decoded = vi.fn((): void => {
      disposed = true; // the player leaves while the second species is still on the wire
    });
    const hooks = spyHooks({ isDisposed: () => disposed, markSpeciesDecoded: decoded });

    await new AssetLoader(hooks, decoders()).loadDeferred();

    expect(decoded).toHaveBeenCalledExactlyOnceWith('PINKY_WALK'); // the second is dropped
  });
});

describe('AssetLoader — load()', () => {
  it('runs the critical phase FIRST, then the bestiary — the world never races the foes for bandwidth', async () => {
    const order: string[] = [];
    const hooks = spyHooks({
      markPopulated: () => order.push('populated'),
      markSpeciesDecoded: (name) => order.push(`species:${name}`),
    });

    await new AssetLoader(hooks, decoders()).load();

    expect(order).toEqual(['populated', 'species:PINKY_WALK', 'species:IMP_WALK']);
  });
});
