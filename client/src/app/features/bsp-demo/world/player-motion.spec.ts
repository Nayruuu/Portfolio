import { describe, expect, it, vi } from 'vitest';
import { buildBsp } from '../../../core/lib/bsp-engine';
import type { MapSource, SideDef } from '../../../core/lib/bsp-engine';
import { movementDelta } from '../../../core/lib';
import { EYE_HEIGHT, type MutableCamera } from './zone-runtime';
import { PlayerMotion, type MotionWorld, type PlayerMotionHooks } from './player-motion';

/**
 * The player-motion subsystem's real net — the Playwright specs shoot the portfolio pages, never the game
 * interior, so the collided move + step-up + auto-mantle physics is characterized ONLY here. Each test wires a
 * real {@link PlayerMotion} over a shared camera and a REAL compiled-BSP fixture world (built through
 * {@link buildBsp}, so the collision/step-up/climb-probe run the true engine, not a stub), driving the exact
 * two tick entry points the coordinator calls (`stepPlayerMotion` / `stepMantle`) and asserting the camera
 * mutation + the mantle latch. The `crossSeam` hook is a spy so the seamless mid-tick early-return is observed,
 * never faked.
 */

const sideTex = (sector: number): SideDef => ({
  sector,
  xOffset: 0,
  yOffset: 0,
  upperTex: 'M',
  lowerTex: 'M',
  middleTex: 'M',
});

// A 12×8 room split at x=6: WEST sector (floor 0) | a two-sided divider | EAST sector (floor `eastFloor`).
// (The same shape the engine's own physics.spec uses, so the collision/climb geometry is a known quantity.)
const mapWith = (eastFloor: number, eastCeil = 5): MapSource => ({
  vertices: [
    { x: 0, y: 0 },
    { x: 0, y: 8 },
    { x: 6, y: 8 },
    { x: 6, y: 0 },
    { x: 12, y: 8 },
    { x: 12, y: 0 },
  ],
  sectors: [
    { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 }, // 0 WEST
    { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 }, // 1 EAST
  ],
  linedefs: [
    { v1: 0, v2: 1, front: sideTex(0), back: null }, // outer walls (one-sided)
    { v1: 1, v2: 2, front: sideTex(0), back: null },
    { v1: 2, v2: 4, front: sideTex(1), back: null },
    { v1: 4, v2: 5, front: sideTex(1), back: null },
    { v1: 5, v2: 3, front: sideTex(1), back: null },
    { v1: 3, v2: 0, front: sideTex(0), back: null },
    { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) }, // the divider portal
  ],
  things: [],
});

/** A live world over one fixture map — the {@link MotionWorld} the runtime reads (no slides, no obstacles). */
function motionWorld(eastFloor: number, eastCeil = 5): MotionWorld {
  return { map: buildBsp(mapWith(eastFloor, eastCeil)), slides: [], obstacles: [] };
}

/** A camera seated at `(x,y)` on floor 0, facing `angle` (0 = +x), the eye at spawn height. */
function cameraAt(x: number, y: number, angle = 0): MutableCamera {
  return { x, y, angle, z: EYE_HEIGHT, pitch: 0 };
}

/** Wire a {@link PlayerMotion} over a fixture, with `forward`/`strafe` axes fixed and a spy `crossSeam`.
 *  `movementWant` delegates to the real core {@link movementDelta} — the true want-vector the input controller
 *  would produce — so only the seam decision is a test double. Returns the motion + its camera + the spy. */
function harness(options: {
  camera: MutableCamera;
  world: MotionWorld;
  forward?: number;
  strafe?: number;
  crossSeam?: PlayerMotionHooks['crossSeam'];
}) {
  const { camera, world, forward = 0, strafe = 0 } = options;
  const crossSeam = vi.fn(options.crossSeam ?? (() => false));
  const motion = new PlayerMotion({
    camera,
    world: () => world,
    movementAxes: () => ({ forward, strafe }),
    movementWant: (angle, fwd, str, reach) => movementDelta(angle, fwd, str, reach),
    crossSeam,
  });

  return { motion, camera, crossSeam };
}

describe('PlayerMotion.stepPlayerMotion', () => {
  it('advances the camera by ~speed·dt along the facing across open floor', () => {
    const { camera } = testMove({ camera: cameraAt(3, 4), eastFloor: 0, forward: 1, dt: 0.1 });

    expect(camera.x).toBeCloseTo(3.4, 5); // MOVE_SPEED 4 × dt 0.1 = 0.4 forward (+x)
    expect(camera.y).toBeCloseTo(4, 5); // no strafe, no drift off-axis
    expect(camera.z).toBeCloseTo(EYE_HEIGHT, 5); // flat floor 0 → the eye ease is a no-op
  });

  it('advances the walk-bob only while moving', () => {
    const still = testMove({ camera: cameraAt(3, 4), eastFloor: 0, forward: 0, dt: 0.1 });
    const walking = testMove({ camera: cameraAt(3, 4), eastFloor: 0, forward: 1, dt: 0.1 });

    expect(still.motion.bob).toBe(0); // standing still never advances the bob phase
    expect(walking.motion.bob).toBeCloseTo(0.9, 5); // dt 0.1 × 9
  });

  it('is blocked by a solid wall — parks a radius off, never crosses it', () => {
    // Charge the west wall (x=0) head-on: PLAYER_RADIUS 0.3 stops the eye a radius off it.
    const { camera } = testMove({
      camera: cameraAt(0.5, 4, Math.PI),
      eastFloor: 0,
      forward: 1,
      dt: 0.1,
    });

    expect(camera.x).toBeGreaterThan(0); // never crossed the wall
    expect(camera.x).toBeCloseTo(0.3, 1); // parked a radius off it (target would be 0.1)
  });

  it('steps up a small ledge (≤ STEP_MAX) and eases the eye onto it', () => {
    // EAST floor 0.5 is a walkable step (< STEP_MAX 1.1): crossing the divider raises the floor under us.
    // dt 0.05 keeps the eye-ease factor (12·dt = 0.6) below 1, so the eye rises PART-way — a smooth ease.
    const { camera } = testMove({ camera: cameraAt(5.9, 4), eastFloor: 0.5, forward: 1, dt: 0.05 });

    expect(camera.x).toBeGreaterThan(6); // crossed the divider onto the step (not blocked)
    expect(camera.z).toBeCloseTo(EYE_HEIGHT + 0.5 * 0.6, 5); // eased 60% toward 0.5 + EYE_HEIGHT
    expect(camera.z).toBeLessThan(0.5 + EYE_HEIGHT); // …only part-way (a smooth ease, not a jump)
  });

  it('commits the collided move + walk-bob + eye ease, then does NOT mantle a walkable step', () => {
    const { motion } = testMove({ camera: cameraAt(5.9, 4), eastFloor: 0.5, forward: 1, dt: 0.05 });

    expect(motion.isMantling()).toBe(false); // a ≤ STEP_MAX rise was walked up, never vaulted
  });
});

describe('PlayerMotion.stepPlayerMotion — the climb probe', () => {
  it('arms an auto-mantle for a too-tall-but-climbable ledge in (STEP_MAX, CLIMB_MAX]', () => {
    // EAST floor 1.5: rise 1.5 is > STEP_MAX 1.1 (movePlayer blocks a radius off the divider) and ≤ CLIMB_MAX
    // 2.4 with headroom (ceil 5 − 1.5 = 3.5) — the forward probe classifies it as a vaultable ledge.
    const { motion, camera } = harness({
      camera: cameraAt(5.5, 4),
      world: motionWorld(1.5),
      forward: 1,
    });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(true);
    const mantle = motion.mantle;

    expect(mantle).not.toBeNull();
    expect(mantle?.startZ).toBe(0); // launched from the west floor
    expect(mantle?.targetZ).toBe(1.5); // hoisting up to the east ledge
    expect(mantle?.progress).toBe(0); // freshly armed
    expect(mantle?.dirX).toBeCloseTo(1, 5); // captured heading = +x
    expect(mantle?.dirY).toBeCloseTo(0, 5);
    expect(camera.x).toBeLessThan(6); // still parked west of the divider (the hoist glides it over)
  });

  it('does NOT mantle a rise taller than CLIMB_MAX (it stays a solid wall)', () => {
    const { motion } = harness({ camera: cameraAt(5.5, 4), world: motionWorld(3), forward: 1 });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(false); // rise 3 > CLIMB_MAX 2.4 — no vault
  });

  it('does NOT probe for a climb while walking backward', () => {
    // Facing the ledge but pressing BACK (forward −1): the climb probe only fires on a forward push.
    const { motion } = harness({ camera: cameraAt(5.5, 4), world: motionWorld(1.5), forward: -1 });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(false);
  });
});

describe('PlayerMotion.stepMantle', () => {
  /** Arm a real mantle (WEST floor 0 → EAST ledge 1.5) by driving the climb probe, then return it mid-vault. */
  function armedMantle() {
    return harness({ camera: cameraAt(5.5, 4), world: motionWorld(1.5), forward: 1 });
  }

  it('hoists the eye from startZ toward targetZ mid-vault, gliding forward along the heading', () => {
    const { motion, camera } = armedMantle();

    motion.stepPlayerMotion(0.1); // arm it
    const parkedX = camera.x;

    motion.stepMantle(0.2); // half of MANTLE_DURATION (0.4)

    expect(motion.isMantling()).toBe(true); // still vaulting
    expect(motion.mantle?.progress).toBeCloseTo(0.5, 5);
    expect(camera.z).toBeCloseTo(0.75 + EYE_HEIGHT, 5); // lerp: 0 + (1.5−0)·0.5 + EYE_HEIGHT
    expect(camera.x).toBeCloseTo(parkedX + 0.25, 5); // glide: CLIMB_VAULT_ADVANCE 0.5 × 0.5
  });

  it('completes over MANTLE_DURATION, snapping the eye onto the ledge and clearing the state', () => {
    const { motion, camera } = armedMantle();

    motion.stepPlayerMotion(0.1); // arm it
    const parkedX = camera.x;

    motion.stepMantle(0.2);
    motion.stepMantle(0.2); // progress passes 1.0 → the vault completes this frame

    expect(motion.isMantling()).toBe(false); // landed
    expect(motion.mantle).toBeNull();
    expect(camera.z).toBeCloseTo(1.5 + EYE_HEIGHT, 5); // eye snapped exactly onto the ledge
    expect(camera.x).toBeCloseTo(parkedX + 0.5, 5); // glided the full CLIMB_VAULT_ADVANCE forward
  });

  it('is a no-op when not mantling', () => {
    const { motion, camera } = harness({ camera: cameraAt(3, 4), world: motionWorld(0) });
    const before = { ...camera };

    motion.stepMantle(0.2);

    expect(camera).toEqual(before);
    expect(motion.isMantling()).toBe(false);
  });
});

describe('PlayerMotion — the seamless crossing early-return', () => {
  it('performs the crossSeam swap and early-returns WITHOUT committing the camera or probing a climb', () => {
    const camera = cameraAt(5.5, 4);
    const { motion, crossSeam } = harness({
      camera,
      world: motionWorld(1.5), // a ledge is right ahead — proving the early-return skips the climb probe too
      forward: 1,
      crossSeam: () => true, // the move stepped over a passable seam → the zone swapped under us
    });
    const before = { ...camera };

    motion.stepPlayerMotion(0.1);

    // crossSeam is fed the ORIGINAL position and the collided destination (fromX,fromY,toX,toY).
    expect(crossSeam).toHaveBeenCalledTimes(1);
    const [fromX, fromY, toX, toY] = crossSeam.mock.calls[0];

    expect(fromX).toBe(before.x);
    expect(fromY).toBe(before.y);
    expect(toX).toBeGreaterThan(before.x); // the collided move that triggered the crossing
    expect(toY).toBeCloseTo(before.y, 5);
    // The world swapped; the view must NOT jump — the camera keeps its pre-move pose and no mantle armed.
    expect(camera.x).toBe(before.x);
    expect(camera.y).toBe(before.y);
    expect(camera.z).toBe(before.z);
    expect(motion.isMantling()).toBe(false);
  });

  it('commits the move normally when the crossing check is negative', () => {
    const camera = cameraAt(3, 4);
    const { motion, crossSeam } = harness({ camera, world: motionWorld(0), forward: 1 });

    motion.stepPlayerMotion(0.1);

    expect(crossSeam).toHaveBeenCalledTimes(1); // the check ran on the collided move
    expect(camera.x).toBeCloseTo(3.4, 5); // …and, negative, the camera committed as usual
    expect(motion.isMantling()).toBe(false);
  });
});

/** Drive one `stepPlayerMotion` tick over a fresh fixture and hand back the motion + its camera. */
function testMove(options: {
  camera: MutableCamera;
  eastFloor: number;
  forward?: number;
  strafe?: number;
  dt: number;
}) {
  const { camera, motion } = harness({
    camera: options.camera,
    world: motionWorld(options.eastFloor),
    forward: options.forward,
    strafe: options.strafe,
  });

  motion.stepPlayerMotion(options.dt);

  return { motion, camera };
}
