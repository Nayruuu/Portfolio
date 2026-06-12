import { describe, it, expect } from 'vitest';
import { parseModule } from './module';
import { FLAT_ROOM, LEDGE_ROOM, MODULE_LIBRARY } from './modules';
import {
  assembleLayout,
  carveGrid,
  exitMask,
  selectModule,
  type AssembledLayout,
} from './assembler';
import { isWall } from './game-map';
import { makeRng } from './rng';

/** The seed + grid-size sweep the assembler invariants are asserted over (the shipping 3×3 plus larger
 *  grids, so single- AND multi-door side masks all occur). */
const SWEEP_SIZES: readonly (readonly [number, number])[] = [
  [3, 3], // the shipping grid
  [4, 3],
  [4, 4],
  [5, 5],
];

/** Flood the open-floor cells (`cell === 0`) reachable from the spawn (4-connectivity), then report whether
 *  any cell orthogonally adjacent to the exit-switch wall was reached — the spawn→exit reachability invariant. */
function reachesExit(layout: AssembledLayout): boolean {
  const { map, spawn, exit } = layout;
  const seen = new Set<number>();
  const start = Math.floor(spawn.y) * map.width + Math.floor(spawn.x);
  const stack = [start];

  seen.add(start);
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const x = cell % map.width;
    const y = (cell / map.width) | 0;

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * map.width + nx;

      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < map.width &&
        ny < map.height &&
        !seen.has(next) &&
        map.cells[next] === 0
      ) {
        seen.add(next);
        stack.push(next);
      }
    }
  }

  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => seen.has((exit.y + dy) * map.width + (exit.x + dx)));
}

describe('example modules', () => {
  it('FLAT_ROOM parses to a 13×13 enclosed room with N/S doors and a spawn', () => {
    const m = parseModule(FLAT_ROOM);

    expect(m.width).toBe(13);
    expect(m.height).toBe(13);
    expect(m.spawn).toEqual({ x: 6, y: 6 });
    expect(m.exits.some((e) => e.edge === 'N')).toBe(true);
    expect(m.exits.some((e) => e.edge === 'S')).toBe(true);
    expect(m.sectors.every((s) => s.floorZ === 0)).toBe(true); // flat
  });

  it('LEDGE_ROOM carries raised sectors (a deliberate step + ledge) and an enemy on top', () => {
    const m = parseModule(LEDGE_ROOM);

    expect(m.sectors.map((s) => s.floorZ)).toEqual([0, 0.3, 0.45]);
    expect(m.enemies).toHaveLength(1);
    expect(m.pickups).toHaveLength(1);
  });
});

describe('MODULE_LIBRARY', () => {
  it('every entry is a parsed 13×13 module carrying at least one 2-cell doorway', () => {
    for (const m of MODULE_LIBRARY) {
      expect(m.width).toBe(13);
      expect(m.height).toBe(13);
      // Every doorway is 2 cells wide → 2 exits per door edge. Every module carries at least one door edge
      // (≥2 exits): the single-door `path` END CAPS (the entrance/exit stepping sideways along a row) and
      // the `side`/landmark rooms each have exactly one; the through-route `path` pieces have two or more.
      expect(m.exits.length).toBeGreaterThanOrEqual(2);
      // Every door sits on a border edge, so the exit signature is non-empty.
      expect(exitMask(m)).not.toBe(0);
    }
  });

  it('every `path` module carries a tuned fight — ≥2 enemies + an ammo box (a backbone fight, not an empty hall)', () => {
    for (const m of MODULE_LIBRARY) {
      if (m.role !== 'path' || m.name === 'flat_room') {
        continue; // `flat_room` is the N|S safety-net / documented simplest piece, deliberately empty
      }
      expect(m.enemies.length).toBeGreaterThanOrEqual(2);
      expect(m.ammo.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the `path` backbone uses a MIX of kinds — drones (the staple) + some husks + at least one middle-manager — and stocks some health', () => {
    const pathModules = MODULE_LIBRARY.filter((m) => m.role === 'path' && m.name !== 'flat_room');
    const kinds = new Set(pathModules.flatMap((m) => m.enemies.map((e) => e.kind)));

    expect(kinds.has('junior_office_drone')).toBe(true); // the swarm staple
    expect(kinds.has('manager')).toBe(true); // husks (melee pressure)
    expect(kinds.has('middle_manager')).toBe(true); // a bruiser in the bigger rooms
    // Health turns up in roughly half the backbone (the bigger rooms), so 1–3 packs land per level.
    expect(pathModules.some((m) => m.pickups.some((p) => p.kind === 'health'))).toBe(true);
  });

  // The "no empty backbone" guarantee: every `path` slot the generator carves is filled by a real LIBRARY
  // module, never a synthesized `corridor-*` fallback. Were a path mask uncovered, `selectModule` would
  // return a bare corridor and this would fail — so it is the regression net for the swarm backbone.
  it('fills EVERY path slot with a real library module (no synthesized corridor) across seeds + grid sizes', () => {
    const sizes: readonly [number, number][] = [
      [3, 3], // the shipping grid
      [4, 3],
      [4, 4],
      [5, 5],
    ];

    for (const [gridW, gridH] of sizes) {
      for (let seed = 0; seed < 60; seed++) {
        // One rng drives the whole assembly, so re-running `carveGrid` then `selectModule` with a FRESH
        // rng of the same seed replays the exact slot plan + picks `assembleLayout` makes.
        const rng = makeRng(seed);
        const plan = carveGrid(rng, gridW, gridH);
        const chosen = plan.slots.map((slot) => selectModule(rng, slot, MODULE_LIBRARY));

        plan.slots.forEach((slot, i) => {
          if (slot.role === 'path') {
            expect(chosen[i].name.startsWith('corridor-')).toBe(false);
          }
        });
      }
    }
  });

  it('carries real SHAPE VARIETY — several feature modules are non-rectangular octagons (a populated diagonals layer)', () => {
    // The bold-octagon feature rooms (cross, tees, mini-arenas) each carry a non-empty `diagonals` layer; the
    // L-room and pillar rooms add shape via solid `#` only (no chamfer), so they stay all-0 here on purpose.
    const shaped = MODULE_LIBRARY.filter((m) => m.diagonals.some((v) => v !== 0));

    expect(shaped.length).toBeGreaterThanOrEqual(4); // the box feel is broken across multiple rooms, not a one-off
    // All four chamfer orientations (q/e/z/c → 1/3/4/2) appear, proving true 8-sided rooms (every corner bevelled),
    // not a single-cell nick.
    const orients = new Set(MODULE_LIBRARY.flatMap((m) => m.diagonals).filter((v) => v !== 0));

    expect(orients).toEqual(new Set([1, 2, 3, 4]));
    // Each octagon bevels every corner ~3 cells deep, so a shaped module carries several chamfer cells, not one.
    for (const m of shaped) {
      expect(m.diagonals.filter((v) => v !== 0).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('assembles a reachable multi-room level whose spawn lands on open floor, across seeds', () => {
    for (let seed = 0; seed < 8; seed++) {
      const { map, spawn } = assembleLayout(seed, MODULE_LIBRARY, 3, 3);

      expect(map.width).toBe(39);
      expect(map.height).toBe(39);
      expect(isWall(map, spawn.x, spawn.y)).toBe(false);
    }
  });

  // The side-room counterpart of the "no empty backbone" guarantee: every side slot the carver opens a
  // doorway into (`needs !== 0`) is now filled by a real `side` LIBRARY set-piece, never a synthesized
  // `corridor-*`. A fully SEALED side slot (`needs === 0`) has no doorway to author against, so it stays a
  // sealed `corridor-0` box — those are the only side fallbacks left, and they are inaccessible dead space.
  it('fills EVERY doored side slot with a real library set-piece (no synthesized corridor) across seeds + grid sizes', () => {
    let doored = 0;
    let synthesized = 0;
    let sealed = 0;

    for (const [gridW, gridH] of SWEEP_SIZES) {
      for (let seed = 0; seed < 60; seed++) {
        const rng = makeRng(seed);
        const plan = carveGrid(rng, gridW, gridH);
        const chosen = plan.slots.map((slot) => selectModule(rng, slot, MODULE_LIBRARY));

        plan.slots.forEach((slot, i) => {
          if (slot.role !== 'side') {
            return;
          }
          if (slot.needs === 0) {
            sealed += 1; // a sealed island — no doorway, intrinsically un-fillable

            return;
          }
          doored += 1;
          if (chosen[i].name.startsWith('corridor-')) {
            synthesized += 1;
          }
        });
      }
    }

    expect(doored).toBeGreaterThan(0); // the sweep actually exercises doored side slots
    expect(sealed).toBeGreaterThan(0); // … and sealed ones (proving they are excluded on purpose)
    expect(synthesized).toBe(0); // ZERO doored side slots fall back to an empty auto-corridor
  });

  it('keeps every side set-piece LIGHT (≤4 enemies) and spans the four flavours over the library', () => {
    const sideModules = MODULE_LIBRARY.filter((m) => m.role === 'side');

    for (const m of sideModules) {
      expect(m.enemies.length).toBeLessThanOrEqual(4); // side rooms add variety, never raw density
    }
    // A supply cache (health + ammo, no enemies), a husk ambush (≥2 husks + ammo), a mini-arena (a drone
    // cluster + ammo), and a landmark (a raised 0.3 dais — a sector above the base — bearing a reward, no enemies).
    const supplyCache = sideModules.some(
      (m) => m.enemies.length === 0 && m.pickups.length >= 1 && m.ammo.length >= 1,
    );
    const huskAmbush = sideModules.some(
      (m) => m.enemies.filter((e) => e.kind === 'manager').length >= 2 && m.ammo.length >= 1,
    );
    const miniArena = sideModules.some(
      (m) => m.enemies.filter((e) => e.kind === 'junior_office_drone').length >= 3,
    );
    const landmark = sideModules.some((m) => m.enemies.length === 0 && m.sectors.length > 1);

    expect(supplyCache).toBe(true);
    expect(huskAmbush).toBe(true);
    expect(miniArena).toBe(true);
    expect(landmark).toBe(true);
  });

  it('assembles reachable levels (spawn → exit) whose density stays in a sane band, across seeds', () => {
    for (let seed = 0; seed < 60; seed++) {
      const layout = assembleLayout(seed, MODULE_LIBRARY, 3, 3);

      expect(reachesExit(layout)).toBe(true); // the side rooms never sever the spawn→exit route
      // The backbone carries the swarm (~12–20); light side rooms must not balloon the shipping-grid total.
      expect(layout.enemies.length).toBeLessThanOrEqual(28);
    }
  });
});
