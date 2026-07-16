import type { Texture } from '../../bsp-engine';
import {
  buildEnemyGroups,
  buildPickupJobs,
  decodeAtlas,
  loadPropTextures,
  loadWeaponPickupVox,
  loadWorldTextures,
  type AtlasJob,
  type EnemyAtlasGroup,
} from '../render/load-textures';

export interface AssetLoaderHooks {
  applyTextures(loaded: ReadonlyMap<string, Texture>): void;
  onEnvTexturesLoaded(hasArt: boolean): void;
  /** Drives the loading screen's bar over the CRITICAL set only. */
  onProgress(loaded: number, total: number): void;
  /** The world's objects exist and the foes are placed (dormant) — the floor is playable. */
  markPopulated(): void;
  /** One species' art landed: its foes may now wake, out of sight. */
  markSpeciesDecoded(texName: string): void;
  /** Runs once — zone transitions never re-run it. */
  seedReserves(): void;
  /** Gates the async callbacks: a late decode landing after teardown must not mutate a disposed game
   *  (a stray {@link markPopulated} would corrupt the first level of the next mount). */
  isDisposed(): boolean;
}

export interface AssetDecoders {
  loadWorldTextures(
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Map<string, Texture>>;
  loadPropTextures(): Promise<Map<string, Texture>>;
  /** Per-weapon `pickup.vox` collectibles, keyed by PICKUP_WEAPON_<ID> to override the 2D icon. */
  loadWeaponPickupVox(): Promise<Map<string, Texture>>;
  buildPickupJobs(): AtlasJob[];
  buildEnemyGroups(): EnemyAtlasGroup[];
  /** Decodes a sprite sheet — OFF the main thread where the browser allows it. */
  decodeAtlas(url: string, rows: number): Promise<Texture | null>;
}

const BROWSER_DECODERS: AssetDecoders = {
  loadWorldTextures,
  loadPropTextures,
  loadWeaponPickupVox,
  buildPickupJobs,
  buildEnemyGroups,
  decodeAtlas,
};

/** Two phases, deliberately SERIAL: on a thin connection every byte is contended, so the 6 MB of enemy
 *  sheets must not race the world the player is waiting to stand in. Critical first (behind the loading
 *  screen), then the bestiary species by species while he plays. */
export class AssetLoader {
  constructor(
    private readonly hooks: AssetLoaderHooks,
    private readonly decoders: AssetDecoders = BROWSER_DECODERS,
  ) {}

  public async load(): Promise<void> {
    await this.loadCritical();
    await this.loadDeferred();
  }

  public async loadCritical(): Promise<void> {
    const pickupJobs = this.decoders.buildPickupJobs();
    let envDone = 0;
    let envTotal = 0;
    let pickupsDone = 0;
    const report = (): void =>
      this.hooks.onProgress(envDone + pickupsDone, envTotal + pickupJobs.length);

    const [env, props, pickups, weaponVox] = await Promise.all([
      this.decoders.loadWorldTextures((done, total) => {
        envDone = done;
        envTotal = total;
        report();
      }),
      // The decor's VOXEL CARVE is the heaviest main-thread work in the whole boot (a 96³ grid + its AO
      // bake). Its bytes could stream during play, but its CPU cannot: a 300 ms freeze is invisible behind
      // a static card and unforgivable under the player's feet. So it waits here.
      this.decoders.loadPropTextures(),
      Promise.all(
        pickupJobs.map(async (job) => {
          const texture = await this.decoders.decodeAtlas(job.url, job.rows);

          pickupsDone++;
          report();

          return texture;
        }),
      ),
      // Weapon collectibles as voxel volumes — override the 2D icon under the same name (below).
      this.decoders.loadWeaponPickupVox(),
    ]);

    if (this.hooks.isDisposed()) {
      return; // tore down mid-decode — do not touch a disposed host
    }
    const loaded = new Map([...env, ...props]);

    pickups.forEach((texture, i) => {
      if (texture !== null) {
        loaded.set(pickupJobs[i].name, texture);
      }
    });
    // AFTER the 2D icons, so a sculpted pickup.vox wins its PICKUP_WEAPON_<ID> slot.
    for (const [name, grid] of weaponVox) {
      loaded.set(name, grid);
    }
    this.hooks.onEnvTexturesLoaded(env.size > 0);

    if (loaded.size === 0) {
      return; // nothing decoded (SSR / all 404) — leave the procedural fallback + the spawn gate shut
    }
    this.hooks.applyTextures(loaded);
    this.hooks.markPopulated();
    this.hooks.seedReserves();
  }

  public async loadDeferred(): Promise<void> {
    for (const group of this.decoders.buildEnemyGroups()) {
      // A species' sheets decode in PARALLEL — the pixel work lives in a worker, so the game keeps its
      // frame while the tower fills in behind the player.
      const textures = await Promise.all(
        group.jobs.map((job) => this.decoders.decodeAtlas(job.url, job.rows)),
      );

      if (this.hooks.isDisposed()) {
        return;
      }
      const loaded = new Map<string, Texture>();

      textures.forEach((texture, i) => {
        if (texture !== null) {
          loaded.set(group.jobs[i].name, texture);
        }
      });

      if (loaded.size === 0) {
        continue; // this species' art is missing — its foes stay dormant rather than render as gaps
      }
      this.hooks.applyTextures(loaded);
      this.hooks.markSpeciesDecoded(group.texName);
    }
  }
}
