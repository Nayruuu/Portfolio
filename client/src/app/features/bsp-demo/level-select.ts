import { ACCUEIL, type Level } from './level-accueil';
import { DEMO_LEVEL } from './level-demo';
import { HANGAR } from './level-hangar';
import { M1_LOBBY } from './level-m1-lobby';

/**
 * Zone registry + dev-time overrides via URL query params — the fast create→test→capture loop for level
 * work. The component loads every zone (the initial URL one AND each open-building transition) through
 * `resolveZone`, so a capture/playtest never requires editing a level file's spawn and rebuilding:
 *
 *   /bsp?level=hangar                 — start in a registry level (default `m1`)
 *   /bsp?spawn=17,108,4.71            — spawn override: `x,y,angle` (angle in RADIANS)
 *   /bsp?noenemies=1                  — strip the enemy roster of EVERY loaded zone (inspection captures)
 *   /bsp?perflog=1                    — record per-frame timings into a ring buffer on `window` (perf runs)
 *   /bsp?nogov=1                      — disable the render governor (fixed workers/resolution — A/B perf runs)
 *   /bsp?renderer=cpu                 — force the CPU worker-pool path (the WebGPU compute backend is the
 *                                       DEFAULT when available; CPU remains the automatic fallback)
 *
 * Parsing and resolution are PURE (`(search) -> LevelParams`, `(key, entry, params) -> ZoneLoad`) and
 * junk-tolerant: a malformed spawn, an unknown level key, or stray params silently fall back to the
 * defaults — the game must never crash on a bad URL.
 */

/** The playable levels, by URL key. `m1` (the episode opener) is the default. */
export const LEVELS: Readonly<Record<string, Level>> = {
  m1: M1_LOBBY,
  accueil: ACCUEIL,
  hangar: HANGAR,
  demo: DEMO_LEVEL,
};

/** The registry key served when no (or an unknown) `?level=` is given. */
export const DEFAULT_LEVEL_KEY = 'm1';

/** The parsed dev params — `levelKey` is the RAW requested key (resolution falls back on unknown keys). */
export interface LevelParams {
  readonly levelKey: string;
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number } | null;
  readonly noEnemies: boolean;
  readonly perfRing: boolean;
  readonly noGovernor: boolean;
  readonly renderer: 'cpu' | 'gpu';
}

/** Parse the dev params out of a `location.search` string. Pure; junk falls back to the defaults
 *  (`spawn` needs exactly three finite numbers, `noenemies`/`perflog`/`nogov` must be literally `1`,
 *  `renderer` must be literally `cpu` to force the CPU path — anything else means "GPU when available",
 *  the CPU staying the automatic fallback). */
export function parseLevelParams(search: string): LevelParams {
  const params = new URLSearchParams(search);
  let spawn: LevelParams['spawn'] = null;
  const rawSpawn = params.get('spawn');

  if (rawSpawn !== null) {
    const nums = rawSpawn.split(',').map((n) => Number.parseFloat(n));

    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      spawn = { x: nums[0], y: nums[1], angle: nums[2] };
    }
  }

  return {
    levelKey: params.get('level') ?? DEFAULT_LEVEL_KEY,
    spawn,
    noEnemies: params.get('noenemies') === '1',
    perfRing: params.get('perflog') === '1',
    noGovernor: params.get('nogov') === '1',
    renderer: params.get('renderer') === 'cpu' ? 'cpu' : 'gpu',
  };
}

/** A resolved zone load: the registry key actually served, the level to mount (with the dev overrides
 *  applied), and where to place the player. */
export interface ZoneLoad {
  readonly key: string; // the RESOLVED registry key (unknown requested keys fall back to the default)
  readonly level: Level;
  readonly at: { readonly x: number; readonly y: number; readonly angle: number };
}

/** Resolve a zone to load — the single path for BOTH the initial URL level and every open-building
 *  transition. Placement: a named `entry` (a graph arrival — unknown names fall back to the level spawn),
 *  else the dev `spawn` override (only when the zone IS the URL's own level: initial load + restarts),
 *  else the level spawn. `noenemies` strips the roster of every loaded zone. Registry entries are never
 *  mutated. */
export function resolveZone(key: string, entry: string | undefined, params: LevelParams): ZoneLoad {
  const resolved = LEVELS[key] === undefined ? DEFAULT_LEVEL_KEY : key;
  const base = LEVELS[resolved];
  const level = params.noEnemies ? { ...base, enemies: [] } : base;
  const urlKey = LEVELS[params.levelKey] === undefined ? DEFAULT_LEVEL_KEY : params.levelKey;
  const at =
    entry !== undefined
      ? (level.entries?.[entry] ?? level.spawn)
      : resolved === urlKey && params.spawn !== null
        ? params.spawn
        : level.spawn;

  return { key: resolved, level, at };
}
