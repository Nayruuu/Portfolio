import { describe, it, expect } from 'vitest';
import { buildAssembledLevel, isBossLevel, gridFor, BOSS_HP } from './assembled-level';
import { EXIT_SWITCH, isWall } from './game-map';
import { THEME_CYCLE } from './levels';
import { canEnter, floorZAt } from './sector';
import type { GameMap } from './game-map';

/** Flood-fill the open cells reachable from `spawn`, honouring the engine's height-aware `canEnter`
 *  (4-neighbours, `fromZ = floorZAt` at the current cell) — the same invariant the assembler spec asserts.
 *  Returns the set of reached cell indices (`y * width + x`). */
function reachable(map: GameMap, spawn: { x: number; y: number }): Set<number> {
  const sx = Math.floor(spawn.x);
  const sy = Math.floor(spawn.y);
  const seen = new Set<number>([sy * map.width + sx]);
  const queue: [number, number][] = [[sx, sy]];

  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    const fromZ = floorZAt(map, x + 0.5, y + 0.5);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = ny * map.width + nx;

      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || seen.has(key)) {
        continue;
      }
      if (canEnter(map, fromZ, nx + 0.5, ny + 0.5)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }

  return seen;
}

describe('buildAssembledLevel', () => {
  it('builds a well-formed Level: matching dims, theme[0], walkable spawn, an exit switch', () => {
    const level = buildAssembledLevel(7, 0);

    expect(level.map.cells.length).toBe(level.map.width * level.map.height);
    expect(level.floorFlats.length).toBe(level.map.cells.length);
    expect(level.ceilFlats.length).toBe(level.map.cells.length);
    expect(level.theme).toBe(THEME_CYCLE[0]);
    expect(isWall(level.map, level.spawn.x, level.spawn.y)).toBe(false);
    expect(level.map.cells).toContain(EXIT_SWITCH);
  });

  it('assembles a 39×39 map (3×3 slot grid of 13-cell modules)', () => {
    const level = buildAssembledLevel(7, 0);

    expect(level.map.width).toBe(39);
    expect(level.map.height).toBe(39);
  });

  it('cycles the theme by level index', () => {
    expect(buildAssembledLevel(7, 1).theme).toBe(THEME_CYCLE[1 % THEME_CYCLE.length]);
    expect(buildAssembledLevel(7, 3).theme).toBe(THEME_CYCLE[3 % THEME_CYCLE.length]);
  });

  it('sources every cell flat + every sector material from the chosen theme (no placeholders)', () => {
    const level = buildAssembledLevel(7, 0);
    const floorMat = level.floorFlats[0];
    const ceilMat = level.ceilFlats[0];

    expect(THEME_CYCLE[0].floors[floorMat]).toBeDefined();
    expect(THEME_CYCLE[0].ceils[ceilMat]).toBeDefined();
    expect(ceilMat).toBeGreaterThan(0); // a real ceiling, not the unsampled sky placeholder
    expect(level.floorFlats.every((id) => id === floorMat)).toBe(true);
    expect(level.ceilFlats.every((id) => id === ceilMat)).toBe(true);

    for (const sector of level.map.sectors ?? []) {
      expect(sector.floorMat).toBe(floorMat);
      expect(sector.ceilMat).toBe(ceilMat);
    }
  });

  it('passes the assembler diagonals layer through to the rendered Level map', () => {
    const level = buildAssembledLevel(7, 0);

    expect(level.map.diagonals).toBeDefined();
    expect(level.map.diagonals).toHaveLength(level.map.cells.length); // parallel to cells, reaches the renderer
  });

  it('is byte-identical for the same (seed, index)', () => {
    expect(JSON.stringify(buildAssembledLevel(7, 2))).toBe(
      JSON.stringify(buildAssembledLevel(7, 2)),
    );
  });

  it('differs for a different seed or a different index', () => {
    const ref = JSON.stringify(buildAssembledLevel(7, 2));

    expect(JSON.stringify(buildAssembledLevel(8, 2))).not.toBe(ref); // different layout
    expect(JSON.stringify(buildAssembledLevel(7, 0))).not.toBe(ref); // different theme
  });

  it('gives each level of a run a DISTINCT layout — not just a re-theme (index feeds the assembler seed)', () => {
    // Same run seed, consecutive levels: the GEOMETRY must change, not only the palette.
    const cells = (i: number): string => JSON.stringify(buildAssembledLevel(99, i).map.cells);

    expect(cells(0)).not.toBe(cells(1));
    expect(cells(1)).not.toBe(cells(2));
    expect(cells(0)).not.toBe(cells(2));
  });
});

describe('buildAssembledLevel — difficulty ramp', () => {
  it('gridFor starts at 3, grows one every 5 levels, and caps at 4', () => {
    expect(gridFor(0)).toBe(3);
    expect(gridFor(4)).toBe(3);
    expect(gridFor(5)).toBe(4);
    expect(gridFor(9)).toBe(4);
    expect(gridFor(20)).toBe(4); // capped — never 5×5
  });

  it('a deeper level yields a LARGER map than a shallow one', () => {
    expect(buildAssembledLevel(7, 9).map.width).toBeGreaterThan(
      buildAssembledLevel(7, 0).map.width,
    );
    expect(buildAssembledLevel(7, 0).map.width).toBe(39); // 3×3 × 13
    expect(buildAssembledLevel(7, 9).map.width).toBe(52); // 4×4 × 13
  });

  it('caps the ramp — a very deep level is no larger than the first 4×4 one', () => {
    expect(buildAssembledLevel(7, 20).map.width).toBe(buildAssembledLevel(7, 9).map.width);
    expect(buildAssembledLevel(7, 20).map.height).toBe(buildAssembledLevel(7, 9).map.height);
  });

  it('stays byte-identical for the same (seed, index) on a ramped (4×4) level', () => {
    expect(JSON.stringify(buildAssembledLevel(3, 9))).toBe(
      JSON.stringify(buildAssembledLevel(3, 9)),
    );
  });
});

describe('buildAssembledLevel — boss levels', () => {
  it('isBossLevel marks every 5th level (indices 4, 9, 14) and nothing else', () => {
    expect([4, 9, 14].map(isBossLevel)).toEqual([true, true, true]);
    expect([0, 1, 2, 3, 5].map(isBossLevel)).toEqual([false, false, false, false, false]);
  });

  it('adds exactly one placeholder boss — a middle_manager with BOSS_HP on a non-wall cell', () => {
    const level = buildAssembledLevel(7, 4); // the 5th level
    const bosses = level.enemies.filter((enemy) => enemy.hp === BOSS_HP);

    expect(bosses.length).toBe(1);
    expect(bosses[0].kind).toBe('middle_manager');
    expect(isWall(level.map, bosses[0].x, bosses[0].y)).toBe(false);
  });

  it('keeps the normal swarm on a boss level (the boss is an ADD, not a replace)', () => {
    const swarm = buildAssembledLevel(7, 4).enemies.filter((enemy) => enemy.hp !== BOSS_HP);

    expect(swarm.length).toBeGreaterThan(0);
  });

  it('a non-boss level carries no BOSS_HP enemy', () => {
    expect(buildAssembledLevel(7, 0).enemies.some((enemy) => enemy.hp === BOSS_HP)).toBe(false);
  });

  it('plants the boss on a reachable open-floor cell (so the exit stays pressable), across seeds', () => {
    for (let seed = 0; seed < 24; seed++) {
      for (const index of [4, 9, 14]) {
        const level = buildAssembledLevel(seed, index);
        const boss = level.enemies.find((enemy) => enemy.hp === BOSS_HP) as {
          x: number;
          y: number;
        };
        const seen = reachable(level.map, level.spawn);
        const bossCell = Math.floor(boss.y) * level.map.width + Math.floor(boss.x);

        // The boss stands ON the open neighbour of the exit switch, so a reached boss cell == a pressable exit.
        expect(seen.has(bossCell)).toBe(true);
      }
    }
  });
});
