import { describe, it, expect, vi, afterEach } from 'vitest';
import { preloadImages } from './preload';

/** A loadable `Image` stand-in — captures each instance so the test can fire its `onload` / `onerror`. */
class FakeImage {
  public static instances: FakeImage[] = [];
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public src = '';

  constructor() {
    FakeImage.instances.push(this);
  }
}

describe('preloadImages', () => {
  afterEach(() => {
    FakeImage.instances = [];
    vi.unstubAllGlobals();
  });

  it('loads every url, reports progress per settle, and resolves once all have settled', async () => {
    vi.stubGlobal('Image', FakeImage);
    const progress: [number, number][] = [];

    const done = preloadImages(['/a.webp', '/b.webp'], (loaded, total) =>
      progress.push([loaded, total]),
    );

    expect(FakeImage.instances).toHaveLength(2); // both images created synchronously
    expect(FakeImage.instances.map((image) => image.src)).toEqual(['/a.webp', '/b.webp']);

    FakeImage.instances[0].onload?.(); // one decodes…
    FakeImage.instances[1].onerror?.(); // …the other 404s — it STILL settles (never stalls the bar)

    await expect(done).resolves.toBeUndefined();
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('resolves immediately for an empty list, reporting complete', async () => {
    const progress: [number, number][] = [];

    await expect(
      preloadImages([], (loaded, total) => progress.push([loaded, total])),
    ).resolves.toBeUndefined();
    expect(progress).toEqual([[0, 0]]); // 0 of 0 = already done
  });

  it('resolves with no DOM (SSR — `Image` undefined), never throwing', async () => {
    vi.stubGlobal('Image', undefined);

    await expect(preloadImages(['/a.webp', '/b.webp'])).resolves.toBeUndefined();
  });
});
