import { clampPitch } from '../../bsp-engine';
import { PITCH_DOWN_MAX, PITCH_UP_MAX } from '../game-tuning';

export interface LookOrientation {
  readonly angle: number;
  readonly pitch: number;
}

// Pointer/touch look: a screen-space drag delta (px) turns the heading and tilts the pitch, the pitch
// clamped to the look up/down limits. `sens` is per-device — MOUSE_SENS for a locked mouse, TOUCH_LOOK_SENS
// for a thumb drag. Dragging right turns right; dragging down looks down. Shared by the mouse + touch paths.
export function applyLook(
  angle: number,
  pitch: number,
  dx: number,
  dy: number,
  sens: number,
): LookOrientation {
  return {
    angle: angle - dx * sens,
    pitch: clampPitch(pitch - dy * sens, PITCH_DOWN_MAX, PITCH_UP_MAX),
  };
}
