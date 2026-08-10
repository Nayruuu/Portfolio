export const FRAME_STATS_WINDOW_MS = 250;

/** `meanMs` is null when NO render completed in the window (else the caller reports a bogus zero). */
export interface FrameRollUp {
  readonly fps: number;
  readonly meanMs: number | null;
  readonly maxMs: number;
  readonly stallMax: number;
}

export class FrameStats {
  private windowStart = 0; // 0 = not yet opened
  private renders = 0;
  private msSum = 0;
  private msMax = 0;
  private stallMax = 0;

  public record(frameCost: number, stallMs: number): void {
    this.renders += 1;
    this.msSum += frameCost;
    this.msMax = Math.max(this.msMax, frameCost);
    this.stallMax = Math.max(this.stallMax, stallMs);
  }

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
