import { describe, expect, it, vi } from 'vitest';
import { buildBsp } from '../../bsp-engine';
import type { MapSource, SideDef } from '../../bsp-engine';
import { movementDelta } from '../controls';
import { EYE_HEIGHT, type MutableCamera } from './zone-runtime';
import { PlayerMotion, type MotionWorld, type PlayerMotionHooks } from './player-motion';

const sideTex = (sector: number): SideDef => ({
  sector,
  xOffset: 0,
  yOffset: 0,
  upperTex: 'M',
  lowerTex: 'M',
  middleTex: 'M',
});

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
    { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
    { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 },
  ],
  linedefs: [
    { v1: 0, v2: 1, front: sideTex(0), back: null },
    { v1: 1, v2: 2, front: sideTex(0), back: null },
    { v1: 2, v2: 4, front: sideTex(1), back: null },
    { v1: 4, v2: 5, front: sideTex(1), back: null },
    { v1: 5, v2: 3, front: sideTex(1), back: null },
    { v1: 3, v2: 0, front: sideTex(0), back: null },
    { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) },
  ],
  things: [],
});

function motionWorld(eastFloor: number, eastCeil = 5): MotionWorld {
  return { map: buildBsp(mapWith(eastFloor, eastCeil)), slides: [], obstacles: [] };
}

function cameraAt(x: number, y: number, angle = 0): MutableCamera {
  return { x, y, angle, z: EYE_HEIGHT, pitch: 0 };
}

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

    expect(camera.x).toBeCloseTo(3.4, 5);
    expect(camera.y).toBeCloseTo(4, 5);
    expect(camera.z).toBeCloseTo(EYE_HEIGHT, 5);
  });

  it('advances the walk-bob only while moving', () => {
    const still = testMove({ camera: cameraAt(3, 4), eastFloor: 0, forward: 0, dt: 0.1 });
    const walking = testMove({ camera: cameraAt(3, 4), eastFloor: 0, forward: 1, dt: 0.1 });

    expect(still.motion.bob).toBe(0);
    expect(walking.motion.bob).toBeCloseTo(0.9, 5);
  });

  it('is blocked by a solid wall — parks a radius off, never crosses it', () => {
    const { camera } = testMove({
      camera: cameraAt(0.5, 4, Math.PI),
      eastFloor: 0,
      forward: 1,
      dt: 0.1,
    });

    expect(camera.x).toBeGreaterThan(0);
    expect(camera.x).toBeCloseTo(0.3, 1);
  });

  it('steps up a small ledge (≤ STEP_MAX) and eases the eye onto it', () => {
    const { camera } = testMove({ camera: cameraAt(5.9, 4), eastFloor: 0.5, forward: 1, dt: 0.05 });

    expect(camera.x).toBeGreaterThan(6);
    expect(camera.z).toBeCloseTo(EYE_HEIGHT + 0.5 * 0.6, 5);
    expect(camera.z).toBeLessThan(0.5 + EYE_HEIGHT);
  });

  it('commits the collided move + walk-bob + eye ease, then does NOT mantle a walkable step', () => {
    const { motion } = testMove({ camera: cameraAt(5.9, 4), eastFloor: 0.5, forward: 1, dt: 0.05 });

    expect(motion.isMantling()).toBe(false);
  });
});

describe('PlayerMotion.stepPlayerMotion — the climb probe', () => {
  it('arms an auto-mantle for a too-tall-but-climbable ledge in (STEP_MAX, CLIMB_MAX]', () => {
    const { motion, camera } = harness({
      camera: cameraAt(5.5, 4),
      world: motionWorld(1.5),
      forward: 1,
    });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(true);
    const mantle = motion.mantle;

    expect(mantle).not.toBeNull();
    expect(mantle?.startZ).toBe(0);
    expect(mantle?.targetZ).toBe(1.5);
    expect(mantle?.progress).toBe(0);
    expect(mantle?.dirX).toBeCloseTo(1, 5);
    expect(mantle?.dirY).toBeCloseTo(0, 5);
    expect(camera.x).toBeLessThan(6);
  });

  it('does NOT mantle a rise taller than CLIMB_MAX (it stays a solid wall)', () => {
    const { motion } = harness({ camera: cameraAt(5.5, 4), world: motionWorld(3), forward: 1 });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(false);
  });

  it('does NOT probe for a climb while walking backward', () => {
    const { motion } = harness({ camera: cameraAt(5.5, 4), world: motionWorld(1.5), forward: -1 });

    motion.stepPlayerMotion(0.1);

    expect(motion.isMantling()).toBe(false);
  });
});

describe('PlayerMotion.stepMantle', () => {
  function armedMantle() {
    return harness({ camera: cameraAt(5.5, 4), world: motionWorld(1.5), forward: 1 });
  }

  it('hoists the eye from startZ toward targetZ mid-vault, gliding forward along the heading', () => {
    const { motion, camera } = armedMantle();

    motion.stepPlayerMotion(0.1);
    const parkedX = camera.x;

    motion.stepMantle(0.2);

    expect(motion.isMantling()).toBe(true);
    expect(motion.mantle?.progress).toBeCloseTo(0.5, 5);
    expect(camera.z).toBeCloseTo(0.75 + EYE_HEIGHT, 5);
    expect(camera.x).toBeCloseTo(parkedX + 0.25, 5);
  });

  it('completes over MANTLE_DURATION, snapping the eye onto the ledge and clearing the state', () => {
    const { motion, camera } = armedMantle();

    motion.stepPlayerMotion(0.1);
    const parkedX = camera.x;

    motion.stepMantle(0.2);
    motion.stepMantle(0.2);

    expect(motion.isMantling()).toBe(false);
    expect(motion.mantle).toBeNull();
    expect(camera.z).toBeCloseTo(1.5 + EYE_HEIGHT, 5);
    expect(camera.x).toBeCloseTo(parkedX + 0.5, 5);
  });

  it('is a no-op when not mantling', () => {
    const { motion, camera } = harness({ camera: cameraAt(3, 4), world: motionWorld(0) });
    const before = { ...camera };

    motion.stepMantle(0.2);

    expect(camera).toEqual(before);
    expect(motion.isMantling()).toBe(false);
  });

  it('reset() aborts an armed mantle', () => {
    const { motion } = harness({ camera: cameraAt(5.5, 4), world: motionWorld(1.5), forward: 1 });

    motion.stepPlayerMotion(0.1);
    expect(motion.isMantling()).toBe(true);

    motion.reset();

    expect(motion.isMantling()).toBe(false);
    expect(motion.mantle).toBeNull();
  });
});

describe('PlayerMotion — the seamless crossing early-return', () => {
  it('performs the crossSeam swap and early-returns WITHOUT committing the camera or probing a climb', () => {
    const camera = cameraAt(5.5, 4);
    const { motion, crossSeam } = harness({
      camera,
      world: motionWorld(1.5),
      forward: 1,
      crossSeam: () => true,
    });
    const before = { ...camera };

    motion.stepPlayerMotion(0.1);

    expect(crossSeam).toHaveBeenCalledTimes(1);
    const [fromX, fromY, toX, toY] = crossSeam.mock.calls[0];

    expect(fromX).toBe(before.x);
    expect(fromY).toBe(before.y);
    expect(toX).toBeGreaterThan(before.x);
    expect(toY).toBeCloseTo(before.y, 5);
    expect(camera.x).toBe(before.x);
    expect(camera.y).toBe(before.y);
    expect(camera.z).toBe(before.z);
    expect(motion.isMantling()).toBe(false);
  });

  it('commits the move normally when the crossing check is negative', () => {
    const camera = cameraAt(3, 4);
    const { motion, crossSeam } = harness({ camera, world: motionWorld(0), forward: 1 });

    motion.stepPlayerMotion(0.1);

    expect(crossSeam).toHaveBeenCalledTimes(1);
    expect(camera.x).toBeCloseTo(3.4, 5);
    expect(motion.isMantling()).toBe(false);
  });
});

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
