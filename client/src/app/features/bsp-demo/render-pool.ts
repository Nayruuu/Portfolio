import type { Camera, MapSource, Sprite, Texture } from '../../core/lib/bsp-engine';

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
 */

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

export interface RenderPool {
  readonly threads: number;
  readonly frame: Uint8ClampedArray; // SAB-backed view of the CURRENT resolution; re-read after each render()
  render(
    camera: Camera,
    sprites: readonly Sprite[],
    sectors: SectorHeights,
    slides: readonly number[],
  ): Promise<void>;
  resize(config: RenderConfig): void; // re-point the workers at a new-resolution framebuffer (no respawn)
  setTextures(textures: ReadonlyMap<string, Texture>): void;
  dispose(): void;
}

export function createRenderPool(config: RenderConfig, mapSource: MapSource): RenderPool | null {
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

  // Point every worker at the level's geometry ONCE (each builds its own BSP). Messages are ordered, so this
  // is processed before the first `render`. Without it the workers would render a hard-coded fallback map.
  for (const worker of workers) {
    worker.postMessage({ type: 'map', source: mapSource });
  }

  let frame = new Uint8ClampedArray(new SharedArrayBuffer(0)); // SAB-backed (matched by `configure`)

  // (Re)allocate the shared buffers at `cfg`'s resolution and re-`init` every worker onto its new band. The
  // workers keep their already-built map + swapped textures (module state), so this is cheap — no respawn.
  const configure = (cfg: RenderConfig): void => {
    const pixels = cfg.width * cfg.height;
    const frameSab = new SharedArrayBuffer(pixels * 4); // RGBA bytes
    const zbufSab = new SharedArrayBuffer(pixels * 4); // Float32 depth

    frame = new Uint8ClampedArray(frameSab);
    const bandHeight = Math.ceil(cfg.height / workerCount);

    workers.forEach((worker, i) => {
      const rowStart = Math.min(i * bandHeight, cfg.height);
      const rowEnd = Math.min(rowStart + bandHeight, cfg.height);

      worker.postMessage({ type: 'init', config: cfg, rowStart, rowEnd, frameSab, zbufSab });
    });
  };

  configure(config);

  let pending: (() => void) | null = null;
  let done = 0;

  for (const worker of workers) {
    worker.onmessage = (): void => {
      done += 1;
      if (done === workers.length && pending !== null) {
        const resolve = pending;

        pending = null;
        resolve();
      }
    };
  }

  return {
    threads: workers.length,
    get frame(): Uint8ClampedArray {
      return frame;
    },
    render(
      camera: Camera,
      sprites: readonly Sprite[],
      sectors: SectorHeights,
      slides: readonly number[],
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        done = 0;
        pending = resolve;
        for (const worker of workers) {
          worker.postMessage({ type: 'render', camera, sprites, sectors, slides });
        }
      });
    },
    resize(next: RenderConfig): void {
      configure(next);
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
