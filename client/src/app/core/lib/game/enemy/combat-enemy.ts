import type { EnemyCombat, EnemyProjectile } from './enemy-spec';

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
  windup: number; // seconds left; 0 = not attacking
  cooldown: number;
}

export interface EnemyShot {
  x: number;
  y: number;
  z: number;
  readonly dx: number;
  readonly dy: number;
  readonly proj: EnemyProjectile;
  traveled: number;
}
