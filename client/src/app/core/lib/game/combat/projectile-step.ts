import { castFloorCeil, castRay, nearestTargetHit } from '../../bsp-engine';
import { MAX_SHOT_RANGE, MUZZLE_CLEAR } from '../game-tuning';
import type { ChainSpec } from '../types';
import { collectHittables } from './hittables';
import type { PlayerCombatFrame } from './player-combat-frame';
import type { Barrel } from './barrel';
import type { Projectile } from './projectile';

// Spent shots are compacted out of the shared pool in place — the shell's array ref stays live.
export function stepProjectiles(frame: PlayerCombatFrame, dt: number): void {
  const projectiles = frame.projectiles;

  for (const p of projectiles) {
    advanceProjectile(frame, p, dt);
  }
  let live = 0;

  for (const p of projectiles) {
    if (p.alive) {
      projectiles[live++] = p;
    }
  }
  projectiles.length = live;
}

function advanceProjectile(frame: PlayerCombatFrame, p: Projectile, dt: number): void {
  const step = p.speed * dt;
  const wall = castRay(frame.map, p.x, p.y, p.dx, p.dy, step, true, frame.slides); // glass/shut door stops shots
  const reach = wall === null ? step : Math.min(step, wall.dist);
  // muzzle grace (minus traveled) lets a shot off a platform clear its own lip
  const ground = castFloorCeil(
    frame.map,
    p.x,
    p.y,
    p.dx,
    p.dy,
    p.z,
    p.vSlope,
    reach,
    undefined,
    Math.max(0, MUZZLE_CLEAR - p.traveled),
  );
  const targetReach = ground === null ? reach : Math.min(reach, ground.dist);
  const hittables = collectHittables(frame, p.radius);
  const hit = nearestTargetHit(
    p.x,
    p.y,
    p.dx,
    p.dy,
    targetReach,
    hittables.map((h) => h.target),
    0,
    p.z,
    p.vSlope,
  );

  if (hit !== null) {
    const h = hittables[hit.index];

    h.hit(p.damage);
    detonate(frame, h.x, h.y, h.z, p.splashR, p.damage, p.impactKind);
    if (p.chain !== null) {
      chainFrom(frame, h.x, h.y, h.z, p.chain);
    }
    p.alive = false;
  } else if (ground !== null) {
    detonate(frame, ground.x, ground.y, ground.z, p.splashR, p.damage, p.impactKind);
    p.alive = false;
  } else if (wall !== null) {
    detonate(frame, wall.x, wall.y, p.z, p.splashR, p.damage, p.impactKind);
    p.alive = false;
  } else {
    p.x += p.dx * step;
    p.y += p.dy * step;
    p.z += p.vSlope * step;
    p.traveled += step;
    p.alive = p.traveled <= MAX_SHOT_RANGE;
  }
}

export function detonate(
  frame: PlayerCombatFrame,
  x: number,
  y: number,
  z: number,
  splashR: number,
  splashDmg: number,
  kind: string,
): void {
  if (splashR > 0) {
    for (const t of frame.targets) {
      if (t.alive && Math.hypot(t.sprite.x - x, t.sprite.y - y) <= splashR) {
        t.alive = false;
      }
    }
    for (const e of frame.enemies) {
      if (!e.dying && Math.hypot(e.x - x, e.y - y) <= splashR) {
        frame.hurtEnemy(e, splashDmg);
      }
    }
  }
  frame.addImpact(kind, x, y, z);
}

export function chainFrom(
  frame: PlayerCombatFrame,
  fromXIn: number,
  fromYIn: number,
  fromZIn: number,
  chain: ChainSpec,
): void {
  let fromX = fromXIn;
  let fromY = fromYIn;
  let fromZ = fromZIn;

  for (let hop = 0; hop < chain.targets; hop++) {
    let nearest: Barrel | null = null;
    let nearestDist = chain.range;

    for (const t of frame.targets) {
      if (!t.alive) {
        continue;
      }
      const dist = Math.hypot(t.sprite.x - fromX, t.sprite.y - fromY);

      if (dist <= nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }
    if (nearest === null) {
      break;
    }
    nearest.alive = false;
    const toZ = nearest.sprite.z + nearest.sprite.height / 2;

    frame.addArc({
      ax: fromX,
      ay: fromY,
      az: fromZ,
      bx: nearest.sprite.x,
      by: nearest.sprite.y,
      bz: toZ,
      age: 0,
    });
    fromX = nearest.sprite.x;
    fromY = nearest.sprite.y;
    fromZ = toZ;
  }
}
