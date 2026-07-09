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
const SATURATED: RenderGovernorSample = { stallMs: 25, computeMs: 20, joinMs: 12 };
const REGRESSED: RenderGovernorSample = { stallMs: 25, computeMs: 4, joinMs: 40 };
const DRIFTING: RenderGovernorSample = { stallMs: 25, computeMs: 4, joinMs: 14 };

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
    expect(state.auditPending).toBe(true);
    expect(state.anchorJoin).toBeGreaterThan(0);
  });

  it('does NOT shrink on fewer strikes than the threshold', () => {
    const state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink - 1);

    expect(state.workers).toBe(8);
    expect(state.strikes).toBe(CFG.strikesToShrink - 1);
  });

  it('forgets strikes when the window expires — stalls must RECUR to matter', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, 2);

    state = run(state, CALM, CFG.strikeWindow);
    state = run(state, STALLED, 2);

    expect(state.workers).toBe(8);
  });

  it('ignores strikes during the post-actuation cooldown, then counts fresh ones', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    const cooled = run(shrunk, STALLED, CFG.actuationCooldown);

    expect(cooled.workers).toBe(6);
    expect(cooled.strikes).toBe(0);

    expect(run(cooled, STALLED, CFG.strikesToShrink).workers).toBe(4);
  });

  it('walks the ladder down to its half-pool floor under sustained stalls, then holds', () => {
    let state = initialRenderGovernor(8, CFG);

    for (const expected of [6, 4]) {
      state = run(settle(state), STALLED, CFG.strikesToShrink);
      expect(state.workers).toBe(expected);
    }

    state = run(settle(state), STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(4);
  });

  it('holds (window reset, no change) at the bottom worker rung', () => {
    let state = initialRenderGovernor(1, CFG);

    state = run(state, STALLED, CFG.strikesToShrink);

    expect(state.workers).toBe(1);
    expect(state.strikes).toBe(0);
    expect(state.cooldown).toBe(CFG.actuationCooldown);
  });
});

describe('stepRenderGovernor — the shrink audit', () => {
  it('REVERTS a shrink whose measured join latency regressed, and burns the ladder', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    const state = run(shrunk, REGRESSED, CFG.actuationCooldown + 1);

    expect(state.workers).toBe(8);
    expect(state.burnLeft).toBe(CFG.burnFrames);
    expect(state.cooldown).toBe(CFG.actuationCooldown);
    expect(state.auditPending).toBe(false);
    expect(state.anchorJoin).toBe(0);
  });

  it('KEEPS a shrink whose join latency held, and closes the audit', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    const state = run(shrunk, STALLED, CFG.actuationCooldown + 1);

    expect(state.workers).toBe(6);
    expect(state.auditPending).toBe(false);
    expect(state.anchorJoin).toBeGreaterThan(0);
    expect(state.burnLeft).toBe(0);
  });

  it('audits every rung against the FULL-WORKER anchor — slight per-rung drifts cannot compound', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink);
    expect(state.workers).toBe(4);

    state = run(state, DRIFTING, CFG.actuationCooldown + 1);

    expect(state.workers).toBe(6);
    expect(state.burnLeft).toBe(CFG.burnFrames);
  });

  it('re-audits a held shrunken rung against the anchor — persisting regressions climb back to full', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink);
    expect(state.workers).toBe(4);

    let sawFull = false;

    for (let i = 0; i < 60 && !sawFull; i++) {
      state = stepRenderGovernor(state, REGRESSED, CFG);
      sawFull = state.workers === 8;
    }
    expect(sawFull).toBe(true);
  });

  it('a burned ladder refuses new shrink trials until the burn expires', () => {
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    let state = run(shrunk, REGRESSED, CFG.actuationCooldown + 1);

    state = run(state, STALLED, CFG.actuationCooldown);
    state = run(state, STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(8);

    state = run(state, STALLED, CFG.actuationCooldown);
    state = run(state, STALLED, CFG.strikesToShrink);
    expect(state.workers).toBe(6);
  });
});

describe('stepRenderGovernor — the saturation guard', () => {
  it('HOLDS workers when stalls come with an unbroken over-budget compute streak (true saturation)', () => {
    const state = run(initialRenderGovernor(8, CFG), SATURATED, CFG.strikesToShrink);

    expect(state.workers).toBe(8);
    expect(state.strikes).toBe(0);
    expect(state.cooldown).toBe(CFG.actuationCooldown);
  });

  it('still shrinks workers under BURSTY contention — sporadic hot frames break the streak', () => {
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
    const shrunk = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);
    const state = run(shrunk, SATURATED, CFG.actuationCooldown + CFG.strikesToShrink);

    expect(state.workers).toBe(6);
  });
});

describe('stepRenderGovernor — growing back on sustained calm', () => {
  it('grows workers back one rung after growAfter calm frames, clearing the anchor at the top', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    expect(state.workers).toBe(6);
    state = run(state, CALM, CFG.actuationCooldown + CFG.growAfter);

    expect(state.workers).toBe(8);
    expect(state.anchorJoin).toBe(0);
  });

  it('a mid-ladder grow keeps the anchor — the ladder is still below full workers', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    state = run(state, STALLED, CFG.actuationCooldown + CFG.strikesToShrink);
    expect(state.workers).toBe(4);

    state = run(state, CALM, CFG.actuationCooldown + CFG.growAfter);

    expect(state.workers).toBe(6);
    expect(state.anchorJoin).toBeGreaterThan(0);
  });

  it('a single strike resets the calm credit', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

    state = settle(state);
    state = stepRenderGovernor(state, STALLED, CFG);
    expect(state.calmFrames).toBe(0);

    state = run(state, CALM, CFG.growAfter - 1);

    expect(state.workers).toBe(6);
    expect(state.calmFrames).toBe(CFG.growAfter - 1);
  });

  it('grows back even while compute runs hot — more workers mean smaller bands, never worse', () => {
    let state = run(initialRenderGovernor(8, CFG), STALLED, CFG.strikesToShrink);

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
