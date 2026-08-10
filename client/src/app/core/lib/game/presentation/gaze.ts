import type { Gaze } from './doom-hud';

/**
 * Aim the DOOM-guy HUD face from the player's turning: a signed turn rate (rad/s, + = turning right) is
 * smoothed into an exponential moving average ({@link smoothTurnRate}) so the glance holds steady through a
 * turn instead of flickering per repaint, then mapped to a discrete {@link Gaze} column ({@link gazeForTurn}).
 * Pure helpers over the game presentation types — the per-frame state (the previous angle + the EMA) lives in the caller.
 */

/** Turning speed (rad/s) below which the face looks dead ahead; at/above it the face glances toward the turn. */
const GAZE_TURN_RATE = 0.6;
/** Turning speed (rad/s) at/above which the face throws the extreme-glance (outer) column. */
const GAZE_FAR_TURN_RATE = 2.5;
/** EMA convergence rate (per second) smoothing the raw per-frame turn rate — a steady gaze mid-turn. */
const TURN_SMOOTH_RATE = 8;

/** Advance the exponential moving average of the signed turn rate one frame (rad/s, + = turning right); the
 *  blend factor is clamped to 1 so a long `dt` snaps to the target instead of overshooting. */
export function smoothTurnRate(previous: number, turnRate: number, dt: number): number {
  return previous + (turnRate - previous) * Math.min(1, TURN_SMOOTH_RATE * dt);
}

/** Map a signed turn rate (rad/s, + = turning right) to a HUD gaze: centre below GAZE_TURN_RATE, then a
 *  near or extreme glance toward the turn — the classic DOOM face that looks where you swing. */
export function gazeForTurn(turnRate: number): Gaze {
  const speed = Math.abs(turnRate);

  if (speed < GAZE_TURN_RATE) {
    return 0;
  }
  const far = speed >= GAZE_FAR_TURN_RATE ? 2 : 1;

  return (turnRate > 0 ? far : -far) as Gaze;
}
