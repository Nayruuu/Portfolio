import type { CombatEnemy, EnemySpec } from '../../../core/lib';

export interface Foe extends CombatEnemy {
  readonly spec: EnemySpec;
}
