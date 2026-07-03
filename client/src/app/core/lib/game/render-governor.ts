/**
 * The pure RENDER GOVERNOR — the contention-resilience decision core behind the BSP game's render pool.
 *
 * The engine is cheap (a few ms per frame), but the per-frame JOIN across N band workers is
 * straggler-sensitive: on a loaded machine (other browsers eating cores) ONE descheduled worker stalls the
 * whole frame for an OS scheduling quantum (10ms+), so a game that costs nothing still hitches. The governor
 * owns ONE knob — the ACTIVE WORKER COUNT. Recurring join stalls (`stallMs` — how long the slowest band
 * lagged the median band) shrink it: fewer simultaneous threads = fewer straggler lotteries per frame, and
 * cores handed back to the OS/other apps. Sustained calm grows it back. Resolution is deliberately NOT a
 * knob: sharpness is part of the product, and measured wall-times under contention overstate the true
 * compute (every band inflates while descheduled), so a resolution drop there buys blur, not cadence.
 *
 * Under contention no classifier of the wall-times can tell in advance whether a shrink will help (light
 * noise: fewer straggler lotteries win) or hurt (heavy same-QoS starvation: the pool's CPU share scales
 * with its runnable threads, so fewer bigger bands render SLOWER — measured up to 4×). So every shrink is
 * a measured TRIAL, audited when its cooldown ends against the ANCHOR — the join-latency EWMA (`joinMs`,
 * the slowest band: the frame's real render latency) captured at FULL workers when the ladder first left
 * the top. Auditing every rung against the full-worker anchor (never the previous rung) means regressions
 * cannot compound step by step; a failed audit reverts the rung and burns the ladder for a while, and a
 * shrunken rung that keeps stalling RE-ARMS its audit on every hold, climbing back toward full workers for
 * as long as the below-full shape measures worse. The governor can never end up durably worse than doing
 * nothing, by measurement, not heuristics. For the same reason the ladder never goes below HALF the pool: the deep rungs only ever helped when tiny reduced-
 * resolution bands existed, and at full resolution they measured catastrophic in every contended regime.
 *
 * The compute signal (`computeMs` — the FASTEST band's completion, the least-disturbed worker) survives as
 * a pre-emptive GUARD: when stalls arrive while even the fastest band has been over budget for an unbroken
 * streak, the machine is genuinely SATURATED (every thread timeshared) and the shrink trial is skipped
 * outright — the honest outcome is a lower frame rate at full sharpness. The streak must be consecutive:
 * contention inflates wall-times in BURSTS (measured: p50 under budget while p95 hits 80ms+), so sporadic
 * inflation never masquerades as saturation.
 *
 * Hysteresis: strikes SHRINK fast (a window of a few seconds), calm GROWS slowly (one rung per sustained
 * calm period). Any actuation starts a cooldown so each change is observed before the next decision. Pure
 * and frame-driven: `stepRenderGovernor(state, sample)` returns the next state; the caller applies
 * `workers` when it changes.
 */

/** Tuning: thresholds, windows and the strike/calm/audit hysteresis. `RENDER_GOVERNOR` is the game's
 *  tuning; tests inject others. */
export interface RenderGovernorConfig {
  /** A frame whose join stall exceeds this is a STRIKE — the slowest band lost a scheduling quantum,
   *  not merely a heavier slice (band imbalance sits well under this; a deschedule is 10ms+). */
  readonly stallStrikeMs: number;
  /** Strikes are counted per rolling window of this many frames… */
  readonly strikeWindow: number;
  /** …and this many strikes within one window shrink the worker rung (recurring stalls, not one blip). */
  readonly strikesToShrink: number;
  /** A frame whose FASTEST band exceeds this is saturation-hot — even the least-disturbed worker was slow. */
  readonly saturationComputeMs: number;
  /** Consecutive saturation-hot frames before stalls are ruled SATURATION (hold workers) rather than a
   *  straggler (shrink). Consecutive, because contention inflates in bursts; only genuine load sustains. */
  readonly saturationFrames: number;
  /** EWMA smoothing factor for the join-latency signal the shrink audit compares (per frame). */
  readonly joinAlpha: number;
  /** A shrink is REVERTED when the post-cooldown join EWMA exceeds the full-worker anchor × this. */
  readonly revertFactor: number;
  /** Frames the ladder stays locked against further shrinks after a reverted trial. */
  readonly burnFrames: number;
  /** Strike-free frames required before growing back one rung (slow to give back). */
  readonly growAfter: number;
  /** Frames after ANY actuation before the next decision — observe the new shape, then judge. */
  readonly actuationCooldown: number;
}

export const RENDER_GOVERNOR: RenderGovernorConfig = {
  stallStrikeMs: 6,
  strikeWindow: 240, // ~2-4s of frames
  strikesToShrink: 8,
  saturationComputeMs: 10,
  saturationFrames: 120, // ~1-2s where EVERY frame is hot — bursty contention can't string that together
  joinAlpha: 0.05, // ~20-frame time constant — settled well within the actuation cooldown
  revertFactor: 1.2, // a shrunken shape must not cost more than +20% join latency vs full workers
  burnFrames: 1800, // ~15-30s before a reverted ladder is allowed to try shrinking again
  growAfter: 900, // ~8-15s of proven calm per rung given back
  actuationCooldown: 120,
};

/** One frame's measurements, straight off the pool's join instrumentation. */
export interface RenderGovernorSample {
  /** Slowest band's completion minus the median band's — pure scheduling noise. */
  readonly stallMs: number;
  /** Fastest band's completion — the least-disturbed worker, the robust true-compute estimator. */
  readonly computeMs: number;
  /** Slowest band's completion — the frame's real render latency (what the shrink audit optimises). */
  readonly joinMs: number;
}

/** The governor's full state. `workers` is the decision; the rest is hysteresis bookkeeping. */
export interface RenderGovernorState {
  readonly workerLadder: readonly number[]; // active-worker rungs, full → half (derived from the pool size)
  readonly workerRung: number; // index into workerLadder (0 = all workers)
  readonly workers: number; // the decision: active workers = workerLadder[workerRung]
  readonly strikes: number; // stall strikes in the current window
  readonly windowLeft: number; // frames left in the current strike window
  readonly calmFrames: number; // consecutive strike-free frames (grow credit)
  readonly hotFrames: number; // consecutive saturation-hot frames (the saturation-guard streak)
  readonly joinAvg: number; // the join-latency EWMA (ms) — the audit's measured outcome
  readonly anchorJoin: number; // full-worker join EWMA every shrunken rung is audited against (0 = at full)
  readonly auditPending: boolean; // a shrink trial awaits its one-shot post-cooldown audit
  readonly burnLeft: number; // frames the ladder stays locked after a reverted trial
  readonly cooldown: number; // frames left before the next actuation is allowed
}

/** The worker-count ladder for a pool of `poolSize` workers: full → ~¾ → ~½, deduplicated — never below
 *  half the pool (the pool's CPU share under contention scales with its runnable threads; see module doc).
 *  E.g. 8 → [8, 6, 4] · 4 → [4, 3, 2] · 2 → [2, 1] · 1 → [1]. */
export function workerLadder(poolSize: number): readonly number[] {
  const full = Math.max(1, Math.floor(poolSize));
  const rungs = [full, Math.round(full * 0.75), Math.max(1, Math.round(full * 0.5))];

  return rungs.filter((n, i) => n >= 1 && rungs.indexOf(n) === i);
}

/** The governor's starting state for a pool of `poolSize` workers: everything full, all counters idle. */
export function initialRenderGovernor(
  poolSize: number,
  config: RenderGovernorConfig = RENDER_GOVERNOR,
): RenderGovernorState {
  const ladder = workerLadder(poolSize);

  return {
    workerLadder: ladder,
    workerRung: 0,
    workers: ladder[0],
    strikes: 0,
    windowLeft: config.strikeWindow,
    calmFrames: 0,
    hotFrames: 0,
    joinAvg: 0,
    anchorJoin: 0,
    auditPending: false,
    burnLeft: 0,
    cooldown: 0,
  };
}

/** Advance the governor one frame. See the module doc for the policy; the shape of the result:
 *  at most ONE actuation per call, and none during a cooldown. */
export function stepRenderGovernor(
  state: RenderGovernorState,
  sample: RenderGovernorSample,
  config: RenderGovernorConfig = RENDER_GOVERNOR,
): RenderGovernorState {
  const strike = sample.stallMs > config.stallStrikeMs;
  const hotFrames = sample.computeMs > config.saturationComputeMs ? state.hotFrames + 1 : 0;
  const calmFrames = strike ? 0 : state.calmFrames + 1;
  const joinAvg = state.joinAvg * (1 - config.joinAlpha) + sample.joinMs * config.joinAlpha;
  const burnLeft = Math.max(0, state.burnLeft - 1);

  // During a cooldown: only observe (EWMA, streaks, calm credit); the strike window stays frozen so the
  // frames spent settling into a new shape are never counted against it.
  if (state.cooldown > 0) {
    return { ...state, joinAvg, hotFrames, calmFrames, burnLeft, cooldown: state.cooldown - 1 };
  }

  const strikes = state.strikes + (strike ? 1 : 0);
  // Any actuation closes a pending audit; the anchor persists while the ladder is below full and clears
  // when it returns to the top (a shrink re-arms both explicitly below).
  const actuate = (next: Partial<RenderGovernorState>): RenderGovernorState => ({
    ...state,
    joinAvg,
    hotFrames,
    burnLeft,
    strikes: 0,
    windowLeft: config.strikeWindow,
    calmFrames: 0,
    auditPending: false,
    cooldown: config.actuationCooldown,
    ...next,
  });

  // 1 — the one-shot AUDIT of the last shrink, on the first frame after its cooldown: if this shape's join
  // latency regressed past the FULL-WORKER anchor (never the previous rung — regressions must not compound
  // across rungs), the trial FAILED — revert the rung and burn the ladder (measured harm, e.g. heavy
  // same-QoS starvation where fewer bigger bands on starved threads lose).
  if (state.auditPending && joinAvg > state.anchorJoin * config.revertFactor) {
    const workerRung = state.workerRung - 1;

    return actuate({
      workerRung,
      workers: state.workerLadder[workerRung],
      anchorJoin: workerRung === 0 ? 0 : state.anchorJoin,
      burnLeft: config.burnFrames,
    });
  }

  // 2 — recurring join stalls → trial-shrink the worker rung, unless the ladder is burned (a trial just
  // failed here), the streak guard rules SATURATION (even the fastest band over budget every frame — a
  // shrink provably loses), or the floor is reached. Held stalls ride out honestly: lower fps, never blur.
  if (strikes >= config.strikesToShrink) {
    const saturated = hotFrames >= config.saturationFrames;

    if (!saturated && burnLeft === 0 && state.workerRung < state.workerLadder.length - 1) {
      const workerRung = state.workerRung + 1;

      return actuate({
        workerRung,
        workers: state.workerLadder[workerRung],
        anchorJoin: state.workerRung === 0 ? joinAvg : state.anchorJoin, // leaving the top sets the anchor
        auditPending: true, // arm the audit: the new rung must hold near the full-worker shape
      });
    }

    // Saturation, burned or the floor — reset the window and ride it out. A shrunken rung that keeps
    // stalling RE-ARMS its audit: if the held shape measures worse than the anchor, the revert path keeps
    // climbing it back toward full workers — a below-full ladder never sits on a measured regression.
    return actuate({ auditPending: state.workerRung > 0 });
  }

  // 3 — sustained calm → grow back one rung (growing is the safe direction: never audited, never burned).
  if (calmFrames >= config.growAfter && state.workerRung > 0) {
    const workerRung = state.workerRung - 1;

    return actuate({
      workerRung,
      workers: state.workerLadder[workerRung],
      anchorJoin: workerRung === 0 ? 0 : state.anchorJoin,
    });
  }

  // No actuation: advance the strike window (expiry resets the count — stalls must RECUR to matter), cap
  // the calm credit at the grow threshold (fully calm never banks more than one rung of credit) and close
  // a passed audit (the shrink is kept; the anchor stays for the deeper rungs).
  const cappedCalm = Math.min(calmFrames, config.growAfter);
  const windowLeft = state.windowLeft - 1;
  const kept = { joinAvg, hotFrames, burnLeft, auditPending: false, calmFrames: cappedCalm };

  return windowLeft <= 0
    ? { ...state, ...kept, strikes: 0, windowLeft: config.strikeWindow }
    : { ...state, ...kept, strikes, windowLeft };
}
