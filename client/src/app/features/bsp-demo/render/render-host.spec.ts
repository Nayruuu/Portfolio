// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Camera, MapSource } from '../../../core/lib/bsp-engine';
import { RenderHost, type PerfState } from './render-host';

/**
 * The render-confluence's unit net. Under Vitest (jsdom) there is no cross-origin isolation and no WebGPU, so
 * {@link RenderHost} bootstraps with a NULL worker pool + NULL GPU — the single-threaded fallback path. That is
 * exactly the seam this spec pins: the config-mutated-in-place contract, the frame-stats roll-up feeding the
 * fps/frameMs/max readouts, the perf-beacon gate, and the queued between-frames actuations. The real pool/GPU
 * render + the scaled pixel output ride on the Playwright webkit player-scene specs (a broken pool/config/render
 * path fails those), never here.
 */

const CAMERA: Camera = { x: 1, y: 2, angle: 0.5, z: 1.4, pitch: 0.25 };

/** A 2D-context stand-in: RenderHost only ever calls `createImageData`, sizing a plain RGBA buffer. */
function fakeContext(): CanvasRenderingContext2D {
  return {
    createImageData: (width: number, height: number) =>
      ({ data: new Uint8ClampedArray(width * height * 4), width, height }) as ImageData,
  } as unknown as CanvasRenderingContext2D;
}

/** A canvas stand-in: RenderHost only reads/writes the backing-store width/height. */
function fakeCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0 } as HTMLCanvasElement;
}

/** Bootstrap a host on the CPU fallback path (forceCpu skips the async GPU init; the pool is null in jsdom). */
function bootstrap(
  host: RenderHost,
  overrides: { perfRing?: boolean; perfState?: () => PerfState } = {},
): void {
  host.bootstrap({
    context: fakeContext(),
    canvas: fakeCanvas(),
    zoneKey: 'z1',
    mapSource: {} as MapSource, // unread on the null-pool path (createRenderPool returns null first)
    neighborSources: new Map(),
    perfRing: overrides.perfRing ?? false,
    noGovernor: false,
    forceCpu: true,
    camera: CAMERA,
    perfState:
      overrides.perfState ??
      (() => ({
        camera: CAMERA,
        spriteCount: 3,
        projectileCount: 2,
        stressEnemyCount: 0,
        aiMs: 1.234,
      })),
  });
}

describe('RenderHost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)['__bspPerfRing'];
    delete (window as unknown as Record<string, unknown>)['__bspCam'];
  });

  describe('applyResolution', () => {
    it('mutates the SAME config object in place (holders keep their reference)', () => {
      const host = new RenderHost();
      const configRef = host.config;

      bootstrap(host);
      host.applyResolution(1920, 1080);

      expect(host.config).toBe(configRef); // identity preserved — a fullscreen switch reaches every holder
      expect(host.config.width).toBe(1920);
      expect(host.config.height).toBe(1080);
      expect(host.config.fov).toBeCloseTo(Math.PI / 2); // fov untouched by a resolution switch
    });

    it('resizes the framebuffer to the new resolution', () => {
      const host = new RenderHost();

      bootstrap(host);
      expect(host.frame.width).toBe(1280); // the windowed tier the host seeds itself at
      expect(host.frame.height).toBe(720);

      host.applyResolution(1920, 1080);

      expect(host.frame.width).toBe(1920);
      expect(host.frame.height).toBe(1080);
      expect(host.frame.data.length).toBe(1920 * 1080 * 4);
    });
  });

  describe('queueResolution + flushPending', () => {
    it('applies a DIFFERENT queued resolution in the flush window', () => {
      const host = new RenderHost();

      bootstrap(host);
      host.queueResolution(1920, 1080);
      expect(host.config.width).toBe(1280); // not applied until the flush

      host.flushPending();
      expect(host.config.width).toBe(1920);
      expect(host.config.height).toBe(1080);
    });

    it('ignores a queued resolution equal to the current one', () => {
      const host = new RenderHost();

      bootstrap(host);
      host.queueResolution(1280, 720); // same as current — a no-op
      host.flushPending();

      expect(host.config.width).toBe(1280);
    });
  });

  describe('setMaps / swapTo', () => {
    it('are safe no-ops when there is no pool (the single-threaded fallback)', () => {
      const host = new RenderHost();

      bootstrap(host); // pool is null in jsdom
      expect(() => {
        host.setMaps('z2', {} as MapSource, new Map());
        host.swapTo('z2', new Map());
        host.flushPending(); // drains the queue against a null pool without throwing
      }).not.toThrow();
    });
  });

  describe('recordRender + measureDisplay', () => {
    it('rolls the frame-stats window up into the fps / frameMs / max readouts', () => {
      const host = new RenderHost();

      bootstrap(host);
      expect(host.measureDisplay(1000).roll).toBeNull(); // opens the window at t=1000

      host.recordRender(4, 1, 0, 0);
      host.recordRender(6, 3, 0, 0);

      const snapshot = host.measureDisplay(1300); // 300ms ≥ the 250ms window → distil

      expect(snapshot.roll).toEqual({ fps: 7, meanMs: 5, maxMs: 6 }); // 2 renders / 0.3s ≈ 7fps, mean 5, worst 6
    });

    it('reports the backend readouts every frame (pool/GPU absent → cpu, single-threaded)', () => {
      const host = new RenderHost();

      bootstrap(host);
      const snapshot = host.measureDisplay(1000);

      expect(snapshot.backend).toBe('cpu');
      expect(snapshot.threads).toBe(1);
      expect(snapshot.poolSize).toBe(1);
      expect(snapshot.roll).toBeNull(); // the window is still filling
    });
  });

  describe('afterRender', () => {
    it('records a completed render with no worker join (governor stays inert)', () => {
      const host = new RenderHost();

      bootstrap(host);
      host.measureDisplay(1000); // open the window
      expect(() => host.afterRender(performance.now())).not.toThrow();

      const snapshot = host.measureDisplay(1300);

      expect(snapshot.roll).not.toBeNull();
      expect(snapshot.roll?.meanMs).not.toBeNull(); // the render was ingested into the mean
    });
  });

  describe('dispose', () => {
    it('latches the disposed flag (the coordinator then skips a late blit)', () => {
      const host = new RenderHost();

      bootstrap(host);
      expect(host.disposed).toBe(false);

      host.dispose();

      expect(host.disposed).toBe(true);
    });
  });

  describe('logPerf gate', () => {
    it('fires ONE localhost beacon on a roll-up, reading the perf-state lazily', () => {
      const beacon = vi.fn().mockReturnValue(true);

      vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
      const perfState = vi.fn<() => PerfState>(() => ({
        camera: CAMERA,
        spriteCount: 3,
        projectileCount: 2,
        stressEnemyCount: 0,
        aiMs: 1.234,
      }));
      const host = new RenderHost();

      bootstrap(host, { perfState });
      host.measureDisplay(1000); // opens the window
      host.recordRender(5, 2, 0, 0);
      expect(perfState).not.toHaveBeenCalled(); // read lazily — no beacon yet, no state pulled

      host.measureDisplay(1300); // rolls up → the localhost beacon fires

      expect(beacon).toHaveBeenCalledTimes(1);
      expect(perfState).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(beacon.mock.calls[0][1] as string);

      expect(payload).toMatchObject({ spr: 3, proj: 2, w: 1280, h: 720, ms: 5 });
    });

    it('does NOT fire when the perf flag is off', () => {
      const beacon = vi.fn().mockReturnValue(true);

      vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
      const host = new RenderHost();

      bootstrap(host);
      (host as unknown as { perfLog: boolean }).perfLog = false; // simulate a non-localhost host
      host.measureDisplay(1000);
      host.recordRender(5, 2, 0, 0);
      host.measureDisplay(1300);

      expect(beacon).not.toHaveBeenCalled();
    });
  });

  describe('perf ring', () => {
    it('exposes the ring on window and writes one row per display frame', () => {
      const host = new RenderHost();

      bootstrap(host, { perfRing: true });
      const ring = (
        window as unknown as Record<
          string,
          { n: number; delta: Float64Array; render: Float64Array }
        >
      )['__bspPerfRing'];

      expect(ring).toBeDefined();
      expect(ring.n).toBe(0);

      host.measureDisplay(1000); // first frame only seeds perfRingLast (no previous timestamp)
      host.recordRender(5, 2, 0, 0);
      host.measureDisplay(1016); // second frame writes a row

      expect(ring.n).toBe(1);
      expect(ring.delta[0]).toBeCloseTo(16);
      expect(ring.render[0]).toBe(5);
    });
  });
});
