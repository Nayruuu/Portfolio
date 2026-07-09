import { castRay, HEADROOM, movePlayer, PLAYER_RADIUS, STEP_MAX } from '../../bsp-engine';
import { ENEMY_SEP_DIST, PLAYER_HIT_RADIUS, STANDOFF_BAND } from '../game-tuning';
import type { CombatFrame } from '../combat';
import type { CombatEnemy } from './combat-enemy';

export function stepEnemies(frame: CombatFrame, dt: number): void {
  if (frame.enemies.length === 0 && frame.shots.length === 0) {
    return;
  }

  for (const e of frame.enemies) {
    stepEnemy(frame, e, dt);
  }
  separateEnemies(frame);
}

function stepEnemy(frame: CombatFrame, e: CombatEnemy, dt: number): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.cooldown = Math.max(0, e.cooldown - dt);

  if (e.dying) {
    e.deathTime += dt;

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
    return;
  }
  const canMelee = s.meleeReach > 0 && dist <= s.meleeReach;
  const canShoot = s.shotgun !== undefined && dist <= s.shotgun.range;
  const canThrow = s.thrower !== undefined && dist <= s.thrower.range;

  if (e.cooldown === 0 && (canMelee || canShoot || canThrow)) {
    e.windup = s.windup;
  } else if (dist > s.standoff + STANDOFF_BAND) {
    moveEnemy(frame, e, nx, ny, dt);
  } else if (dist < s.standoff - STANDOFF_BAND) {
    moveEnemy(frame, e, -nx, -ny, dt);
  }
}

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
    frame.slides,
    false, // never crossSeams — a passable seam stays a solid wall to foes
    frame.obstacles,
  );

  e.walkDist += Math.hypot(moved.x - e.x, moved.y - e.y);
  e.x = moved.x;
  e.y = moved.y;
  e.z = moved.floorZ;
}

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

// Compacts frame.shots in place — the array is shared with the zone's world state.
export function stepEnemyShots(frame: CombatFrame, dt: number): void {
  const shots = frame.shots;
  let live = 0;

  for (const shot of shots) {
    const step = shot.proj.speed * dt;

    if (castRay(frame.map, shot.x, shot.y, shot.dx, shot.dy, step, true, frame.slides) !== null) {
      continue;
    }
    shot.x += shot.dx * step;
    shot.y += shot.dy * step;
    shot.traveled += step;

    if (Math.hypot(frame.px - shot.x, frame.py - shot.y) <= PLAYER_HIT_RADIUS) {
      frame.hurt(shot.proj.damage);
    } else if (shot.traveled <= shot.proj.range) {
      shots[live++] = shot;
    }
  }
  shots.length = live;
}

export function separateEnemies(frame: CombatFrame): void {
  const enemies = frame.enemies;
  const n = enemies.length;

  if (n < 2) {
    return;
  }
  const push = accumulateSeparation(enemies, n);

  applySeparation(frame, push);
}

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
