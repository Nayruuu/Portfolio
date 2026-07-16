import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEnemyGroups, buildPickupJobs } from './load-textures';
import { ENEMY_SPECS } from '../enemy';
import { PICKUP_TEXTURE_JOBS } from '../world/pickups';

describe('buildPickupJobs — the critical set', () => {
  it('emits every pickup sheet, single-row, so the index pairs with the decoded texture', () => {
    expect(buildPickupJobs()).toEqual(
      PICKUP_TEXTURE_JOBS.map((job) => ({ name: job.name, url: job.url, rows: 1 })),
    );
  });

  it('carries NO enemy art — the bestiary must not gate the loading screen', () => {
    const names = buildPickupJobs().map((job) => job.name);

    for (const spec of ENEMY_SPECS) {
      expect(names).not.toContain(spec.texName);
    }
  });
});

describe('buildEnemyGroups — the deferred set, one group per species', () => {
  it('groups each species by its walk-atlas name (the id the runtime wakes it by)', () => {
    const groups = buildEnemyGroups();

    expect(groups.map((g) => g.texName)).toEqual(ENEMY_SPECS.map((spec) => spec.texName));
  });

  it('gives a species its whole sheet set: walk (own row count) + death + attack + pain', () => {
    const spec = ENEMY_SPECS[0];
    const group = buildEnemyGroups()[0];

    expect(group.jobs).toEqual([
      { name: spec.texName, url: spec.atlasUrl, rows: spec.walkRows },
      { name: spec.deathTexName, url: spec.deathUrl, rows: 1 },
      { name: spec.attackTexName, url: spec.attackUrl, rows: 1 },
      { name: spec.painTexName, url: spec.painUrl, rows: 1 },
      ...(spec.thrower ? [{ name: spec.thrower.texName, url: spec.thrower.url, rows: 1 }] : []),
    ]);
  });

  it('includes the ranged thrower spin strip exactly for the specs that have one', () => {
    const groups = buildEnemyGroups();

    for (const [i, spec] of ENEMY_SPECS.entries()) {
      const hasStrip = groups[i].jobs.some((job) => job.name === spec.thrower?.texName);

      expect(hasStrip).toBe(spec.thrower !== undefined);
    }
  });
});

describe('a dead decoder pool (worker chunk 404 / CSP) must fall back, never hang', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('re-routes in-flight decodes to the main thread and retires the pool for later calls', async () => {
    const workers: { posts: number; onerror: (() => void) | null }[] = [];

    vi.stubGlobal(
      'Worker',
      class {
        public onmessage: unknown = null;
        public onerror: (() => void) | null = null;
        public posts = 0;

        constructor() {
          workers.push(this as never);
        }

        public postMessage(): void {
          this.posts++;
        }
      },
    );
    vi.stubGlobal('OffscreenCanvas', class {});
    // An Image whose load always errors, ASYNC like the real thing — the main-thread fallback resolves.
    vi.stubGlobal(
      'Image',
      class {
        public onerror: (() => void) | null = null;
        public onload: (() => void) | null = null;

        public set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    vi.resetModules();
    const { decodeAtlas } = await import('./load-textures');
    const hung = Symbol('hung');
    const settle = (work: Promise<unknown>): Promise<unknown> =>
      Promise.race([work, new Promise((resolve) => setTimeout(() => resolve(hung), 100))]);
    const inFlight = decodeAtlas('/dead.webp', 1);

    expect(workers.length).toBeGreaterThan(0);
    expect(workers.reduce((sum, worker) => sum + worker.posts, 0)).toBe(1);
    for (const worker of workers) {
      worker.onerror?.(); // the chunk fails to load — every pool worker dies
    }

    expect(await settle(inFlight)).not.toBe(hung); // resolves via the main-thread fallback

    const postsBefore = workers.reduce((sum, worker) => sum + worker.posts, 0);
    const second = decodeAtlas('/dead-2.webp', 1);

    expect(await settle(second)).not.toBe(hung); // a dead pool must not swallow later decodes
    expect(workers.reduce((sum, worker) => sum + worker.posts, 0)).toBe(postsBefore); // no more posts
  });
});
