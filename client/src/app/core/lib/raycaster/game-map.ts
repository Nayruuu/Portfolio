import { KEYCARD_COLORS } from './types';
import type { Enemy, KeycardColor, Pose } from './types';
import type { Sector } from './sector';

/** A grid level: row-major `cells`, 0 = empty, > 0 = wall id. The game's real levels live in
 *  `levels.ts`; `SAMPLE_*` below is the small canonical fixture the pure-engine specs cast against. */
export interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly number[];
  /** Optional 45° face per cell, row-major and parallel to `cells`: 0 = none, 1..4 = orientation
   *  (1 = NW, 2 = SE on the `/` line; 3 = NE, 4 = SW on the `\` line). A diagonal cell still carries
   *  a normal wall id in `cells`, so every non-raycast consumer stays byte-identical. */
  readonly diagonals?: readonly number[];
  /** Optional sector table — each space's floor/ceiling height + materials. The parallel `sectorId` maps
   *  every cell to its sector index. Both optional (like `diagonals`) so a map without them stays a valid
   *  flat level; populated by the generator's `sectorize` step. Heights are all flat today — sub-project A2
   *  varies them + makes the renderer/physics consume them. */
  readonly sectors?: readonly Sector[];
  readonly sectorId?: readonly number[];
}

/** An 8×8 enclosed room with mixed-material walls (1 = brick, 2 = tech-panel, 3 = metal). Engine-test
 *  fixture (move / raycast / fire / enemy / game-step specs cast against it). */
export const SAMPLE_LEVEL: GameMap = {
  width: 8,
  height: 8,
  // prettier-ignore
  cells: [
    1, 1, 1, 2, 2, 1, 1, 1,
    1, 0, 0, 0, 0, 0, 0, 1,
    1, 0, 0, 3, 0, 0, 0, 1,
    2, 0, 0, 0, 0, 2, 0, 2,
    2, 0, 3, 0, 0, 0, 0, 2,
    1, 0, 0, 0, 2, 0, 0, 1,
    1, 0, 0, 0, 0, 0, 0, 1,
    1, 1, 1, 2, 2, 1, 1, 1,
  ],
};

/** Spawn for `SAMPLE_LEVEL` (center of the top-left empty cell, facing +x). */
export const SAMPLE_SPAWN = { x: 1.5, y: 1.5, dir: 0 };

/** Wandering enemies for `SAMPLE_LEVEL`, placed on open floor, facing assorted headings. */
export const SAMPLE_ENEMIES: readonly Enemy[] = [
  {
    x: 4.5,
    y: 1.5,
    dir: 0,
    state: 'alive',
    deathTime: 0,
    hp: 4,
    fireCooldown: 0,
    hitFlash: 0,
    windup: 0,
    kind: 'manager',
  },
  {
    x: 2.5,
    y: 5.5,
    dir: 0,
    state: 'alive',
    deathTime: 0,
    hp: 4,
    fireCooldown: 0,
    hitFlash: 0,
    windup: 0,
    kind: 'manager',
  },
  {
    x: 6.5,
    y: 5.5,
    dir: Math.PI / 2,
    state: 'alive',
    deathTime: 0,
    hp: 4,
    fireCooldown: 0,
    hitFlash: 0,
    windup: 0,
    kind: 'manager',
  },
];

/** Wall id at a world coordinate; out-of-bounds is solid (1). */
export function cellAt(map: GameMap, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) {
    return 1;
  }

  return map.cells[cy * map.width + cx];
}

/** Diagonal orientation (1..4) at a world coordinate; a map with no `diagonals` layer, or any
 *  out-of-bounds coordinate, is 0 (no diagonal). */
export function diagAt(map: GameMap, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  if (!map.diagonals || cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) {
    return 0;
  }

  return map.diagonals[cy * map.width + cx];
}

/** Whether the cell-local point (u, v) — each in 0..1 — falls in the solid half of a 45° face of
 *  orientation `diag`: 1 = NW (u+v<1), 2 = SE (u+v>1), 3 = NE (u>v), 4 = SW (v>u). */
export function isSolidLocal(diag: number, u: number, v: number): boolean {
  return diag === 1 ? u + v < 1 : diag === 2 ? u + v > 1 : diag === 3 ? u > v : v > u;
}

export function isWall(map: GameMap, x: number, y: number): boolean {
  const c = cellAt(map, x, y);

  if (c === 0) {
    return false;
  }

  const d = diagAt(map, x, y);

  if (d === 0) {
    return true;
  }

  return isSolidLocal(d, x - Math.floor(x), y - Math.floor(y));
}

/** A wall cell that acts as a level-exit switch (still solid — the player stops in front of it). */
export const EXIT_SWITCH = 9;

/** How far ahead (cells) the "use" action reaches — past the collision radius into the switch cell. */
const USE_REACH = 0.8;

/** True when the cell just ahead of the player (along `dir`) is the exit switch. */
export function isFacingExit(pose: Pose, map: GameMap): boolean {
  const x = pose.x + Math.cos(pose.dir) * USE_REACH;
  const y = pose.y + Math.sin(pose.dir) * USE_REACH;

  return cellAt(map, x, y) === EXIT_SWITCH;
}

/** Base id for locked-door cells: door cell = `DOOR_BASE + colorIndex` (10 = red, 11 = blue,
 *  12 = yellow). Collision-free with wall ids 1..3 and EXIT_SWITCH (9), with a 4..8 buffer. A closed
 *  door is a nonzero, non-diagonal cell, so `isWall` already treats it as solid — no engine change. */
export const DOOR_BASE = 10;

/** Whether a cell id is a locked door (one of the three coloured door ids). */
export function isLockedDoor(cell: number): boolean {
  return cell >= DOOR_BASE && cell < DOOR_BASE + KEYCARD_COLORS.length;
}

/** The colour bit (0..2) of a locked-door cell — the inverse of `doorCell`. */
export function doorColorIndex(cell: number): number {
  return cell - DOOR_BASE;
}

/** The door cell id that a given keycard colour unlocks. */
export function doorCell(color: KeycardColor): number {
  return DOOR_BASE + KEYCARD_COLORS.indexOf(color);
}

/** Whether `heldKeys` holds the keycard for colour bit `colorIndex`. */
export function hasKey(heldKeys: number, colorIndex: number): boolean {
  return (heldKeys & (1 << colorIndex)) !== 0;
}

/** Base id for SEE-THROUGH glass cells: 13 = tinted partition (`glass_partition` surface), 14 = clear
 *  window (`glass_window`). Past the doors (10..12), collision-free with everything below. A glass cell is
 *  a nonzero, non-diagonal cell, so `isWall` already treats it as SOLID (you bump into it) — the only
 *  special handling is the renderer casting THROUGH it (the ray records the pane then continues to the
 *  opaque wall behind, so enemies in the next room show through the glass). */
export const GLASS_BASE = 13;

/** The two glass kinds (partition, window) — their ids are `GLASS_BASE` and `GLASS_BASE + 1`. */
export const GLASS_KINDS = 2;

/** Whether a cell id is see-through glass (a tinted partition or a clear window). */
export function isGlass(cell: number): boolean {
  return cell >= GLASS_BASE && cell < GLASS_BASE + GLASS_KINDS;
}

/** Flat index of the locked-door cell `USE_REACH` ahead of the player (along `dir`), or `null` when
 *  the cell ahead is floor, a plain wall, the exit switch, or out of bounds. Mirrors `isFacingExit`. */
export function facingDoorIndex(pose: Pose, map: GameMap): number | null {
  const x = pose.x + Math.cos(pose.dir) * USE_REACH;
  const y = pose.y + Math.sin(pose.dir) * USE_REACH;

  if (!isLockedDoor(cellAt(map, x, y))) {
    return null;
  }

  return Math.floor(y) * map.width + Math.floor(x);
}

/** The flat indices of the door seam containing cell `di`: a bounded 4-connected flood over cells of
 *  the SAME id (so it never leaks into a wall, the floor, or a different-colour door). Opening a door
 *  clears exactly this group. `width` is the grid stride of the flat `cells` array. */
export function doorGroup(cells: readonly number[], di: number, width: number): number[] {
  const value = cells[di];
  const height = cells.length / width;
  const group: number[] = [];
  const seen = new Set<number>([di]);
  const stack = [di];

  while (stack.length) {
    const idx = stack.pop()!;

    group.push(idx);
    const x = idx % width;
    const y = Math.floor(idx / width);

    for (const [deltaX, deltaY] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborX = x + deltaX;
      const neighborY = y + deltaY;

      if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
        continue;
      }
      const neighbor = neighborY * width + neighborX;

      if (!seen.has(neighbor) && cells[neighbor] === value) {
        seen.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  return group;
}

/** Flat id (floor or ceiling) at a world coordinate from a grid parallel to `map`; oob → 0. */
export function flatAt(flats: readonly number[], map: GameMap, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) {
    return 0;
  }

  return flats[cy * map.width + cx];
}
