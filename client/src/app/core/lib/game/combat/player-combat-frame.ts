import type { CompiledMap } from '../../bsp-engine';
import type { CombatEnemy } from '../enemy';
import type { Barrel } from './barrel';
import type { Arc, Projectile } from './projectile';

export interface PlayerCombatFrame {
  readonly map: CompiledMap;
  readonly slides: readonly number[];
  readonly targets: Barrel[];
  readonly enemies: CombatEnemy[];
  readonly projectiles: Projectile[];
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  readonly angle: number; // dx = cos(angle), dy = sin(angle)
  readonly vSlope: number; // vertical climb per cell of forward depth
  readonly hurtEnemy: (enemy: CombatEnemy, damage: number) => void;
  readonly addImpact: (kind: string, x: number, y: number, z: number) => void;
  readonly addArc: (arc: Arc) => void;
  readonly projectileWidth: (kind: string) => number | undefined;
}
