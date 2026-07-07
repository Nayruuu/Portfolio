// core/lib/game/combat/player-combat-frame — one frame's PLAYER-combat input, as the hitscan / projectile
// steppers see it (the mirror of the enemy side's {@link CombatFrame}). Art-free: it carries the zone's
// shootable barrels + living foes + the shared in-flight projectile pool, the camera's firing pose, and
// CALLBACKS for the side effects that belong to the shell — hurting a foe (its death/flash timing stays in
// the shell), queuing an impact/arc visual, and resolving a projectile kind's width from the feature's
// texture manifest. bsp-engine `CompiledMap` is core → core (legal).

import type { CompiledMap } from '../../bsp-engine';
import type { CombatEnemy } from '../enemy';
import type { Barrel } from './barrel';
import type { Arc, Projectile } from './projectile';

/** One frame's player-combat input. The ACTIVE zone is the only one that fights: the shell rebuilds this bag
 *  each frame from its live map/entities + camera, and the steppers read + mutate the shared arrays through
 *  it. `angle`/`vSlope` are the firing pose (a shot leaves along `dx = cos(angle)` climbing by `vSlope`). */
export interface PlayerCombatFrame {
  readonly map: CompiledMap;
  readonly slides: readonly number[]; // open sliding-door state — glass / a shut door stops a shot
  readonly targets: Barrel[]; // the zone's shootable billboards (a hit flips one to not-standing)
  readonly enemies: CombatEnemy[]; // living foes (the feature passes its wider `Foe[]`, which extends this)
  readonly projectiles: Projectile[]; // the shared in-flight pool the real fire path AND the stress test feed
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  readonly angle: number; // yaw the shot leaves along (dx = cos, dy = sin)
  readonly vSlope: number; // vertical climb per cell of forward depth, from the camera pitch (the aim line's slope)
  readonly hurtEnemy: (enemy: CombatEnemy, damage: number) => void; // flash + kill bookkeeping stays in the shell
  readonly addImpact: (kind: string, x: number, y: number, z: number) => void; // queue a burst-strip visual
  readonly addArc: (arc: Arc) => void; // queue a chain-lightning arc visual
  readonly projectileWidth: (kind: string) => number | undefined; // feature texture-manifest lookup (undefined = unknown kind)
}
