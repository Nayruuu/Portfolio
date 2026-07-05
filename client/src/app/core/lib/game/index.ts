// core/lib/game — the pure game subset the BSP game reuses: the combat types, the magazine / fire-rate
// subsystem, the shared tuning constants, and the render governor (the contention-resilience decision
// core behind the worker pool). Zero DOM, fully unit-tested.
export * from './types';
export * from './arsenal';
export * from './combat-constants';
export * from './render-governor';
export * from './weapon-progression';
