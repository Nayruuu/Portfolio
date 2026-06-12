import { makeRng, pick, randInt } from './rng';
import { parseModule } from './module';
import { EXIT_SWITCH } from './game-map';
import type { Module, ModuleRole } from './module';
import type { GameMap } from './game-map';
import type { Sector } from './sector';
import type { AmmoSpawn } from './levels';
import type { Enemy, Keycard, Pickup, Pose } from './types';

/** A bitmask of the slot edges that carry a doorway: N=1, E=2, S=4, W=8 (OR them together). */
export type ExitMask = number;

/** The edge → bit mapping for an `ExitMask` (N/S = top/bottom rows, W/E = left/right columns). */
export const EDGE_BIT = { N: 1, E: 2, S: 4, W: 8 } as const;

/** The side of one meta-grid slot — every prefab is a square `MODULE_SIZE×MODULE_SIZE` cells grid, so an
 *  edge's 2-cell doorway sits at the centre indices `(MODULE_SIZE - 1) / 2` and `(MODULE_SIZE + 1) / 2`
 *  (= 6 and 7 for a 13-wide edge — see `DOOR_CELLS`). */
export const MODULE_SIZE = 13;

/** One meta-grid slot: its gameplay role + the edges that must carry a doorway toward connected neighbours.
 *  Task 1 only PLANS the grid; a later task fills each slot with a 13×13 prefab whose exits honour `needs`. */
export interface SlotPlan {
  role: ModuleRole; // 'path' on the guaranteed main route, 'side' everywhere else
  needs: ExitMask; // edges that must open a doorway toward a connected neighbour
}

/** A planned meta-grid: every slot, plus the entrance (top row) and exit (bottom row) the path links. */
export interface GridPlan {
  gridW: number;
  gridH: number;
  slots: SlotPlan[]; // row-major, length gridW*gridH
  entrance: number; // slot index of the spawn module (top row)
  exit: number; // slot index of the exit-switch module (bottom row)
}

type Step = 'down' | 'left' | 'right';

/**
 * Plan a meta-grid of slots and a guaranteed entrance→exit path. Pure + deterministic — driven only by
 * `rng` (no `Math.random`/`Date`), so the same seed replays the identical plan.
 *
 * The path is carved as a NON-REVISITING walk: from the (seeded) top-row entrance it descends to the
 * bottom row — at each step it may move DOWN, LEFT, or RIGHT onto an in-bounds, unvisited slot, never up.
 * DOWN is always available: since the walk never moves up, the row below the cursor has never been
 * touched, so its cell is always in bounds and unvisited. That guarantees progress (and, as every step
 * consumes a fresh cell on a finite grid, termination) — the walk always lands on the bottom row, then
 * runs along it to the (seeded) exit column.
 *
 * Doorways are then assigned so FACING EDGES ALWAYS AGREE by construction: a boundary between two slots
 * opens iff the two are consecutive path cells, OR exactly one of them is a path cell (a side room
 * opening onto the path); both facing bits are set together. Two side cells (or two non-consecutive path
 * cells) stay sealed.
 */
export function carveGrid(rng: () => number, gridW: number, gridH: number): GridPlan {
  const total = gridW * gridH;
  const index = (x: number, y: number): number => y * gridW + x;

  // 1. Seeded entrance (top row) + exit (bottom row).
  const entranceX = randInt(rng, gridW);
  const exitX = randInt(rng, gridW);
  const entrance = index(entranceX, 0);
  const exit = index(exitX, gridH - 1);

  // 2. Carve the non-revisiting path. `path` (and the equivalent `visited` set) records the slots in order.
  const visited = new Set<number>([entrance]);
  const path: number[] = [entrance];
  let x = entranceX;
  let y = 0;

  while (y < gridH - 1) {
    const moves: Step[] = ['down']; // DOWN is always legal (the row below is untouched) → progress is sure

    if (x - 1 >= 0 && !visited.has(index(x - 1, y))) {
      moves.push('left');
    }
    if (x + 1 < gridW && !visited.has(index(x + 1, y))) {
      moves.push('right');
    }
    const step = pick(rng, moves);

    if (step === 'down') {
      y += 1;
    } else if (step === 'left') {
      x -= 1;
    } else {
      x += 1;
    }
    const slot = index(x, y);

    visited.add(slot);
    path.push(slot);
  }
  while (x !== exitX) {
    x += x < exitX ? 1 : -1; // walk the bottom row (never before visited) over to the exit column
    const slot = index(x, y);

    visited.add(slot);
    path.push(slot);
  }

  // 3. Record the consecutive path boundaries (the doorways along the main route), keyed order-independently.
  const edgeKey = (a: number, b: number): number => (a < b ? a * total + b : b * total + a);
  const consecutive = new Set<number>();

  for (let k = 1; k < path.length; k++) {
    consecutive.add(edgeKey(path[k - 1], path[k]));
  }

  // 4. A boundary opens iff both slots are consecutive path cells, OR exactly one of them is a path cell.
  const opens = (a: number, b: number): boolean => {
    if (visited.has(a) && visited.has(b)) {
      return consecutive.has(edgeKey(a, b)); // both path → only along the carved route
    }

    return visited.has(a) || visited.has(b); // one path + one side → the side room opens onto the path
  };

  // 5. Stamp the facing bits TOGETHER on every open boundary, so the facing-edges-agree invariant holds.
  const needs = new Array<number>(total).fill(0);

  for (let cy = 0; cy < gridH; cy++) {
    for (let cx = 0; cx < gridW; cx++) {
      const here = index(cx, cy);

      if (cx + 1 < gridW && opens(here, index(cx + 1, cy))) {
        needs[here] |= EDGE_BIT.E;
        needs[index(cx + 1, cy)] |= EDGE_BIT.W;
      }
      if (cy + 1 < gridH && opens(here, index(cx, cy + 1))) {
        needs[here] |= EDGE_BIT.S;
        needs[index(cx, cy + 1)] |= EDGE_BIT.N;
      }
    }
  }

  const slots: SlotPlan[] = needs.map((mask, i) => ({
    role: visited.has(i) ? 'path' : 'side',
    needs: mask,
  }));

  return { gridW, gridH, slots, entrance, exit };
}

/** The bitmask of edges a module carries a doorway on — OR of `EDGE_BIT` for each of its `exits`
 *  (a module with no exits → 0). The signature the assembler matches a slot's `needs` against. */
export function exitMask(module: Module): ExitMask {
  return module.exits.reduce((mask, exit) => mask | EDGE_BIT[exit.edge], 0);
}

/** The two centred door cells of a 13-wide edge — indices 6 and 7. A 2-cell doorway gives a 0.4-radius
 *  player a [0.4, 1.6]-cell corridor (easy passage); a single cell would wedge it. Used everywhere a
 *  doorway is stamped so adjacent modules' doors always align. */
export const DOOR_CELLS = [(MODULE_SIZE - 1) / 2, (MODULE_SIZE + 1) / 2] as const; // [6, 7]

/**
 * Build a featureless `MODULE_SIZE×MODULE_SIZE` z=0 room — solid wall border, open interior — with a CENTRE
 * doorway punched through every border edge the `mask` carries. Each doorway is TWO adjacent cells wide
 * (`DOOR_CELLS`, indices 6–7) so a 0.4-radius player passes (N → top-row centre, S → bottom-row centre,
 * W → left-column centre, E → right-column centre). Parsed to a `'path'` module, this is the guaranteed
 * fallback so selection never fails; by construction `exitMask(corridorFor(mask)) === mask` (both cells of
 * a door sit on the same edge, so ORing its `EDGE_BIT` twice is idempotent).
 */
export function corridorFor(mask: ExitMask): Module {
  const last = MODULE_SIZE - 1;

  // Featureless room: walls on the border, open floor inside.
  const grid: string[][] = Array.from({ length: MODULE_SIZE }, (_, y) =>
    Array.from({ length: MODULE_SIZE }, (_, x) =>
      x === 0 || x === last || y === 0 || y === last ? '#' : '.',
    ),
  );

  // Punch a 2-cell doorway through each border edge present in the mask (both `DOOR_CELLS` along the edge).
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

  const layout = grid.map((row) => row.join('')).join('\n');

  return parseModule({ name: `corridor-${mask}`, role: 'path', layout });
}

/**
 * Pick (seeded) a library module whose role AND exit signature match the slot's plan; if the library has
 * none, synthesize a plain corridor with doors exactly on `needs`. Pure + deterministic, and never fails.
 */
export function selectModule(
  rng: () => number,
  plan: SlotPlan,
  library: readonly Module[],
): Module {
  const matches = library.filter((m) => m.role === plan.role && exitMask(m) === plan.needs);

  return matches.length > 0 ? pick(rng, matches) : corridorFor(plan.needs);
}

/** The stitched level: the merged `GameMap` plus the chosen modules echoed row-major so a later task can
 *  read each slot's content markers (spawn/exit/enemies/…) back at its meta-grid position. */
export interface StitchedMap {
  map: GameMap;
  modulesBySlot: readonly Module[]; // the input, row-major (slot index = gy*gridW + gx)
}

/** A by-value key for a `Sector` — two sectors merge iff all four fields match. */
function sectorKey(sector: Sector): string {
  return `${sector.floorZ}|${sector.ceilZ}|${sector.floorMat}|${sector.ceilMat}`;
}

/**
 * Tile the `chosen` modules edge-to-edge into one `gridW×gridH` meta-grid of `MODULE_SIZE×MODULE_SIZE`
 * prefabs, producing a single `GameMap`. Each slot `(gx, gy)` is blitted at offset `(gx*MODULE_SIZE,
 * gy*MODULE_SIZE)`, so two
 * adjacent modules whose facing edges both carry a centre door line up into a walkable passage with no extra
 * carving (`selectModule` guarantees facing modules carry matching doors).
 *
 * The per-module sector tables are merged into ONE deduplicated global table (by value), and every module's
 * LOCAL `sectorId` values are remapped to the matching GLOBAL index as its cells are blitted. Each module's
 * `diagonals` (45° chamfer) layer is blitted alongside its `cells`, so a non-rectangular module (an octagon
 * etc.) keeps its chamfers in the merged map; an all-rectangular library contributes 0s (a no-op layer).
 * Pure + deterministic — `chosen` is row-major (slot index = `gy*gridW + gx`), the same indexing as `GridPlan.slots`.
 */
export function stitchModules(
  chosen: readonly Module[],
  gridW: number,
  gridH: number,
): StitchedMap {
  const width = gridW * MODULE_SIZE;
  const height = gridH * MODULE_SIZE;
  const cells = new Array<number>(width * height).fill(0);
  const diagonals = new Array<number>(width * height).fill(0); // 45° chamfer per cell (all-0 for box libraries)
  const sectorId = new Array<number>(width * height).fill(0);

  // One deduplicated global sector table; `globalIndexOf` interns a sector and returns its global index.
  const sectors: Sector[] = [];
  const byKey = new Map<string, number>();
  const globalIndexOf = (sector: Sector): number => {
    const key = sectorKey(sector);
    let id = byKey.get(key);

    if (id === undefined) {
      id = sectors.length;
      sectors.push(sector);
      byKey.set(key, id);
    }

    return id;
  };

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const module = chosen[gy * gridW + gx];
      const remap = module.sectors.map((sector) => globalIndexOf(sector)); // local sector idx → global idx

      for (let ly = 0; ly < MODULE_SIZE; ly++) {
        for (let lx = 0; lx < MODULE_SIZE; lx++) {
          const local = ly * MODULE_SIZE + lx;
          const global = (gy * MODULE_SIZE + ly) * width + (gx * MODULE_SIZE + lx);

          cells[global] = module.cells[local];
          diagonals[global] = module.diagonals[local];
          sectorId[global] = remap[module.sectorId[local]];
        }
      }
    }
  }

  return { map: { width, height, cells, diagonals, sectors, sectorId }, modulesBySlot: chosen };
}

/**
 * A fully assembled, render-ready level: the stitched `GameMap` plus every runtime entity resolved to
 * GLOBAL cell-centre world coords, and the integer cell of the exit-switch. The keystone the game shell
 * consumes — and the unit the reachability invariant is asserted against (spawn → exit is always walkable).
 */
export interface AssembledLayout {
  map: GameMap;
  spawn: Pose;
  exit: { x: number; y: number }; // global cell of the exit module's switch marker (else its centre)
  enemies: readonly Enemy[];
  pickups: readonly Pickup[];
  ammoSpawns: readonly AmmoSpawn[];
  keys: readonly Keycard[];
}

/** The runtime entities a parsed module contributes, resolved to GLOBAL cell-CENTRE world coords (`+0.5`) at
 *  the offset `(ox, oy)`. The single converter the prefab assembler (one call per stitched slot) AND the
 *  hand-authored campaign (one call at offset 0,0 for its single module) share — so an enemy's runtime hp /
 *  cooldown defaults live in exactly one place. Pure. */
export function moduleEntities(
  module: Module,
  ox: number,
  oy: number,
): { enemies: Enemy[]; pickups: Pickup[]; ammoSpawns: AmmoSpawn[]; keys: Keycard[] } {
  return {
    enemies: module.enemies.map((enemy) => ({
      x: ox + enemy.x + 0.5,
      y: oy + enemy.y + 0.5,
      dir: 0,
      state: 'alive',
      deathTime: 0,
      hp: 4,
      fireCooldown: 2,
      hitFlash: 0,
      windup: 0,
      kind: enemy.kind,
    })),
    pickups: module.pickups.map((pickup) => ({
      x: ox + pickup.x + 0.5,
      y: oy + pickup.y + 0.5,
      kind: pickup.kind,
    })),
    ammoSpawns: module.ammo.map((box) => ({
      x: ox + box.x + 0.5,
      y: oy + box.y + 0.5,
      pickupId: box.pickupId,
    })),
    keys: module.keycards.map((key) => ({
      x: ox + key.x + 0.5,
      y: oy + key.y + 0.5,
      color: key.color,
    })),
  };
}

/** A module's CENTRE cell — the spawn/exit fallback when a module carries no explicit marker. */
const MODULE_CENTRE = { x: (MODULE_SIZE - 1) / 2, y: (MODULE_SIZE - 1) / 2 } as const;

/** The orthogonal neighbour deltas in the fixed scan order N, E, S, W — the deterministic priority for
 *  choosing which cell becomes the exit switch (first match wins, so no rng tie-break is ever needed). */
const SWITCH_NEIGHBOURS = [
  { dx: 0, dy: -1 }, // N
  { dx: 1, dy: 0 }, // E
  { dx: 0, dy: 1 }, // S
  { dx: -1, dy: 0 }, // W
] as const;

/**
 * Turn the exit module's open-floor `marker` cell into a real, pressable `EXIT_SWITCH` and return that
 * switch's global cell. A switch must be a SOLID wall the player faces with the "use" action while standing
 * on the floor in front of it — so, scanning the marker's in-bounds orthogonal neighbours in the fixed
 * N,E,S,W order, this stamps the FIRST wall neighbour as the switch (the marker stays open floor right in
 * front of it). If the marker sits in fully open space (no wall neighbour at all), it converts the first
 * neighbour — a floor cell — into the wall switch instead. Either way the invariant always holds: the
 * `EXIT_SWITCH` cell is a wall orthogonally adjacent to open floor (reachable + pressable).
 *
 * Mutates `cells` in place (the freshly stitched, owned array). Pure + deterministic — the fixed scan order
 * fully determines the switch cell, so the same seed replays the identical exit.
 */
function placeExitSwitch(
  cells: number[],
  width: number,
  height: number,
  marker: { x: number; y: number },
): { x: number; y: number } {
  const candidates = SWITCH_NEIGHBOURS.map(({ dx, dy }) => ({
    x: marker.x + dx,
    y: marker.y + dy,
  })).filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
  // The marker is always module-interior, so it has the four in-bounds neighbours `candidates[0]` indexes
  // (no dead empty-fallback branch): prefer the first solid wall, else convert the first floor neighbour.
  // `parseModule` only ever emits 0 (open) or 1 (wall) — doorways are open floor — so "non-zero" here can
  // only be a plain wall: overwriting it with `EXIT_SWITCH` never severs a doorway or other special cell.
  const target = candidates.find((c) => cells[c.y * width + c.x] !== 0) ?? candidates[0]!;

  cells[target.y * width + target.x] = EXIT_SWITCH;

  return { x: target.x, y: target.y };
}

/**
 * Assemble a complete, reachability-by-construction level from a `seed` + a prefab `library` on a
 * `gridW×gridH` meta-grid: plan the grid, pick a module per slot, stitch them into one map, then resolve
 * the spawn, the exit-switch cell, and every content marker to global coords. Pure + deterministic — a
 * single `rng` drives the plan AND the per-slot picks, so the same seed replays the identical layout.
 *
 * A slot `i` sits at global cell offset `(gx*MODULE_SIZE, gy*MODULE_SIZE)` (`gx = i % gridW`, `gy = ⌊i /
 * gridW⌋`); a module-local marker `(mx, my)` maps to the global cell `(gx*MODULE_SIZE + mx, gy*MODULE_SIZE +
 * my)`, and entities sit at its CENTRE (`+0.5`).
 * The entrance is always a top-row module whose path descends, so the spawn faces +y (`π/2`).
 */
export function assembleLayout(
  seed: number,
  library: readonly Module[],
  gridW: number,
  gridH: number,
): AssembledLayout {
  const rng = makeRng(seed);
  const plan = carveGrid(rng, gridW, gridH);
  const chosen = plan.slots.map((slot) => selectModule(rng, slot, library));
  const stitched = stitchModules(chosen, gridW, gridH);
  const { modulesBySlot } = stitched;
  // Own a mutable copy of the stitched cells so the exit switch can be stamped into it without touching the
  // (readonly) stitched map; `map` below is rebuilt over this array.
  const cells = stitched.map.cells.slice();

  // Slot index → global cell offset of its module's top-left corner.
  const offsetOf = (slot: number): { ox: number; oy: number } => ({
    ox: (slot % gridW) * MODULE_SIZE,
    oy: ((slot / gridW) | 0) * MODULE_SIZE,
  });

  // Spawn: the entrance module's spawn marker (else its centre), offset to the grid and cell-centred.
  const entrance = offsetOf(plan.entrance);
  const spawnCell = modulesBySlot[plan.entrance].spawn ?? MODULE_CENTRE;
  const spawn: Pose = {
    x: entrance.ox + spawnCell.x + 0.5,
    y: entrance.oy + spawnCell.y + 0.5,
    z: 0,
    dir: Math.PI / 2, // the entrance is top-row; its path descends, so face +y
  };

  // Exit: the exit module's switch marker (else its centre) is an open-floor cell; turn the wall beside it
  // (in N,E,S,W order; failing any wall, a converted floor neighbour) into a real, pressable `EXIT_SWITCH`.
  const exitOffset = offsetOf(plan.exit);
  const exitCell = modulesBySlot[plan.exit].exitSwitch ?? MODULE_CENTRE;
  const marker = { x: exitOffset.ox + exitCell.x, y: exitOffset.oy + exitCell.y };
  const exit = placeExitSwitch(cells, stitched.map.width, stitched.map.height, marker);

  // Collect EVERY module's content markers, offset to global cell centres, into runtime entities (the
  // defaults mirror `core/services/game/module-preview.ts`).
  const enemies: Enemy[] = [];
  const pickups: Pickup[] = [];
  const ammoSpawns: AmmoSpawn[] = [];
  const keys: Keycard[] = [];

  modulesBySlot.forEach((module, slot) => {
    const { ox, oy } = offsetOf(slot);
    const resolved = moduleEntities(module, ox, oy);

    enemies.push(...resolved.enemies);
    pickups.push(...resolved.pickups);
    ammoSpawns.push(...resolved.ammoSpawns);
    keys.push(...resolved.keys);
  });

  const map: GameMap = { ...stitched.map, cells };

  return { map, spawn, exit, enemies, pickups, ammoSpawns, keys };
}
