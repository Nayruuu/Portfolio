// core/lib/game/doors/door-constants — pure door tuning constants shared by the door RULE kernels and the
// game shell (the shell reads the trigger radii for its proximity tests; the kernels use the open speeds).

/** Openness units/second an animated door raises (≈0.45s for a door to fully open). */
export const DOOR_OPEN_SPEED = 2.2;

/** Approach this close (world units) to a door's trigger point to start it opening. */
export const DOOR_TRIGGER_RADIUS = 2.4;

/** Sliding-glass panel openness units/second (a snappy automatic door). */
export const SLIDE_OPEN_SPEED = 4;

/** An automatic sliding door senses the player within this radius (world units) — then it stays open. */
export const SLIDE_TRIGGER_RADIUS = 4;
