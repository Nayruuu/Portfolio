import { describe, it, expect } from 'vitest';
import {
  generateLevel,
  buildRooms,
  GRID_W,
  GRID_H,
  MAX_ENEMIES,
  type Room,
} from './generate-level';
import { THEME_CYCLE } from './levels';
import { WALL_HEIGHT } from './floor-cast';
import {
  EXIT_SWITCH,
  cellAt,
  diagAt,
  isGlass,
  isWall,
  isLockedDoor,
  doorColorIndex,
  hasKey,
} from './game-map';
import { KEYCARD_COLORS } from './types';
import { makeRng } from './rng';
import { hasLineOfSight } from './fire';

type Level = ReturnType<typeof generateLevel>;
interface DoorCell {
  x: number;
  y: number;
  cell: number;
}

/** Locks scale with depth — replica of the generator's deterministic cut schedule. */
const cutsFor = (depth: number): number[] =>
  depth <= 1 ? [10] : depth <= 3 ? [5, 10] : [4, 7, 10];
const ALL_KEYS = (1 << KEYCARD_COLORS.length) - 1; // every colour bit set
const SWEEP_DEPTHS = [1, 3, 6]; // one / two / three locks

/** The four interior-corner cells of a room (NW, NE, SW, SE) — the cells the geometry pass cuts. */
function roomCorners(room: Room): readonly (readonly [number, number])[] {
  return [
    [room.x, room.y],
    [room.x + room.width - 1, room.y],
    [room.x, room.y + room.height - 1],
    [room.x + room.width - 1, room.y + room.height - 1],
  ];
}

const THEME = THEME_CYCLE[0];

/** Flood-fill the open-floor cells reachable from the spawn (4-connectivity). */
function reachableFrom(level: ReturnType<typeof generateLevel>): Set<string> {
  const seen = new Set<string>();
  const start = { x: Math.floor(level.spawn.x), y: Math.floor(level.spawn.y) };
  const queue = [start];

  seen.add(`${start.x},${start.y}`);
  while (queue.length) {
    const { x, y } = queue.pop()!;

    for (const [deltaX, deltaY] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborX = x + deltaX;
      const neighborY = y + deltaY;
      const key = `${neighborX},${neighborY}`;

      if (!seen.has(key) && cellAt(level.map, neighborX + 0.5, neighborY + 0.5) === 0) {
        seen.add(key);
        queue.push({ x: neighborX, y: neighborY });
      }
    }
  }

  return seen;
}

/** Key-aware flood from the spawn with a FIXED unlock bitmask: a cell is passable when it is open floor
 *  OR a locked door whose colour bit is set in `bits`. Returns the reached cells (floor + traversed
 *  doors) as `"x,y"` keys. */
function floodWith(level: Level, bits: number): Set<string> {
  const seen = new Set<string>();
  const start = { x: Math.floor(level.spawn.x), y: Math.floor(level.spawn.y) };
  const queue = [start];

  seen.add(`${start.x},${start.y}`);
  while (queue.length) {
    const { x, y } = queue.pop()!;

    for (const [deltaX, deltaY] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborX = x + deltaX;
      const neighborY = y + deltaY;
      const key = `${neighborX},${neighborY}`;
      const cell = cellAt(level.map, neighborX + 0.5, neighborY + 0.5);
      const passable = cell === 0 || (isLockedDoor(cell) && hasKey(bits, doorColorIndex(cell)));

      if (!seen.has(key) && passable) {
        seen.add(key);
        queue.push({ x: neighborX, y: neighborY });
      }
    }
  }

  return seen;
}

/** Key-aware SOLVABILITY flood: start holding nothing, collect a keycard's colour bit the moment its
 *  floor cell is reached, then re-flood — repeated to a fixpoint. Models an actual playthrough. */
function solvableReach(level: Level): Set<string> {
  let bits = 0;

  for (;;) {
    const reached = floodWith(level, bits);
    let next = bits;

    for (const card of level.keys) {
      if (reached.has(`${Math.floor(card.x)},${Math.floor(card.y)}`)) {
        next |= 1 << KEYCARD_COLORS.indexOf(card.color);
      }
    }
    if (next === bits) {
      return reached;
    }
    bits = next;
  }
}

/** Whether any cell orthogonally adjacent to the (single) exit switch is in the reached set. */
function exitReached(level: Level, reached: Set<string>): boolean {
  const switchIndex = level.map.cells.indexOf(EXIT_SWITCH);
  const switchX = switchIndex % GRID_W;
  const switchY = Math.floor(switchIndex / GRID_W);

  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([deltaX, deltaY]) => reached.has(`${switchX + deltaX},${switchY + deltaY}`));
}

/** Every locked-door cell on the level, with its grid coordinates. */
function doorCellsOf(level: Level): DoorCell[] {
  return level.map.cells
    .map((cell, i) => ({ cell, x: i % GRID_W, y: Math.floor(i / GRID_W) }))
    .filter((entry) => isLockedDoor(entry.cell));
}

/** The locked-door cells grouped by colour — each group is one 3-cell seam (one cut). */
function doorGroupsOf(level: Level): DoorCell[][] {
  const groups = new Map<number, DoorCell[]>();

  for (const cell of doorCellsOf(level)) {
    const colorIndex = doorColorIndex(cell.cell);
    const group = groups.get(colorIndex);

    if (group) {
      group.push(cell);
    } else {
      groups.set(colorIndex, [cell]);
    }
  }

  return [...groups.values()];
}

/** Whether `(x, y)` falls inside any room rectangle. */
function insideAnyRoom(rooms: Room[], x: number, y: number): boolean {
  return rooms.some(
    (room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height,
  );
}

describe('generateLevel', () => {
  it('is deterministic — same seed → deep-equal level; a different seed differs', () => {
    expect(generateLevel(42, THEME, 2)).toEqual(generateLevel(42, THEME, 2));
    expect(generateLevel(42, THEME, 2)).not.toEqual(generateLevel(43, THEME, 2));
  });

  it('is fully enclosed — every border cell is wall', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);

      for (let x = 0; x < GRID_W; x++) {
        expect(isWall(level.map, x + 0.5, 0.5)).toBe(true);
        expect(isWall(level.map, x + 0.5, GRID_H - 0.5)).toBe(true);
      }
      for (let y = 0; y < GRID_H; y++) {
        expect(isWall(level.map, 0.5, y + 0.5)).toBe(true);
        expect(isWall(level.map, GRID_W - 0.5, y + 0.5)).toBe(true);
      }
    }
  });

  it('spawns deterministically in an open cell, facing +x', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);

      expect(level.spawn).toEqual({ x: 1.5, y: 1.5, dir: 0 });
      expect(isWall(level.map, 1.5, 1.5)).toBe(false);
    }
  });

  it('installs see-through glass partitions — solid + interior, never in the sealed spawn nook', () => {
    let total = 0;

    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 3);

      level.map.cells.forEach((cell, i) => {
        if (!isGlass(cell)) {
          return;
        }
        total += 1;
        const x = i % GRID_W;
        const y = Math.floor(i / GRID_W);

        expect(isWall(level.map, x + 0.5, y + 0.5)).toBe(true); // solid — you bump into it
        expect(x > 0 && x < GRID_W - 1).toBe(true); // never on the border (the map stays enclosed)
        expect(x <= 6 && y <= 6).toBe(false); // never in the sealed spawn nook
      });
    }

    expect(total).toBeGreaterThan(0); // the open-office partitions actually appear across the sweep
  });

  it('places every feature-accent wall material (servers, screens, airlock doors, pillars) only on plain solid walls', () => {
    // The five PLACED feature materials (renderer's WALL_MATERIAL_IDS): 4/8 server-rack variants, 5 screen,
    // 6 airlock door, 7 pillar. Each must be a solid, non-diagonal, interior wall (collision/safety unchanged).
    const FEATURES = [4, 5, 6, 7, 8];
    const counts: Record<number, number> = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };

    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 3);

      level.map.cells.forEach((cell, i) => {
        if (!FEATURES.includes(cell)) {
          return;
        }
        counts[cell] += 1;
        const x = i % GRID_W;
        const y = Math.floor(i / GRID_W);

        expect(isWall(level.map, x + 0.5, y + 0.5)).toBe(true); // a solid wall — collision unchanged
        expect(diagAt(level.map, x + 0.5, y + 0.5)).toBe(0); // never a diagonal cell
        expect(x > 0 && x < GRID_W - 1 && y > 0 && y < GRID_H - 1).toBe(true); // interior, never the border
      });
    }

    expect(counts[4]).toBeGreaterThan(0); // server-rack variant A
    expect(counts[8]).toBeGreaterThan(0); // its alternating variant B
    expect(counts[5]).toBeGreaterThan(0); // recessed dashboard screens (server room)
    expect(counts[6]).toBeGreaterThan(0); // sealed airlock doors (one per room)
    expect(counts[7]).toBeGreaterThan(0); // structural pillars (large rooms only)
  });

  it('keeps each room visually COHERENT — every wall SIDE is ONE ambient material (no zonal split mid-wall)', () => {
    // The core of the level-design pass: the OLD bug let a 12×12 zone boundary cut a single wall face into two
    // materials. Now each room's wall is its identity. Corners may borrow a diagonal neighbour's material, so
    // the invariant is per-SIDE: each of a room's four wall faces (corners excluded) carries at most ONE
    // ambient material id (1-3) — features (4-8), glass (≥13), doors/switch and carved openings (0) excluded.
    for (let seed = 0; seed < 30; seed++) {
      const level = generateLevel(seed, THEME, 1);
      const rooms = buildRooms(makeRng(seed));

      for (const room of rooms) {
        const sides: [number, number][][] = [[], [], [], []];

        for (let x = room.x; x < room.x + room.width; x++) {
          sides[0].push([x, room.y - 1]); // top face (corners excluded)
          sides[1].push([x, room.y + room.height]); // bottom face
        }
        for (let y = room.y; y < room.y + room.height; y++) {
          sides[2].push([room.x - 1, y]); // left face
          sides[3].push([room.x + room.width, y]); // right face
        }
        for (const side of sides) {
          const ambient = new Set<number>();

          for (const [x, y] of side) {
            const cell = level.map.cells[y * GRID_W + x];

            if (cell >= 1 && cell <= 3 && diagAt(level.map, x + 0.5, y + 0.5) === 0) {
              ambient.add(cell);
            }
          }
          expect(ambient.size).toBeLessThanOrEqual(1); // a single coherent material per wall face — never a mix
        }
      }
    }
  });

  // THE CORE GUARANTEE — purely by operation order: the enemy pool is gathered while box B is still
  // solid wall, so no enemy can ever occupy a cell the sealed spawn is able to see.
  it('keeps the spawn safe — NO enemy ever has line-of-sight to the spawn', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 5);

      for (const enemy of level.enemies) {
        expect(hasLineOfSight(level.spawn.x, level.spawn.y, enemy.x, enemy.y, level.map)).toBe(
          false,
        );
      }
    }
  });

  it('places no enemy or pickup inside the spawn nook (box B) nor on the spawn cell', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 5);
      const inBoxB = (x: number, y: number): boolean => Math.floor(x) <= 6 && Math.floor(y) <= 6;
      const onSpawn = (x: number, y: number): boolean => Math.floor(x) === 1 && Math.floor(y) === 1;

      for (const enemy of level.enemies) {
        expect(inBoxB(enemy.x, enemy.y)).toBe(false);
        expect(onSpawn(enemy.x, enemy.y)).toBe(false);
      }
      for (const pickup of level.pickups) {
        expect(inBoxB(pickup.x, pickup.y)).toBe(false);
        expect(onSpawn(pickup.x, pickup.y)).toBe(false);
      }
      for (const spawn of level.ammoSpawns) {
        expect(inBoxB(spawn.x, spawn.y)).toBe(false); // scattered boxes from the safe pool; the foyer box is past the nook
        expect(onSpawn(spawn.x, spawn.y)).toBe(false);
      }
    }
  });

  it('seals box B, carving only the spawn pocket + the column-3 throat into the foyer', () => {
    const level = generateLevel(0, THEME, 2);
    const nook = [
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
      [3, 5],
      [3, 6],
    ];

    for (const [x, y] of nook) {
      expect(isWall(level.map, x + 0.5, y + 0.5)).toBe(false);
    }
    expect(isWall(level.map, 3.5, 7.5)).toBe(false); // (3,7) is foyer floor — the throat exit
    for (const [x, y] of [
      [0, 0],
      [4, 1],
      [2, 2],
      [6, 6],
    ]) {
      expect(isWall(level.map, x + 0.5, y + 0.5)).toBe(true); // the rest of box B is solid
    }
  });

  it('makes the first enemy a reachable, in-range, sight-sealed sentinel turret', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 5);
      const sentinel = level.enemies[0];

      expect(sentinel.kind).toBe('printer'); // a turret holds the doorway (a rushing kind would wander off)
      expect(Math.floor(sentinel.x)).toBe(3);
      expect(Math.floor(sentinel.y)).toBe(9);
      const dist = Math.hypot(sentinel.x - level.spawn.x, sentinel.y - level.spawn.y);

      expect(dist).toBeLessThan(14); // sits inside the foyer, down the throat the player turns into
      expect(reachableFrom(level).has('3,9')).toBe(true);
      expect(hasLineOfSight(level.spawn.x, level.spawn.y, sentinel.x, sentinel.y, level.map)).toBe(
        false,
      );
    }
  });

  it('has exactly one exit switch, reachable once every door is unlocked', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);
      const switches = level.map.cells.filter((c) => c === EXIT_SWITCH);

      expect(switches).toHaveLength(1);
      expect(exitReached(level, floodWith(level, ALL_KEYS))).toBe(true);
    }
  });

  it('is fully connected under full unlock — every open-floor cell (incl. the throat) is reachable', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);
      const reachable = floodWith(level, ALL_KEYS); // open every coloured door

      for (let i = 0; i < level.map.cells.length; i++) {
        if (level.map.cells[i] === 0) {
          const x = i % GRID_W;
          const y = Math.floor(i / GRID_W);

          expect(reachable.has(`${x},${y}`)).toBe(true); // single component — no overlap-orphan
        }
      }
      expect(reachable.has('3,7')).toBe(true); // the throat
    }
  });

  it('places every enemy and pickup on open floor — never on a chamfer or in a 45° corner', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 5);

      for (const enemy of level.enemies) {
        expect(isWall(level.map, enemy.x, enemy.y)).toBe(false); // not on a wall / chamfered corner
        expect(diagAt(level.map, enemy.x, enemy.y)).toBe(0); // not inside an octagon's 45° corner cell
      }
      for (const pickup of level.pickups) {
        expect(isWall(level.map, pickup.x, pickup.y)).toBe(false);
        expect(diagAt(level.map, pickup.x, pickup.y)).toBe(0);
      }
      for (const spawn of level.ammoSpawns) {
        expect(isWall(level.map, spawn.x, spawn.y)).toBe(false); // every ammo box (incl. the foyer one) on open floor
        expect(diagAt(level.map, spawn.x, spawn.y)).toBe(0);
      }
      const positions = level.enemies.map((enemy) => `${enemy.x},${enemy.y}`);

      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('carves the foyer, r2 and atrium into octagons — twelve wall-backed 45° corners, nothing else diagonal', () => {
    const expectedOrient = [1, 3, 4, 2]; // NW, NE, SW, SE → solid triangle toward each outside corner
    // The two OUTWARD legs (by orientation) that must be solid wall to back each 45° face.
    const legDeltas: Record<number, readonly (readonly [number, number])[]> = {
      1: [
        [-1, 0],
        [0, -1],
      ], // NW: W + N
      3: [
        [1, 0],
        [0, -1],
      ], // NE: E + N
      4: [
        [-1, 0],
        [0, 1],
      ], // SW: W + S
      2: [
        [1, 0],
        [0, 1],
      ], // SE: E + S
    };

    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);
      const rooms = buildRooms(makeRng(seed)); // same seed, drawn first → the identical layout
      const octagons = [rooms[0], rooms[2], rooms[rooms.length - 1]]; // foyer, r2, atrium
      const diagonals = level.map.diagonals ?? [];

      expect(diagonals.filter((orient) => orient !== 0)).toHaveLength(12); // 4 per octagon, nothing else

      for (const room of octagons) {
        roomCorners(room).forEach(([cornerX, cornerY], c) => {
          const index = cornerY * GRID_W + cornerX;

          // Each solid triangle faces its OUTSIDE corner, so the open hypotenuse opens into the room.
          expect(diagonals[index]).toBe(expectedOrient[c]);

          const id = level.map.cells[index];

          expect(id).toBeGreaterThan(0); // a diagonal cell still carries a real wall id …
          expect(id).not.toBe(EXIT_SWITCH); // … never the exit switch
          for (const [deltaX, deltaY] of legDeltas[expectedOrient[c]]) {
            expect(isWall(level.map, cornerX + deltaX + 0.5, cornerY + deltaY + 0.5)).toBe(true);
          }
        });
      }
    }
  });

  it('exposes a full octagon before any keycard — r2 + the foyer corners reachable with zero keys held', () => {
    const inwardDeltas = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 6); // the most-gated schedule (three locks)
      const rooms = buildRooms(makeRng(seed));
      const reached = floodWith(level, 0); // hold NO keycard
      const r2 = rooms[2];

      expect(reached.has(`${r2.centerX},${r2.centerY}`)).toBe(true); // r2 centre needs no key

      for (const room of [rooms[0], r2]) {
        // an inward orthogonal neighbour of each diagonal corner is open floor AND reachable key-free
        for (const [cornerX, cornerY] of roomCorners(room)) {
          const visible = inwardDeltas.some(([deltaX, deltaY]) => {
            const nx = cornerX + deltaX;
            const ny = cornerY + deltaY;

            return cellAt(level.map, nx + 0.5, ny + 0.5) === 0 && reached.has(`${nx},${ny}`);
          });

          expect(visible).toBe(true);
        }
      }
    }
  });

  it("chamfers the non-octagon normal rooms' corners to solid wall (foyer + r2 + atrium are 45° octagons)", () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);
      const rooms = buildRooms(makeRng(seed)); // same seed, drawn first → the identical layout
      const octagons = [rooms[0], rooms[2], rooms[rooms.length - 1]]; // foyer, r2, atrium
      const solidNormals = rooms.slice(1, -1).filter((room) => room !== rooms[2]); // r1 + r3..r9

      for (const room of solidNormals) {
        for (const [cornerX, cornerY] of roomCorners(room)) {
          expect(isWall(level.map, cornerX + 0.5, cornerY + 0.5)).toBe(true); // solid chamfer
          expect(diagAt(level.map, cornerX + 0.5, cornerY + 0.5)).toBe(0); // a plain wall, not a 45° cut
        }
      }
      for (const room of octagons) {
        for (const [cornerX, cornerY] of roomCorners(room)) {
          expect(diagAt(level.map, cornerX + 0.5, cornerY + 0.5)).not.toBe(0); // octagon corner = 45° cut
        }
      }
    }
  });

  it('places flats deterministically — hazard+plain floors, and a matched indoor ceiling per room (no open sky)', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 2);

      expect(level.floorFlats.some((id) => id === 1)).toBe(true); // scorched hazard floor (burnout district)
      expect(level.floorFlats.some((id) => id === 0)).toBe(true); // plain floor
      expect(level.ceilFlats.some((id) => id === 0)).toBe(false); // NO open sky — a fully indoor office
      // All five ceiling materials are dressed somewhere: acoustic hub (1), neon server (2), technical lofts
      // (3), stained burnout (4), concrete atrium (5). Corridors + outside keep the base acoustic ceiling (1).
      for (let ceil = 1; ceil <= 5; ceil++) {
        expect(level.ceilFlats.some((id) => id === ceil)).toBe(true);
      }
      for (const id of level.floorFlats) {
        expect(id).toBeLessThan(THEME.floors.length);
      }
      for (const id of level.ceilFlats) {
        expect(id).toBeGreaterThanOrEqual(1); // every cell is ceilinged (1..5), never open sky (0)
        expect(id).toBeLessThanOrEqual(5);
      }
    }
  });

  it('attaches a flat SECTOR model that mirrors the per-cell flats (the A1 byte-identical foundation)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const level = generateLevel(seed, THEME, 3);
      const { map } = level;

      expect(map.sectors).toBeDefined();
      expect(map.sectorId).toHaveLength(map.cells.length);
      // every sector is FLAT (the A1 invariant — A2 varies these):
      for (const sector of map.sectors!) {
        expect(sector.floorZ).toBe(0);
        expect(sector.ceilZ).toBe(WALL_HEIGHT);
      }
      // every cell's sector materials mirror the level's per-cell flats:
      for (let i = 0; i < map.cells.length; i++) {
        const sector = map.sectors![map.sectorId![i]];

        expect(sector.floorMat).toBe(level.floorFlats[i]);
        expect(sector.ceilMat).toBe(level.ceilFlats[i]);
      }
    }
  });

  it('scales enemies (capped 28) and pickups (capped 12) with depth', () => {
    // Sweep past BOTH caps: pickups saturate at depth 4 (8 + 4), enemies at depth 20 (8 + 20). The scaled
    // pickup count is now split: every third slot drops a scattered ammo box (an `AmmoSpawn`), the rest
    // floor vitals; `scattered` re-sums them, minus the 6 guaranteed foyer PREVIEW boxes (one per ammo type).
    for (let depth = 0; depth <= 22; depth++) {
      const level = generateLevel(7, THEME, depth);
      const scattered = level.pickups.length + level.ammoSpawns.length - 6;

      expect(level.enemies.length).toBe(Math.min(28, 8 + depth));
      expect(scattered).toBe(Math.min(12, 8 + depth));
    }
    expect(generateLevel(7, THEME, 99).enemies.length).toBe(MAX_ENEMIES);
    expect(generateLevel(7, THEME, 99).enemies.length).toBe(28);
    const saturated = generateLevel(7, THEME, 99);

    expect(saturated.pickups.length + saturated.ammoSpawns.length - 6).toBe(12);
  });

  it('uses only valid enemy kinds, with all three appearing over a seed sweep + a fire-grace', () => {
    const valid = new Set(['manager', 'printer', 'hr']);
    const seen = new Set<string>();

    for (let seed = 1; seed <= 40; seed++) {
      const level = generateLevel(seed, THEME, 5);

      expect(level.enemies[0].kind).toBe('printer'); // the sentinel turret
      for (const enemy of level.enemies) {
        expect(valid.has(enemy.kind)).toBe(true);
        expect(enemy.fireCooldown).toBeGreaterThan(0);
        seen.add(enemy.kind);
      }
    }
    expect(seen.has('manager')).toBe(true);
    expect(seen.has('printer')).toBe(true);
    expect(seen.has('hr')).toBe(true);
  });
});

// The lock-and-key sweep: every arm is forced by the INPUT (seed × depth × withheld key), never by
// seed-luck. The cuts/doors/keys are pure functions of depth + room geometry, so there is no rng arm.
describe('generateLevel — lock-and-key objective', () => {
  it('IS SOLVABLE — collecting keys in order reaches the exit (60 seeds × {1,3,6}, 0 failures)', () => {
    for (const depth of SWEEP_DEPTHS) {
      for (let seed = 0; seed < 60; seed++) {
        const level = generateLevel(seed, THEME, depth);

        expect(exitReached(level, solvableReach(level))).toBe(true);
      }
    }
  });

  it('EXIT GATED — with no keys held, no cell adjacent to the exit is reachable', () => {
    for (const depth of SWEEP_DEPTHS) {
      for (let seed = 0; seed < 60; seed++) {
        const level = generateLevel(seed, THEME, depth);

        expect(exitReached(level, floodWith(level, 0))).toBe(false);
      }
    }
  });

  it('EACH LOCK LOAD-BEARING — withholding any single key leaves the exit unreachable', () => {
    for (const depth of SWEEP_DEPTHS) {
      const keyCount = cutsFor(depth).length;
      const allBits = (1 << keyCount) - 1;

      for (let seed = 0; seed < 60; seed++) {
        const level = generateLevel(seed, THEME, depth);

        for (let withheld = 0; withheld < keyCount; withheld++) {
          expect(exitReached(level, floodWith(level, allBits & ~(1 << withheld)))).toBe(false);
        }
      }
    }
  });

  it('scales the lock count with depth (1 / 2 / 3) and emits both door orientations', () => {
    for (let depth = 0; depth <= 22; depth++) {
      expect(generateLevel(7, THEME, depth).keys.length).toBe(cutsFor(depth).length);
    }

    const orientations = new Set<string>();

    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel(seed, THEME, 6);

      level.keys.forEach((card, j) => expect(card.color).toBe(KEYCARD_COLORS[j])); // colour = cut order
      for (const group of doorGroupsOf(level)) {
        orientations.add(
          new Set(group.map((cell) => cell.x)).size === 1 ? 'vertical' : 'horizontal',
        );
      }
    }
    expect(orientations.has('vertical')).toBe(true);
    expect(orientations.has('horizontal')).toBe(true);
  });

  it('stamps a clean 3-cell seam per cut — wall-flanked, mid-corridor, outside every room', () => {
    for (const depth of SWEEP_DEPTHS) {
      for (let seed = 0; seed < 60; seed++) {
        const level = generateLevel(seed, THEME, depth);
        const rooms = buildRooms(makeRng(seed));

        expect(doorCellsOf(level)).toHaveLength(3 * cutsFor(depth).length); // exactly 3 per cut
        for (const cell of doorCellsOf(level)) {
          expect(insideAnyRoom(rooms, cell.x, cell.y)).toBe(false); // doors live on corridors
          expect(diagAt(level.map, cell.x + 0.5, cell.y + 0.5)).toBe(0); // never a 45° cut
        }
        for (const group of doorGroupsOf(level)) {
          expect(group).toHaveLength(3);
          const xs = group.map((cell) => cell.x);
          const ys = group.map((cell) => cell.y);

          if (new Set(xs).size === 1) {
            const x = xs[0]; // a vertical seam (column) sealing a horizontal corridor
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const open = (deltaX: number): boolean =>
              ys.some((y) => cellAt(level.map, x + deltaX + 0.5, y + 0.5) === 0);

            expect(maxY - minY).toBe(2); // contiguous 3-cell column
            expect(isWall(level.map, x + 0.5, minY - 1 + 0.5)).toBe(true); // sealed above the seam
            expect(isWall(level.map, x + 0.5, maxY + 1 + 0.5)).toBe(true); // sealed below the seam
            expect(open(-1)).toBe(true); // corridor floor on one travel side …
            expect(open(1)).toBe(true); // … and the other (the seam bridges the two zones)
          } else {
            expect(new Set(ys).size).toBe(1); // a horizontal seam (row) sealing a vertical corridor
            const y = ys[0];
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const open = (deltaY: number): boolean =>
              xs.some((x) => cellAt(level.map, x + 0.5, y + deltaY + 0.5) === 0);

            expect(maxX - minX).toBe(2);
            expect(isWall(level.map, minX - 1 + 0.5, y + 0.5)).toBe(true);
            expect(isWall(level.map, maxX + 1 + 0.5, y + 0.5)).toBe(true);
            expect(open(-1)).toBe(true);
            expect(open(1)).toBe(true);
          }
        }
      }
    }
  });

  it('places each keycard on open floor in the room before its door — never box B / spawn / a diagonal', () => {
    for (const depth of SWEEP_DEPTHS) {
      for (let seed = 0; seed < 60; seed++) {
        const level = generateLevel(seed, THEME, depth);
        const cuts = cutsFor(depth);
        const rooms = buildRooms(makeRng(seed));

        level.keys.forEach((card, j) => {
          const keyX = Math.floor(card.x);
          const keyY = Math.floor(card.y);
          const room = rooms[cuts[j] - 1]; // the room immediately before this lock

          expect(cellAt(level.map, card.x, card.y)).toBe(0); // open floor
          expect(diagAt(level.map, card.x, card.y)).toBe(0); // not a chamfer-diagonal
          expect(keyX > 6 || keyY > 6).toBe(true); // outside box B
          expect(keyX === 1 && keyY === 1).toBe(false); // not the spawn cell
          expect(keyX).toBe(room.centerX);
          expect(keyY).toBe(room.centerY);
        });
      }
    }
  });
});
