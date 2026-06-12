import type { Pose } from './types';

/** The world-space wall + ceiling height (cells). The single source of truth for the game's vertical
 *  scale: walls project `VIEW_PITCH_STRETCH·WALL_HEIGHT·height/dist`, split around the horizon by the eye
 *  height, the floor + ceiling are cast to meet the wall's bottom + top, and grounded billboards anchor
 *  their feet to `floorScreenY`. The renderer re-imports these (never hardcodes them). */
export const WALL_HEIGHT = 1.4;

/** Eye height as a fraction of the wall — DOOM puts the viewpoint 41 units up a 128-unit wall, so the
 *  player is SHORT in the room and looks UP at the walls (more wall + ceiling above the horizon than floor
 *  below). 0.5 would be the old symmetric, eye-at-wall-centre view. (See eev.ee "doom-scale".) */
export const EYE_FRACTION = 41 / 128;

/** Vertical pixel exaggeration — DOOM rendered 320×200 then displayed it at 4:3, stretching everything
 *  vertically by 320/200 ÷ 4/3 = 1.2. Replicated here as a uniform vertical scale on the whole 3-D
 *  projection (walls + floor + ceiling cast) so walls read ~20 % taller, the signature "cathedral" look. */
export const VIEW_PITCH_STRETCH = 1.2;

/** Camera eye height (cells) — `EYE_FRACTION` up the wall. A wall projects with this much of it below the
 *  horizon and `WALL_HEIGHT − CAMERA_Z` above, so the floor cast (`surfaceZ = CAMERA_Z`) lands on the
 *  wall's bottom and the ceiling cast (`surfaceZ = WALL_HEIGHT − CAMERA_Z`) on its top. */
export const CAMERA_Z = EYE_FRACTION * WALL_HEIGHT;

/** The world-space anchor of one screen row's left edge plus the per-column world step. */
export interface FloorRow {
  worldX: number;
  worldY: number;
  stepX: number;
  stepY: number;
}

/**
 * lodev floor-casting for one screen row off the horizon: returns the world coordinate under the row's
 * leftmost column and the per-column step, so the renderer can march columns and sample a flat. `surfaceZ`
 * is the eye-to-surface height — the FLOOR is `CAMERA_Z` below the eye (the default), the CEILING is
 * `WALL_HEIGHT − CAMERA_Z` above it (passed explicitly); with an asymmetric eye the two are no longer
 * mirror images, so the renderer casts each with its own `surfaceZ` at the same screen distance `p`. The
 * `VIEW_PITCH_STRETCH` factor pulls the matching world distance out by 1.2 so the cast tracks the stretched
 * walls (a row sits 1.2× closer to the horizon than an unstretched view).
 */
export function floorRow(
  pose: Pose,
  fov: number,
  screenY: number,
  width: number,
  height: number,
  surfaceZ = CAMERA_Z,
): FloorRow {
  const dirX = Math.cos(pose.dir);
  const dirY = Math.sin(pose.dir);
  const planeScale = Math.tan(fov / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;
  // Edge rays at the left (cameraX = −1) and right (cameraX = +1) of the FOV.
  const rayLeftX = dirX - planeX;
  const rayLeftY = dirY - planeY;
  const rayRightX = dirX + planeX;
  const rayRightY = dirY + planeY;
  const p = screenY - height / 2; // distance off the horizon, in pixels (> 0)
  const rowDistance = (VIEW_PITCH_STRETCH * surfaceZ * height) / p;

  return {
    worldX: pose.x + rowDistance * rayLeftX,
    worldY: pose.y + rowDistance * rayLeftY,
    stepX: (rowDistance * (rayRightX - rayLeftX)) / width,
    stepY: (rowDistance * (rayRightY - rayLeftY)) / width,
  };
}

/** Screen-Y of the FLOOR (a grounded billboard's feet) at `depth` — the same stretched, eye-low projection
 *  the floor cast + wall bottoms use, so a billboard's feet sit exactly on the floor row at its distance.
 *  (Floor is at world height 0, `CAMERA_Z` below the eye → it lands below the horizon.) */
export function floorScreenY(depth: number, screenHeight: number): number {
  return screenHeight / 2 + (VIEW_PITCH_STRETCH * CAMERA_Z * screenHeight) / depth;
}

/** Screen-Y of a surface at world height `worldZ` seen from camera eye altitude `camZ`, at perpendicular
 *  `depth`. The single projection the whole engine shares: the floor (`eyeToSurface = CAMERA_Z`) reproduces
 *  `floorScreenY`; a wall top is `eyeToSurface = CAMERA_Z - WALL_HEIGHT`, its bottom `CAMERA_Z`. `eyeToSurface
 *  = camZ - worldZ` is SIGNED — a surface ABOVE the eye projects above the horizon (negative term). */
export function surfaceScreenY(eyeToSurface: number, depth: number, screenHeight: number): number {
  return screenHeight / 2 + (VIEW_PITCH_STRETCH * eyeToSurface * screenHeight) / depth;
}
