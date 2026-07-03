import { describe, it, expect } from 'vitest';
import {
  initialRenderGovernor,
  RENDER_GOVERNOR,
  stepRenderGovernor,
  workerLadder,
  type RenderGovernorConfig,
  type RenderGovernorSample,
  type RenderGovernorState,
} from './render-governor';

// Small windows so each hysteresis transition is exercised in a handful of frames.
const CFG: RenderGovernorConfig = {
  stallStrikeMs: 6,
  strikeWindow: 10,
  strikesToShrink: 3,
  saturationComputeMs: 10,
  saturationFrames: 3,
  joinAlpha: 0.5,
  revertFactor: 1.2,
  burnFrames: 12,
  growAfter: 5,
  actuationCooldown: 4,
};

const CALM: RenderGovernorSample = { stallMs: 1, computeMs: 4, joinMs: 5 };
const STALLED: RenderGovernorSample = { stallMs: 25, computeMs: 4, joinMs: 12 };
// Every thread timeshared: stalls AND even the fastest band over budget, frame after frame.
const SATURATED: RenderGovernorSample = { stallMs: 25, computeMs: 20, joinMs: 12 };
// A shrink trial gone wrong: stalls persist AND the frame's join latency ballooned at the new rung.
const REGRESSED: RenderGovernorSample = { stallMs: 25, computeMs: 4, joinMs: 40 };
// The slow boil: each rung only slightly worse than the previous one — but drifting past the anchor.
const DRIFTING: RenderGovernorSample = { stallMs: 25, computeMs: 4, joinMs: 14 };

/** Step `state` through `n` frames of the same sample. */
const run = (
  state: RenderGovernorState,
  sample: RenderGovernorSample,
  n: number,
): RenderGovernorState => {
  let next = state;

  for (let i = 0; i < n; i++) {
    next = stepRenderGovernor(next, sample, CFG);
  }

  return next;
};

/** Burn through an actuation cooldown with calm frames (no counters may advance into the window). */
const settle = (state: RenderGovernorState): RenderGovernorState =>
  run(state, CALM, state.cooldown);

describe('workerLadder', () => {
  it('builds the full → ¾ → ½ rungs for a big pool — never below half (see module doc)', () => {
    expect(workerLadder(8)).toEqual([8, 6, 4]);
  });

  it('deduplicates collapsing rungs on small pools', () => {
    expect(workerLadder(4)).toEqual([4, 3, 2]);
    expect(workerLadder(2)).toEqual([2, 1]);
    expect(workerLadder(1)).toEqual([1]);
  });

  it('floors a degenerate pool size at one worker', () => {
    expect(workerLadder(0)).toEqual([1]);
  });
});

describe('initialRenderGovernor', () => {
  it('starts at full workers with idle counters', () => {
    const state = initialRenderGovernor(8, CFG);

    expect(state.workers).toBe(8);
    expect(state.strikes).toBe(0);
    expect(state.cooldown).toBe(0);
    expect(state.calmFrames).toBe(0);
    expect(state.hotFrames).toBe(0);
    expect(state.anchorJoin).toBe(0);
    expect(state.auditPending).toBe(false);
    expect(state.burnLeft).toBe(0);
  });

  it('defaults to the game tuning config', () => {
    expect(initialRenderGovernor(8).windowLeft).toBe(RENDER_GOVERNOR.strikeWindow);
  });
});

describe('stepRenderGovernor — worker shrink on recurring stalls', () => {
  it('shrinks one worker rung once strikesToShrink strikes land within a window', () => {
    const state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    expect(state.workers).toBe(6);
    expect(state.workerRung).toBe(1);
    expect(state.cooldown).toBe(CFG.actuationCooldown);
    expect(state.auditPending).toBe(true); // the trial is armed for its audit…
    expect(state.anchorJoin).toBeGreaterThan(0); // …against the full-worker anchor just captured
  });

  it('does NOT shrink on fewer strikes than the threshold', () => {
    const state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink - 1);

    expect(state.workers).toBe(8);
    expect(state.strikes).toBe(CFG.strikesToShrink - 1);
  });

  it('forgets strikes when the window expires — stalls must RECUR to matter', () => {
    // Two strikes, then calm past the window boundary, then two strikes again: never 3 in one window.
    let state = run(initialRenderGovernor(8, CFG), STALLED, 2);

    state = run(state, CALM, CFG.strikeWindow); // window rolls over → count resets
    state = run(state, STALLED, 2);

    expect(state.workers).toBe(8);
  });

  it('ignores strikes during the post-actuation cooldown, then counts fresh ones', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    // Cooldown frames are observation-only: stalls there must not stack a second shrink.
    const cooled = run(shrunk, STALLED, CFG.actuationCooldown);

    expect(cooled.workers).toBe(6);
    expect(cooled.strikes).toBe(0);

    // Fresh strikes after the cooldown DO shrink the next rung (the audit passes: same join latency).
    expect(run(cooled, STALLED, CFG.strikesToShrink).workers).toBe(4);
  });

  it('walks the ladder down to its half-pool floor under sustained stalls, then holds', () => {
    let state = initialRenderGovernor(8, CFG);

    for (const expected of [6, 4]) {
      state = run(settle(state), STALLED, CFG.strikesToShrink);
      expect(state.workers).toBe(expected);
    }

    state = run(settle(state), STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(4); // the floor — rides it out
  });

  it('holds (window reset, no change) at the bottom worker rung', () => {
    let state = initialRenderGovernor(1, CFG); // ladder [1] — already at the floor

    state = run(state, STALLED, CFG.strikesToShrink);

    expect(state.workers).toBe(1);
    expect(state.strikes).toBe(0); // the window was still reset — no runaway counter
    expect(state.cooldown).toBe(CFG.actuationCooldown);
  });
});

describe('stepRenderGovernor — the shrink audit', () => {
  it('REVERTS a shrink whose measured join latency regressed, and burns the ladder', () => {
    // The heavy same-QoS regime: fewer, bigger bands on starved threads render SLOWER. The trial's
    // post-cooldown join EWMA blows past the full-worker anchor → the rung comes back.
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6
    const state = run(shrunk, REGRESSED, CFG.actuationCooldown + 1); // settle, then the one-shot audit

    expect(state.workers).toBe(8);
    expect(state.burnLeft).toBe(CFG.burnFrames);
    expect(state.cooldown).toBe(CFG.actuationCooldown);
    expect(state.auditPending).toBe(false); // the trial is closed…
    expect(state.anchorJoin).toBe(0); // …and back at full workers the anchor resets
  });

  it('KEEPS a shrink whose join latency held, and closes the audit', () => {
    // Stalls persist but the join latency did NOT regress at the new rung: the trial stands.
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6
    const state = run(shrunk, STALLED, CFG.actuationCooldown + 1);

    expect(state.workers).toBe(6);
    expect(state.auditPending).toBe(false); // audited once, then closed
    expect(state.anchorJoin).toBeGreaterThan(0); // the anchor stays — deeper rungs audit against it too
    expect(state.burnLeft).toBe(0);
  });

  it('audits every rung against the FULL-WORKER anchor — slight per-rung drifts cannot compound', () => {
    // 8 → 6 passes its audit (join held at 12ms ≈ the anchor). 6 → 4 drifts to 14ms: barely +17% vs the
    // PREVIOUS rung (a per-rung audit would keep it) but past anchor × 1.2 → it must revert to 6.
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6, anchor ≈ 10.5

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink); // audit passes → 6 → 4
    expect(state.workers).toBe(4);

    state = run(state, DRIFTING, CFG.actuationCooldown + 1); // the 4-rung's audit vs the ANCHOR

    expect(state.workers).toBe(6);
    expect(state.burnLeft).toBe(CFG.burnFrames);
  });

  it('re-audits a held shrunken rung against the anchor — persisting regressions climb back to full', () => {
    // Stuck at the floor with strikes that never let calm accrue: the hold path re-arms the audit each
    // cycle, and a join latency past the anchor keeps reverting upward until full workers are back.
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6, anchor set

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink); // audit passes → 6 → 4
    expect(state.workers).toBe(4);

    let sawFull = false;

    for (let i = 0; i < 60 && !sawFull; i++) {
      state = stepRenderGovernor(state, REGRESSED, CFG);
      sawFull = state.workers === 8;
    }
    expect(sawFull).toBe(true);
  });

  it('a burned ladder refuses new shrink trials until the burn expires', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6
    let state = run(shrunk, REGRESSED, CFG.actuationCooldown + 1); // audit fails → back to 8, burned

    // Strikes keep hammering while burned: the governor HOLDS (window resets, no trial).
    state = run(state, STALLED, CFG.actuationCooldown); // the revert's cooldown
    state = run(state, STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(8);

    // Once the burn has fully elapsed, the next strike volley may trial a shrink again.
    state = run(state, STALLED, CFG.actuationCooldown); // the hold's cooldown (burn keeps counting down)
    state = run(state, STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(6);
  });
});

describe('stepRenderGovernor — the saturation guard', () => {
  it('HOLDS workers when stalls come with an unbroken over-budget compute streak (true saturation)', () => {
    // Even the fastest band over budget every frame: the machine is genuinely timeshared. Serialising
    // the frame onto fewer starved threads makes it worse — the honest outcome is a lower frame rate.
    const state = run(initialRenderGovernor(8, CFG), SATURATED, CFG.strikesToShrink);

    expect(state.workers).toBe(8);
    expect(state.strikes).toBe(0); // the window was still reset — no runaway counter
    expect(state.cooldown).toBe(CFG.actuationCooldown);
  });

  it('still shrinks workers under BURSTY contention — sporadic hot frames break the streak', () => {
    // The contention signature (measured: p50 under budget, p95 way over): wall-times inflate in
    // bursts, never every frame. A hot/cold alternation must be ruled STRAGGLER, not saturation.
    let state = initialRenderGovernor(8, CFG);

    for (let i = 0; i < CFG.strikesToShrink; i++) {
      state = stepRenderGovernor(state, i % 2 === 0 ? SATURATED : STALLED, CFG);
    }

    expect(state.workers).toBe(6);
  });

  it('a compute streak alone (no stalls) never actuates — compute is a guard, not an actuator', () => {
    const state = run(initialRenderGovernor(8, CFG), { stallMs: 1, computeMs: 20, joinMs: 5 }, 50);

    expect(state.workers).toBe(8);
    expect(state.cooldown).toBe(0);
  });

  it('keeps the streak counting through a cooldown so post-cooldown stalls classify correctly', () => {
    // Shrink once on cold stalls, then saturate THROUGH the cooldown: the streak built during the
    // observation frames must already flag saturation when the next strikes land — no second shrink.
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    const state = run(shrunk, SATURATED, CFG.actuationCooldown + CFG.strikesToShrink);

    expect(state.workers).toBe(6);
  });
});

describe('stepRenderGovernor — growing back on sustained calm', () => {
  it('grows workers back one rung after growAfter calm frames, clearing the anchor at the top', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6

    expect(state.workers).toBe(6);
    state = run(state, CALM, CFG.actuationCooldown + CFG.growAfter);

    expect(state.workers).toBe(8);
    expect(state.anchorJoin).toBe(0); // back at full workers — the next shrink re-captures it fresh
  });

  it('a mid-ladder grow keeps the anchor — the ladder is still below full workers', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink); // audit passes → 6 → 4
    expect(state.workers).toBe(4);

    state = run(state, CALM, CFG.actuationCooldown + CFG.growAfter); // calm → grow 4 → 6

    expect(state.workers).toBe(6);
    expect(state.anchorJoin).toBeGreaterThan(0); // a deeper re-shrink still audits against full workers
  });

  it('a single strike resets the calm credit', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6

    state = settle(state); // calm credit banked during the cooldown counts (it IS calm)…
    state = stepRenderGovernor(state, STALLED, CFG); // …but one strike burns ALL of it
    expect(state.calmFrames).toBe(0);

    state = run(state, CALM, CFG.growAfter - 1); // one frame short of the grow threshold

    expect(state.workers).toBe(6);
    expect(state.calmFrames).toBe(CFG.growAfter - 1);
  });

  it('grows back even while compute runs hot — more workers mean smaller bands, never worse', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink); // 8 → 6

    state = run(
      state,
      { stallMs: 1, computeMs: 20, joinMs: 5 },
      CFG.actuationCooldown + CFG.growAfter,
    );

    expect(state.workers).toBe(8);
  });

  it('holds the calm credit at the threshold while there is nothing to grow', () => {
    const state = run(initialRenderGovernor(8, CFG), CALM, CFG.growAfter * 3);

    expect(state.workers).toBe(8);
    expect(state.calmFrames).toBe(CFG.growAfter);
  });
});
