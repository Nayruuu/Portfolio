import type { CompiledMap, Obstacle } from '../../bsp-engine';
import type { CombatEnemy, EnemyShot } from '../enemy';

export interface CombatFrame {
  readonly map: CompiledMap;
  readonly slides: readonly number[];
  readonly obstacles: readonly Obstacle[];
  readonly enemies: CombatEnemy[];
  readonly shots: EnemyShot[];
  readonly px: number;
  readonly py: number;
  readonly hurt: (dmg: number) => void;
}
