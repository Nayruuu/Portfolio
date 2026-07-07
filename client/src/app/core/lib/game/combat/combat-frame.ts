// core/lib/game/combat/combat-frame — one zone's per-frame combat input, as the enemy/enemy-shot steppers
// see it. Art-free: the enemies are {@link CombatEnemy} (the feature passes its wider `Foe[]`, which extends
// it). bsp-engine `CompiledMap` / `Obstacle` are core → core (legal).

import type { CompiledMap, Obstacle } from '../../bsp-engine';
import type { CombatEnemy, EnemyShot } from '../enemy';

/** One zone's combat frame, as the enemy/enemy-shot steppers see it: the ACTIVE zone hands the real player
 *  and hurt callback; the WARM zone hands the player's seam-translated ghost and a no-op hurt (its foes can
 *  never land a hit across the seam anyway — `castRay` blocks their sight lines at the line). */
export interface CombatFrame {
  readonly map: CompiledMap;
  readonly slides: readonly number[];
  readonly obstacles: readonly Obstacle[]; // the zone's solid decor (props block movers)
  readonly enemies: CombatEnemy[];
  readonly shots: EnemyShot[];
  readonly px: number;
  readonly py: number;
  readonly hurt: (dmg: number) => void;
}
