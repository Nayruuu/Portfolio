import type { Vertex } from './types';

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly angle: number; // radians, 0 = +x
  readonly z: number; // eye height
  readonly pitch?: number; // horizon y-shear, not a rotation: + up, − down (~[−0.85, 0.85])
}

// forward = distance along the view axis (perpendicular, fisheye-free); side = left positive.
export interface CamPoint {
  readonly forward: number;
  readonly side: number;
}

export function focalFor(width: number, fov: number): number {
  return width / 2 / Math.tan(fov / 2);
}

export function toCamera(camera: Camera, point: Vertex): CamPoint {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const cos = Math.cos(camera.angle);
  const sin = Math.sin(camera.angle);

  return { forward: dx * cos + dy * sin, side: -dx * sin + dy * cos };
}

// Requires forward > 0.
export function projectColumn(point: CamPoint, width: number, focal: number): number {
  return width / 2 - (point.side / point.forward) * focal;
}

// downMax/upMax are positive magnitudes.
export function clampPitch(pitch: number, downMax: number, upMax: number): number {
  return Math.max(-downMax, Math.min(upMax, pitch));
}

export function projectRow(
  z: number,
  forward: number,
  camera: Camera,
  height: number,
  focal: number,
): number {
  return height / 2 - ((z - camera.z) / forward) * focal;
}
