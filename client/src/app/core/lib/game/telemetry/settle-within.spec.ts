import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RENDER_SETTLE_TIMEOUT_MS, settleWithin } from './settle-within';

describe('settleWithin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves { settled: false } after the timeout when the inner promise never settles', async () => {
    const never = new Promise<void>(() => {}); // a killed worker's render() — never resolves
    const guarded = settleWithin(never, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(guarded).resolves.toEqual({ settled: false });
  });

  it('resolves { settled: true } when the inner promise fulfils before the timeout', async () => {
    const guarded = settleWithin(Promise.resolve(), 1000);

    await expect(guarded).resolves.toEqual({ settled: true });
  });

  it('treats an inner rejection as settled (a dropped render still releases the latch)', async () => {
    const guarded = settleWithin(Promise.reject(new Error('worker died')), 1000);

    await expect(guarded).resolves.toEqual({ settled: true });
  });

  it('clears the timer on a real settle so it cannot leak or fire a late false timeout', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const guarded = settleWithin(Promise.resolve(), 1000);

    await expect(guarded).resolves.toEqual({ settled: true });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exposes the render settle budget as a constant (generous vs a ~5ms normal frame)', () => {
    expect(RENDER_SETTLE_TIMEOUT_MS).toBe(1000);
  });
});
