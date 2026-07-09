// Game presentation layer — the canvas/viewmodel helpers the BSP feature draws with. `loaded-image` is
// deliberately NOT re-exported here: it constructs `new Image()` and is imported directly by its consumers
// so the browser-only primitive never rides the SSR-facing barrel.
export * from './climb-frames';
export * from './climb-view';
export * from './doom-hud';
export * from './effects';
export * from './gaze';
export * from './weapon-view';
export * from './weapons';
