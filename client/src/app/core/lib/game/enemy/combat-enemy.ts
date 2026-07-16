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
  // Its atlas has not landed yet: authored into the world (so the snapshot keeps its slot) but not
  // yet ALIVE — invisible, inert, untargetable. It wakes out of sight once the species decodes.
  dormant: boolean;
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
