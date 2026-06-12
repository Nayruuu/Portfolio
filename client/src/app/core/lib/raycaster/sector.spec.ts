import { describe, it, expect } from 'vitest';
import {
  sectorize,
  sectorAt,
  floorZAt,
  ceilZAt,
  canEnter,
  climbTarget,
  STEP_UP_MAX,
  CLIMB_MAX,
  PLAYER_HEIGHT,
} from './sector';
import { WALL_HEIGHT } from './floor-cast';
import { SAMPLE_LEVEL, isWall } from './game-map';
import type { GameMap } from './game-map';

/** A 1-row height fixture: one own sector per cell, `wall` cells carrying wall id 1. */
function heightMap(specs: readonly { wall?: boolean; floorZ: number; ceilZ: number }[]): GameMap {
  return {
    width: specs.length,
    height: 1,
    cells: specs.map((spec) => (spec.wall ? 1 : 0)),
    sectors: specs.map((spec) => ({
      floorZ: spec.floorZ,
      ceilZ: spec.ceilZ,
      floorMat: 0,
      ceilMat: 0,
    })),
    sectorId: specs.map((_, i) => i),
  };
}

describe('sectorize', () => {
  it('builds ONE flat sector per distinct (floorFlat, ceilFlat) combo, mapping every cell to it', () => {
    // 4 cells: two share (floor 0, ceil 1); one is (floor 1, ceil 1); one is (floor 0, ceil 0 = sky).
    const floorFlats = [0, 0, 1, 0];
    const ceilFlats = [1, 1, 1, 0];

    const { sectors, sectorId } = sectorize(floorFlats, ceilFlats);

    expect(sectors).toHaveLength(3); // (0,1), (1,1), (0,0)
    expect(sectorId).toHaveLength(4);
    expect(sectorId[0]).toBe(sectorId[1]); // the two (0,1) cells share a sector
    expect(sectorId[2]).not.toBe(sectorId[0]); // (1,1) is its own sector
    expect(sectorId[3]).not.toBe(sectorId[0]); // (0,0) sky too
    // every sector is FLAT and mirrors its source flats:
    for (let i = 0; i < sectorId.length; i++) {
      const sector = sectors[sectorId[i]];

      expect(sector.floorZ).toBe(0);
      expect(sector.ceilZ).toBe(WALL_HEIGHT);
      expect(sector.floorMat).toBe(floorFlats[i]);
      expect(sector.ceilMat).toBe(ceilFlats[i]);
    }
  });

  it('returns a single sector when every cell shares the same flats', () => {
    const { sectors, sectorId } = sectorize([2, 2, 2], [3, 3, 3]);

    expect(sectors).toHaveLength(1);
    expect(sectorId).toEqual([0, 0, 0]);
  });
});

describe('sector accessors', () => {
  const flat: GameMap = { width: 2, height: 1, cells: [0, 0] }; // no sectors
  const sectorized = sectorize([5, 7], [1, 1]);
  const sectored: GameMap = {
    width: 2,
    height: 1,
    cells: [0, 0],
    sectors: sectorized.sectors,
    sectorId: sectorized.sectorId,
  };

  it('returns the sector under a world point, by floored cell', () => {
    expect(sectorAt(sectored, 0.5, 0.5)?.floorMat).toBe(5); // cell (0,0)
    expect(sectorAt(sectored, 1.5, 0.5)?.floorMat).toBe(7); // cell (1,0)
  });

  it('reads the floor/ceiling heights from a PRESENT sector', () => {
    expect(floorZAt(sectored, 0.5, 0.5)).toBe(0); // the sector's floorZ
    expect(ceilZAt(sectored, 0.5, 0.5)).toBe(WALL_HEIGHT); // the sector's ceilZ
  });

  it('returns undefined / defaults out of bounds, even on a sectored map', () => {
    expect(sectorAt(sectored, -1, 0.5)).toBeUndefined(); // x < 0
    expect(sectorAt(sectored, 2, 0.5)).toBeUndefined(); // x >= width
    expect(sectorAt(sectored, 0.5, -1)).toBeUndefined(); // y < 0
    expect(sectorAt(sectored, 0.5, 1)).toBeUndefined(); // y >= height
    expect(floorZAt(sectored, 5, 5)).toBe(0); // out of bounds → BASE_FLOOR_Z
  });

  it('falls back to flat defaults when the map carries no sectors', () => {
    expect(sectorAt(flat, 0.5, 0.5)).toBeUndefined();
    expect(floorZAt(flat, 0.5, 0.5)).toBe(0); // BASE_FLOOR_Z
    expect(ceilZAt(flat, 0.5, 0.5)).toBe(WALL_HEIGHT);
  });
});

describe('canEnter', () => {
  it('is byte-identical to !isWall on a FLAT map (no sectors), open AND wall cells', () => {
    // Sample a spread of points across SAMPLE_LEVEL: walls (edges, interior pillars) + open floor.
    const points: readonly [number, number][] = [
      [0.5, 0.5], // top-left wall
      [1.5, 1.5], // open spawn cell
      [3.5, 2.5], // interior pillar (id 3)
      [2.5, 4.5], // interior pillar (id 3)
      [4.5, 3.5], // open
      [5.5, 5.5], // open
      [7.5, 4.5], // east wall
      [3.5, 7.5], // south wall
      [-1, -1], // out of bounds (solid)
      [99, 99], // out of bounds (solid)
    ];

    for (const [x, y] of points) {
      expect(canEnter(SAMPLE_LEVEL, 0, x, y)).toBe(!isWall(SAMPLE_LEVEL, x, y));
    }
  });

  it('blocks a solid wall cell regardless of its heights', () => {
    const map = heightMap([{ wall: true, floorZ: 0, ceilZ: WALL_HEIGHT }]);

    expect(canEnter(map, 0, 0.5, 0.5)).toBe(false); // isWall short-circuits
  });

  it('steps UP onto a small rise (Δfloor ≤ STEP_UP_MAX) but is blocked by a tall one', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.3, ceilZ: 0.3 + WALL_HEIGHT }, // small rise, climbable
      { floorZ: 0.5, ceilZ: 0.5 + WALL_HEIGHT }, // tall rise, blocked
    ]);

    expect(canEnter(map, 0, 1.5, 0.5)).toBe(true); // 0 → 0.3 ≤ 0.35
    expect(canEnter(map, 0, 2.5, 0.5)).toBe(false); // 0 → 0.5 > 0.35
  });

  it('always allows stepping DOWN (pits are walk-into / fall-into)', () => {
    const map = heightMap([
      { floorZ: 0.5, ceilZ: 0.5 + WALL_HEIGHT },
      { floorZ: 0, ceilZ: WALL_HEIGHT }, // a big drop
    ]);

    expect(canEnter(map, 0.5, 1.5, 0.5)).toBe(true); // 0.5 → 0, Δ negative
  });

  it('blocks a too-low ceiling but allows adequate clearance', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: 0.5 }, // clearance 0.5 < PLAYER_HEIGHT
      { floorZ: 0, ceilZ: WALL_HEIGHT }, // clearance 1.4 ≥ PLAYER_HEIGHT
    ]);

    expect(canEnter(map, 0, 0.5, 0.5)).toBe(false); // crouch-only, blocked
    expect(canEnter(map, 0, 1.5, 0.5)).toBe(true); // fits
  });

  it('boundaries are inclusive: Δfloor === STEP_UP_MAX and clearance === PLAYER_HEIGHT both pass', () => {
    const map = heightMap([
      { floorZ: STEP_UP_MAX, ceilZ: STEP_UP_MAX + WALL_HEIGHT }, // exactly the max rise
      { floorZ: 0, ceilZ: PLAYER_HEIGHT }, // exactly the min clearance
    ]);

    expect(canEnter(map, 0, 0.5, 0.5)).toBe(true); // Δ === STEP_UP_MAX → not > → allowed
    expect(canEnter(map, 0, 1.5, 0.5)).toBe(true); // clearance === PLAYER_HEIGHT → not < → allowed
  });
});

describe('climbTarget', () => {
  it('returns null for a walkable rise (Δfloor ≤ STEP_UP_MAX — a normal step, not a climb)', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.3, ceilZ: 0.3 + WALL_HEIGHT }, // 0.3 ≤ 0.35 → just step up, not mantle
    ]);

    expect(climbTarget(map, 0, 1.5, 0.5)).toBeNull();
  });

  it('returns the ledge floorZ for a rise in the climbable band (STEP_UP_MAX, CLIMB_MAX]', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.6, ceilZ: 0.6 + WALL_HEIGHT }, // 0.6 ∈ (0.35, 1.4], head clearance ok → mantle to 0.6
    ]);

    expect(climbTarget(map, 0, 1.5, 0.5)).toBeCloseTo(0.6, 5);
  });

  it('returns null for a rise taller than CLIMB_MAX (a true wall, not a climb)', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 1.5, ceilZ: 1.5 + WALL_HEIGHT }, // 1.5 > 1.4 → too tall to mantle
    ]);

    expect(climbTarget(map, 0, 1.5, 0.5)).toBeNull();
  });

  it('returns null for a solid wall cell (isWall short-circuits before any height check)', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { wall: true, floorZ: 0.6, ceilZ: 0.6 + WALL_HEIGHT }, // a climbable rise, but it's a wall cell
    ]);

    expect(climbTarget(map, 0, 1.5, 0.5)).toBeNull();
  });

  it('returns null when the ceiling at the top is too low to stand in (no head clearance)', () => {
    const map = heightMap([
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.6, ceilZ: 1.1 }, // climbable rise, but clearance 0.5 < PLAYER_HEIGHT 0.9
    ]);

    expect(climbTarget(map, 0, 1.5, 0.5)).toBeNull();
  });

  it('treats the band boundaries: rise === STEP_UP_MAX is walkable (null), rise === CLIMB_MAX is climbable', () => {
    const map = heightMap([
      { floorZ: STEP_UP_MAX, ceilZ: STEP_UP_MAX + WALL_HEIGHT }, // exactly STEP_UP_MAX → ≤ → null
      { floorZ: CLIMB_MAX, ceilZ: CLIMB_MAX + WALL_HEIGHT }, // exactly CLIMB_MAX → not > → climbable
    ]);

    expect(climbTarget(map, 0, 0.5, 0.5)).toBeNull(); // rise === STEP_UP_MAX → not a climb
    expect(climbTarget(map, 0, 1.5, 0.5)).toBeCloseTo(CLIMB_MAX, 5); // rise === CLIMB_MAX → climbs
  });
});
