import type { Camera, MapSource, Sprite, Texture } from '../../../core/lib/bsp-engine';

/** Per-frame live sector heights — only `ceilZ`/`floorZ` change at runtime (animated doors). */
export type SectorHeights = readonly { readonly floorZ: number; readonly ceilZ: number }[];

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/** One frame's JOIN measurements. `computeMs` = the FASTEST band (the least-disturbed worker — the robust
 *  true-compute estimator, immune to contention's wall-time inflation on the other bands); `joinMs` = the
 *  slowest band (real render latency); `stallMs` = how far the slowest lagged the median (the straggler
 *  signal). Feeds the render governor (see `render-governor.ts`). */
export interface JoinStats {
  readonly computeMs: number;
  readonly joinMs: number;
  readonly stallMs: number;
  readonly slowest: number; // worker index of the last band to land
}

export interface RenderPool {
  readonly threads: number;
  readonly active: number; // workers currently rendering (≤ threads — the governor's worker rung)
  readonly stats: JoinStats;
  readonly frame: Uint8ClampedArray; // SAB-backed view of the CURRENT resolution; re-read after each render()
  render(
    camera: Camera,
    sprites: readonly Sprite[],
    sectors: SectorHeights,
    slides: readonly number[],
    // The WARM neighbor's live billboards by zone key, in that zone's own coordinates.
    neighborSprites?: ReadonlyMap<string, readonly Sprite[]>,
  ): Promise<void>;
  resize(config: RenderConfig): void; // re-point the workers at a new-resolution framebuffer (no respawn)
  // Bands re-split across the first `n` workers; the rest go idle but stay ALIVE with warm zone caches
  // (regrowing is a cheap re-band, never a respawn). Between frames only, like `resize`.
  setWorkers(n: number): void;
  // Re-point the workers at another zone's geometry (rebuilt in place under its key), plus the sources of
  // every zone its LIVE portals look into.
  setMaps(key: string, source: MapSource, neighbors?: ReadonlyMap<string, MapSource>): void;
  // The SEAMLESS crossing: promote an already-held zone to primary — only never-seen `neighbors` compile.
  swapTo(key: string, neighbors?: ReadonlyMap<string, MapSource>): void;
  setTextures(textures: ReadonlyMap<string, Texture>): void;
  dispose(): void;
}

export function createRenderPool(
  config: RenderConfig,
  key: string,
  mapSource: MapSource,
  neighbors?: ReadonlyMap<string, MapSource>,
): RenderPool | null {
  // A shared framebuffer needs SharedArrayBuffer, which needs cross-origin isolation (COOP/COEP headers).
  if (
    typeof Worker === 'undefined' ||
    typeof SharedArrayBuffer === 'undefined' ||
    typeof crossOriginIsolated === 'undefined' ||
    !crossOriginIsolated
  ) {
    return null;
  }

  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
  const workerCount = Math.max(1, Math.min(8, cores - 1)); // leave a core for the main thread
  const workers: Worker[] = [];

  for (let i = 0; i < workerCount; i++) {
    workers.push(new Worker(new URL('./render.worker', import.meta.url), { type: 'module' }));
  }

  // Point every worker at the geometry ONCE. Messages are ordered, so this lands before the first `render`;
  // without it the workers would render a hard-coded fallback map.
  for (const worker of workers) {
    worker.postMessage({ type: 'map', key, source: mapSource, neighbors });
  }

  let frame = new Uint8ClampedArray(new SharedArrayBuffer(0));
  let current = config;
  let frameSab = new SharedArrayBuffer(0);
  let zbufSab = new SharedArrayBuffer(0);
  let active = workerCount;

  // Re-`init` the ACTIVE workers onto their bands. Idle workers keep a stale band config — harmless, they
  // get no `render` messages and are re-banded here before re-activation.
  const band = (): void => {
    const bandHeight = Math.ceil(current.height / active);

    for (let i = 0; i < active; i++) {
      const rowStart = Math.min(i * bandHeight, current.height);
      const rowEnd = Math.min(rowStart + bandHeight, current.height);

      workers[i].postMessage({
        type: 'init',
        config: current,
        rowStart,
        rowEnd,
        frameSab,
        zbufSab,
      });
    }
  };

  // (Re)allocate the shared buffers at `cfg`'s resolution and re-band. The workers keep their built map +
  // swapped textures (module state), so this is cheap — no respawn.
  const configure = (cfg: RenderConfig): void => {
    const pixels = cfg.width * cfg.height;

    current = cfg;
    frameSab = new SharedArrayBuffer(pixels * 4); // RGBA bytes
    zbufSab = new SharedArrayBuffer(pixels * 4); // Float32 depth
    frame = new Uint8ClampedArray(frameSab);
    band();
  };

  configure(config);

  let pending: (() => void) | null = null;
  let done = 0;
  let joined = active; // the worker set the IN-FLIGHT frame was posted to (render captures it)
  let renderStart = 0;
  const doneMs = new Float64Array(workerCount); // per-worker band completion, relative to the post
  let stats: JoinStats = { computeMs: 0, joinMs: 0, stallMs: 0, slowest: 0 };

  // The frame JOIN: resolves once every band of the in-flight frame has landed; the per-band timestamps
  // become the frame's `JoinStats`.
  workers.forEach((worker, i) => {
    worker.onmessage = (): void => {
      doneMs[i] = performance.now() - renderStart;
      done += 1;
      if (done === joined && pending !== null) {
        const resolve = pending;
        const sorted = [...doneMs.subarray(0, joined)].sort((a, b) => a - b);
        let slowest = 0;

        for (let w = 1; w < joined; w++) {
          if (doneMs[w] > doneMs[slowest]) {
            slowest = w;
          }
        }
        stats = {
          computeMs: sorted[0],
          joinMs: sorted[joined - 1],
          stallMs: sorted[joined - 1] - sorted[Math.floor((joined - 1) / 2)],
          slowest,
        };
        pending = null;
        resolve();
      }
    };
  });

  return {
    threads: workers.length,
    get active(): number {
      return active;
    },
    get stats(): JoinStats {
      return stats;
    },
    get frame(): Uint8ClampedArray {
      return frame;
    },
    render(
      camera: Camera,
      sprites: readonly Sprite[],
      sectors: SectorHeights,
      slides: readonly number[],
      neighborSprites?: ReadonlyMap<string, readonly Sprite[]>,
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        done = 0;
        joined = active;
        renderStart = performance.now();
        pending = resolve;
        for (let i = 0; i < active; i++) {
          workers[i].postMessage({
            type: 'render',
            camera,
            sprites,
            sectors,
            slides,
            neighborSprites,
          });
        }
      });
    },
    resize(next: RenderConfig): void {
      configure(next);
    },
    setWorkers(n: number): void {
      const next = Math.max(1, Math.min(workerCount, Math.floor(n)));

      if (next !== active) {
        active = next;
        band();
      }
    },
    setMaps(nextKey: string, source: MapSource, next?: ReadonlyMap<string, MapSource>): void {
      // Messages are ordered, so the next `render` already sees the new geometry. No worker is respawned.
      for (const worker of workers) {
        worker.postMessage({ type: 'map', key: nextKey, source, neighbors: next });
      }
    },
    swapTo(nextKey: string, next?: ReadonlyMap<string, MapSource>): void {
      // The demoted zone stays held for the reverse portal; only never-seen neighbor sources compile.
      for (const worker of workers) {
        worker.postMessage({ type: 'swap', key: nextKey, neighbors: next });
      }
    },
    setTextures(textures: ReadonlyMap<string, Texture>): void {
      for (const worker of workers) {
        worker.postMessage({ type: 'textures', textures });
      }
    },
    dispose(): void {
      for (const worker of workers) {
        worker.terminate();
      }
    },
  };
}
