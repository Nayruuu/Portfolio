import type { Level } from '../level';
import {
  ACCUEIL,
  DEMO_LEVEL,
  HANGAR,
  M1_LOBBY,
  M2_OPENSPACE,
  M3_HR,
  M4_MEETINGS,
  M5_CAFETERIA,
  M6_DIRECTION,
  M7_SERVEURS,
  SHOWROOM,
} from '../levels';

// Zone registry + dev-time URL overrides (?level ?spawn=x,y,angle[rad] ?noenemies ?perflog ?nogov
// ?renderer=cpu). Parsing/resolution are PURE and junk-tolerant — a bad URL never crashes the game.

export const LEVELS: Readonly<Record<string, Level>> = {
  m1: M1_LOBBY,
  m2: M2_OPENSPACE,
  m3: M3_HR,
  m4: M4_MEETINGS,
  m5: M5_CAFETERIA,
  m6: M6_DIRECTION,
  m7: M7_SERVEURS,
  accueil: ACCUEIL,
  hangar: HANGAR,
  demo: DEMO_LEVEL,
  showroom: SHOWROOM,
};

export const DEFAULT_LEVEL_KEY = 'm1';

export interface LevelParams {
  readonly levelKey: string; // RAW requested key — resolveZone falls back on unknown keys
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number } | null;
  readonly noEnemies: boolean;
  readonly perfRing: boolean;
  readonly noGovernor: boolean;
  readonly renderer: 'cpu' | 'gpu';
}

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

export interface ZoneLoad {
  readonly key: string;
  readonly level: Level;
  readonly at: { readonly x: number; readonly y: number; readonly angle: number };
}

export function resolveZone(key: string, entry: string | undefined, params: LevelParams): ZoneLoad {
  const resolved = LEVELS[key] === undefined ? DEFAULT_LEVEL_KEY : key;
  const base = LEVELS[resolved];
  const level = params.noEnemies ? { ...base, enemies: [] } : base;
  const urlKey = LEVELS[params.levelKey] === undefined ? DEFAULT_LEVEL_KEY : params.levelKey;
  // the dev spawn override applies only when THIS zone is the URL's own level (initial load + restarts)
  const at =
    entry !== undefined
      ? (level.entries?.[entry] ?? level.spawn)
      : resolved === urlKey && params.spawn !== null
        ? params.spawn
        : level.spawn;

  return { key: resolved, level, at };
}
