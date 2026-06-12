import { describe, it, expect } from 'vitest';
import {
  EXIT_SWITCH,
  DOOR_BASE,
  GLASS_BASE,
  cellAt,
  diagAt,
  isSolidLocal,
  isWall,
  isFacingExit,
  flatAt,
  isGlass,
  isLockedDoor,
  doorColorIndex,
  doorCell,
  hasKey,
  facingDoorIndex,
  doorGroup,
} from './game-map';
import type { GameMap } from './game-map';

describe('game-map', () => {
  // A 3×2 grid: top row solid, bottom row [wall, empty, wall].
  const map = { width: 3, height: 2, cells: [1, 1, 1, 1, 0, 1] };

  it('reads a cell by floored coordinates', () => {
    expect(cellAt(map, 0.4, 0.9)).toBe(1); // top-left is wall
    expect(cellAt(map, 1.5, 1.5)).toBe(0); // middle of the bottom row is empty
  });

  it('treats out-of-bounds as solid on every edge', () => {
    expect(cellAt(map, -1, 0)).toBe(1); // x < 0
    expect(cellAt(map, 99, 0)).toBe(1); // x >= width
    expect(cellAt(map, 1, -1)).toBe(1); // y < 0
    expect(cellAt(map, 1, 99)).toBe(1); // y >= height
    expect(isWall(map, -1, 0)).toBe(true);
  });

  it('isWall reflects cell occupancy', () => {
    expect(isWall(map, 1.5, 1.5)).toBe(false);
    expect(isWall(map, 0.5, 0.5)).toBe(true);
  });
});

describe('diagonals', () => {
  // A 2×2 all-wall grid; only (1,0) carries a 45° face (orientation 2).
  const diagMap: GameMap = { width: 2, height: 2, cells: [1, 1, 1, 1], diagonals: [0, 2, 0, 0] };
  // A diagonals-free map (the absent-layer case).
  const plainMap: GameMap = { width: 2, height: 1, cells: [1, 0] };

  it('diagAt returns 0 when the map has no diagonals layer', () => {
    expect(diagAt(plainMap, 0.5, 0.5)).toBe(0);
  });

  it('diagAt reads the orientation at a present cell', () => {
    expect(diagAt(diagMap, 1.5, 0.5)).toBe(2);
    expect(diagAt(diagMap, 0.5, 0.5)).toBe(0); // a non-diagonal cell in a diagonal map
  });

  it('diagAt returns 0 out of bounds on every edge', () => {
    expect(diagAt(diagMap, -1, 0)).toBe(0); // x < 0
    expect(diagAt(diagMap, 9, 0)).toBe(0); // x >= width
    expect(diagAt(diagMap, 0, -1)).toBe(0); // y < 0
    expect(diagAt(diagMap, 0, 9)).toBe(0); // y >= height
  });

  it('isSolidLocal covers all four orientations (solid point vs open point)', () => {
    expect(isSolidLocal(1, 0.2, 0.2)).toBe(true); // NW: u+v<1
    expect(isSolidLocal(1, 0.8, 0.8)).toBe(false);
    expect(isSolidLocal(2, 0.8, 0.8)).toBe(true); // SE: u+v>1
    expect(isSolidLocal(2, 0.2, 0.2)).toBe(false);
    expect(isSolidLocal(3, 0.8, 0.2)).toBe(true); // NE: u>v
    expect(isSolidLocal(3, 0.2, 0.8)).toBe(false);
    expect(isSolidLocal(4, 0.2, 0.8)).toBe(true); // SW: v>u
    expect(isSolidLocal(4, 0.8, 0.2)).toBe(false);
  });

  it('isWall is diagonal-aware', () => {
    // (1,0) is orientation 2 (SE solid); (0,0) is a plain wall in the same map.
    expect(isWall(diagMap, 0.5, 0.5)).toBe(true); // plain wall (d === 0)
    expect(isWall(diagMap, 1.8, 0.8)).toBe(true); // SE solid half
    expect(isWall(diagMap, 1.2, 0.2)).toBe(false); // SE open half
    expect(isWall(plainMap, 1.5, 0.5)).toBe(false); // floor cell (c === 0)
  });
});

describe('glass', () => {
  it('recognises the two glass cell ids and nothing else', () => {
    expect(isGlass(GLASS_BASE)).toBe(true); // tinted partition
    expect(isGlass(GLASS_BASE + 1)).toBe(true); // clear window
    expect(isGlass(GLASS_BASE + 2)).toBe(false); // past the glass range
    expect(isGlass(1)).toBe(false); // a plain wall
    expect(isGlass(0)).toBe(false); // empty
    expect(isGlass(EXIT_SWITCH)).toBe(false); // the switch
    expect(isGlass(DOOR_BASE)).toBe(false); // a locked door
  });

  it('a glass cell is still a SOLID wall (you bump into it; only rendering sees through)', () => {
    const map: GameMap = { width: 3, height: 1, cells: [1, 0, GLASS_BASE] };

    expect(isWall(map, 2.5, 0.5)).toBe(true);
  });
});

describe('exit switch', () => {
  // A 3-wide row: [wall, empty, switch]. Player stands in the empty cell.
  const map = { width: 3, height: 1, cells: [1, 0, EXIT_SWITCH] };

  it('EXIT_SWITCH is a solid wall', () => {
    expect(isWall(map, 2.5, 0.5)).toBe(true);
  });

  it('isFacingExit is true when the switch is straight ahead, within reach', () => {
    expect(isFacingExit({ x: 1.5, y: 0.5, dir: 0 }, map)).toBe(true); // facing +x → into the switch
  });

  it('isFacingExit is false facing the plain wall, or away from the switch', () => {
    expect(isFacingExit({ x: 1.5, y: 0.5, dir: Math.PI }, map)).toBe(false); // faces the wall at x0
    expect(isFacingExit({ x: 1.5, y: 0.5, dir: Math.PI / 2 }, map)).toBe(false); // faces empty/oob
  });
});

describe('flatAt', () => {
  const map = { width: 2, height: 2, cells: [0, 0, 0, 0] };
  const flats = [0, 1, 2, 3]; // row-major flat ids

  it('reads the flat id at a world coordinate', () => {
    expect(flatAt(flats, map, 0.5, 0.5)).toBe(0);
    expect(flatAt(flats, map, 1.5, 1.5)).toBe(3);
  });

  it('returns 0 out of bounds', () => {
    expect(flatAt(flats, map, -1, 0)).toBe(0);
    expect(flatAt(flats, map, 5, 5)).toBe(0);
  });
});

describe('locked doors', () => {
  it('isLockedDoor covers the three door ids and rejects floor / walls / the exit switch', () => {
    expect(isLockedDoor(DOOR_BASE)).toBe(true); // red
    expect(isLockedDoor(DOOR_BASE + 2)).toBe(true); // yellow (last colour)
    expect(isLockedDoor(0)).toBe(false); // floor (below base)
    expect(isLockedDoor(EXIT_SWITCH)).toBe(false); // 9, just below base
    expect(isLockedDoor(DOOR_BASE + 3)).toBe(false); // one past the last colour
  });

  it('doorCell / doorColorIndex round-trip through every colour', () => {
    expect(doorCell('red')).toBe(DOOR_BASE);
    expect(doorCell('blue')).toBe(DOOR_BASE + 1);
    expect(doorCell('yellow')).toBe(DOOR_BASE + 2);
    expect(doorColorIndex(doorCell('red'))).toBe(0);
    expect(doorColorIndex(doorCell('blue'))).toBe(1);
    expect(doorColorIndex(doorCell('yellow'))).toBe(2);
  });

  it('hasKey reads the colour bit from the held mask', () => {
    expect(hasKey(0b101, 0)).toBe(true); // red held
    expect(hasKey(0b101, 1)).toBe(false); // blue not held
    expect(hasKey(0b101, 2)).toBe(true); // yellow held
  });
});

describe('facingDoorIndex', () => {
  // [wall, floor, red-door] — the player stands in the floor cell.
  const map: GameMap = { width: 3, height: 1, cells: [1, 0, DOOR_BASE] };

  it('returns the flat index of a locked door straight ahead, within reach', () => {
    expect(facingDoorIndex({ x: 1.5, y: 0.5, dir: 0 }, map)).toBe(2); // faces +x → into the door
  });

  it('returns null facing a plain wall (non-door cell ahead)', () => {
    expect(facingDoorIndex({ x: 1.5, y: 0.5, dir: Math.PI }, map)).toBeNull(); // faces the wall at x0
  });

  it('returns null when the reach runs out of bounds', () => {
    expect(facingDoorIndex({ x: 1.5, y: 0.5, dir: Math.PI / 2 }, map)).toBeNull(); // faces oob (cellAt → 1)
  });
});

describe('doorGroup', () => {
  it('floods the whole same-id seam, exploring every grid edge (3×3 of one door id)', () => {
    const cells = new Array(9).fill(DOOR_BASE);
    const group = doorGroup(cells, 4, 3); // start at the centre

    expect(group.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('stops at walls — a 3-cell seam never leaks into the flanking walls', () => {
    // A 1×5 row [wall, door, door, door, wall].
    const cells = [1, DOOR_BASE, DOOR_BASE, DOOR_BASE, 1];
    const group = doorGroup(cells, 2, 5); // start at the middle door cell

    expect(group.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('does not leak into an adjacent door of a different colour', () => {
    // A 1×4 row [red, red, blue, blue]: the two-cell red seam stays red-only.
    const cells = [DOOR_BASE, DOOR_BASE, DOOR_BASE + 1, DOOR_BASE + 1];
    const group = doorGroup(cells, 0, 4);

    expect(group.sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
