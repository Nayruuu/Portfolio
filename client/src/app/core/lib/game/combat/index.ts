// core/lib/game/combat — the art-free combat entities: the player projectile + its impact/arc bursts, the
// shootable barrel, and the per-zone combat frame. Re-exported through the game sub-barrel
// (core/lib/game/index.ts).
export * from './projectile';
export * from './barrel';
export * from './combat-frame';
export * from './player-combat-frame';
export * from './hittables';
export * from './weapon-fire';
export * from './projectile-step';
