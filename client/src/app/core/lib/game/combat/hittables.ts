import type { Target } from '../../bsp-engine';
import { BARREL_HIT_RADIUS } from '../game-tuning';
import type { PlayerCombatFrame } from './player-combat-frame';

export interface Hittable {
  readonly target: Target;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hit: (damage: number) => void;
}

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
