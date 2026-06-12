import { describe, it, expect } from 'vitest';
import { resolveFire, resolveSpread, hasLineOfSight } from './fire';
import { SAMPLE_LEVEL } from './game-map';
import type { GameMap } from './game-map';
import type { Enemy, Pose } from './types';

const at = (x: number, y: number): Enemy => ({
  x,
  y,
  dir: 0,
  state: 'alive',
  deathTime: 0,
  hp: 3,
  fireCooldown: 0,
  hitFlash: 0,
  windup: 0,
  kind: 'manager',
});
// Facing +x along the open corridor at y≈1.5 (row `1, 0, 0, 0, 0, 0, 0, 1` — clear x=1.5..6.5).
const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };

describe('resolveFire', () => {
  it('hits an aligned enemy in line of sight', () => {
    expect(resolveFire(pose, [at(4.5, 1.5)], SAMPLE_LEVEL, 14, 0.13)).toBe(0);
  });

  it('misses an enemy outside the aim cone', () => {
    expect(resolveFire(pose, [at(4.5, 3.5)], SAMPLE_LEVEL, 14, 0.13)).toBeNull();
  });

  it('misses an enemy beyond range', () => {
    expect(resolveFire(pose, [at(1.5 + 20, 1.5)], SAMPLE_LEVEL, 14, 0.13)).toBeNull();
  });

  it('returns the nearest of two aligned enemies', () => {
    expect(resolveFire(pose, [at(5.5, 1.5), at(3.5, 1.5)], SAMPLE_LEVEL, 14, 0.13)).toBe(1);
  });

  it('ignores dead enemies', () => {
    expect(
      resolveFire(pose, [{ ...at(4.5, 1.5), state: 'dead' }], SAMPLE_LEVEL, 14, 0.13),
    ).toBeNull();
  });

  it('misses an aligned enemy blocked by a wall', () => {
    // From (1.5, 2.5) facing +x there is a wall at cell (3, 2); the enemy sits beyond it.
    const blocked: Pose = { x: 1.5, y: 2.5, dir: 0 };

    expect(resolveFire(blocked, [at(5.5, 2.5)], SAMPLE_LEVEL, 14, 0.13)).toBeNull();
  });

  it('normalizes a wrapped facing angle (±2π still aims +x)', () => {
    expect(
      resolveFire({ x: 1.5, y: 1.5, dir: 2 * Math.PI }, [at(4.5, 1.5)], SAMPLE_LEVEL, 14, 0.13),
    ).toBe(0);
    expect(
      resolveFire({ x: 1.5, y: 1.5, dir: -2 * Math.PI }, [at(4.5, 1.5)], SAMPLE_LEVEL, 14, 0.13),
    ).toBe(0);
  });

  it('respects the range/cone parameters (gun reaches, fists do not)', () => {
    const fistPose = { x: 1.5, y: 1.5, dir: 0 };
    // dead-ahead, ~3 cells away — distance ~3.0 > melee 1.4, < gun 14
    const enemies = [at(4.5, 1.5)];

    expect(resolveFire(fistPose, enemies, SAMPLE_LEVEL, 14, 0.13)).toBe(0); // gun range reaches
    expect(resolveFire(fistPose, enemies, SAMPLE_LEVEL, 1.4, 0.5)).toBeNull(); // melee range does not
  });
});

describe('resolveSpread', () => {
  it('a point-blank centred enemy eats every pellet of the fan', () => {
    // Dead ahead + VERY close (dist 0.5): the enemy's silhouette is wider than the whole fan, so all land.
    const hits = resolveSpread(pose, [at(2.0, 1.5)], SAMPLE_LEVEL, 6, 0.28, 9);

    expect(hits[0]).toBe(9);
  });

  it('an edge enemy catches fewer pellets than a centred one (authentic falloff)', () => {
    // Two enemies the same distance away: one dead-ahead, one off to the +y edge of the fan.
    const hits = resolveSpread(pose, [at(3.5, 1.5), at(3.5, 1.9)], SAMPLE_LEVEL, 6, 0.28, 9);

    expect(hits[0]).toBeGreaterThan(hits[1]); // centred — the bulk of the fan
    expect(hits[1]).toBeGreaterThan(0); // off the edge — only the outer pellets still reach it
  });

  it('an out-of-range enemy eats zero pellets', () => {
    const hits = resolveSpread(pose, [at(2.5, 1.5)], SAMPLE_LEVEL, 0.5, 0.28, 9);

    expect(hits[0]).toBe(0); // dist 1 > range 0.5
  });

  it('a wall-blocked enemy eats zero pellets', () => {
    // From (1.5,2.5) facing +x there is a wall at cell (3,2); the enemy sits beyond it, dead ahead.
    const blocked: Pose = { x: 1.5, y: 2.5, dir: 0 };
    const hits = resolveSpread(blocked, [at(5.5, 2.5)], SAMPLE_LEVEL, 14, 0.28, 9);

    expect(hits[0]).toBe(0);
  });

  it('ignores a dead enemy', () => {
    const hits = resolveSpread(
      pose,
      [{ ...at(2.5, 1.5), state: 'dead' }],
      SAMPLE_LEVEL,
      6,
      0.28,
      9,
    );

    expect(hits[0]).toBe(0);
  });

  it('with a single pellet, fires one centred ray (the unchanged hitscan path)', () => {
    const hits = resolveSpread(pose, [at(4.5, 1.5)], SAMPLE_LEVEL, 14, 0.13, 1);

    expect(hits[0]).toBe(1); // one ray straight down the aim hits the aligned enemy once
  });
});

/** A 7×3 open corridor (clear at y=1.5) with a one-cell raised barrier mid-way at (3,1), height `barrierZ`. */
function corridorWithBarrier(barrierZ: number): GameMap {
  const width = 7;
  const height = 3;
  const cells: number[] = [];
  const sectorId: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || x === width - 1 || y === 0 || y === height - 1;

      cells.push(border ? 1 : 0);
      sectorId.push(x === 3 && y === 1 ? 1 : 0);
    }
  }

  return {
    width,
    height,
    cells,
    sectors: [
      { floorZ: 0, ceilZ: 1.4, floorMat: 0, ceilMat: 0 },
      { floorZ: barrierZ, ceilZ: barrierZ + 1.4, floorMat: 0, ceilMat: 0 },
    ],
    sectorId,
  };
}

describe('hasLineOfSight — heights', () => {
  it('is blocked when terrain rises above the eye-to-eye sightline (a tall barrier)', () => {
    expect(hasLineOfSight(1.5, 1.5, 5.5, 1.5, corridorWithBarrier(0.6))).toBe(false);
  });

  it('is clear over a low step that stays below the sightline', () => {
    expect(hasLineOfSight(1.5, 1.5, 5.5, 1.5, corridorWithBarrier(0.3))).toBe(true);
  });

  it('is clear when the mid sector sits at the base floor (flat → byte-identical)', () => {
    expect(hasLineOfSight(1.5, 1.5, 5.5, 1.5, corridorWithBarrier(0))).toBe(true);
  });
});
