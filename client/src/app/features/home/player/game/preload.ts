/**
 * The game's image preloader: decode a batch of served WebP images up front (the loading screen) so nothing
 * pops in once the loop starts. Browser-only — with no `Image` (SSR) it resolves instantly. Each URL
 * SETTLES on either a successful decode OR an error (a 404 must not stall the loading bar forever), so the
 * returned promise always resolves; `onProgress(loaded, total)` fires after each settle to drive the bar.
 * The decoded images warm the browser cache, so the scattered `LoadedImage` consumers hit it for free.
 */
export function preloadImages(
  urls: readonly string[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const total = urls.length;

  if (total === 0 || typeof Image === 'undefined') {
    onProgress?.(total, total); // nothing to load (or SSR) → already "complete"

    return Promise.resolve();
  }
  let loaded = 0;
  const settle = (resolve: () => void): void => {
    loaded += 1;
    onProgress?.(loaded, total);
    resolve();
  };

  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();

          image.onload = (): void => settle(resolve);
          image.onerror = (): void => settle(resolve); // a missing asset still counts — never stall the bar
          image.src = url;
        }),
    ),
  ).then(() => undefined);
}
