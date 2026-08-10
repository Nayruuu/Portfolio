import type { CombatEnemy, EnemySpec } from '../enemy';

export interface Foe extends CombatEnemy {
  readonly spec: EnemySpec;
}
