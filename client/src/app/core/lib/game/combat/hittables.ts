// core/lib/game/combat/hittables — the frame's shootable list: every standing barrel + every living foe, as a
// bsp-engine {@link Target} for the ray test plus a `hit(damage)` closure that applies the right effect (a
// barrel pops; a foe's damage routes through the shell's hurt callback). Shared by the hitscan resolution and
// the projectile stepper. bsp-engine `Target` is core → core (legal).

import type { Target } from '../../bsp-engine';
import { BARREL_HIT_RADIUS } from './combat-constants';
import type { PlayerCombatFrame } from './player-combat-frame';

/** One shootable this frame: its {@link Target} silhouette for the ray test, the world point an impact plays
 *  at (its billboard mid-height), and a `hit(damage)` that applies the effect (barrel pop / foe damage). */
export interface Hittable {
  readonly target: Target;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hit: (damage: number) => void;
}

/** The combat targets this frame: every standing barrel + every living foe, as a {@link Hittable}. `inflate`
 *  grows each silhouette by a projectile's radius (so a fat shot connects a hair off-centre). */
export function collectHittables(frame: PlayerCombatFrame, inflate = 0): Hittable[] {
  const out: Hittable[] = [];

  for (const b of frame.targets) {
    if (!b.alive) {
      continue;
    }
    const s = b.sprite;

    out.push({
      target: {
        x: s.x,
        y: s.y,
        radius: BARREL_HIT_RADIUS + inflate,
        zMin: s.z - inflate,
        zMax: s.z + s.height + inflate,
      },
      x: s.x,
      y: s.y,
      z: s.z + s.height / 2,
      hit: () => (b.alive = false),
    });
  }
  for (const e of frame.enemies) {
    if (e.dying) {
      continue;
    }
    out.push({
      target: {
        x: e.x,
        y: e.y,
        radius: e.spec.hitRadius + inflate,
        zMin: e.z - inflate,
        zMax: e.z + e.spec.worldHeight + inflate,
      },
      x: e.x,
      y: e.y,
      z: e.z + e.spec.worldHeight / 2,
      hit: (dmg) => frame.hurtEnemy(e, dmg),
    });
  }

  return out;
}
