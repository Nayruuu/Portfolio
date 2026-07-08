// core/lib/game/enemy/enemy-ai — the pure per-zone enemy AI + projectile step, extracted from the BSP-game
// shell. It reads/writes only the passed {@link CombatFrame} + dt (art-free, no shell state): foes chase /
// hold / retreat by their standoff band, telegraph a wind-up, then land a melee strike / hitscan shotgun /
// thrown projectile; throwers' shots fly and hurt the player on contact; overlapping foes separate. Every
// side effect runs through `frame.hurt` and the shared foe/shot arrays. The engine deps (`castRay` /
// `movePlayer` + the player-body constants) are core → core.

import { castRay, HEADROOM, movePlayer, PLAYER_RADIUS, STEP_MAX } from '../../bsp-engine';
import { ENEMY_SEP_DIST, PLAYER_HIT_RADIUS, STANDOFF_BAND, type CombatFrame } from '../combat';
import type { CombatEnemy } from './combat-enemy';

/** Real-enemy AI (per-spec), over one zone's {@link CombatFrame} — the active zone or the warm neighbor.
 *  With line of sight a foe holds at its `standoff` (a melee Husk in your face, a ranged Guard on a firing
 *  lane), and when ready TELEGRAPHS a wind-up (feet planted, attack animation); on release it lands a melee
 *  strike if in reach, else lobs a projectile. `walkDist` drives the walk frame. */
export function stepEnemies(frame: CombatFrame, dt: number): void {
  if (frame.enemies.length === 0 && frame.shots.length === 0) {
    return;
  }

  for (const e of frame.enemies) {
    stepEnemy(frame, e, dt);
  }
  separateEnemies(frame);
}

/** One foe's AI for this frame: fade its timers, advance a death/telegraph, else — with line of sight —
 *  either start an attack telegraph (in range + off cooldown) or close in / back off toward its standoff. */
function stepEnemy(frame: CombatFrame, e: CombatEnemy, dt: number): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt); // fade the white hit-flash
  e.cooldown = Math.max(0, e.cooldown - dt);

  if (e.dying) {
    e.deathTime += dt; // play the death animation, then freeze on its last frame (a corpse)

    return;
  }
  const dx = frame.px - e.x;
  const dy = frame.py - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  const s = e.spec;

  if (e.windup > 0) {
    releaseAttack(frame, e, nx, ny, dist, dt);

    return;
  }
  if (castRay(frame.map, e.x, e.y, nx, ny, dist) !== null) {
    return; // no line of sight → idle (no wander yet)
  }
  const canMelee = s.meleeReach > 0 && dist <= s.meleeReach;
  const canShoot = s.shotgun !== undefined && dist <= s.shotgun.range;
  const canThrow = s.thrower !== undefined && dist <= s.thrower.range;

  if (e.cooldown === 0 && (canMelee || canShoot || canThrow)) {
    e.windup = s.windup; // ready + in range → start the telegraph
  } else if (dist > s.standoff + STANDOFF_BAND) {
    moveEnemy(frame, e, nx, ny, dt); // close in toward the standoff
  } else if (dist < s.standoff - STANDOFF_BAND) {
    moveEnemy(frame, e, -nx, -ny, dt); // crowded → ease back toward the lane
  }
}

/** Advance a telegraphed attack: count the wind-up down and, on release, land a melee strike if in reach,
 *  else a shotgun blast or a thrown projectile (whichever the kind has), then start the cooldown. */
function releaseAttack(
  frame: CombatFrame,
  e: CombatEnemy,
  nx: number,
  ny: number,
  dist: number,
  dt: number,
): void {
  const s = e.spec;

  e.windup = Math.max(0, e.windup - dt);
  if (e.windup === 0) {
    if (s.meleeReach > 0 && dist <= s.meleeReach) {
      frame.hurt(s.meleeDamage);
    } else if (s.shotgun !== undefined) {
      fireShotgun(frame, e, nx, ny, dist);
    } else if (s.thrower !== undefined && castRay(frame.map, e.x, e.y, nx, ny, dist) === null) {
      throwProjectile(frame, e, nx, ny);
    }
    e.cooldown = s.cooldownTime;
  }
}

/** Move one enemy by its speed along a unit direction (collision-aware), accumulating `walkDist` for the
 *  legs. Enemies never `crossSeams`: a passable seam stays a solid wall to them — they don't change zones. */
export function moveEnemy(
  frame: CombatFrame,
  e: CombatEnemy,
  dirX: number,
  dirY: number,
  dt: number,
): void {
  const reach = e.spec.speed * dt;
  const moved = movePlayer(
    frame.map,
    e.x,
    e.y,
    dirX * reach,
    dirY * reach,
    PLAYER_RADIUS,
    STEP_MAX,
    HEADROOM,
    frame.slides, // respect open sliding doors (else foes stay stuck behind them)
    false,
    frame.obstacles, // props block foes too (DOOM: things block things)
  );

  e.walkDist += Math.hypot(moved.x - e.x, moved.y - e.y);
  e.x = moved.x;
  e.y = moved.y;
  e.z = moved.floorZ;
}

/** Fire a shotgunner's blast: INSTANT (hitscan), no projectile — it connects if the player is still within
 *  range + line of sight at the moment of release (so backing out of range during the wind-up dodges it). The
 *  firing tell is the enemy's own attack animation. */
export function fireShotgun(
  frame: CombatFrame,
  e: CombatEnemy,
  nx: number,
  ny: number,
  dist: number,
): void {
  const gun = e.spec.shotgun;

  if (
    gun !== undefined &&
    dist <= gun.range &&
    castRay(frame.map, e.x, e.y, nx, ny, dist) === null
  ) {
    frame.hurt(gun.damage);
  }
}

/** Lob a thrower's projectile from its upper body toward the player (a flying, dodgeable spinning billboard). */
export function throwProjectile(frame: CombatFrame, e: CombatEnemy, nx: number, ny: number): void {
  if (e.spec.thrower === undefined || frame.shots.length > 60) {
    return;
  }
  frame.shots.push({
    x: e.x,
    y: e.y,
    z: e.z + e.spec.worldHeight * 0.6,
    dx: nx,
    dy: ny,
    proj: e.spec.thrower,
    traveled: 0,
  });
}

/** Step one zone's thrown projectiles: fly forward, hurt the player on contact, die on a wall or past
 *  range. Compacts `frame.shots` in place (the array is shared with the zone's world state). */
export function stepEnemyShots(frame: CombatFrame, dt: number): void {
  const shots = frame.shots;
  let live = 0;

  for (const shot of shots) {
    const step = shot.proj.speed * dt;

    if (castRay(frame.map, shot.x, shot.y, shot.dx, shot.dy, step, true, frame.slides) !== null) {
      continue; // struck a wall (or glass / a shut sliding door / a seam) — spent
    }
    shot.x += shot.dx * step;
    shot.y += shot.dy * step;
    shot.traveled += step;

    if (Math.hypot(frame.px - shot.x, frame.py - shot.y) <= PLAYER_HIT_RADIUS) {
      frame.hurt(shot.proj.damage);
    } else if (shot.traveled <= shot.proj.range) {
      shots[live++] = shot; // still flying
    }
  }
  shots.length = live;
}

/** Keep one zone's living enemies from stacking: push apart every overlapping pair (circle-circle,
 *  symmetric), then apply each push through `movePlayer` so the nudge still respects walls. O(n²), fine
 *  for these counts. */
export function separateEnemies(frame: CombatFrame): void {
  const enemies = frame.enemies;
  const n = enemies.length;

  if (n < 2) {
    return;
  }
  const push = accumulateSeparation(enemies, n);

  applySeparation(frame, push);
}

/** Accumulate every living pair's symmetric circle-circle nudge (O(n²)) into a per-enemy push vector. */
function accumulateSeparation(
  enemies: readonly CombatEnemy[],
  n: number,
): { x: number; y: number }[] {
  const push = enemies.map(() => ({ x: 0, y: 0 }));

  for (let i = 0; i < n; i++) {
    if (enemies[i].dying) {
      continue;
    }
    for (let j = i + 1; j < n; j++) {
      const a = enemies[i];
      const b = enemies[j];

      if (b.dying) {
        continue;
      }
      const d = Math.hypot(b.x - a.x, b.y - a.y);

      if (d >= ENEMY_SEP_DIST) {
        continue;
      }
      const nx = d > 1e-4 ? (b.x - a.x) / d : 1; // exact overlap → split along an arbitrary axis
      const ny = d > 1e-4 ? (b.y - a.y) / d : 0;
      const amt = (ENEMY_SEP_DIST - d) * 0.5;

      push[i].x -= nx * amt;
      push[i].y -= ny * amt;
      push[j].x += nx * amt;
      push[j].y += ny * amt;
    }
  }

  return push;
}

/** Apply each accumulated nudge through `movePlayer`, so the push still slides off walls + props. */
function applySeparation(frame: CombatFrame, push: readonly { x: number; y: number }[]): void {
  const enemies = frame.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const p = push[i];

    if (p.x === 0 && p.y === 0) {
      continue;
    }
    const e = enemies[i];
    const moved = movePlayer(
      frame.map,
      e.x,
      e.y,
      p.x,
      p.y,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      frame.slides,
      false,
      frame.obstacles,
    );

    e.x = moved.x;
    e.y = moved.y;
    e.z = moved.floorZ;
  }
}
