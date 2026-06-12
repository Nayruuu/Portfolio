import { describe, it, expect } from 'vitest';
import {
  DOOR_CELLS,
  EDGE_BIT,
  MODULE_SIZE,
  assembleLayout,
  carveGrid,
  corridorFor,
  exitMask,
  selectModule,
  stitchModules,
} from './assembler';
import type { ExitMask, GridPlan, SlotPlan } from './assembler';
import { EXIT_SWITCH, isWall } from './game-map';
import { parseModule } from './module';
import type { Module } from './module';
import { MODULE_LIBRARY, OCTAGON_TEST } from './modules';
import { makeRng } from './rng';
import { canEnter, floorZAt } from './sector';
import type { GameMap } from './game-map';

/** Walk the `needs`-connected component from the entrance; A→B is connected iff A carries the bit toward B
 *  AND B carries the bit back. Returns the set of reachable slot indices. */
function reachable(plan: GridPlan): Set<number> {
  const { gridW, gridH, slots, entrance } = plan;
  const seen = new Set<number>([entrance]);
  const queue = [entrance];

  while (queue.length > 0) {
    const i = queue.shift() as number;
    const x = i % gridW;
    const y = Math.floor(i / gridW);
    const links: [boolean, number, number, number][] = [
      [y > 0, i - gridW, EDGE_BIT.N, EDGE_BIT.S], // north neighbour
      [x < gridW - 1, i + 1, EDGE_BIT.E, EDGE_BIT.W], // east neighbour
      [y < gridH - 1, i + gridW, EDGE_BIT.S, EDGE_BIT.N], // south neighbour
      [x > 0, i - 1, EDGE_BIT.W, EDGE_BIT.E], // west neighbour
    ];

    for (const [inBounds, neighbour, here, back] of links) {
      if (!inBounds || seen.has(neighbour)) {
        continue;
      }
      if ((slots[i].needs & here) !== 0 && (slots[neighbour].needs & back) !== 0) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }

  return seen;
}

/** True when every adjacent pair's facing bits agree: A opens toward B ⟺ B opens back toward A. */
function facingEdgesAgree(plan: GridPlan): boolean {
  const { gridW, gridH, slots } = plan;

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;

      if (x < gridW - 1) {
        const east = (slots[i].needs & EDGE_BIT.E) !== 0;
        const west = (slots[i + 1].needs & EDGE_BIT.W) !== 0;

        if (east !== west) {
          return false;
        }
      }
      if (y < gridH - 1) {
        const south = (slots[i].needs & EDGE_BIT.S) !== 0;
        const north = (slots[i + gridW].needs & EDGE_BIT.N) !== 0;

        if (south !== north) {
          return false;
        }
      }
    }
  }

  return true;
}

const SIZES: readonly [number, number][] = [
  [3, 3],
  [4, 3],
  [4, 4],
  [5, 5],
];

describe('carveGrid — shape', () => {
  it('produces a row-major slot grid with entrance on the top row and exit on the bottom row', () => {
    for (const [gridW, gridH] of SIZES) {
      for (let seed = 0; seed < 12; seed++) {
        const plan = carveGrid(makeRng(seed), gridW, gridH);

        expect(plan.slots).toHaveLength(gridW * gridH);
        expect(Math.floor(plan.entrance / gridW)).toBe(0); // top row
        expect(Math.floor(plan.exit / gridW)).toBe(gridH - 1); // bottom row
      }
    }
  });
});

describe('carveGrid — invariants', () => {
  it('always links the entrance to the exit through facing-agreed doorways', () => {
    for (const [gridW, gridH] of SIZES) {
      for (let seed = 0; seed < 40; seed++) {
        const plan = carveGrid(makeRng(seed), gridW, gridH);

        expect(facingEdgesAgree(plan)).toBe(true);
        expect(reachable(plan).has(plan.exit)).toBe(true);
      }
    }
  });

  it('marks the entrance and exit as path slots that open onto the route', () => {
    const plan = carveGrid(makeRng(7), 4, 4);

    expect(plan.slots[plan.entrance].role).toBe('path');
    expect(plan.slots[plan.exit].role).toBe('path');
    expect(plan.slots[plan.entrance].needs).not.toBe(0); // the entrance carries a door toward its neighbour
    expect(plan.slots[plan.exit].needs).not.toBe(0);
  });
});

describe('carveGrid — slot roles', () => {
  it('yields path slots, side rooms opening onto the path, and sealed filler across seeds', () => {
    let sawPath = false;
    let sawOpenSide = false;
    let sawSealedSide = false;

    for (const [gridW, gridH] of SIZES) {
      for (let seed = 0; seed < 40; seed++) {
        for (const slot of carveGrid(makeRng(seed), gridW, gridH).slots) {
          if (slot.role === 'path') {
            sawPath = true;
          } else if (slot.needs === 0) {
            sawSealedSide = true; // a side slot touching no path slot → sealed filler
          } else {
            sawOpenSide = true; // a side room opening onto the path
          }
        }
      }
    }

    expect(sawPath).toBe(true);
    expect(sawOpenSide).toBe(true);
    expect(sawSealedSide).toBe(true);
  });
});

describe('carveGrid — determinism', () => {
  it('replays an identical plan for the same seed', () => {
    expect(carveGrid(makeRng(123), 3, 3)).toEqual(carveGrid(makeRng(123), 3, 3));
    expect(carveGrid(makeRng(99), 4, 3)).toEqual(carveGrid(makeRng(99), 4, 3));
  });

  it('can differ for different seeds', () => {
    const a = carveGrid(makeRng(1), 5, 5);
    let differs = false;

    for (let seed = 2; seed < 20 && !differs; seed++) {
      if (JSON.stringify(carveGrid(makeRng(seed), 5, 5)) !== JSON.stringify(a)) {
        differs = true;
      }
    }

    expect(differs).toBe(true);
  });
});

describe('exitMask', () => {
  it('ORs the bit of each edge a module carries a door on', () => {
    // A vertical corridor: doors centred on the top (N) and bottom (S) rows.
    const northSouth = parseModule({ name: 'ns', role: 'path', layout: '#D#\n#.#\n#D#' });

    expect(exitMask(northSouth)).toBe(EDGE_BIT.N | EDGE_BIT.S);
  });

  it('is 0 for a sealed module with no doors', () => {
    const sealed = parseModule({ name: 'sealed', role: 'side', layout: '###\n#.#\n###' });

    expect(exitMask(sealed)).toBe(0);
  });
});

/** A library module with a centred door on each edge present in `mask` — a 3×3 reference fixture. */
function libModule(name: string, role: Module['role'], mask: ExitMask): Module {
  const grid = [
    ['#', mask & EDGE_BIT.N ? 'D' : '#', '#'],
    [mask & EDGE_BIT.W ? 'D' : '#', '.', mask & EDGE_BIT.E ? 'D' : '#'],
    ['#', mask & EDGE_BIT.S ? 'D' : '#', '#'],
  ];

  return parseModule({ name, role, layout: grid.map((row) => row.join('')).join('\n') });
}

describe('selectModule', () => {
  const needs: ExitMask = EDGE_BIT.N | EDGE_BIT.S;
  const plan: SlotPlan = { role: 'path', needs };

  it('returns a library module whose role and exit signature both match', () => {
    const match = libModule('match', 'path', needs);
    const wrongRole = libModule('wrong-role', 'side', needs);
    const wrongMask = libModule('wrong-mask', 'path', EDGE_BIT.E | EDGE_BIT.W);
    const picked = selectModule(makeRng(3), plan, [wrongRole, wrongMask, match]);

    expect(picked).toBe(match);
  });

  it('picks deterministically among several matches for a given seed', () => {
    const a = libModule('a', 'path', needs);
    const b = libModule('b', 'path', needs);
    const library = [a, b];

    expect(selectModule(makeRng(5), plan, library)).toBe(selectModule(makeRng(5), plan, library));
  });

  it('falls back to a wall-bordered corridor when the library has no match', () => {
    const corridor = selectModule(makeRng(0), plan, []);

    expect(corridor.role).toBe('path');
    expect(exitMask(corridor)).toBe(needs);
    expect(corridor.width).toBe(MODULE_SIZE);
    expect(corridor.height).toBe(MODULE_SIZE);
    // The whole border is wall except the two punched doorways; the interior is open floor.
    expect(corridor.cells[0]).toBe(1); // a corner is always wall
    expect(corridor.cells[MODULE_SIZE * MODULE_SIZE - 1]).toBe(1);
    const centre = Math.floor(MODULE_SIZE / 2) * MODULE_SIZE + Math.floor(MODULE_SIZE / 2);

    expect(corridor.cells[centre]).toBe(0); // interior is open
  });
});

describe('corridorFor (via selectModule fallback)', () => {
  const last = MODULE_SIZE - 1;
  const cell = (x: number, y: number): number => y * MODULE_SIZE + x;
  const corridor = (mask: ExitMask): Module =>
    selectModule(makeRng(0), { role: 'path', needs: mask }, []);

  it('round-trips every mask, opening BOTH cells of each present edge doorway and sealing the absent ones', () => {
    for (const mask of [0, EDGE_BIT.N, EDGE_BIT.S, EDGE_BIT.W, EDGE_BIT.E, 15] as const) {
      const module = corridor(mask);

      expect(module.width).toBe(MODULE_SIZE);
      expect(module.height).toBe(MODULE_SIZE);
      expect(exitMask(module)).toBe(mask);
      // Each edge's 2-cell doorway (DOOR_CELLS, 6–7): both cells open iff the bit is set, both wall otherwise.
      for (const dc of DOOR_CELLS) {
        expect(module.cells[cell(dc, 0)]).toBe(mask & EDGE_BIT.N ? 0 : 1);
        expect(module.cells[cell(dc, last)]).toBe(mask & EDGE_BIT.S ? 0 : 1);
        expect(module.cells[cell(0, dc)]).toBe(mask & EDGE_BIT.W ? 0 : 1);
        expect(module.cells[cell(last, dc)]).toBe(mask & EDGE_BIT.E ? 0 : 1);
      }
    }
  });
});

describe('stitchModules', () => {
  const mid = Math.floor(MODULE_SIZE / 2); // door / interior centre on a 13-wide edge (= 6)
  // A 13×13 module: open room with one raised tile at its centre — two sectors (flat z=0 + raised z=1).
  const raisedDef = {
    name: 'raised',
    role: 'side' as const,
    layout: [
      '#############',
      '#...........#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#.....R.....#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#############',
    ].join('\n'),
    legend: { R: { floorZ: 1 } },
  };

  it('merges a 2×1 grid into a map of the summed cell dimensions', () => {
    const stitched = stitchModules([corridorFor(EDGE_BIT.E), corridorFor(EDGE_BIT.W)], 2, 1);

    expect(stitched.map.width).toBe(2 * MODULE_SIZE);
    expect(stitched.map.height).toBe(1 * MODULE_SIZE);
    expect(stitched.map.cells).toHaveLength(stitched.map.width * stitched.map.height);
    expect(stitched.modulesBySlot).toHaveLength(2); // the input echoed row-major
  });

  it('blits each module at its slot offset — walls and interior floor land at the right global cell', () => {
    const { map } = stitchModules([corridorFor(EDGE_BIT.E), corridorFor(EDGE_BIT.W)], 2, 1);
    const at = (x: number, y: number): number => map.cells[y * map.width + x];

    expect(at(0, 0)).toBe(1); // left module's top-left corner is wall
    expect(at(mid, mid)).toBe(0); // left module's interior centre is open floor
    expect(at(MODULE_SIZE + mid, mid)).toBe(0); // right module's interior centre is open floor
  });

  it('lines up two facing 2-cell doorways into a walkable passage, leaving non-facing edges walled', () => {
    const { map } = stitchModules([corridorFor(EDGE_BIT.E), corridorFor(EDGE_BIT.W)], 2, 1);

    // The shared edge carries a 2-cell doorway (rows 6 and 7): BOTH cells of the left module's E door
    // (col 12) and the right module's W door (col 13) are open, so a 0.4-radius player threads it.
    for (const row of DOOR_CELLS) {
      expect(isWall(map, MODULE_SIZE - 1 + 0.5, row + 0.5)).toBe(false); // left E door cell (12, row)
      expect(isWall(map, MODULE_SIZE + 0.5, row + 0.5)).toBe(false); // right W door cell (13, row)
      // The far (non-facing) west edge of the left module stays sealed across both door cells.
      expect(isWall(map, 0 + 0.5, row + 0.5)).toBe(true); // global (0, row)
    }
  });

  it('dedupes shared sectors and remaps each module-local sectorId to the global index', () => {
    const flat = corridorFor(0); // single flat z=0 sector
    const raised = parseModule(raisedDef); // flat z=0 + raised z=1 sectors
    const { map } = stitchModules([flat, raised], 2, 1);
    const sectorOf = (x: number, y: number) => map.sectors![map.sectorId![y * map.width! + x]];

    // The flat z=0 sector is shared → the global table holds exactly the two distinct sectors.
    expect(map.sectors).toHaveLength(2);
    // The raised tile (local (6, 6) of slot 1) lands at global (19, 6) mapped to the z=1 sector.
    expect(sectorOf(MODULE_SIZE + mid, mid).floorZ).toBe(1);
    // A flat cell of the raised module still maps to the shared z=0 sector.
    expect(sectorOf(MODULE_SIZE + 1, 1).floorZ).toBe(0);
    // A cell of the flat module maps to that same shared z=0 sector.
    expect(sectorOf(mid, mid).floorZ).toBe(0);
  });
});

describe('stitchModules — diagonals', () => {
  const last = MODULE_SIZE - 1; // 12

  it('blits a placed octagon module’s four corner chamfers at the right GLOBAL cells', () => {
    const octagon = parseModule(OCTAGON_TEST);
    // Place the octagon in slot 1 of a 2×1 grid (global x-offset = MODULE_SIZE), a flat box in slot 0.
    const { map } = stitchModules([corridorFor(0), octagon], 2, 1);
    const at = (x: number, y: number): number => map.diagonals![y * map.width + x];
    const ox = MODULE_SIZE; // slot 1's global column offset

    expect(map.diagonals).toBeDefined();
    expect(map.diagonals).toHaveLength(map.width * map.height);
    expect(at(ox + 0, 0)).toBe(1); // NW corner → orientation 1
    expect(at(ox + last, 0)).toBe(3); // NE corner → orientation 3
    expect(at(ox + 0, last)).toBe(4); // SW corner → orientation 4
    expect(at(ox + last, last)).toBe(2); // SE corner → orientation 2
    // Each chamfer cell is still a SOLID wall in `cells` (the chamfer is a render-only overlay).
    expect(map.cells[0 * map.width + (ox + 0)]).toBe(1);
  });

  it('produces an all-0 diagonals layer for a purely rectangular library (no regression)', () => {
    const { map } = stitchModules([corridorFor(EDGE_BIT.E), corridorFor(EDGE_BIT.W)], 2, 1);

    expect(map.diagonals).toHaveLength(map.width * map.height);
    expect(map.diagonals!.every((d) => d === 0)).toBe(true);
  });
});

/**
 * A 13×13 module with a 2-cell centred doorway on each edge in `mask` (so it stitches like a `corridorFor`)
 * PLUS interior content markers at fixed local cells — a spawn (1,1), enemy (2,2), pickup (3,3), ammo
 * (5,5), keycard (6,6), exit switch (7,7). Every marker sits on open floor (default-legend chars, all
 * `floorZ` 0), so it never blocks the flood-fill; it just exercises the assembler's entity-collection.
 */
function contentModule(role: Module['role'], mask: ExitMask): Module {
  const last = MODULE_SIZE - 1;
  const grid: string[][] = Array.from({ length: MODULE_SIZE }, (_, y) =>
    Array.from({ length: MODULE_SIZE }, (_, x) =>
      x === 0 || x === last || y === 0 || y === last ? '#' : '.',
    ),
  );
  // Each present edge carries a 2-cell doorway (DOOR_CELLS, 6–7), so it stitches exactly like a corridorFor.
  const doors: readonly [ExitMask, 'row' | 'col', number][] = [
    [EDGE_BIT.N, 'row', 0],
    [EDGE_BIT.S, 'row', last],
    [EDGE_BIT.W, 'col', 0],
    [EDGE_BIT.E, 'col', last],
  ];

  for (const [bit, axis, fixed] of doors) {
    if ((mask & bit) !== 0) {
      for (const c of DOOR_CELLS) {
        if (axis === 'row') {
          grid[fixed][c] = 'D';
        } else {
          grid[c][fixed] = 'D';
        }
      }
    }
  }
  // Interior content markers (grid[row=y][col=x]); local coords are therefore (col, row).
  grid[1][1] = 'S'; // spawn marker
  grid[2][2] = 'E'; // enemy (default 'manager')
  grid[3][3] = 'P'; // pickup (default 'health')
  grid[5][5] = 'A'; // ammo (default 'box_staples')
  grid[6][6] = 'K'; // keycard (default 'red')
  grid[7][7] = 'X'; // exit switch marker
  const layout = grid.map((row) => row.join('')).join('\n');

  return parseModule({ name: `content-${role}-${mask}`, role, layout });
}

// A library carrying a content module for EVERY (role, mask) pair, so selection never falls back to a
// bare corridor: every slot — entrance + exit included — gets explicit spawn/exit/content markers.
const CONTENT_LIBRARY: readonly Module[] = (['path', 'side'] as const).flatMap((role) =>
  Array.from({ length: 16 }, (_, mask) => contentModule(role, mask)),
);

/** Flood-fill the open cells from the spawn cell honouring `canEnter` (4-neighbours, `fromZ = floorZAt`
 *  at the current cell); true when the `exit` SWITCH is pressable — i.e. some orthogonal neighbour of the
 *  (solid wall) switch cell is reached open floor. The reachability-by-construction invariant. */
function reachesExit(
  map: GameMap,
  spawn: { x: number; y: number },
  exit: { x: number; y: number },
): boolean {
  const start = Math.floor(spawn.y) * map.width + Math.floor(spawn.x);
  const seen = new Set<number>([start]);
  const queue: [number, number][] = [[Math.floor(spawn.x), Math.floor(spawn.y)]];

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

  // The switch itself is a solid wall (never entered); it's pressable iff a floor neighbour was reached.
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => seen.has((exit.y + dy) * map.width + (exit.x + dx)));
}

describe('assembleLayout — reachability invariant', () => {
  it('always carves a walkable spawn→exit route, for the content library and the corridor fallback', () => {
    for (const [gridW, gridH] of SIZES) {
      for (let seed = 0; seed < 32; seed++) {
        for (const library of [CONTENT_LIBRARY, [] as readonly Module[]]) {
          const layout = assembleLayout(seed, library, gridW, gridH);

          expect(reachesExit(layout.map, layout.spawn, layout.exit)).toBe(true);
        }
      }
    }
  });

  it('the SHIPPING module library produces a finishable level (spawn → exit reachable) across seeds', () => {
    // The real prefabs that go into the game — the guarantee a player can always reach the exit switch.
    for (let seed = 0; seed < 24; seed++) {
      const layout = assembleLayout(seed, MODULE_LIBRARY, 3, 3);

      expect(reachesExit(layout.map, layout.spawn, layout.exit)).toBe(true);
    }
  });
});

describe('assembleLayout — diagonals layer', () => {
  it('carries a full-length diagonals layer through to the assembled map', () => {
    const { map } = assembleLayout(5, MODULE_LIBRARY, 3, 3);

    expect(map.diagonals).toBeDefined();
    expect(map.diagonals).toHaveLength(map.width * map.height);
  });

  it('propagates a box (chamfer-free) library as an all-0 diagonals layer (a no-op layer)', () => {
    const box = parseModule({
      name: 'box',
      role: 'path',
      layout: Array.from({ length: MODULE_SIZE }, () => '#'.repeat(MODULE_SIZE)).join('\n'),
    });
    const { map } = stitchModules([box], 1, 1);

    expect(map.diagonals!.every((d) => d === 0)).toBe(true);
  });

  it('blits a non-rectangular module (the octagon proof fixture) chamfers into the merged map', () => {
    const { map } = stitchModules([parseModule(OCTAGON_TEST)], 1, 1);

    expect(map.diagonals!.some((d) => d !== 0)).toBe(true); // the four corner chamfers survive the stitch
  });
});

describe('assembleLayout — determinism', () => {
  it('replays an identical layout for the same seed', () => {
    expect(assembleLayout(42, CONTENT_LIBRARY, 3, 3)).toEqual(
      assembleLayout(42, CONTENT_LIBRARY, 3, 3),
    );
  });
});

describe('assembleLayout — bounds + spawn', () => {
  it('produces a well-formed map and a spawn on an in-bounds, non-wall cell facing +y at z 0', () => {
    const { map, spawn } = assembleLayout(3, CONTENT_LIBRARY, 4, 4);

    expect(map.cells).toHaveLength(map.width * map.height);
    expect(spawn.x).toBeGreaterThanOrEqual(0);
    expect(spawn.y).toBeGreaterThanOrEqual(0);
    expect(spawn.x).toBeLessThan(map.width);
    expect(spawn.y).toBeLessThan(map.height);
    expect(isWall(map, spawn.x, spawn.y)).toBe(false);
    expect(spawn.z).toBe(0);
    expect(spawn.dir).toBeCloseTo(Math.PI / 2);
  });
});

describe('assembleLayout — markers vs centre fallback', () => {
  it('uses the entrance spawn marker and exit switch marker when the modules carry them', () => {
    const { spawn, exit } = assembleLayout(7, CONTENT_LIBRARY, 3, 3);

    // The entrance is top-row (oy = 0); its content module's spawn marker is local (1, 1) → centre (1.5).
    expect(spawn.y).toBe(1.5);
    // The exit is bottom-row (oy = (gridH-1)*13 = 26); its switch marker is local (7, 7), fully surrounded
    // by open floor, so the switch is stamped on its first (N) neighbour (7, 6) → global y 26 + 6 = 32.
    expect(exit.y).toBe((3 - 1) * MODULE_SIZE + 6);
  });

  it('falls back to the module CENTRE for spawn and exit when no marker is present (corridor library)', () => {
    const { spawn, exit } = assembleLayout(7, [], 3, 3);
    const centre = (MODULE_SIZE - 1) / 2; // 6

    // No spawn marker → entrance centre cell (6, 6); top-row oy = 0 → spawn y = 6.5.
    expect(spawn.y).toBe(centre + 0.5);
    // No exit switch marker → exit centre cell (6, 6), surrounded by open floor → switch on its N
    // neighbour (6, 5); bottom-row oy = 26 → exit y = 26 + 5 = 31.
    expect(exit.y).toBe((3 - 1) * MODULE_SIZE + centre - 1);
  });
});

describe('assembleLayout — content collection', () => {
  it('collects every module marker into runtime entities at the right global cell centres', () => {
    const { enemies, pickups, ammoSpawns, keys } = assembleLayout(1, CONTENT_LIBRARY, 3, 3);

    // Slot 0 (top-left, offset (0, 0)) always gets a content module, so its markers land at fixed centres.
    expect(enemies).toContainEqual(
      expect.objectContaining({
        x: 2.5,
        y: 2.5,
        kind: 'manager',
        hp: 4,
        fireCooldown: 2,
        state: 'alive',
      }),
    );
    expect(pickups).toContainEqual({ x: 3.5, y: 3.5, kind: 'health' });
    expect(ammoSpawns).toContainEqual({ x: 5.5, y: 5.5, pickupId: 'box_staples' });
    expect(keys).toContainEqual({ x: 6.5, y: 6.5, color: 'red' });
  });

  it('yields empty entity arrays when no module carries content markers (corridor library)', () => {
    const { enemies, pickups, ammoSpawns, keys } = assembleLayout(1, [], 4, 3);

    expect(enemies).toHaveLength(0);
    expect(pickups).toHaveLength(0);
    expect(ammoSpawns).toHaveLength(0);
    expect(keys).toHaveLength(0);
  });
});

/**
 * A 13×13 module like `contentModule` but with the EXIT SWITCH marker tucked at local (1, 1) — whose N
 * neighbour (1, 0) is the module's border WALL (column 1 is never a door cell). It also carries a spawn
 * marker at (1, 3). Used to exercise the assembler's WALL branch: the exit switch lands on that pre-existing
 * border wall, not on a converted floor cell.
 */
function wallExitModule(role: Module['role'], mask: ExitMask): Module {
  const last = MODULE_SIZE - 1;
  const grid: string[][] = Array.from({ length: MODULE_SIZE }, (_, y) =>
    Array.from({ length: MODULE_SIZE }, (_, x) =>
      x === 0 || x === last || y === 0 || y === last ? '#' : '.',
    ),
  );
  const doors: readonly [ExitMask, 'row' | 'col', number][] = [
    [EDGE_BIT.N, 'row', 0],
    [EDGE_BIT.S, 'row', last],
    [EDGE_BIT.W, 'col', 0],
    [EDGE_BIT.E, 'col', last],
  ];

  for (const [bit, axis, fixed] of doors) {
    if ((mask & bit) !== 0) {
      for (const c of DOOR_CELLS) {
        if (axis === 'row') {
          grid[fixed][c] = 'D';
        } else {
          grid[c][fixed] = 'D';
        }
      }
    }
  }
  grid[1][1] = 'X'; // exit switch marker — its N neighbour (1, 0) is the border wall
  grid[3][1] = 'S'; // spawn marker (so the same library also serves the entrance)
  const layout = grid.map((row) => row.join('')).join('\n');

  return parseModule({ name: `wall-exit-${role}-${mask}`, role, layout });
}

// A library whose every (role, mask) module sits its exit switch beside a wall — so the exit-stamp always
// takes the WALL branch (vs the floor-fallback branch the CONTENT/corridor libraries take).
const WALL_EXIT_LIBRARY: readonly Module[] = (['path', 'side'] as const).flatMap((role) =>
  Array.from({ length: 16 }, (_, mask) => wallExitModule(role, mask)),
);

describe('assembleLayout — exit switch', () => {
  const orthoNeighbours = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const;

  it('stamps exactly one reachable EXIT_SWITCH wall that the `exit` field points at, across libraries + seeds', () => {
    for (const [gridW, gridH] of SIZES) {
      for (let seed = 0; seed < 16; seed++) {
        for (const library of [CONTENT_LIBRARY, WALL_EXIT_LIBRARY, [] as readonly Module[]]) {
          const { map, exit } = assembleLayout(seed, library, gridW, gridH);
          const switches = map.cells.filter((cell) => cell === EXIT_SWITCH);

          // (a) exactly one switch; (b) the `exit` field is that switch cell.
          expect(switches).toHaveLength(1);
          expect(map.cells[exit.y * map.width + exit.x]).toBe(EXIT_SWITCH);
          // (c) the switch is a wall with at least one open-floor orthogonal neighbour (pressable).
          expect(isWall(map, exit.x + 0.5, exit.y + 0.5)).toBe(true);
          const hasFloorNeighbour = orthoNeighbours.some(
            ([dx, dy]) => !isWall(map, exit.x + dx + 0.5, exit.y + dy + 0.5),
          );

          expect(hasFloorNeighbour).toBe(true);
        }
      }
    }
  });

  it('takes the WALL branch — stamps the switch on the marker (1, 1)’s N border wall (1, 0)', () => {
    const seed = 4;
    const plan = carveGrid(makeRng(seed), 3, 3);
    const ox = (plan.exit % 3) * MODULE_SIZE;
    const oy = Math.floor(plan.exit / 3) * MODULE_SIZE;
    const { map, exit } = assembleLayout(seed, WALL_EXIT_LIBRARY, 3, 3);

    // Marker at local (1, 1) → global (ox+1, oy+1) is open floor; its N neighbour (ox+1, oy) is the
    // border wall the switch is stamped onto (the WALL branch, not a converted floor cell).
    expect(map.cells[(oy + 1) * map.width + (ox + 1)]).toBe(0);
    expect(exit).toEqual({ x: ox + 1, y: oy });
    expect(map.cells[exit.y * map.width + exit.x]).toBe(EXIT_SWITCH);
  });

  it('takes the FLOOR-fallback branch — converts the marker’s open-floor N neighbour into the switch', () => {
    const seed = 7;
    const plan = carveGrid(makeRng(seed), 3, 3);
    const ox = (plan.exit % 3) * MODULE_SIZE;
    const oy = Math.floor(plan.exit / 3) * MODULE_SIZE;
    const { map, exit } = assembleLayout(seed, CONTENT_LIBRARY, 3, 3);

    // Marker at local (7, 7) sits in open interior → no wall neighbour → its N neighbour (7, 6), a floor
    // cell, is converted into the switch, and the marker itself stays open floor right in front of it.
    expect(exit).toEqual({ x: ox + 7, y: oy + 6 });
    expect(map.cells[exit.y * map.width + exit.x]).toBe(EXIT_SWITCH);
    expect(map.cells[(oy + 7) * map.width + (ox + 7)]).toBe(0); // marker stays floor
  });

  it('replays an identical exit cell and stamped map for the same seed (determinism)', () => {
    for (const library of [CONTENT_LIBRARY, WALL_EXIT_LIBRARY, [] as readonly Module[]]) {
      const a = assembleLayout(13, library, 4, 4);
      const b = assembleLayout(13, library, 4, 4);

      expect(a.exit).toEqual(b.exit);
      expect(a.map.cells).toEqual(b.map.cells);
    }
  });
});
