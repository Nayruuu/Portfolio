import type { Texture } from '../../bsp-engine';
import {
  buildAtlasJobs,
  loadAtlasTexture,
  loadEnvTextures,
  type AtlasJob,
} from '../render/load-textures';

export interface AssetLoaderHooks {
  applyTextures(loaded: ReadonlyMap<string, Texture>): void;
  onEnvTexturesLoaded(hasArt: boolean): void;
  markAtlasesReady(): void;
  /** Runs once — zone transitions never re-run it. */
  seedReserves(): void;
  /** Gates the async callbacks: a late decode landing after teardown must not mutate a disposed game
   *  (a stray {@link markAtlasesReady} would corrupt the first level of the next mount). */
  isDisposed(): boolean;
}

export interface AssetDecoders {
  loadEnvTextures(): Promise<Map<string, Texture>>;
  buildAtlasJobs(): AtlasJob[];
  loadAtlasTexture(url: string, rows: number): Promise<Texture | null>;
}

const BROWSER_DECODERS: AssetDecoders = { loadEnvTextures, buildAtlasJobs, loadAtlasTexture };

export class AssetLoader {
  constructor(
    private readonly hooks: AssetLoaderHooks,
    private readonly decoders: AssetDecoders = BROWSER_DECODERS,
  ) {}

  public async load(): Promise<void> {
    await Promise.all([this.loadEnvironment(), this.loadAtlases()]);
  }

  private async loadEnvironment(): Promise<void> {
    const loaded = await this.decoders.loadEnvTextures();

    if (this.hooks.isDisposed()) {
      return; // tore down mid-decode — do not touch a disposed host
    }
    this.hooks.applyTextures(loaded);
    this.hooks.onEnvTexturesLoaded(loaded.size > 0);
  }

  private async loadAtlases(): Promise<void> {
    const jobs = this.decoders.buildAtlasJobs();
    const textures = await Promise.all(
      jobs.map((job) => this.decoders.loadAtlasTexture(job.url, job.rows)),
    );

    if (this.hooks.isDisposed()) {
      return; // a late atlas decode must NOT markAtlasesReady on a disposed game (first level would load wrong)
    }
    const loaded = new Map<string, Texture>();

    textures.forEach((texture, i) => {
      if (texture !== null) {
        loaded.set(jobs[i].name, texture);
      }
    });
    if (loaded.size === 0) {
      return; // nothing decoded (SSR / all 404) — leave the procedural fallback + the deferred-spawn gate shut
    }
    this.hooks.applyTextures(loaded);
    this.hooks.markAtlasesReady();
    this.hooks.seedReserves();
  }
}
