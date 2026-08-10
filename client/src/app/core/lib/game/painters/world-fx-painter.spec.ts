import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFromCache } from './world-fx-painter';

class FakeImage {
  public src = '';
  public complete = false;
  public naturalWidth = 0;
}

describe('imageFromCache', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined and caches nothing when there is no source', () => {
    const cache = new Map<string, HTMLImageElement>();

    expect(imageFromCache(cache, 'plasma', undefined)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('lazily creates ONE Image per kind, reused across calls, and holds it until it has decoded', () => {
    const cache = new Map<string, HTMLImageElement>();

    expect(imageFromCache(cache, 'plasma', 'data:image/png;base64,AAAA')).toBeUndefined();
    expect(cache.size).toBe(1);
    const first = cache.get('plasma');

    expect(imageFromCache(cache, 'plasma', 'data:image/png;base64,AAAA')).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.get('plasma')).toBe(first);

    imageFromCache(cache, 'rocket', 'data:image/png;base64,BBBB');
    expect(cache.size).toBe(2);
  });

  it('returns the cached image once it reports complete with real pixels', () => {
    const cache = new Map<string, HTMLImageElement>();
    const decoded = { complete: true, naturalWidth: 8 } as unknown as HTMLImageElement;

    cache.set('plasma', decoded);

    expect(imageFromCache(cache, 'plasma', 'data:image/png;base64,AAAA')).toBe(decoded);
  });

  it('still withholds a cached image that is complete but has zero pixels (a failed decode)', () => {
    const cache = new Map<string, HTMLImageElement>();
    const broken = { complete: true, naturalWidth: 0 } as unknown as HTMLImageElement;

    cache.set('plasma', broken);

    expect(imageFromCache(cache, 'plasma', 'data:image/png;base64,AAAA')).toBeUndefined();
  });
});
