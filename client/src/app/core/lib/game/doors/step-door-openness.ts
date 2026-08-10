import { DOOR_OPEN_SPEED } from '../game-tuning';

// Holds openness unchanged when not opening — an opened door is a PERMANENT unlock (never auto-closes).
export function stepDoorOpenness(
  openness: number,
  dt: number,
  near: boolean,
  hasCard: boolean,
): number {
  if (near && hasCard) {
    return Math.min(1, openness + DOOR_OPEN_SPEED * dt);
  }

  return openness;
}
