import { SLIDE_OPEN_SPEED } from '../game-tuning';

// Proximity-driven AUTO-CLOSING panel: eases toward open while near, back toward shut when not.
export function stepSlideOpenness(openness: number, dt: number, near: boolean): number {
  const step = SLIDE_OPEN_SPEED * dt;
  const target = near ? 1 : 0;

  return target > openness ? Math.min(target, openness + step) : Math.max(target, openness - step);
}
