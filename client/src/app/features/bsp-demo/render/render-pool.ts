import type { Camera, MapSource, Sprite, Texture } from '../../../core/lib/bsp-engine';

/** Per-frame live sector heights (animated doors mutate `ceilZ`); forwarded to each worker each render. */
type SectorHeights = readonly { readonly floorZ: number; readonly ceilZ: number }[];

/**
 * A multi-threaded render pool: it splits the frame into N horizontal bands and hands each to a worker that
 * paints straight into one SHARED framebuffer + z-buffer (`SharedArrayBuffer`). Each frame: post the camera
 * to every worker, await all `done`, then the caller copies {@link RenderPool.frame} into an `ImageData` and
 * blits. Returns `null` when the platform can't do it (no `SharedArrayBuffer` / not cross-origin isolated /
 * SSR) — the caller then renders single-threaded on the main thread, so `/bsp` always works.
 *
 * The worker set is created ONCE (each worker builds the map + procedural textures on load — the expensive
 * part). {@link RenderPool.resize} re-points the SAME workers at fresh framebuffers/bands for a new resolution
 * via a cheap re-`init` — it never respawns them, so a fullscreen toggle costs a few ms, not a worker rebuild.
 *
 * Zones are held by KEY: each worker caches every compiled zone it has ever built (primary + portal
 * neighbors), so a seamless seam crossing is {@link RenderPool.swapTo} — the workers just PROMOTE the
 * neighbor map they already hold to primary (building only never-seen neighbor sources). Zero teardown,
 * zero rebuild, zero hitch.
 */

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/** One frame's JOIN measurements: the FASTEST band completion (the least-disturbed worker — the robust
 *  true-compute estimator, immune to the wall-time inflation contention causes on every other band), the
 *  SLOWEST band completion (the frame's real render latency), and how long that slowest band lagged the
 *  median (pure scheduling noise — the straggler signal). Feeds the render governor: stalls drive the
 *  worker rung, the join latency audits each shrink, compute guards it (see `render-governor.ts`). */
export interface JoinStats {
  readonly computeMs: number;
  readonly joinMs: number;
  readonly stallMs: number;
  readonly slowest: number; // worker index of the last band to land
}

export interface RenderPool {
  readonly threads: number;
  readonly active: number; // workers currently rendering (≤ threads — the governor's worker rung)
  readonly stats: JoinStats; // the LAST completed frame's join measurements
  readonly frame: Uint8ClampedArray; // SAB-backed view of the CURRENT resolution; re-read after each render()
  render(
    camera: Camera,
    sprites: readonly Sprite[],
    sectors: SectorHeights,
    slides: readonly number[],
    // The WARM neighbor's live billboards by zone key, in that zone's own coordinates — rendered through
    // the seam windows (see the renderer's neighbor sprites).
    neighborSprites?: ReadonlyMap<string, readonly Sprite[]>,
  ): Promise<void>;
  resize(config: RenderConfig): void; // re-point the workers at a new-resolution framebuffer (no respawn)
  // Resize the ACTIVE worker set (contention resilience): bands re-split across the first `n` workers;
  // the rest go idle but stay ALIVE with their zone caches warm (regrowing is a cheap re-band, never a
  // respawn). Call between frames only, like `resize`.
  setWorkers(n: number): void;
  // Re-point the workers at another zone's geometry (rebuilt in place under its key), plus the sources of
  // every zone its LIVE portals look into (rendered through the seams — see the renderer's zone portals).
  setMaps(key: string, source: MapSource, neighbors?: ReadonlyMap<string, MapSource>): void;
  // The SEAMLESS crossing: promote an already-held zone to primary — the workers keep every map they have
  // built and only compile `neighbors` entries they have never seen (none, for a reciprocal seam pair).
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

  // Point every worker at the level's geometry ONCE (each builds its own BSP — primary + portal neighbors).
  // Messages are ordered, so this is processed before the first `render`. Without it the workers would
  // render a hard-coded fallback map.
  for (const worker of workers) {
    worker.postMessage({ type: 'map', key, source: mapSource, neighbors });
  }

  let frame = new Uint8ClampedArray(new SharedArrayBuffer(0)); // SAB-backed (matched by `configure`)
  let current = config; // the pool's live resolution (re-banding a shrunken worker set needs it)
  let frameSab = new SharedArrayBuffer(0);
  let zbufSab = new SharedArrayBuffer(0);
  let active = workerCount; // workers taking render bands; the rest idle warm (governor-driven)

  // Re-`init` the ACTIVE workers onto their bands of the current buffers. Idle workers keep a stale band
  // config — harmless, they receive no `render` messages and are re-banded here before re-activation.
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

  // (Re)allocate the shared buffers at `cfg`'s resolution and re-band. The workers keep their already-built
  // map + swapped textures (module state), so this is cheap — no respawn.
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

  // The frame JOIN: the promise resolves when every band of the in-flight frame has landed. The per-band
  // timestamps become the frame's `JoinStats` — median completion vs slowest-band lag (see `JoinStats`).
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
        band(); // same buffers, re-split across the new active set (idle workers stay warm)
      }
    },
    setMaps(nextKey: string, source: MapSource, next?: ReadonlyMap<string, MapSource>): void {
      // A zone LOAD: each worker rebuilds the primary from the new source (keeping its swapped textures) —
      // messages are ordered, so the next `render` already sees the new geometry. No worker is respawned.
      for (const worker of workers) {
        worker.postMessage({ type: 'map', key: nextKey, source, neighbors: next });
      }
    },
    swapTo(nextKey: string, next?: ReadonlyMap<string, MapSource>): void {
      // A seam CROSSING: promote the held neighbor to primary (see the worker's zone cache) — the demoted
      // zone stays held for the reverse portal, and only never-seen neighbor sources compile.
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
