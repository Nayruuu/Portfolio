import { describe, expect, it } from 'vitest';

import { FRAME_STATS_WINDOW_MS, FrameStats } from './frame-stats';

describe('FrameStats', () => {
  it('opens the window on the first roll-up call and reports nothing yet', () => {
    const stats = new FrameStats();

    stats.record(4, 1);

    expect(stats.rollUp(1000, FRAME_STATS_WINDOW_MS)).toBeNull();
  });

  it('holds the roll-up back until the window has elapsed', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(5, 0);

    expect(stats.rollUp(1249, 250)).toBeNull();
  });

  it('rolls up fps / mean / max / stall exactly like the inline readout math', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(4, 1);
    stats.record(6, 3);
    stats.record(5, 0);

    expect(stats.rollUp(1300, 250)).toEqual({ fps: 10, meanMs: 5, maxMs: 6, stallMax: 3 });
  });

  it('divides fps by the ELAPSED window, not the nominal window length', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(3, 0);
    stats.record(3, 0);

    expect(stats.rollUp(1400, 250)?.fps).toBe(5);
  });

  it('rounds mean and max to one decimal', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(4.04, 0);
    stats.record(6.29, 0);

    const roll = stats.rollUp(1300, 250);

    expect(roll?.meanMs).toBe(5.2);
    expect(roll?.maxMs).toBe(6.3);
  });

  it('reports meanMs null (leave the readout unchanged) when no render completed in the window', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);

    expect(stats.rollUp(1300, 250)).toEqual({ fps: 0, meanMs: null, maxMs: 0, stallMax: 0 });
  });

  it('starts a fresh window after a roll-up (old samples are dropped)', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(20, 9);
    stats.rollUp(1300, 250);

    stats.record(10, 2);
    expect(stats.rollUp(1550, 250)).toEqual({ fps: 4, meanMs: 10, maxMs: 10, stallMax: 2 });
  });

  it('exposes the 250ms roll-up cadence as a constant', () => {
    expect(FRAME_STATS_WINDOW_MS).toBe(250);
  });
});
