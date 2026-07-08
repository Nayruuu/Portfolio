// core/lib/game/doors — the pure door RULE kernels: the animated-door openness progression, its openness →
// ceilZ interpolation, and the sliding-glass panel's proximity-driven auto-closing progression. The shell
// owns the stateful application (mutating live sector heights / the slide array) + the DOM/proximity reads;
// these decide the per-frame values. Re-exported through the game sub-barrel (core/lib/game/index.ts). The
// door TUNING constants (open speeds + trigger radii) live in the central gameplay balance sheet
// (core/lib/game/game-tuning.ts).
export * from './step-door-openness';
export * from './door-ceil-z';
export * from './step-slide-openness';
