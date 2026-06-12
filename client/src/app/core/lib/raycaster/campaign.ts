import { applyTheme, buildAssembledLevel } from './assembled-level';
import { moduleEntities } from './assembler';
import { ACCUEIL } from './campaign-levels';
import { EXIT_SWITCH } from './game-map';
import { THEME_CYCLE } from './levels';
import { parseModule } from './module';
import type { GameMap } from './game-map';
import type { Level } from './levels';
import type { ModuleDef } from './module';
import type { Pose } from './types';

/** The hand-authored campaign, in play order. Indices `0..CAMPAIGN.length-1` are bespoke levels; everything
 *  beyond is the procedural assembler ("Endless mode"), offset so it resumes at its own level 0. */
export const CAMPAIGN: readonly ModuleDef[] = [ACCUEIL];

/**
 * Build the render-ready `Level` for level `index` of a run seeded by `seed`:
 *
 *  - `index < CAMPAIGN.length` → a HAND-AUTHORED level: parse its ASCII map, build the `GameMap` (cells +
 *    diagonals + sectors), stamp the `EXIT_SWITCH` (id 9) at the authored `X`, theme it (cycling like the
 *    rest of the game), and resolve the spawn + entities (REUSING the assembler's `moduleEntities`
 *    converter). Pure + deterministic — a hand map ignores `seed`, so the same `index` always replays it.
 *  - `index >= CAMPAIGN.length` → ENDLESS: the procedural `buildAssembledLevel`, offset so the first
 *    post-campaign level is assembler level 0.
 *
 * A hand-authored `ModuleDef` always carries a spawn + an exit-switch marker (the level is unplayable
 * without them), so both are asserted present here rather than guarded — the campaign tests cover it.
 */
export function buildLevel(seed: number, index: number): Level {
  if (index >= CAMPAIGN.length) {
    return buildAssembledLevel(seed, index - CAMPAIGN.length);
  }

  const module = parseModule(CAMPAIGN[index]);
  const cells = module.cells.slice();
  const exit = module.exitSwitch!; // authored `X` — a hand level always carries one (see the doc above)

  cells[exit.y * module.width + exit.x] = EXIT_SWITCH; // a solid, pressable wall the player faces to advance

  const map: GameMap = {
    width: module.width,
    height: module.height,
    cells,
    diagonals: module.diagonals,
    sectors: module.sectors,
    sectorId: module.sectorId,
  };
  const theme = THEME_CYCLE[index % THEME_CYCLE.length];
  const themed = applyTheme(map, theme);
  const start = module.spawn!; // authored `S` — a hand level always carries one (see the doc above)
  const spawn: Pose = { x: start.x + 0.5, y: start.y + 0.5, z: 0, dir: 0 };

  return { ...themed, spawn, ...moduleEntities(module, 0, 0), theme };
}
