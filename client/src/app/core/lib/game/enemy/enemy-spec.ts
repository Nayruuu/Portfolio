export interface EnemyShotgun {
  readonly range: number;
  readonly damage: number;
}

export interface EnemyProjectile {
  readonly texName: string;
  readonly url: string;
  readonly frames: number;
  readonly speed: number;
  readonly damage: number;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly spinRate: number; // spin frames advanced per world cell travelled
  readonly range: number; // dual: throw trigger distance AND the projectile's max flight
}

export interface EnemyCombat {
  readonly worldHeight: number;
  readonly hitRadius: number;
  readonly hp: number;
  readonly speed: number;
  readonly standoff: number;
  readonly windup: number;
  readonly cooldownTime: number;
  readonly meleeReach: number; // 0 = never melees
  readonly meleeDamage: number;
  readonly shotgun?: EnemyShotgun;
  readonly thrower?: EnemyProjectile;
}
