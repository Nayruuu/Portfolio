/**
 * The pure FRAME-STATS TELEMETRY accumulator — the roll-up math behind the BSP game's dev perf readout
 * (the `fps` / `frameMs` / `frameMaxMs` HUD signals and the localhost `?perflog` beacon). Debug-only and
 * render-neutral: it can never change a rendered pixel, only what the overlay/beacon report.
 *
 * The component MEASURES each completed render (a `performance.now` span around the pool join) and the
 * per-rAF timestamp; this accumulator only INGESTS those plain numbers and, roughly four times a second,
 * distils the window into a small readout. Zero DOM / `performance` / `fetch` — the shell owns the clock,
 * the signals and the beacon; this owns the arithmetic.
 */

/** How long a roll-up window stays open before it is distilled and reset (ms). ~4 readouts/second. */
export const FRAME_STATS_WINDOW_MS = 250;

/** One window's distilled readout. `meanMs` is null when NO render completed in the window — the caller
 *  then leaves its frame-time readout unchanged rather than reporting a bogus zero. */
export interface FrameRollUp {
  /** Rendered frames per second over the window (completed renders ÷ the ELAPSED window, not the nominal). */
  readonly fps: number;
  /** Mean render cost (ms, one decimal) — null when the window completed no renders. */
  readonly meanMs: number | null;
  /** Worst single render cost in the window (ms, one decimal) — the spike/stutter readout. */
  readonly maxMs: number;
  /** Worst join-straggler stall in the window (raw ms) — the caller rounds it into the beacon. */
  readonly stallMax: number;
}

/** A time-windowed accumulator: ingest each completed render's cost + join stall, then roll the window up
 *  once it has been open for {@link FRAME_STATS_WINDOW_MS}. */
export class FrameStats {
  private windowStart = 0; // rAF timestamp the current window opened at (0 = not yet opened)
  private renders = 0; // completed renders in the window (the visual rate)
  private msSum = 0; // summed render cost → the mean
  private msMax = 0; // worst single render → the spike readout
  private stallMax = 0; // worst join straggler stall → the contention readout

  /** Ingest one COMPLETED render's cost + its join-straggler stall (both ms). */
  public record(frameCost: number, stallMs: number): void {
    this.renders += 1;
    this.msSum += frameCost;
    this.msMax = Math.max(this.msMax, frameCost);
    this.stallMax = Math.max(this.stallMax, stallMs);
  }

  /** Distil the window if it has been open for `windowMs`, then start a fresh one; returns null while the
   *  window is still filling (the first call merely opens it at `now`). */
  public rollUp(now: number, windowMs: number): FrameRollUp | null {
    if (this.windowStart === 0) {
      this.windowStart = now;

      return null;
    }
    const elapsed = now - this.windowStart;

    if (elapsed < windowMs) {
      return null;
    }
    const rollUp: FrameRollUp = {
      fps: Math.round((this.renders * 1000) / elapsed),
      meanMs: this.renders > 0 ? Math.round((this.msSum / this.renders) * 10) / 10 : null,
      maxMs: Math.round(this.msMax * 10) / 10,
      stallMax: this.stallMax,
    };

    this.windowStart = now;
    this.renders = 0;
    this.msSum = 0;
    this.msMax = 0;
    this.stallMax = 0;

    return rollUp;
  }
}
