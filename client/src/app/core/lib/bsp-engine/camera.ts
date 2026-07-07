import type { Vertex } from './types';

/**
 * The viewpoint + the perspective projection math for the software renderer. Pure: world → camera space
 * → screen. The map plane is (x, y); the third axis is height `z`. The camera looks along `angle` (0 =
 * +x), with eye height `z`.
 *
 * Camera space is `forward` (distance along the view axis — the perpendicular distance that keeps walls
 * fisheye-free) and `side` (left of the view is positive). Screen is `width`×`height` pixels with the
 * horizon at `height/2`; a single `focal` length (in pixels, derived from the horizontal FOV) drives both
 * the horizontal and vertical projection.
 */

/** The viewpoint. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly angle: number; // radians, 0 = looking +x
  readonly z: number; // eye height
  readonly pitch?: number; // vertical look via horizon y-shear: + looks up, − looks down (~[−0.85, 0.85])
}

/** A point expressed relative to the camera: distance ahead + signed sideways offset (left positive). */
export interface CamPoint {
  readonly forward: number;
  readonly side: number;
}

/** The focal length in pixels for a screen `width` and horizontal field of view `fov` (radians). */
export function focalFor(width: number, fov: number): number {
  return width / 2 / Math.tan(fov / 2);
}

/** Transform a world point into camera space (forward along the view axis, side to the left). */
export function toCamera(camera: Camera, point: Vertex): CamPoint {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const cos = Math.cos(camera.angle);
  const sin = Math.sin(camera.angle);

  return { forward: dx * cos + dy * sin, side: -dx * sin + dy * cos };
}

/** Project a camera-space point to its screen column (x). Requires `forward > 0`. */
export function projectColumn(point: CamPoint, width: number, focal: number): number {
  return width / 2 - (point.side / point.forward) * focal;
}

/**
 * Clamp a look pitch to its vertical range. The pitch is a horizon y-shear (not a true rotation): `+` looks
 * up to `upMax`, `−` looks down to `−downMax` (both passed as positive magnitudes — the down limit runs
 * deeper than up so you can aim down at enemies below a platform).
 */
export function clampPitch(pitch: number, downMax: number, upMax: number): number {
  return Math.max(-downMax, Math.min(upMax, pitch));
}

/** Project a world height `z` seen at camera distance `forward` to its screen row (y). */
export function projectRow(
  z: number,
  forward: number,
  camera: Camera,
  height: number,
  focal: number,
): number {
  return height / 2 - ((z - camera.z) / forward) * focal;
}
