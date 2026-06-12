import { describe, it, expect } from 'vitest';
import { CAMPAIGN, buildLevel } from './campaign';
import { buildAssembledLevel } from './assembled-level';
import { EXIT_SWITCH, doorCell, isLockedDoor } from './game-map';
import type { Level } from './levels';

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Flood the cells reachable from the spawn (4-connectivity) through every cell the `passable` predicate
 *  admits — `cell === 0` for the floor-only walk (a locked door blocks), or floor + locked doors for the
 *  "player holds the key" walk. Returns the set of reached cell indices (`y * width + x`). */
function flood(level: Level, passable: (cell: number) => boolean): Set<number> {
  const { map, spawn } = level;
  const start = Math.floor(spawn.y) * map.width + Math.floor(spawn.x);
  const seen = new Set<number>([start]);
  const stack = [start];

  while (stack.length > 0) {
    const cell = stack.pop()!;
    const x = cell % map.width;
    const y = (cell / map.width) | 0;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * map.width + nx;

      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < map.width &&
        ny < map.height &&
        !seen.has(next) &&
        passable(map.cells[next])
      ) {
        seen.add(next);
        stack.push(next);
      }
    }
  }

  return seen;
}

/** The single cell (`x`, `y`) holding the exit switch (id 9) — asserted unique by the caller. */
function exitCell(level: Level): { x: number; y: number } {
  const i = level.map.cells.indexOf(EXIT_SWITCH);

  return { x: i % level.map.width, y: (i / level.map.width) | 0 };
}

const cellOf = (level: Level, p: { x: number; y: number }): number =>
  Math.floor(p.y) * level.map.width + Math.floor(p.x);

describe('buildLevel — hand-authored campaign (level 0, "Accueil")', () => {
  const level = buildLevel(1234, 0);
  const floorOnly = flood(level, (c) => c === 0);
  const withKey = flood(level, (c) => c === 0 || isLockedDoor(c));

  it('spawns the player on open floor', () => {
    expect(level.map.cells[cellOf(level, level.spawn)]).toBe(0);
  });

  it('is a hand map: ignores the run seed (same index always replays the same level)', () => {
    expect(JSON.stringify(buildLevel(1, 0))).toBe(JSON.stringify(buildLevel(999, 0)));
  });

  it('has exactly one exit switch (id 9), reachable from the spawn once the player holds the key', () => {
    expect(level.map.cells.filter((c) => c === EXIT_SWITCH)).toHaveLength(1);

    const exit = exitCell(level);
    const pressable = NEIGHBOURS.some(([dx, dy]) =>
      withKey.has((exit.y + dy) * level.map.width + (exit.x + dx)),
    );

    expect(pressable).toBe(true);
  });

  it('carries both a blue keycard and a blue locked door (id 11)', () => {
    expect(level.keys.some((k) => k.color === 'blue')).toBe(true);
    expect(level.map.cells).toContain(doorCell('blue'));
  });

  it('reaches the blue keycard from the spawn WITHOUT crossing a locked door (key before door)', () => {
    const key = level.keys.find((k) => k.color === 'blue')!;

    expect(floorOnly.has(cellOf(level, key))).toBe(true);
  });

  it('gates the exit behind the keycard — the switch is unreachable on the floor-only (no key) walk', () => {
    const exit = exitCell(level);
    const reachedWithoutKey = NEIGHBOURS.some(([dx, dy]) =>
      floorOnly.has((exit.y + dy) * level.map.width + (exit.x + dx)),
    );

    expect(reachedWithoutKey).toBe(false);
  });

  it('hides the secret armor pickup on a reachable floor cell', () => {
    const armor = level.pickups.find((p) => p.kind === 'armor')!;

    expect(armor).toBeDefined();
    expect(floorOnly.has(cellOf(level, armor))).toBe(true);
  });

  it('populates the level with a fight (at least one enemy)', () => {
    expect(level.enemies.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildLevel — endless fall-through past the campaign', () => {
  it('routes the first post-campaign index to assembler level 0 (offset correct)', () => {
    for (const seed of [0, 7, 42]) {
      expect(JSON.stringify(buildLevel(seed, CAMPAIGN.length))).toBe(
        JSON.stringify(buildAssembledLevel(seed, 0)),
      );
    }
  });

  it('keeps the assembler offset for deeper endless levels', () => {
    for (const extra of [1, 3, 9]) {
      expect(JSON.stringify(buildLevel(7, CAMPAIGN.length + extra))).toBe(
        JSON.stringify(buildAssembledLevel(7, extra)),
      );
    }
  });
});
