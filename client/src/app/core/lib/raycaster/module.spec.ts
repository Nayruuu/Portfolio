import { describe, it, expect } from 'vitest';
import { parseModule } from './module';
import { WALL_HEIGHT } from './floor-cast';
import { doorCell } from './game-map';

describe('parseModule — geometry', () => {
  it('parses walls, open floor, and per-cell heights into cells/sectors/sectorId', () => {
    const m = parseModule({
      name: 'tiny',
      role: 'side',
      layout: `###
               #L#
               #.#`,
      legend: { L: { floorZ: 0.3 } },
    });

    expect(m.width).toBe(3);
    expect(m.height).toBe(3);
    expect(m.cells).toEqual([1, 1, 1, 1, 0, 1, 1, 0, 1]); // 1 = wall, 0 = open
    expect(m.sectors).toContainEqual(expect.objectContaining({ floorZ: 0, ceilZ: WALL_HEIGHT }));
    expect(m.sectors).toContainEqual(
      expect.objectContaining({ floorZ: 0.3, ceilZ: WALL_HEIGHT }), // ceiling stays FLAT — only the floor steps
    );
    const zOf = (i: number) => m.sectors[m.sectorId[i]].floorZ;

    expect(zOf(4)).toBe(0.3); // the 'L' cell
    expect(zOf(7)).toBe(0); // the '.' cell
  });

  it('treats an unknown char as a wall (safe enclosure)', () => {
    const m = parseModule({ name: 'unknown', role: 'side', layout: `~.~` });

    expect(m.cells).toEqual([1, 0, 1]); // '~' (not in legend/default) → wall, '.' → open
  });

  it('defaults an open legend char with no floorZ to the base floor', () => {
    const m = parseModule({ name: 'bare', role: 'side', layout: `o`, legend: { o: {} } });

    expect(m.cells).toEqual([0]); // open
    expect(m.sectors).toEqual([{ floorZ: 0, ceilZ: WALL_HEIGHT, floorMat: 0, ceilMat: 0 }]);
  });

  it('right-pads a ragged row with walls', () => {
    const m = parseModule({ name: 'ragged', role: 'side', layout: `##\n#` });

    expect(m.width).toBe(2);
    expect(m.cells).toEqual([1, 1, 1, 1]); // the short second row padded to '##'
  });
});

describe('parseModule — diagonals', () => {
  it('parses the q/e/z/c chamfer chars into a solid wall plus its 45° orientation (NW/NE/SW/SE)', () => {
    // A 2×2 box, each corner a different chamfer — q top-left, e top-right, z bottom-left, c bottom-right.
    const m = parseModule({ name: 'corners', role: 'side', layout: `qe\nzc` });

    expect(m.cells).toEqual([1, 1, 1, 1]); // every chamfer cell is a SOLID wall
    // Orientation convention (matches generate-level's `cornerOrients` [1,3,4,2] for [NW,NE,SW,SE]).
    expect(m.diagonals).toEqual([
      1, // q = NW
      3, // e = NE
      4, // z = SW
      2, // c = SE
    ]);
  });

  it('leaves a 0 diagonal on every non-chamfer cell (walls + open floor alike)', () => {
    const m = parseModule({ name: 'mixed', role: 'side', layout: `#q#\n#.#\n###` });

    expect(m.diagonals).toHaveLength(m.width * m.height);
    expect(m.diagonals[1]).toBe(1); // the 'q' chamfer
    expect(m.diagonals.filter((d) => d !== 0)).toHaveLength(1); // ONLY the chamfer cell is nonzero
    expect(m.diagonals[0]).toBe(0); // a plain wall has no chamfer
    expect(m.diagonals[4]).toBe(0); // open floor has no chamfer
  });

  it('emits an all-0 diagonals layer for a rectangular (chamfer-free) module', () => {
    const m = parseModule({ name: 'box', role: 'side', layout: `###\n#.#\n###` });

    expect(m.diagonals).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('parseModule — exits', () => {
  it('derives one exit per door char on each of the four edges', () => {
    const m = parseModule({
      name: 'doors',
      role: 'path',
      layout: `#D#
               D.D
               #D#`,
    });

    expect(m.exits).toContainEqual({ edge: 'N', position: 1, floorZ: 0 });
    expect(m.exits).toContainEqual({ edge: 'S', position: 1, floorZ: 0 });
    expect(m.exits).toContainEqual({ edge: 'W', position: 1, floorZ: 0 });
    expect(m.exits).toContainEqual({ edge: 'E', position: 1, floorZ: 0 });
    expect(m.exits).toHaveLength(4);
  });

  it('reads a door cell’s floorZ (a raised exit on a branch)', () => {
    const m = parseModule({
      name: 'raised',
      role: 'side',
      layout: `#d#
               #.#
               #.#`,
      legend: { d: { door: true, floorZ: 0.6 } },
    });

    expect(m.exits).toContainEqual({ edge: 'N', position: 1, floorZ: 0.6 });
  });

  it('defaults a door with no authored floorZ to the base floor', () => {
    const m = parseModule({
      name: 'bare-door',
      role: 'side',
      layout: `#b#
               #.#
               #.#`,
      legend: { b: { door: true } },
    });

    expect(m.exits).toContainEqual({ edge: 'N', position: 1, floorZ: 0 });
  });

  it('ignores a door that is not on an edge', () => {
    const m = parseModule({
      name: 'interior-door',
      role: 'side',
      layout: `###
               #D#
               ###`,
    });

    expect(m.exits).toEqual([]); // the centre door is open floor but yields no exit
    expect(m.cells[4]).toBe(0); // still an open cell
  });
});

describe('parseModule — content markers', () => {
  it('collects spawn, exit switch, and typed entities at their cells', () => {
    const m = parseModule({
      name: 'content',
      role: 'arena',
      layout: `#####
               #S.E#
               #PAK#
               ##X##`,
    });

    expect(m.spawn).toEqual({ x: 1, y: 1 });
    expect(m.exitSwitch).toEqual({ x: 2, y: 3 });
    expect(m.enemies).toContainEqual({ x: 3, y: 1, kind: 'manager' });
    expect(m.pickups).toContainEqual({ x: 1, y: 2, kind: 'health' });
    expect(m.ammo).toContainEqual({ x: 2, y: 2, pickupId: 'box_staples' });
    expect(m.keycards).toContainEqual({ x: 3, y: 2, color: 'red' });
  });

  it('places the swarm enemies via their default legend chars (d = drone, m = middle manager, G = guard)', () => {
    const mod = parseModule({ name: 'swarm', role: 'arena', layout: `#######\n#d.m.G#\n#######` });

    expect(mod.enemies).toContainEqual({ x: 1, y: 1, kind: 'junior_office_drone' });
    expect(mod.enemies).toContainEqual({ x: 3, y: 1, kind: 'middle_manager' });
    expect(mod.enemies).toContainEqual({ x: 5, y: 1, kind: 'security_guard' });
  });

  it('parses a blue keycard (`j`) on open floor and a SOLID blue door (`b`) as its coloured wall id', () => {
    const m = parseModule({ name: 'gate', role: 'arena', layout: `#####\n#j.b#\n#####` });

    // `j` → a blue keycard lying on floor (an open cell, like the red `K`).
    expect(m.keycards).toContainEqual({ x: 1, y: 1, color: 'blue' });
    expect(m.cells[1 * m.width + 1]).toBe(0); // the keycard cell stays open floor
    // `b` → a solid blue locked-door cell carrying the `DOOR_BASE + blue` wall id (11), NOT an edge exit.
    expect(m.cells[1 * m.width + 3]).toBe(doorCell('blue'));
    expect(m.exits).toEqual([]); // a locked door is an in-map gate, never an inter-module doorway
  });

  it('parses an armor vest (`V`) as an open-floor pickup, the counterpart of the health `P`', () => {
    const m = parseModule({ name: 'vest', role: 'side', layout: `###\n#V#\n###` });

    expect(m.pickups).toContainEqual({ x: 1, y: 1, kind: 'armor' });
    expect(m.cells[1 * m.width + 1]).toBe(0); // on open floor
  });

  it('leaves markers empty/undefined when none are authored', () => {
    const m = parseModule({ name: 'empty', role: 'side', layout: `###\n#.#\n###` });

    expect(m.spawn).toBeUndefined();
    expect(m.exitSwitch).toBeUndefined();
    expect(m.enemies).toEqual([]);
    expect(m.pickups).toEqual([]);
    expect(m.ammo).toEqual([]);
    expect(m.keycards).toEqual([]);
  });
});
