// core/lib/game — the pure combat subset the BSP game reuses: the combat types, the magazine / fire-rate
// subsystem, and the shared tuning constants. Zero DOM, fully unit-tested. (The old raycaster engine +
// grid game that lived here were removed.)
export * from './types';
export * from './arsenal';
export * from './combat-constants';
