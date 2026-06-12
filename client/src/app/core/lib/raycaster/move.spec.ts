import { describe, it, expect } from 'vitest';
import { move } from './move';
import { SAMPLE_LEVEL, isWall } from './game-map';
import type { GameMap } from './game-map';
import type { MoveIntent, Pose } from './types';

const SPEED = 3;
const still: MoveIntent = { forward: 0, strafe: 0, look: 0, fire: false, reload: false };

describe('move', () => {
  it('a still intent leaves the pose exactly put (with z snapped to the flat floor)', () => {
    const pose: Pose = { x: 2.5, y: 3.5, z: 0, dir: 0.7 };

    expect(move(pose, still, SAMPLE_LEVEL, 0.1, SPEED)).toEqual(pose);
  });

  it('keeps z on the floor under the player — a flat map (no sectors) → 0', () => {
    const pose: Pose = { x: 1.5, y: 1.5, z: 0, dir: 0 };

    const moved = move(pose, { ...still, forward: 1 }, SAMPLE_LEVEL, 0.1, SPEED);

    expect(moved.z).toBe(0); // floorZAt default on a sector-less map
  });

  it('advances forward along the facing direction', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 }; // +x
    const next = move(pose, { ...still, forward: 1 }, SAMPLE_LEVEL, 0.1, SPEED);

    expect(next.x).toBeGreaterThan(1.5);
    expect(next.y).toBeCloseTo(1.5, 5);
  });

  it('does not pass through a wall (blocked axis stops)', () => {
    const pose: Pose = { x: 1.3, y: 1.5, dir: Math.PI }; // facing -x, wall at x=0
    const next = move(pose, { ...still, forward: 1 }, SAMPLE_LEVEL, 1, SPEED);

    expect(next.x).toBeGreaterThanOrEqual(1.0); // stayed out of the x=0 wall
  });

  it('slides along a wall: blocked on x still moves on y', () => {
    // At x≈1.25 facing -x, pushing forward into the west wall while also strafing
    // should leave x pinned but y free to change.
    const pose: Pose = { x: 1.25, y: 4.5, dir: Math.PI };
    const next = move(
      pose,
      { forward: 1, strafe: 1, look: 0, fire: false, reload: false },
      SAMPLE_LEVEL,
      0.2,
      SPEED,
    );

    expect(Math.abs(next.y - 4.5)).toBeGreaterThan(0); // slid on y
  });
});

describe('move — diagonal walls', () => {
  // A 3×3 grid whose centre cell is a 45° SE-solid face; everything else is open floor.
  const seMap: GameMap = {
    width: 3,
    height: 3,
    // prettier-ignore
    cells: [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ],
    // prettier-ignore
    diagonals: [
      0, 0, 0,
      0, 2, 0,
      0, 0, 0,
    ],
  };

  it('slides along a 45° face: heading into the corner pins one axis, frees the other', () => {
    // Open-half start; pushing diagonally into the SE solid lets x advance but blocks y.
    const pose: Pose = { x: 1.3, y: 1.25, dir: Math.PI / 4 };
    const next = move(pose, { ...still, forward: 1 }, seMap, 0.07, SPEED);

    expect(next.x).toBeGreaterThan(1.3); // free axis advanced past the open half
    expect(next.y).toBeCloseTo(1.25, 5); // blocked axis pinned against the face
  });

  it('isWall is solid in the wall half and open in the floor half, per orientation', () => {
    const cell = (d: number): GameMap => ({ width: 1, height: 1, cells: [1], diagonals: [d] });

    expect(isWall(cell(1), 0.2, 0.2)).toBe(true); // NW solid
    expect(isWall(cell(1), 0.8, 0.8)).toBe(false);
    expect(isWall(cell(2), 0.8, 0.8)).toBe(true); // SE solid
    expect(isWall(cell(2), 0.2, 0.2)).toBe(false);
    expect(isWall(cell(3), 0.8, 0.2)).toBe(true); // NE solid
    expect(isWall(cell(3), 0.2, 0.8)).toBe(false);
    expect(isWall(cell(4), 0.2, 0.8)).toBe(true); // SW solid
    expect(isWall(cell(4), 0.8, 0.2)).toBe(false);
  });
});

describe('height movement', () => {
  // A 3-wide corridor (1 row, no walls) with a step UP, a TALL step, and a low floor, each its own
  // sector. The player walks east (+x) along it. WALL_HEIGHT 1.4 → STEP_UP_MAX 0.35.
  const sector = (floorZ: number, ceilZ: number) => ({ floorZ, ceilZ, floorMat: 0, ceilMat: 0 });

  it('steps UP onto a small rise: the move succeeds and z climbs to the step floor', () => {
    const map: GameMap = {
      width: 2,
      height: 1,
      cells: [0, 0],
      sectors: [sector(0, 1.4), sector(0.3, 1.7)], // cell 1 is +0.3, climbable
      sectorId: [0, 1],
    };
    const pose: Pose = { x: 0.5, y: 0.5, z: 0, dir: 0 }; // facing +x toward cell 1

    const next = move(pose, { ...still, forward: 1 }, map, 0.2, SPEED);

    expect(next.x).toBeGreaterThan(1.0); // crossed into the higher cell
    expect(next.z).toBe(0.3); // snapped to the step floor
  });

  it('is BLOCKED by a tall step: the moving axis is pinned at the lower cell', () => {
    const map: GameMap = {
      width: 2,
      height: 1,
      cells: [0, 0],
      sectors: [sector(0, 1.4), sector(0.5, 1.9)], // cell 1 is +0.5 > STEP_UP_MAX
      sectorId: [0, 1],
    };
    const pose: Pose = { x: 0.7, y: 0.5, z: 0, dir: 0 }; // near the seam, facing +x

    const next = move(pose, { ...still, forward: 1 }, map, 0.2, SPEED);

    expect(next.x).toBeLessThan(1.0); // never entered the tall cell (RADIUS-padded)
    expect(next.z).toBe(0); // stayed on the low floor
  });

  it('steps off a ledge: the move succeeds and z DROPS to the lower floor', () => {
    const map: GameMap = {
      width: 2,
      height: 1,
      cells: [0, 0],
      sectors: [sector(0.5, 1.9), sector(0, 1.4)], // cell 0 high, cell 1 low
      sectorId: [0, 1],
    };
    const pose: Pose = { x: 0.5, y: 0.5, z: 0.5, dir: 0 }; // on the ledge, facing the drop

    const next = move(pose, { ...still, forward: 1 }, map, 0.2, SPEED);

    expect(next.x).toBeGreaterThan(1.0); // fell into the pit cell
    expect(next.z).toBe(0); // dropped to the lower floor
  });
});
