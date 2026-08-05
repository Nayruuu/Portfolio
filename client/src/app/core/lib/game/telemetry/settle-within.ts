/** The watchdog budget for one render join. A normal frame settles in ~5ms; a merely-slow render must never
 *  be cut, so the budget is generous. Past it, the render is presumed hung (an iOS-killed worker whose
 *  `done` message never arrives) and the caller retries the NEXT frame instead of latching forever. */
export const RENDER_SETTLE_TIMEOUT_MS = 1000;

export interface SettleResult {
  /** True if `inner` settled (fulfilled OR rejected) before the deadline; false if the timeout won. */
  readonly settled: boolean;
}

/**
 * Races `inner` against a `ms` deadline. Resolves `{ settled: true }` the moment `inner` settles — a
 * rejection counts, since a dropped render still frees the caller's busy latch — else `{ settled: false }`
 * once `ms` elapses. The timeout branch never rejects, so the caller always gets a value and can clear its
 * latch unconditionally. On a real settle the timer is cleared so it can neither leak nor fire a late,
 * spurious `{ settled: false }`. Pure and SSR/test-safe: only `setTimeout`, so it runs under fake timers.
 */
export function settleWithin(inner: Promise<unknown>, ms: number): Promise<SettleResult> {
  return new Promise<SettleResult>((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), ms);
    const settle = (): void => {
      clearTimeout(timer);
      resolve({ settled: true });
    };

    void inner.then(settle, settle);
  });
}
