// Contention governor. Its ONLY knob is the ACTIVE WORKER COUNT (never resolution — that buys blur, not
// cadence). Every shrink is a measured TRIAL, audited when its cooldown ends against the FULL-WORKER
// join-latency anchor (never the previous rung, so regressions can't compound) and reverted if worse — so
// the governor is never durably worse than doing nothing. Never goes below HALF the pool.

export interface RenderGovernorConfig {
  readonly stallStrikeMs: number;
  readonly strikeWindow: number;
  readonly strikesToShrink: number;
  readonly saturationComputeMs: number;
  // consecutive (not cumulative): contention inflates in bursts, only genuine load sustains a streak
  readonly saturationFrames: number;
  readonly joinAlpha: number;
  readonly revertFactor: number;
  readonly burnFrames: number;
  readonly growAfter: number;
  readonly actuationCooldown: number;
}

export const RENDER_GOVERNOR: RenderGovernorConfig = {
  stallStrikeMs: 6,
  strikeWindow: 240,
  strikesToShrink: 8,
  saturationComputeMs: 10,
  saturationFrames: 120,
  joinAlpha: 0.05,
  revertFactor: 1.2,
  burnFrames: 1800,
  growAfter: 900,
  actuationCooldown: 120,
};

export interface RenderGovernorSample {
  readonly stallMs: number; // slowest band − median band: pure scheduling noise
  readonly computeMs: number; // fastest band: the least-disturbed worker, robust true-compute estimate
  readonly joinMs: number; // slowest band: the frame's real render latency (what the audit optimises)
}

export interface RenderGovernorState {
  readonly workerLadder: readonly number[];
  readonly workerRung: number;
  readonly workers: number;
  readonly strikes: number;
  readonly windowLeft: number;
  readonly calmFrames: number;
  readonly hotFrames: number;
  readonly joinAvg: number;
  readonly anchorJoin: number; // full-worker join EWMA every shrunken rung is audited against; 0 = at full
  readonly auditPending: boolean;
  readonly burnLeft: number;
  readonly cooldown: number;
}

/** Full → ~¾ → ~½, deduplicated — never below half (the pool's CPU share scales with runnable threads). */
export function workerLadder(poolSize: number): readonly number[] {
  const full = Math.max(1, Math.floor(poolSize));
  const rungs = [full, Math.round(full * 0.75), Math.max(1, Math.round(full * 0.5))];

  return rungs.filter((n, i) => n >= 1 && rungs.indexOf(n) === i);
}

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

  // cooldown: observe only; the strike window stays FROZEN (settling frames mustn't count against it)
  if (state.cooldown > 0) {
    return { ...state, joinAvg, hotFrames, calmFrames, burnLeft, cooldown: state.cooldown - 1 };
  }

  const strikes = state.strikes + (strike ? 1 : 0);
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

  // 1 — one-shot audit of the last shrink: regressed past the FULL-WORKER anchor → revert + burn the ladder
  if (state.auditPending && joinAvg > state.anchorJoin * config.revertFactor) {
    const workerRung = state.workerRung - 1;

    return actuate({
      workerRung,
      workers: state.workerLadder[workerRung],
      anchorJoin: workerRung === 0 ? 0 : state.anchorJoin,
      burnLeft: config.burnFrames,
    });
  }

  // 2 — recurring stalls → trial-shrink, unless burned, ruled SATURATION (shrink provably loses), or floored
  if (strikes >= config.strikesToShrink) {
    const saturated = hotFrames >= config.saturationFrames;

    if (!saturated && burnLeft === 0 && state.workerRung < state.workerLadder.length - 1) {
      const workerRung = state.workerRung + 1;

      return actuate({
        workerRung,
        workers: state.workerLadder[workerRung],
        anchorJoin: state.workerRung === 0 ? joinAvg : state.anchorJoin, // leaving the top sets the anchor
        auditPending: true,
      });
    }

    // held below full → RE-ARM the audit so a bad shape keeps climbing back toward full workers
    return actuate({ auditPending: state.workerRung > 0 });
  }

  // 3 — sustained calm → grow back one rung (never audited, never burned)
  if (calmFrames >= config.growAfter && state.workerRung > 0) {
    const workerRung = state.workerRung - 1;

    return actuate({
      workerRung,
      workers: state.workerLadder[workerRung],
      anchorJoin: workerRung === 0 ? 0 : state.anchorJoin,
    });
  }

  const cappedCalm = Math.min(calmFrames, config.growAfter);
  const windowLeft = state.windowLeft - 1;
  const kept = { joinAvg, hotFrames, burnLeft, auditPending: false, calmFrames: cappedCalm };

  return windowLeft <= 0
    ? { ...state, ...kept, strikes: 0, windowLeft: config.strikeWindow }
    : { ...state, ...kept, strikes, windowLeft };
}
