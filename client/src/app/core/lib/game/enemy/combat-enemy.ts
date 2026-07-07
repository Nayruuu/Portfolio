// core/lib/game/enemy/combat-enemy — the RUNTIME enemy entity the AI/combat step reads/writes, plus the
// thrower projectile it spawns in flight. Art-free: the entity carries only its combat `spec` ({@link
// EnemyCombat}); the feature's `Foe` narrows `spec` to the full art+combat `EnemySpec` for the renderer.

import type { EnemyCombat, EnemyProjectile } from './enemy-spec';

/** A live or dying enemy instance as the AI/combat step sees it: its combat `spec` (kind) + world pose +
 *  walk-anim travel, hp, the white hit-flash timer, the death timer (`dying` → a corpse), and the attack
 *  timers. The feature widens this to `Foe` (overriding `spec` with the full art spec) for rendering. */
export interface CombatEnemy {
  readonly spec: EnemyCombat;
  x: number;
  y: number;
  z: number;
  walkDist: number;
  hp: number;
  dying: boolean;
  deathTime: number;
  hitFlash: number;
  windup: number; // seconds left on a telegraphed attack wind-up (0 = not attacking)
  cooldown: number; // seconds until it can attack again
}

/** A thrower's projectile in flight: a spinning billboard that hurts the player on contact (dodgeable).
 *  Liveness is positional: `stepEnemyShots` compacts spent shots out of its zone's array in place. */
export interface EnemyShot {
  x: number;
  y: number;
  z: number;
  readonly dx: number;
  readonly dy: number;
  readonly proj: EnemyProjectile;
  traveled: number;
}
