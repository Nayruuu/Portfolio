// core/lib/game/enemy/enemy-spec — the ART-FREE combat spec of an enemy kind + its two attack sub-specs.
// Pure data shapes (hp / speed / reach / attack tuning), zero DOM and zero art fields: the atlas/animation
// half lives feature-side as `EnemyArt` (features/bsp-demo/enemies.ts), which composes with this into the
// full `EnemySpec`. The AI/combat/hitscan steps read only these numbers.

/** A ranged enemy's HITSCAN shotgun: an INSTANT blast within `range` — no projectile, no separate burst
 *  sprite (the firing tell is the enemy's own attack animation). */
export interface EnemyShotgun {
  readonly range: number; // effective hitscan range (a shotgun engages CLOSE)
  readonly damage: number; // damage to the player on a connecting blast
}

/** A thrower's projectile: a spinning strip billboard that flies at the player and hurts on contact (dodgeable
 *  by side-stepping). */
export interface EnemyProjectile {
  readonly texName: string; // key under which the spin strip is registered
  readonly url: string; // served spin strip (a `frames`×1 horizontal strip)
  readonly frames: number; // spin frames
  readonly speed: number; // world units / second
  readonly damage: number; // damage to the player on contact
  readonly worldHeight: number; // billboard height in world units
  readonly aspect: number; // billboard width : height
  readonly spinRate: number; // spin frames advanced per world cell travelled
  readonly range: number; // cells of sight within which it throws (and the projectile's max flight)
}

/** The combat + physics characteristics of an enemy kind — the art-free half of the feature's `EnemySpec`.
 *  `worldHeight` + `hitRadius` live here (not with the art) because the AI/hitscan read them for sizing and
 *  the shootable silhouette. */
export interface EnemyCombat {
  readonly worldHeight: number; // billboard height in world units
  readonly hitRadius: number; // shootable silhouette half-width (world units)
  readonly hp: number; // damage points to kill
  readonly speed: number; // move speed (world units / second)
  readonly standoff: number; // distance it holds at (melee: in your face; ranged: a firing lane)
  readonly windup: number; // seconds of telegraphed wind-up before an attack releases (a dodge window)
  readonly cooldownTime: number; // seconds after an attack before it can wind up again
  readonly meleeReach: number; // it strikes in melee within this range (0 = never melees)
  readonly meleeDamage: number; // a landed melee strike's damage to the player
  readonly shotgun?: EnemyShotgun; // present → a hitscan shotgunner
  readonly thrower?: EnemyProjectile; // present → lobs a flying, dodgeable projectile
}
