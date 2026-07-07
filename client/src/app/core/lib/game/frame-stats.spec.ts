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

    stats.rollUp(1000, 250); // opens the window at t=1000
    stats.record(5, 0);

    expect(stats.rollUp(1249, 250)).toBeNull(); // 249ms < 250ms — still filling
  });

  it('rolls up fps / mean / max / stall exactly like the inline readout math', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250); // opens the window at t=1000
    stats.record(4, 1);
    stats.record(6, 3);
    stats.record(5, 0);

    // elapsed = 300ms, 3 renders: fps = round(3*1000/300)=10, mean = round((15/3)*10)/10=5,
    // max = round(6*10)/10=6, stall = worst raw stall = 3.
    expect(stats.rollUp(1300, 250)).toEqual({ fps: 10, meanMs: 5, maxMs: 6, stallMax: 3 });
  });

  it('divides fps by the ELAPSED window, not the nominal window length', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(3, 0);
    stats.record(3, 0);

    // elapsed = 400ms (overshot the 250 nominal), 2 renders: fps = round(2*1000/400) = 5.
    expect(stats.rollUp(1400, 250)?.fps).toBe(5);
  });

  it('rounds mean and max to one decimal', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(4.04, 0);
    stats.record(6.29, 0);

    // mean = round((10.33/2)*10)/10 = round(51.65)/10 = 5.2 (5.165 → 51.65 → 52 → 5.2)
    // max = round(6.29*10)/10 = round(62.9)/10 = 6.3
    const roll = stats.rollUp(1300, 250);

    expect(roll?.meanMs).toBe(5.2);
    expect(roll?.maxMs).toBe(6.3);
  });

  it('reports meanMs null (leave the readout unchanged) when no render completed in the window', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250); // opens the window; no record calls this window

    expect(stats.rollUp(1300, 250)).toEqual({ fps: 0, meanMs: null, maxMs: 0, stallMax: 0 });
  });

  it('starts a fresh window after a roll-up (old samples are dropped)', () => {
    const stats = new FrameStats();

    stats.rollUp(1000, 250);
    stats.record(20, 9); // this belongs to the FIRST window only
    stats.rollUp(1300, 250);

    // Fresh window opened at t=1300; a single new render must not carry the first window's numbers.
    stats.record(10, 2);
    expect(stats.rollUp(1550, 250)).toEqual({ fps: 4, meanMs: 10, maxMs: 10, stallMax: 2 });
  });

  it('exposes the 250ms roll-up cadence as a constant', () => {
    expect(FRAME_STATS_WINDOW_MS).toBe(250);
  });
});
