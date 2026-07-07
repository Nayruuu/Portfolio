/**
 * Interpolate an animated door sector's live ceiling height from its openness: `closedCeilZ` (shut → the
 * ceiling meets the floor → no headroom → physics blocks it) at 0, up to `openCeilZ` (the authored open
 * ceiling) at 1. The shell stamps the result onto the mutable sector each frame, so a raised ceiling both
 * shows AND becomes passable.
 */
export function doorCeilZ(closedCeilZ: number, openCeilZ: number, openness: number): number {
  return closedCeilZ + (openCeilZ - closedCeilZ) * openness;
}
