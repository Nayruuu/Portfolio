// core/lib/game/combat/projectile-step — the player-PROJECTILE stepper, extracted from the BSP-game shell.
// Each frame it advances every launched shot in the shared pool, detonating it on the first hittable (a
// barrel or a foe) or the wall / floor / ceiling it reaches; a direct hit deals the shot's damage, then the
// blast does its splash + burst, and the plasma hops its chain-lightning between nearby barrels. The engine
// deps (`castRay` / `castFloorCeil` / `nearestTargetHit`) are core → core.

import { castFloorCeil, castRay, nearestTargetHit } from '../../bsp-engine';
import { MAX_SHOT_RANGE, MUZZLE_CLEAR } from '../combat-constants';
import type { ChainSpec } from '../types';
import { collectHittables } from './hittables';
import type { PlayerCombatFrame } from './player-combat-frame';
import type { Barrel } from './barrel';
import type { Projectile } from './projectile';

/** Step every projectile forward, detonating on the first hittable (barrel OR foe) or wall it reaches; a
 *  direct hit deals `damage`, then {@link detonate} does the splash + burst. Spent shots are compacted out of
 *  the shared pool in place (so the shell's array reference — fed by both the fire path and the stress test —
 *  stays live). */
export function stepProjectiles(frame: PlayerCombatFrame, dt: number): void {
  const projectiles = frame.projectiles;

  for (const p of projectiles) {
    advanceProjectile(frame, p, dt);
  }
  let live = 0;

  for (const p of projectiles) {
    if (p.alive) {
      projectiles[live++] = p; // keep the survivors, in order
    }
  }
  projectiles.length = live;
}

/** One projectile's frame: step it to the nearest of {wall, floor/ceiling, hittable} within its reach and
 *  resolve that outcome (direct hit + splash + chain / floor burst / wall burst), else fly on until spent. */
function advanceProjectile(frame: PlayerCombatFrame, p: Projectile, dt: number): void {
  const step = p.speed * dt;
  const wall = castRay(frame.map, p.x, p.y, p.dx, p.dy, step, true, frame.slides); // glass/shut door stops shots
  const reach = wall === null ? step : Math.min(step, wall.dist);
  // Floor/ceiling collision: a shot diving at the ground (or into a step that rises above it) bursts there
  // instead of sailing on under the world — capped by the wall, so it can't reach a floor behind a wall.
  // The muzzle grace (what's left of it after `traveled`) lets a shot off a platform clear its own lip.
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
  const hittables = collectHittables(frame, p.radius); // inflate each target by the shot's radius
  const hit = nearestTargetHit(
    p.x,
    p.y,
    p.dx,
    p.dy,
    targetReach,
    hittables.map((h) => h.target),
    0,
    p.z, // the shot's current height — must fall within the target (a shot flying over it sails on)
    p.vSlope,
  );

  if (hit !== null) {
    const h = hittables[hit.index];

    h.hit(p.damage);
    detonate(frame, h.x, h.y, h.z, p.splashR, p.damage, p.impactKind);
    if (p.chain !== null) {
      chainFrom(frame, h.x, h.y, h.z, p.chain); // the plasma hops its beam between nearby barrels
    }
    p.alive = false;
  } else if (ground !== null) {
    detonate(frame, ground.x, ground.y, ground.z, p.splashR, p.damage, p.impactKind); // burst on the floor/ceiling
    p.alive = false;
  } else if (wall !== null) {
    detonate(frame, wall.x, wall.y, p.z, p.splashR, p.damage, p.impactKind); // burst where it struck the wall
    p.alive = false;
  } else {
    p.x += p.dx * step;
    p.y += p.dy * step;
    p.z += p.vSlope * step; // climb/descend along the firing pitch
    p.traveled += step;
    p.alive = p.traveled <= MAX_SHOT_RANGE; // spend it once it has flown its distance
  }
}

/** Apply an AOE blast at `(x, y, z)`: barrels in `splashR` pop, foes take `splashDmg`; then queue the weapon's
 *  `kind` burst strip at the hit point. (A direct hit is dealt by the caller before this.) */
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

/** The plasma's chain-lightning: from the hit point, hop to the nearest still-standing barrel within `range`,
 *  up to `targets` times — culling each and queuing a visual arc between hits. */
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
      break; // no barrel left within reach
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
