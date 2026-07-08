import type { Texture } from '../../../core/lib/bsp-engine';
import {
  buildAtlasJobs,
  loadAtlasTexture,
  loadEnvTextures,
  type AtlasJob,
} from '../render/load-textures';

/**
 * The bootstrap seams the asset loader drives on completion — the subsystems it feeds decoded art into, plus
 * the teardown gate. All by callback so the loader never reaches into the component's private state: it merges
 * textures into the render host (the sole texture owner), flips the template signal, and — once the enemy /
 * pickup atlases decode — flips the zone atlas gate + seeds the new-game ammo reserves.
 */
export interface AssetLoaderHooks {
  /** Merge decoded textures into the render pool + GPU texel pool (the render host owns them). */
  applyTextures(loaded: ReadonlyMap<string, Texture>): void;
  /** Report whether the real WebP environment art swapped in (drives the `texturesLoaded` template signal). */
  onEnvTexturesLoaded(hasArt: boolean): void;
  /** Flip the zone atlas gate + spawn the deferred active + warm entities now their art exists. */
  markAtlasesReady(): void;
  /** The NEW-GAME ammo reserve seed — runs once, after the atlases decode (zone transitions never re-run it). */
  seedReserves(): void;
  /** True once the component tore down — gates the async callbacks so a late decode never mutates a disposed
   *  game (a stray {@link markAtlasesReady} after teardown would corrupt the first level of the next mount). */
  isDisposed(): boolean;
}

/** The browser decode surface (Image + canvas), injected so the orchestration is testable without a DOM: the
 *  component takes the real `load-textures` bridge, the spec passes deterministic stubs. */
export interface AssetDecoders {
  loadEnvTextures(): Promise<Map<string, Texture>>;
  buildAtlasJobs(): AtlasJob[];
  loadAtlasTexture(url: string, rows: number): Promise<Texture | null>;
}

/** The real browser decode bridge — the component's default (the spec substitutes stubs). */
const BROWSER_DECODERS: AssetDecoders = { loadEnvTextures, buildAtlasJobs, loadAtlasTexture };

/**
 * The BOOTSTRAP asset-load orchestration, lifted out of the component's `afterNextRender`. It kicks the two
 * decode pipelines concurrently — the environment WebP walls/flats and the enemy/pickup sprite atlases — and
 * on each pipeline's completion feeds the decoded art back through {@link AssetLoaderHooks}. Both callbacks are
 * gated on {@link AssetLoaderHooks.isDisposed} so a decode landing after the component tore down is dropped.
 * Browser/Image-heavy (the decode lives in `load-textures`, injected as {@link AssetDecoders}), so it is the
 * feature layer, not `core/`.
 */
export class AssetLoader {
  constructor(
    private readonly hooks: AssetLoaderHooks,
    private readonly decoders: AssetDecoders = BROWSER_DECODERS,
  ) {}

  /** Kick both decode pipelines concurrently; resolves when both have settled (callers fire-and-forget). */
  public async load(): Promise<void> {
    await Promise.all([this.loadEnvironment(), this.loadAtlases()]);
  }

  /** Decode the real environment textures off the served WebP and swap them in live. A failed / SSR load
   *  leaves the procedural textures untouched (an empty map → `onEnvTexturesLoaded(false)`). */
  private async loadEnvironment(): Promise<void> {
    const loaded = await this.decoders.loadEnvTextures();

    if (this.hooks.isDisposed()) {
      return; // tore down mid-decode — do not touch a disposed host
    }
    this.hooks.applyTextures(loaded);
    this.hooks.onEnvTexturesLoaded(loaded.size > 0);
  }

  /** Decode every enemy's atlases (walk/death/attack/pain + a thrower's spin strip) AND every pickup sprite,
   *  register them, then flip the atlas gate + seed the reserves so the deferred entities spawn with real art
   *  (never the magenta MISSING texture). The decode order pairs each texture back with its job by index. */
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
    this.hooks.applyTextures(loaded); // enemy/pickup atlases join the pool + GPU texel pool too
    this.hooks.markAtlasesReady(); // flip the atlas gate + spawn the (deferred) active + warm entities in place
    this.hooks.seedReserves(); // the NEW-GAME ammo seed
  }
}
