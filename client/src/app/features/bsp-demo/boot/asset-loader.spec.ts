import { describe, expect, it, vi } from 'vitest';
import type { Texture } from '../../../core/lib/bsp-engine';
import type { AtlasJob } from '../render/load-textures';
import { AssetLoader, type AssetDecoders, type AssetLoaderHooks } from './asset-loader';

const TEXTURE = { width: 1, height: 1, pixels: new Uint8ClampedArray(4) } satisfies Texture;
const JOB: AtlasJob = { name: 'ENEMY', url: '/enemy.webp', rows: 1 };

function decoders(overrides: Partial<AssetDecoders> = {}): AssetDecoders {
  return {
    loadEnvTextures: async () => new Map<string, Texture>([['FLOOR', TEXTURE]]),
    buildAtlasJobs: () => [JOB],
    loadAtlasTexture: async () => TEXTURE,
    ...overrides,
  };
}

function spyHooks(overrides: Partial<AssetLoaderHooks> = {}): AssetLoaderHooks {
  return {
    applyTextures: vi.fn(),
    onEnvTexturesLoaded: vi.fn(),
    markAtlasesReady: vi.fn(),
    seedReserves: vi.fn(),
    isDisposed: () => false,
    ...overrides,
  };
}

describe('AssetLoader', () => {
  it('on completion applies both texture sets, flips the atlas gate and seeds the reserves ONCE', async () => {
    const hooks = spyHooks();

    await new AssetLoader(hooks, decoders()).load();

    expect(hooks.applyTextures).toHaveBeenCalledTimes(2);
    expect(hooks.onEnvTexturesLoaded).toHaveBeenCalledExactlyOnceWith(true);
    expect(hooks.markAtlasesReady).toHaveBeenCalledTimes(1);
    expect(hooks.seedReserves).toHaveBeenCalledTimes(1);
  });

  it('reports no environment art when nothing decodes and never opens the atlas gate', async () => {
    const hooks = spyHooks();

    await new AssetLoader(
      hooks,
      decoders({ loadEnvTextures: async () => new Map(), loadAtlasTexture: async () => null }),
    ).load();

    expect(hooks.onEnvTexturesLoaded).toHaveBeenCalledExactlyOnceWith(false);
    expect(hooks.markAtlasesReady).not.toHaveBeenCalled();
    expect(hooks.seedReserves).not.toHaveBeenCalled();
  });

  it('drops both completions when disposed — never markAtlasesReady / seedReserves after teardown', async () => {
    const hooks = spyHooks({ isDisposed: () => true });

    await new AssetLoader(hooks, decoders()).load();

    expect(hooks.markAtlasesReady).not.toHaveBeenCalled();
    expect(hooks.seedReserves).not.toHaveBeenCalled();
    expect(hooks.applyTextures).not.toHaveBeenCalled();
    expect(hooks.onEnvTexturesLoaded).not.toHaveBeenCalled();
  });
});
