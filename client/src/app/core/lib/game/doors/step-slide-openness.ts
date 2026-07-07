import { SLIDE_OPEN_SPEED } from './door-constants';

/**
 * Advance one sliding-glass panel's openness for a frame — proximity-driven and AUTO-CLOSING (a real
 * automatic door). It eases toward fully open (1) at SLIDE_OPEN_SPEED while the player is `near`, and back
 * toward shut (0) when they leave, never overshooting the target either way. The shell owns the proximity
 * test (feeding `near`) and writes the result into its per-linedef slide array (read by render + physics).
 */
export function stepSlideOpenness(openness: number, dt: number, near: boolean): number {
  const step = SLIDE_OPEN_SPEED * dt;
  const target = near ? 1 : 0;

  return target > openness ? Math.min(target, openness + step) : Math.max(target, openness - step);
}
