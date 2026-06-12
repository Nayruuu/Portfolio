import type { GameMap } from './game-map';
import type { Enemy, Keycard, Pickup, Pose } from './types';

export type ThemeName = 'openspace' | 'meeting' | 'executive';
export type WallStyle = 'brick' | 'panel' | 'plate';

/** The few tones a procedural generator recolours to. Art data, not UI tokens. */
export interface Palette {
  base: string;
  light: string;
  dark: string;
  accent: string;
}

/** A level's look — pure data; `game-textures` turns it into canvases. Wall index 0 and ceil index 0
 *  are placeholders (0 wall = empty space; 0 ceil = open sky). */
export interface Theme {
  name: ThemeName;
  walls: { style: WallStyle; palette: Palette }[]; // indexed by wall id (1..3 used; 0 unused)
  floors: { palette: Palette; glow: boolean }[]; // indexed by floor-flat id (0 = main floor)
  ceils: { palette: Palette }[]; // indexed by ceil-flat id (0 = sky placeholder, unsampled)
  sky: string; // sky colour for ceil id 0
  fog: string; // distance-shade tint
}

/** A placed ammo box in the level's data: a world position + the descriptor id (`box_staples`) the shell
 *  resolves — via `ammo-pickups.json` for `ammoType`/`amount` and `weapons.json` `ammo_types` for `max` — into
 *  a runtime `AmmoPickup`. The pure core never resolves the descriptor; it only carries the placement. */
export interface AmmoSpawn {
  x: number;
  y: number;
  pickupId: string; // an `ammo-pickups.json` key (e.g. 'box_staples')
}

export interface Level {
  map: GameMap;
  floorFlats: readonly number[]; // row-major, map dims — floor-flat id per cell
  ceilFlats: readonly number[]; // row-major, map dims — ceil-flat id per cell (0 = sky)
  spawn: Pose;
  enemies: readonly Enemy[];
  pickups: readonly Pickup[];
  ammoSpawns: readonly AmmoSpawn[]; // rotating ammo boxes (resolved to `AmmoPickup`s by the shell)
  keys: readonly Keycard[]; // keycards that unlock this floor's coloured doors
  theme: Theme;
}

// ---- palettes (office tones) ----
// open-space: grey-blue cubicle farm
const CUBICLE: Palette = { base: '#2a3038', light: '#5a6b7a', dark: '#161a1f', accent: '#7fa0b8' };
const GLASS: Palette = { base: '#1c2a2e', light: '#3a8a8a', dark: '#0e1517', accent: '#6fd0d0' };
const DIVIDER: Palette = { base: '#2c2c30', light: '#7a7a82', dark: '#101012', accent: '#cfd2dc' };
const CARPET: Palette = { base: '#20262b', light: '#3a4650', dark: '#0e1216', accent: '#4a5a66' };
const SCREENGLOW: Palette = {
  base: '#102038',
  light: '#3a6fd0',
  dark: '#060d18',
  accent: '#6fa0ff',
};
// meeting: glass / wood / whiteboard
const GLASSWALL: Palette = {
  base: '#1c2a2e',
  light: '#4a9a9a',
  dark: '#0e1517',
  accent: '#8fe0e0',
};
const WOODPANEL: Palette = {
  base: '#2e2014',
  light: '#8a5a32',
  dark: '#150e08',
  accent: '#c08040',
};
const WHITEBOARD: Palette = {
  base: '#c8ccc4',
  light: '#f0f4ec',
  dark: '#9aa096',
  accent: '#2a6fd0',
};
const MEETINGFLOOR: Palette = {
  base: '#26201a',
  light: '#4a3a2a',
  dark: '#100c08',
  accent: '#6a5440',
};
const PROJECTOR: Palette = {
  base: '#2a2810',
  light: '#d0c050',
  dark: '#14120a',
  accent: '#ffe070',
};
// executive: dark wood / marble / brass
const DARKWOOD: Palette = { base: '#241810', light: '#6a4226', dark: '#100a06', accent: '#9a6030' };
const MARBLE: Palette = { base: '#26242a', light: '#7a7686', dark: '#100f12', accent: '#c8c4d4' };
const BRASS: Palette = { base: '#2e2410', light: '#b08a30', dark: '#150f06', accent: '#ffd060' };
const EXECFLOOR: Palette = {
  base: '#1e1c22',
  light: '#46424e',
  dark: '#0c0b0e',
  accent: '#6a6678',
};
const GOLDINLAY: Palette = {
  base: '#2a1e06',
  light: '#d0a030',
  dark: '#140e02',
  accent: '#ffd870',
};
// ceilings (acoustic tile / dark)
const OFFICECEIL: Palette = {
  base: '#14181a',
  light: '#262d30',
  dark: '#080a0b',
  accent: '#303a3e',
};
const DARKCEIL: Palette = { base: '#1a1410', light: '#332720', dark: '#0a0806', accent: '#40302a' };
const SKYBLANK: Palette = { base: '#000000', light: '#000000', dark: '#000000', accent: '#000000' }; // ceil id 0 — unsampled

const THEMES: Record<ThemeName, Theme> = {
  openspace: {
    name: 'openspace',
    walls: [
      { style: 'panel', palette: CUBICLE },
      { style: 'panel', palette: CUBICLE },
      { style: 'panel', palette: GLASS },
      { style: 'plate', palette: DIVIDER },
    ],
    floors: [
      { palette: CARPET, glow: false },
      { palette: SCREENGLOW, glow: true },
    ],
    ceils: [{ palette: SKYBLANK }, { palette: OFFICECEIL }],
    sky: '#0b0f12',
    fog: '#000000',
  },
  meeting: {
    name: 'meeting',
    walls: [
      { style: 'panel', palette: WOODPANEL },
      { style: 'panel', palette: WOODPANEL },
      { style: 'panel', palette: GLASSWALL },
      { style: 'brick', palette: WHITEBOARD },
    ],
    floors: [
      { palette: MEETINGFLOOR, glow: false },
      { palette: PROJECTOR, glow: true },
    ],
    ceils: [{ palette: SKYBLANK }, { palette: OFFICECEIL }],
    sky: '#14110c',
    fog: '#0a0806',
  },
  executive: {
    name: 'executive',
    walls: [
      { style: 'panel', palette: DARKWOOD },
      { style: 'panel', palette: DARKWOOD },
      { style: 'plate', palette: MARBLE },
      { style: 'plate', palette: BRASS },
    ],
    floors: [
      { palette: EXECFLOOR, glow: false },
      { palette: GOLDINLAY, glow: true },
    ],
    ceils: [{ palette: SKYBLANK }, { palette: DARKCEIL }],
    sky: '#18120a',
    fog: '#0c0804',
  },
};

/** Themes in level order; the service cycles through these by `levelIndex`. */
export const THEME_CYCLE: readonly Theme[] = [THEMES.openspace, THEMES.meeting, THEMES.executive];
