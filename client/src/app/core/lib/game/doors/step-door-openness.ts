import { DOOR_OPEN_SPEED } from './door-constants';

/**
 * Advance one animated door's openness for a frame. A player within trigger range who may open it (holds
 * the required badge — `hasCard`, or the door needs none) raises it toward fully open at DOOR_OPEN_SPEED,
 * clamped at 1. Otherwise the openness holds unchanged: an opened door is a PERMANENT unlock (it never
 * auto-closes), and a locked door approached without the badge stays shut. The shell owns the proximity
 * test (feeding `near`), the inventory (feeding `hasCard`), and the "badge requis" hint on the shut case.
 */
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
