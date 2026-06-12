import { WALL_HEIGHT } from './floor-cast';
import { doorCell } from './game-map';
import type { Sector } from './sector';
import type { EnemyKind, KeycardColor } from './types';

/** A prefab module's gameplay role — where the assembler is allowed to place it. */
export type ModuleRole = 'path' | 'side' | 'arena' | 'landmark' | 'secret';

/** A module edge (N/S = top/bottom rows, W/E = left/right columns). */
export type Edge = 'N' | 'S' | 'E' | 'W';

/** What one layout character means. Absent fields default (`floorZ` 0, not a wall). */
export interface CellSpec {
  wall?: boolean;
  floorZ?: number;
  door?: boolean;
  spawn?: boolean;
  exitSwitch?: boolean;
  enemy?: EnemyKind;
  pickup?: 'health' | 'armor';
  ammo?: string;
  keycard?: KeycardColor;
  /** A SOLID keyed door of this colour — the cell becomes the `DOOR_BASE + colour` wall id (red 10, blue 11,
   *  yellow 12), the same ids the engine's `facingDoorIndex`/`doorGroup` open when the player holds the
   *  matching keycard. Unlike `door` (an inter-module edge doorway for the assembler), this is an in-map gate
   *  a hand-authored campaign level uses to lock a wing behind its keycard. */
  lockedDoor?: KeycardColor;
  /** A 45° chamfer cutting one corner of this (SOLID wall) cell — the orientation matches
   *  `GameMap.diagonals` (1 = NW, 2 = SE on the `/` line; 3 = NE, 4 = SW on the `\` line). A chamfered
   *  cell carries a normal wall id too (its `wall` must be `true`), so non-render consumers stay unchanged. */
  diagonal?: 1 | 2 | 3 | 4;
}

/** A hand-authored prefab: an ASCII `layout` grid + a per-module `legend` of char → meaning. */
export interface ModuleDef {
  name: string;
  role: ModuleRole;
  layout: string;
  legend?: Record<string, CellSpec>;
}

/** A doorway on a module edge — the assembler aligns facing exits to connect two modules. */
export interface Exit {
  edge: Edge;
  position: number; // offset along the edge (x for N/S, y for E/W)
  floorZ: number;
}

/** The parsed, render-ready module: geometry + exits + content markers (module-local cell coords). */
export interface Module {
  name: string;
  role: ModuleRole;
  width: number;
  height: number;
  cells: number[]; // row-major: 0 open, 1 wall
  diagonals: number[]; // row-major, parallel to `cells`: 0 = none, 1..4 = 45° chamfer orientation
  sectors: Sector[];
  sectorId: number[];
  exits: Exit[];
  spawn?: { x: number; y: number };
  exitSwitch?: { x: number; y: number };
  enemies: { x: number; y: number; kind: EnemyKind }[];
  pickups: { x: number; y: number; kind: 'health' | 'armor' }[];
  ammo: { x: number; y: number; pickupId: string }[];
  keycards: { x: number; y: number; color: KeycardColor }[];
}

/** The fixed default alphabet; a module's `legend` overrides per char. Floor materials are placeholders
 *  (0) — the level adapter assigns real flat ids from a theme. An unknown char falls back to a wall. */
const DEFAULT_LEGEND: Record<string, CellSpec> = {
  '#': { wall: true },
  '.': { floorZ: 0 },
  D: { door: true, floorZ: 0 },
  S: { spawn: true, floorZ: 0 },
  X: { exitSwitch: true, floorZ: 0 },
  E: { enemy: 'manager', floorZ: 0 }, // the husk (melee)
  d: { enemy: 'junior_office_drone', floorZ: 0 }, // the ranged drone — the swarm staple
  m: { enemy: 'middle_manager', floorZ: 0 }, // the ranged bruiser
  G: { enemy: 'security_guard', floorZ: 0 }, // the tough ranged guard — a mini-threat per arena
  P: { pickup: 'health', floorZ: 0 },
  V: { pickup: 'armor', floorZ: 0 }, // a vest — the armor counterpart of the `P` health pack
  A: { ammo: 'box_staples', floorZ: 0 },
  K: { keycard: 'red', floorZ: 0 },
  j: { keycard: 'blue', floorZ: 0 }, // the blue keycard (`b` unlocks the matching blue door)
  b: { lockedDoor: 'blue' }, // a SOLID blue-keyed door cell (id 11) — gates a wing behind the blue keycard
  // Four 45° corner chamfers — a SOLID wall whose named corner is cut, so modules author octagons etc. The
  // mnemonic places each char where its chamfer sits: q/e on the top row (NW/NE), z/c on the bottom (SW/SE).
  // Orientations match `generate-level.ts`'s octagon convention (`cornerOrients = [1, 3, 4, 2]` for the room
  // corners [NW, NE, SW, SE]): the solid triangle faces the cut corner, so the hypotenuse opens inward.
  q: { wall: true, diagonal: 1 }, // NW corner cut (solid toward top-left)
  e: { wall: true, diagonal: 3 }, // NE corner cut (solid toward top-right)
  z: { wall: true, diagonal: 4 }, // SW corner cut (solid toward bottom-left)
  c: { wall: true, diagonal: 2 }, // SE corner cut (solid toward bottom-right)
};

function specFor(ch: string, legend: Record<string, CellSpec> | undefined): CellSpec {
  return legend?.[ch] ?? DEFAULT_LEGEND[ch] ?? { wall: true }; // unknown char → wall (safe enclosure)
}

/** Split the template-literal layout into equal-width rows: trim each line (the source indentation is not
 *  significant — modules are full grids), drop blank lines, then right-pad short rows with walls. */
function rowsOf(layout: string): string[] {
  const trimmed = layout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const width = Math.max(...trimmed.map((line) => line.length));

  return trimmed.map((line) => line.padEnd(width, '#'));
}

/**
 * Parse a hand-authored `ModuleDef` into a render-ready `Module`: a `width×height` cells grid (0 open / 1
 * wall), one `Sector` per distinct floor height (`ceilZ = floorZ + WALL_HEIGHT`) with the per-cell
 * `sectorId`, the edge `exits` (one per `door` char on an edge, carrying its height), and the content
 * markers in module-local coords. Pure.
 */
export function parseModule(def: ModuleDef): Module {
  const rows = rowsOf(def.layout);
  const height = rows.length;
  const width = rows[0].length;
  const cells: number[] = new Array(width * height);
  const diagonals: number[] = new Array(width * height).fill(0); // 45° chamfer per cell (0 = none)
  const floorZ: number[] = new Array(width * height); // per-cell floor height (walls reuse base 0)
  const exits: Exit[] = [];
  const enemies: Module['enemies'] = [];
  const pickups: Module['pickups'] = [];
  const ammo: Module['ammo'] = [];
  const keycards: Module['keycards'] = [];
  let spawn: Module['spawn'];
  let exitSwitch: Module['exitSwitch'];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const spec = specFor(rows[y][x], def.legend);
      // A locked door is a SOLID coloured wall id (`DOOR_BASE + colour`); otherwise a plain wall is 1 and
      // open floor is 0. A solid cell (wall or door) always sits on the base floor (z 0).
      const cellId = spec.lockedDoor ? doorCell(spec.lockedDoor) : spec.wall ? 1 : 0;
      const solid = cellId !== 0;

      cells[i] = cellId;
      diagonals[i] = spec.diagonal ?? 0; // a chamfer char is a wall (above) that records its orientation here
      floorZ[i] = solid ? 0 : (spec.floorZ ?? 0);

      if (spec.door) {
        const z = spec.floorZ ?? 0;

        if (y === 0) {
          exits.push({ edge: 'N', position: x, floorZ: z });
        } else if (y === height - 1) {
          exits.push({ edge: 'S', position: x, floorZ: z });
        } else if (x === 0) {
          exits.push({ edge: 'W', position: y, floorZ: z });
        } else if (x === width - 1) {
          exits.push({ edge: 'E', position: y, floorZ: z });
        }
      }

      if (spec.spawn) {
        spawn = { x, y };
      }
      if (spec.exitSwitch) {
        exitSwitch = { x, y };
      }
      if (spec.enemy) {
        enemies.push({ x, y, kind: spec.enemy });
      }
      if (spec.pickup) {
        pickups.push({ x, y, kind: spec.pickup });
      }
      if (spec.ammo) {
        ammo.push({ x, y, pickupId: spec.ammo });
      }
      if (spec.keycard) {
        keycards.push({ x, y, color: spec.keycard });
      }
    }
  }

  // One sector per distinct floor height present, ascending; every cell maps to its height's index. The
  // ceiling stays FLAT at `WALL_HEIGHT` (it does NOT rise with the floor): only floors step — the validated
  // render path — so the level never has a ceiling height change (a ceiling RISE is not yet rendered, it
  // would leave a gap). Keep authored heights ≤ `WALL_HEIGHT − PLAYER_HEIGHT` so the flat ceiling clears.
  const heights = [...new Set(floorZ)].sort((a, b) => a - b);
  const sectors: Sector[] = heights.map((z) => ({
    floorZ: z,
    ceilZ: WALL_HEIGHT,
    floorMat: 0,
    ceilMat: 0,
  }));
  const sectorId = floorZ.map((z) => heights.indexOf(z));

  return {
    name: def.name,
    role: def.role,
    width,
    height,
    cells,
    diagonals,
    sectors,
    sectorId,
    exits,
    spawn,
    exitSwitch,
    enemies,
    pickups,
    ammo,
    keycards,
  };
}
