import {
  renderFrame,
  type Camera,
  type CompiledMap,
  type MapSource,
  type Sprite,
  type Texture,
  type ZoneNeighbor,
} from '../../../core/lib/bsp-engine';
import {
  FRAME_STATS_WINDOW_MS,
  FrameStats,
  initialRenderGovernor,
  stepRenderGovernor,
  type RenderGovernorState,
} from '../../../core/lib';
import { createGpuRenderer, type GpuRenderer } from './gpu-renderer';
import { createRenderPool, type RenderPool, type SectorHeights } from './render-pool';
import { proceduralTextures } from './load-textures';

const PERF_RING_SIZE = 4096; // frames the dev perf ring (`?perflog=1`) holds — a power of two (index masks)

/** The mutable internal render resolution + field of view — one object, mutated in place by
 *  {@link RenderHost.applyResolution} so every holder (the painters, the sprite builder, the combat runtime's
 *  aim-slope projection, the perf beacon) sees a fullscreen switch through its captured reference. */
export interface RenderConfig {
  width: number;
  height: number;
  fov: number;
}

/** Everything one render needs from the coordinator, assembled fresh each frame: the shared camera + the
 *  active world's geometry/sprites, plus the neighbour-portal channel (the warm zone's life through the seams)
 *  and the thunk that reifies it into engine {@link ZoneNeighbor}s only on the paths that read it. */
export interface RenderRequest {
  readonly camera: Camera;
  readonly map: CompiledMap;
  readonly sectors: SectorHeights;
  readonly slides: readonly number[];
  readonly sprites: readonly Sprite[];
  readonly neighborSprites?: ReadonlyMap<string, readonly Sprite[]>;
  zoneNeighbors(
    neighborSprites?: ReadonlyMap<string, readonly Sprite[]>,
  ): ReadonlyMap<string, ZoneNeighbor>;
}

/** The coordinator game-state the perf beacon correlates a frame-time spike WITH (position/view + live
 *  entity counts) — read lazily, only when a localhost `?perflog` sample is actually about to fire. */
export interface PerfState {
  readonly camera: Camera;
  readonly spriteCount: number;
  readonly projectileCount: number;
  readonly stressEnemyCount: number;
  readonly aiMs: number;
}

/** The one-shot browser setup the coordinator hands the host in `afterNextRender` (the 2D context + canvas,
 *  the initial zone's geometry to seed the pool, the dev flags, the shared camera for the scripted hook, and
 *  the perf-state provider). */
export interface RenderHostBootstrap {
  readonly context: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly zoneKey: string;
  readonly mapSource: MapSource;
  readonly neighborSources: ReadonlyMap<string, MapSource>;
  readonly perfRing: boolean;
  readonly noGovernor: boolean;
  readonly forceCpu: boolean;
  readonly camera: Camera;
  readonly perfState: () => PerfState;
}

/** One per-frame display roll-up the coordinator pushes into its template signals: the backend readouts flow
 *  EVERY frame (governor re-bands + GPU init/failure change them), while `roll` is non-null only ~4×/second. */
export interface DisplaySnapshot {
  readonly threads: number;
  readonly poolSize: number;
  readonly backend: 'cpu' | 'gpu';
  readonly roll: {
    readonly fps: number;
    readonly meanMs: number | null;
    readonly maxMs: number;
  } | null;
}

/**
 * The RENDER CONFLUENCE of the BSP game — the SOLE owner of the worker {@link RenderPool}, the WebGPU
 * {@link GpuRenderer}, the mutated-in-place {@link RenderConfig}, the texture library, the framebuffer +
 * z-buffer, and the whole telemetry stack (frame stats, the contention governor, the dev perf ring + beacon).
 *
 * The coordinator keeps the irreducible Angular parts — the rAF loop, the template signals, the on-canvas
 * blit + overlay stack — and drives the host through three per-frame calls: {@link measureDisplay} (before the
 * kick), {@link flushPending} + {@link renderInto} (the between-frames render), {@link afterRender} (the join
 * roll-up). Geometry changes ({@link setMaps}/{@link swapTo}) and resolution switches ({@link queueResolution})
 * are QUEUED and applied by `flushPending` in the same no-render-in-flight window the coordinator kicks from,
 * so a re-point never races the single shared framebuffer.
 */
export class RenderHost {
  // Mutated IN PLACE by `applyResolution` (never replaced) — the combat runtime + painters + sprite builder +
  // the perf beacon all hold this reference and are meant to observe a fullscreen switch through it.
  private readonly renderConfig: RenderConfig = { width: 1280, height: 720, fov: Math.PI / 2 };
  // The main-thread render fallback library — the SAME procedural map the workers build, so the two can't
  // drift (every extended palette key has a fallback until its WebP decodes). WebP swaps in via `applyTextures`.
  private readonly textures = proceduralTextures();
  private readonly frameStats = new FrameStats();
  // The render governor's state — the pure contention-resilience controller (see render-governor.ts). Null with
  // no worker pool: the main-thread fallback has no join to stall, nothing for the governor to trade.
  private governor: RenderGovernorState | null = null;
  private pool: RenderPool | null = null; // the worker render pool (null = single-threaded fallback / pre-init)
  // The WebGPU compute backend (the DEFAULT; `?renderer=cpu` forces the CPU path). Null until its async init
  // lands, and again after any GPU failure: the CPU path (pool or main thread) is ALWAYS the running fallback.
  private gpu: GpuRenderer | null = null;
  private backendState: 'cpu' | 'gpu' = 'cpu'; // active render backend (drives the coordinator's `backend` signal)

  private context!: CanvasRenderingContext2D;
  private canvas!: HTMLCanvasElement;
  // The framebuffer + z-buffer, sized to the CURRENT render resolution; `applyResolution` rebuilds them.
  private image!: ImageData;
  private zbuffer!: Float32Array;
  private perfState!: () => PerfState;
  private isDisposed = false;

  // Queued between-frames actuations, applied by `flushPending` while no render is in flight: geometry
  // re-points (setMaps/swapTo route to the SAME pool) and the resolution switch.
  private pendingGeometry: Array<(pool: RenderPool) => void> = [];
  private pendingRes: { width: number; height: number } | null = null;

  // Perf telemetry (localhost only — never in prod): a session id + whether to POST samples to the dev /perf
  // sink, so a play session can be read back + analysed offline instead of eyeballing the HUD.
  private readonly perfSid = typeof performance === 'undefined' ? 0 : Math.round(performance.now());
  private readonly perfLog =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  // Dev-only per-frame ring (`?perflog=1`): the last PERF_RING_SIZE rAF-to-rAF deltas + render costs, exposed
  // on `window.__bspPerfRing`. Null when off — the loop then pays a single null check and allocates nothing.
  private perfRing: {
    readonly delta: Float64Array;
    readonly render: Float64Array;
    readonly stall: Float64Array; // join straggler stall (slowest band vs median — see JoinStats)
    readonly slowest: Float64Array; // worker index of the stalled band (the straggler's identity)
    readonly workers: Float64Array; // active worker count that frame (the governor's rung)
    readonly compute: Float64Array; // fastest-band compute (the governor's compute input)
    n: number;
  } | null = null;
  private perfRingLast = 0; // previous frame's rAF timestamp (0 = no previous frame yet)

  private lastRenderMs = 0; // the last completed render's measurements — the ring's render columns
  private lastStallMs = 0;
  private lastSlowest = 0;
  private lastComputeMs = 0; // last join's fastest-band compute (the governor's compute input)
  private lastFps = 0; // the last window roll-up — the beacon's readout columns
  private lastFrameMs = 0;
  private lastFrameMaxMs = 0;

  /** The mutable render config — handed to every collaborator that must observe a resolution switch in place. */
  public get config(): RenderConfig {
    return this.renderConfig;
  }

  /** The current framebuffer the coordinator blits after {@link renderInto} resolves (the render slot is
   *  gated, so this reference is the one the just-finished render painted into). */
  public get frame(): ImageData {
    return this.image;
  }

  /** True once {@link dispose} has run — the coordinator skips the blit for a render that lands post-teardown. */
  public get disposed(): boolean {
    return this.isDisposed;
  }

  /** Active render workers this instant (the governor's worker rung) — the coordinator's `threads` signal. */
  public get activeThreads(): number {
    return this.pool?.active ?? 1;
  }

  /** Create the browser render resources: the framebuffer/z-buffer, the worker pool (seeded with the initial
   *  zone geometry), the governor, the dev perf ring, and the async WebGPU backend. Browser-only. */
  public bootstrap(setup: RenderHostBootstrap): void {
    this.context = setup.context;
    this.canvas = setup.canvas;
    this.perfState = setup.perfState;
    this.image = setup.context.createImageData(this.renderConfig.width, this.renderConfig.height);
    this.zbuffer = new Float32Array(this.renderConfig.width * this.renderConfig.height);
    setup.canvas.width = this.renderConfig.width; // backing store = the internal render resolution (CSS upscales)
    setup.canvas.height = this.renderConfig.height;

    if (setup.perfRing) {
      this.perfRing = {
        delta: new Float64Array(PERF_RING_SIZE),
        render: new Float64Array(PERF_RING_SIZE),
        stall: new Float64Array(PERF_RING_SIZE),
        slowest: new Float64Array(PERF_RING_SIZE),
        workers: new Float64Array(PERF_RING_SIZE),
        compute: new Float64Array(PERF_RING_SIZE),
        n: 0,
      };
      const globals = window as unknown as Record<string, unknown>;

      globals['__bspPerfRing'] = this.perfRing;
      globals['__bspCam'] = setup.camera; // the LIVE camera — a scripted run reads the pose between moves
    }

    // Multi-thread when the platform allows it (SharedArrayBuffer + cross-origin isolation); otherwise the
    // pool is null and we render single-threaded on the main thread. Kept so `setMaps` can re-point the SAME
    // workers at the next zone's geometry.
    const pool = createRenderPool(
      this.renderConfig,
      setup.zoneKey,
      setup.mapSource,
      setup.neighborSources,
    );

    this.pool = pool;
    // `?nogov=1` pins the pool at full workers: the A/B control for measuring what the governor buys.
    this.governor = pool === null || setup.noGovernor ? null : initialRenderGovernor(pool.threads);
    this.initGpu(setup.forceCpu, setup.perfRing);
  }

  /** Re-point the pool at a zone's geometry (rebuilt in place under its key). Queued — the pool is the SOLE
   *  shared framebuffer, so the re-point is applied by {@link flushPending} while no render is in flight. */
  public setMaps(key: string, source: MapSource, neighbors?: ReadonlyMap<string, MapSource>): void {
    if (this.pool === null) {
      return; // no pool yet (pre-bootstrap load) — the pool is seeded with this geometry at creation
    }
    this.pendingGeometry.push((pool) => pool.setMaps(key, source, neighbors));
  }

  /** The SEAMLESS crossing: promote an already-held zone to primary. Queued like {@link setMaps}. */
  public swapTo(key: string, neighbors?: ReadonlyMap<string, MapSource>): void {
    if (this.pool === null) {
      return;
    }
    this.pendingGeometry.push((pool) => pool.swapTo(key, neighbors));
  }

  /** Queue a resolution switch (fullscreen ↔ windowed). Applied between frames by {@link flushPending} — a
   *  live rebuild mid-render would tear down the pool the frame is still painting into. */
  public queueResolution(width: number, height: number): void {
    if (width !== this.renderConfig.width || height !== this.renderConfig.height) {
      this.pendingRes = { width, height };
    }
  }

  /** Apply every queued between-frames actuation — geometry re-points then a resolution switch. Called by the
   *  coordinator inside its render slot (no render in flight), so a re-point never races the framebuffer. */
  public flushPending(): void {
    const pool = this.pool;

    if (pool !== null) {
      for (const op of this.pendingGeometry) {
        op(pool);
      }
    }
    this.pendingGeometry = [];
    if (this.pendingRes !== null) {
      this.applyResolution(this.pendingRes.width, this.pendingRes.height);
      this.pendingRes = null;
    }
  }

  /** Switch the render targets to a new resolution: the config is MUTATED in place (holders keep their ref),
   *  then the framebuffer/z-buffer/canvas + the pool bands + the GPU buffers re-point (no worker respawn). */
  public applyResolution(width: number, height: number): void {
    this.renderConfig.width = width;
    this.renderConfig.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = this.context.createImageData(width, height);
    this.zbuffer = new Float32Array(width * height);
    this.pool?.resize(this.renderConfig);
    this.gpu?.resize(this.renderConfig);
  }

  /** Merge freshly decoded textures into the library and push them to the pool + GPU (the SOLE owner routes
   *  every texture update). The pool takes the delta; the GPU rebuilds its texel pool from the full library. */
  public applyTextures(loaded: ReadonlyMap<string, Texture>): void {
    this.pool?.setTextures(loaded);
    for (const [name, texture] of loaded) {
      this.textures.set(name, texture); // the main-thread fallback AND the GPU pool read this map
    }
    this.gpu?.setTextures(this.textures);
  }

  /** Render one frame into the framebuffer via the active backend — GPU compute, else the worker pool, else
   *  the main-thread fallback. Resolves when the framebuffer holds the frame, ready for the coordinator's blit. */
  public renderInto(request: RenderRequest): Promise<void> {
    // Capture the current pool + framebuffer: a resolution rebuild only swaps them between frames, so the pair
    // stays consistent for this render (and the locals keep the non-null narrowing in the callback).
    const pool = this.pool;
    const image = this.image;
    const gpu = this.gpu;

    if (gpu !== null) {
      return this.renderGpu(gpu, request, image);
    }
    if (pool !== null) {
      return pool
        .render(
          request.camera,
          request.sprites,
          request.sectors,
          request.slides,
          request.neighborSprites,
        )
        .then(() => image.data.set(pool.frame)); // workers → shared buf → blit
    }
    renderFrame(
      request.map,
      request.camera,
      this.renderConfig,
      this.textures,
      image.data,
      this.zbuffer,
      0,
      this.renderConfig.height,
      request.sprites,
      request.slides,
      request.zoneNeighbors(request.neighborSprites),
    );

    return Promise.resolve();
  }

  /** Roll one COMPLETED render into the telemetry: record its cost + join stall, then step the contention
   *  governor (straggler stalls shrink the active worker set, proven calm grows it back — resolution is never
   *  traded). Called by the coordinator in the render's `.then`, while no render is in flight. */
  public afterRender(renderStartMs: number): void {
    // GPU frames have no worker join — their stats stay out of the stall/governor loop entirely.
    const join = this.pool === null || this.gpu !== null ? null : this.pool.stats;

    this.recordRender(
      performance.now() - renderStartMs,
      join?.stallMs ?? 0,
      join?.slowest ?? 0,
      join?.computeMs ?? 0,
    );
    if (this.pool !== null && join !== null && this.governor !== null) {
      const prev = this.governor;
      const next = stepRenderGovernor(prev, {
        stallMs: join.stallMs,
        computeMs: join.computeMs,
        joinMs: join.joinMs,
      });

      this.governor = next;
      if (next.workers !== prev.workers) {
        this.pool.setWorkers(next.workers);
      }
    }
  }

  /** Record one completed render's cost + join-stall measurements into the ring columns + the frame-stats
   *  accumulator (the source of the ~4×/second overlay + beacon roll-up). */
  public recordRender(
    frameCost: number,
    stallMs: number,
    slowest: number,
    computeMs: number,
  ): void {
    this.lastRenderMs = frameCost;
    this.lastStallMs = stallMs;
    this.lastSlowest = slowest;
    this.lastComputeMs = computeMs;
    this.frameStats.record(frameCost, stallMs);
  }

  /** Per-rAF display bookkeeping: the ring row + the ~4×/second overlay/telemetry roll-up. Returns the
   *  backend readouts (every frame) + the distilled fps/frame-time (only when a window closed) for the
   *  coordinator's template signals; fires the perf beacon on a roll-up. */
  public measureDisplay(now: number): DisplaySnapshot {
    this.recordRingRow(now);

    const roll = this.frameStats.rollUp(now, FRAME_STATS_WINDOW_MS);

    if (roll !== null) {
      this.lastFps = roll.fps;
      if (roll.meanMs !== null) {
        this.lastFrameMs = roll.meanMs;
      }
      this.lastFrameMaxMs = roll.maxMs;
      this.logPerf(now, roll.stallMax);
    }

    return {
      threads: this.activeThreads,
      poolSize: this.pool?.threads ?? 1,
      backend: this.backendState,
      roll: roll === null ? null : { fps: roll.fps, meanMs: roll.meanMs, maxMs: roll.maxMs },
    };
  }

  /** Tear down the render resources (pool workers + GPU device); the coordinator owns the rAF cancellation. */
  public dispose(): void {
    this.isDisposed = true;
    this.pool?.dispose();
    this.pool = null;
    this.gpu?.dispose();
    this.gpu = null;
  }

  /** The WebGPU compute backend is the DEFAULT (`?renderer=cpu` forces the worker-pool path). Its init is
   *  async; until it lands — and on ANY failure — the CPU path keeps rendering (no user-visible error). */
  private initGpu(forceCpu: boolean, perfRing: boolean): void {
    if (forceCpu) {
      return;
    }
    void createGpuRenderer(this.renderConfig).then((gpu) => {
      if (gpu === null || this.isDisposed) {
        gpu?.dispose();
        if (!this.isDisposed) {
          console.info('[bsp] WebGPU unavailable — staying on the CPU renderer');
        }

        return;
      }
      gpu.resize(this.renderConfig); // the resolution may have changed while the device was initializing
      gpu.setTextures(this.textures);
      this.gpu = gpu;
      this.backendState = 'gpu';
      console.info('[bsp] WebGPU compute backend active');
      if (perfRing) {
        // Dev perf hook (like __bspPerfRing): a STABLE stats object, mutated in place each frame.
        (window as unknown as Record<string, unknown>)['__bspGpuStats'] = gpu.stats;
      }
    });
  }

  /** The GPU path: dispatch the full `renderFrame` surface through the compute backend into the framebuffer.
   *  Any failure (a lost device) silently drops back to the CPU path for good — the next kick renders CPU. */
  private renderGpu(gpu: GpuRenderer, request: RenderRequest, image: ImageData): Promise<void> {
    return gpu
      .render(
        request.map,
        request.camera,
        image.data,
        request.sprites,
        request.slides,
        request.zoneNeighbors(request.neighborSprites),
      )
      .catch(() => {
        this.gpu = null;
        this.backendState = 'cpu';
        gpu.dispose();
      });
  }

  /** One dev perf-ring row per DISPLAY frame: the raw rAF-to-rAF delta + the LAST COMPLETED render's cost /
   *  straggler stall / active worker count, duplicated across the rAFs it stays on screen (duration-weighted). */
  private recordRingRow(now: number): void {
    if (this.perfRing === null) {
      return;
    }
    if (this.perfRingLast !== 0) {
      const i = this.perfRing.n % PERF_RING_SIZE;

      this.perfRing.delta[i] = now - this.perfRingLast;
      this.perfRing.render[i] = this.lastRenderMs;
      this.perfRing.stall[i] = this.lastStallMs;
      this.perfRing.slowest[i] = this.lastSlowest;
      this.perfRing.workers[i] = this.activeThreads;
      this.perfRing.compute[i] = this.lastComputeMs;
      this.perfRing.n += 1;
    }
    this.perfRingLast = now;
  }

  /** Fire-and-forget one telemetry sample to the dev server's /perf sink (localhost only). Uses `sendBeacon`
   *  so it never blocks the frame budget; the game-state provider is read lazily, only once a sample fires. */
  private logPerf(now: number, stallMax: number): void {
    if (!this.perfLog || typeof navigator === 'undefined' || navigator.sendBeacon === undefined) {
      return;
    }
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const game = this.perfState();
    const sample = {
      sid: this.perfSid,
      t: Math.round(now),
      fps: this.lastFps,
      ms: this.lastFrameMs,
      max: this.lastFrameMaxMs,
      th: this.activeThreads,
      pool: this.pool?.threads ?? 1,
      stall: r2(stallMax), // worst join straggler stall in the window (ms)
      w: this.renderConfig.width,
      h: this.renderConfig.height,
      fs: typeof document !== 'undefined' && document.fullscreenElement !== null,
      x: r2(game.camera.x),
      y: r2(game.camera.y),
      z: r2(game.camera.z),
      a: r2(game.camera.angle),
      p: r2(game.camera.pitch ?? 0),
      spr: game.spriteCount,
      proj: game.projectileCount,
      en: game.stressEnemyCount, // stress-mode enemy count → correlate frame time with load
      ai: r2(game.aiMs), // per-frame AI cost (ms) → main-thread cost isolated from render
    };

    navigator.sendBeacon('/perf', JSON.stringify(sample));
  }
}
