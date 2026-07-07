import type { CombatEnemy } from '../../core/lib';
import type { EnemySpec } from './enemies';

/**
 * A live or dying enemy instance in the BSP demo — the feature-side widening of the art-free {@link
 * CombatEnemy}: it overrides `spec` with the full art+combat {@link EnemySpec} so the renderer keeps reading
 * `foe.spec.atlasUrl` / animation fields, while the AI/combat step (which sees only `CombatEnemy`) reads the
 * combat half. All the mutable per-frame fields (world pose, walk travel, hp, hit-flash, death + attack
 * timers) come straight from `CombatEnemy`.
 */
export interface Foe extends CombatEnemy {
  readonly spec: EnemySpec;
}
