// core/lib/game/doors — the pure door RULE kernels: the animated-door openness progression, its openness →
// ceilZ interpolation, the sliding-glass panel's proximity-driven auto-closing progression, and their
// tuning constants. The shell owns the stateful application (mutating live sector heights / the slide
// array) + the DOM/proximity reads; these decide the per-frame values. Re-exported through the game
// sub-barrel (core/lib/game/index.ts).
export * from './door-constants';
export * from './step-door-openness';
export * from './door-ceil-z';
export * from './step-slide-openness';
