/**
 * One image loaded once, async, browser-only — the shared async-art primitive behind the DOOM HUD
 * (`DoomHud`) and the FPS weapon viewmodel (`WeaponView`). `ready()` lazily starts the load on first ask
 * and returns the decoded image (or `undefined` until it is), so a consumer simply draws nothing until
 * the art decodes (SSR-safe: with no DOM there is no `Image`, so it stays `undefined` forever, never
 * throwing). On a successful decode it fires the optional `onReady` — a HUD that only repaints on state
 * change uses it to self-heal a late decode; a per-frame consumer (the weapon) just redraws next frame.
 * A cached image whose `onload` may never fire is detected via `complete && naturalWidth > 0`.
 */
export class LoadedImage {
  private readonly src: string;
  private readonly onReady?: () => void;
  private img?: HTMLImageElement;
  private loaded = false;

  constructor(src: string, onReady?: () => void) {
    this.src = src;
    this.onReady = onReady;
  }

  /** The decoded image if usable, else `undefined`; starts the (browser-only) load on first call. */
  public ready(): HTMLImageElement | undefined {
    this.ensure();
    const img = this.img;

    if (img && !this.loaded && img.complete && img.naturalWidth > 0) {
      this.loaded = true; // already cached — `onload` may never fire
    }

    return img && this.loaded ? img : undefined;
  }

  /** Create + start loading the image once (browser-only); flag it loaded + notify on success. */
  private ensure(): void {
    if (this.img || typeof Image === 'undefined') {
      return; // already loading, or no DOM (SSR) — the consumer simply draws nothing
    }
    const img = new Image();

    img.onload = (): void => {
      this.loaded = true;
      this.onReady?.();
    };
    img.onerror = (): void => {
      this.loaded = false; // missing/broken art — leave it blank
    };
    this.img = img;
    img.src = this.src; // assign src last so the handlers are wired first
  }
}
