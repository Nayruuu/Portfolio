import { assembleLayout } from './assembler';
import { cellAt } from './game-map';
import { THEME_CYCLE } from './levels';
import { MODULE_LIBRARY } from './modules';
import type { GameMap } from './game-map';
import type { Level, Theme } from './levels';
import type { Enemy } from './types';

/**
 * Re-skin a stitched `GameMap` with a theme's flats: the main floor (`floors[0]`, id 0) and the theme's
 * office ceiling (the last `ceils` index — the non-sky tile), applied UNIFORMLY to every cell flat AND every
 * sector's materials (the modules' floor/ceiling HEIGHTS are kept; only their MATERIALS are re-themed). The
 * shared theming step both the prefab assembler and the hand-authored campaign run after building geometry.
 * Pure — returns a fresh themed map + the parallel flat grids.
 */
export function applyTheme(
  map: GameMap,
  theme: Theme,
): { map: GameMap; floorFlats: number[]; ceilFlats: number[] } {
  const floorMat = 0; // the theme's main floor (`theme.floors[0]`)
  const ceilMat = theme.ceils.length - 1; // the theme's office ceiling (last id, never the sky placeholder)
  const sectors = map.sectors!.map((sector) => ({ ...sector, floorMat, ceilMat }));

  return {
    map: { ...map, sectors },
    floorFlats: map.cells.map(() => floorMat),
    ceilFlats: map.cells.map(() => ceilMat),
  };
}

/**
 * Build a render-ready `Level` from the prefab assembler for level `index`, seeded by `seed`. The theme
 * cycles per level (`THEME_CYCLE[index % len]`, like the rest of the game), and every floor/ceiling flat —
 * per cell and per stitched sector — is taken from THAT theme's own ids: the main floor (`floors[0]`, id 0)
 * and the theme's office ceiling (the last `ceils` index, the non-sky tile), applied uniformly. The modules'
 * heights still vary via the stitched sectors (only their MATERIALS are re-themed here); a richer per-zone
 * theming is a later slice.
 *
 * Pure + deterministic: the only randomness is the per-level seed inside `assembleLayout`, so the same
 * `(seed, index)` replays a byte-identical `Level` (no `Date.now`/`Math.random`).
 */
/** The assembler seed for level `index` of a run seeded by `seed` — mixed so each level of the SAME run is a
 *  DISTINCT layout (not just a re-theme), while staying a pure function of `(seed, index)`. Level 0 is the run
 *  seed itself (`seed ^ 0`). */
function levelSeed(seed: number, index: number): number {
  return (seed ^ (index * 0x9e3779b1)) >>> 0; // xor with index × the golden-ratio prime → well-spread layouts
}

/**
 * The meta-grid SIDE (slots per row/column) for level `index` — the difficulty ramp. It starts at 3×3 and
 * grows by one every 5 levels, but is CAPPED at 4×4. The cap is load-bearing: the swarm size scales with the
 * slot count (each slot can carry enemies), so an uncapped 5×5 (25 slots) would balloon the swarm past ~40 —
 * 4×4 (16 slots) is the largest that keeps the fight sane while still ramping size + enemy count with depth.
 * Pure + deterministic (a function of `index` alone): 3×3 for levels 0–4, then 4×4 for level 5 onward.
 */
export function gridFor(index: number): number {
  return Math.min(4, 3 + Math.floor(index / 5));
}

/** Whether level `index` is a BOSS level — every 5th level (the 5th, 10th, 15th…, i.e. indices 4, 9, 14…),
 *  `(index + 1) % 5 === 0`. Pure + deterministic. */
export function isBossLevel(index: number): boolean {
  return (index + 1) % 5 === 0;
}

/** Placeholder boss hit points — far above any regular swarm enemy (the tankiest, the middle manager, is
 *  120) so the boss reads as a damage sponge until a real boss with its own tuning lands. */
export const BOSS_HP = 500;

/** Orthogonal neighbour deltas in N, E, S, W scan order — the deterministic priority for picking the open
 *  floor cell in front of the exit switch the boss stands on (first match wins, no rng tie-break needed). */
const BOSS_NEIGHBOURS = [
  { dx: 0, dy: -1 }, // N
  { dx: 1, dy: 0 }, // E
  { dx: 0, dy: 1 }, // S
  { dx: -1, dy: 0 }, // W
] as const;

/**
 * Append a placeholder boss to a boss level's swarm — a single elevated-hp enemy standing on the open-floor
 * cell directly in front of the (solid wall) exit switch. That neighbour is GUARANTEED to exist and be
 * reachable: the exit switch is always a wall pressable from reached open floor (the assembler's invariant),
 * so scanning its N,E,S,W neighbours always finds an open cell (`cellAt` reads out-of-bounds as solid, so a
 * border switch never matches off-map). The normal swarm is KEPT as-is — the boss is an ADD, never a replace
 * or a thin — so a boss floor is the usual fight PLUS the bruiser. Pure + deterministic.
 *
 * BOSS: placeholder middle_manager until a real boss enemy/sprite lands — swap the `kind`/`hp`/sprite HERE,
 * in this one spot.
 */
function withBoss(map: GameMap, exit: { x: number; y: number }, swarm: readonly Enemy[]): Enemy[] {
  const cell = BOSS_NEIGHBOURS.map(({ dx, dy }) => ({ x: exit.x + dx, y: exit.y + dy })).find(
    (c) => cellAt(map, c.x + 0.5, c.y + 0.5) === 0,
  )!; // a pressable switch always has an open-floor neighbour, so the find never misses
  const boss: Enemy = {
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    dir: 0,
    state: 'alive',
    deathTime: 0,
    hp: BOSS_HP,
    fireCooldown: 2,
    hitFlash: 0,
    windup: 0,
    kind: 'middle_manager', // BOSS: placeholder middle_manager until a real boss enemy/sprite lands
  };

  return [...swarm, boss];
}

export function buildAssembledLevel(seed: number, index: number): Level {
  const theme = THEME_CYCLE[index % THEME_CYCLE.length];
  const side = gridFor(index); // the difficulty ramp: deeper levels assemble on a bigger meta-grid (capped)
  const layout = assembleLayout(levelSeed(seed, index), MODULE_LIBRARY, side, side);
  const themed = applyTheme(layout.map, theme);
  const enemies = isBossLevel(index)
    ? withBoss(layout.map, layout.exit, layout.enemies)
    : layout.enemies;

  return {
    ...themed,
    spawn: layout.spawn,
    enemies,
    pickups: layout.pickups,
    ammoSpawns: layout.ammoSpawns,
    keys: layout.keys,
    theme,
  };
}
