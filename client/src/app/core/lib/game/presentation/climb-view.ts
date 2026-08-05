import { CLIMB_FRAME_URLS } from './climb-frames';
import { LoadedImage } from './loaded-image';

/** The fraction of the screen height the climb hands fill — near full height, so the two-handed pull fills
 *  the view while the player is hoisted over the ledge (the asset is hands-only, no ledge baked in). */
const CLIMB_HEIGHT_RATIO = 1;
/** Where the hands GRIP, as a fraction DOWN from the sprite's top — the fingers/contact line that should
 *  sit on the ledge edge. The forearms below it run off the bottom of the screen, as in a real pull-up. */
const GRIP_FRAC_FROM_TOP = 0.14;

/**
 * `ClimbView` — the first-person MANTLE overlay: the two-handed ledge pull (reach → pull)
 * drawn over the whole screen while the player is hoisted up over a too-tall-but-climbable ledge, REPLACING
 * the weapon viewmodel for the climb's duration (both hands are on the ledge, not the weapon). Owns the 2
 * served frames as `LoadedImage`s, so it draws nothing until they decode — SSR-safe and pop-in free. The
 * frame is picked from the mantle's 0..1 `progress`, NOT a wall clock, so the pull stays in lock-step with
 * the hoist however long it lasts. Bottom-centre, NEAREST, width by the frame's own aspect. Engine-agnostic
 * plain class (no Angular) — drawn by the BSP renderer.
 */
export class ClimbView {
  private readonly frames = CLIMB_FRAME_URLS.map((url) => new LoadedImage(url));

  /** Kick off decoding all frames now (browser-only, idempotent) so the first vault never shows a blank
   *  frame — the caller that has no asset preloader (e.g. the BSP harness) warms them at startup. */
  public preload(): void {
    for (const frame of this.frames) {
      frame.ready();
    }
  }

  /** Blit the mantle frame for `progress` (0..1, the hoist fraction) horizontally centred, NEAREST, at
   *  `CLIMB_HEIGHT_RATIO × screenH` (width by the frame's own aspect). The hands' GRIP line (the fingers,
   *  `GRIP_FRAC_FROM_TOP` down the sprite) is pinned to `ledgeY` — the screen-Y of the ledge's top edge — so
   *  the fingers land exactly on the lip you're climbing and the forearms run down its face off the bottom.
   *  `progress` is clamped, so the final `pull` frame holds through completion. Draws nothing until the frame
   *  decodes (the SSR / preloading path). */
  public draw(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
    progress: number,
    ledgeY: number,
  ): void {
    const clamped = Math.min(1, Math.max(0, progress));
    const index = Math.min(this.frames.length - 1, Math.floor(clamped * this.frames.length));
    const image = this.frames[index].ready();

    if (!image) {
      return; // transparent until the frame decodes (SSR-safe; preloaded so it rarely waits)
    }
    const drawH = CLIMB_HEIGHT_RATIO * screenH;
    const drawW = drawH * (image.naturalWidth / image.naturalHeight);
    const dy = ledgeY - GRIP_FRAC_FROM_TOP * drawH; // the fingers land on the ledge edge

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, (screenW - drawW) / 2, dy, drawW, drawH);
  }
}
