// core/lib/game — the pure game subset the BSP game reuses: the combat types, the magazine / fire-rate
// subsystem, the shared tuning constants, and the render governor (the contention-resilience decision
// core behind the worker pool). Zero DOM, fully unit-tested.
export * from './types';
export * from './enemy';
export * from './combat';
export * from './controls';
export * from './doors';
export * from './telemetry';
export * from './weapons';
export * from './zone';
export * from './level';
export * from './levels';
export * from './registry';
