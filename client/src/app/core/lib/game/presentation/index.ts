// Game presentation layer — the canvas/viewmodel helpers the BSP feature draws with. `loaded-image` stays
// off this sub-barrel as an internal helper (only DoomHud/WeaponView/ClimbView consume it), not for SSR —
// it guards `new Image()` behind a DOM check, so it is SSR-safe wherever imported.
export * from './climb-frames';
export * from './climb-view';
export * from './doom-hud';
export * from './effects';
export * from './gaze';
export * from './weapon-view';
export * from './weapons';
