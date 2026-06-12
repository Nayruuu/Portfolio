import { HIT_FLASH_DURATION, ENEMY_CONFIG } from './enemy';
import { isWall } from './game-map';
import { pushAway } from './knockback';
import { applyDamage } from './vitals';
import type { GameMap } from './game-map';
import type { Arc, ChainSpec, Enemy, PlayerProjectile, Pose, ProjectileSpec } from './types';

/** A direct hit = the enemy's own hitbox (`ENEMY_CONFIG[kind].radius`, sized to its sprite width — a wide
 *  middle manager is a bigger target than a thin husk) coming within the projectile's SWEPT path this frame.
 *  The test is the segment the projectile travelled (from→to), not its end point, so a fast projectile (the
 *  nail moves ~1 cell/frame at the dt cap) can't tunnel past a thin foe, and a point-blank enemy sitting
 *  inside the spawn gap is caught because the sweep starts at the muzzle. */

/** The outcome of a detonation: the enemies after splash, the player's post-blast vitals + pose (the
 *  rocket-jump shoves the pose when `selfDamage` bites), and the per-blast tallies the shell folds in. */
export interface Detonation {
  enemies: Enemy[];
  playerHp: number;
  playerArmor: number;
  pose: Pose;
  hits: number; // enemies the blast actually damaged
  kills: number; // enemies the blast finished
  hurt: boolean; // the player took self-damage this blast (drives the red flash)
}

/** Advance one player projectile by its velocity; returns `null` (despawn) when the step would carry it
 *  into a wall, so the caller detonates at the pre-move position. Mirrors the enemy `stepProjectile`. */
export function stepPlayerProjectile(
  projectile: PlayerProjectile,
  map: GameMap,
  dt: number,
): PlayerProjectile | null {
  const x = projectile.x + projectile.vx * dt;
  const y = projectile.y + projectile.vy * dt;

  if (isWall(map, x, y)) {
    return null;
  }

  return { ...projectile, x, y };
}

/** A swept direct hit: the FIRST alive enemy (the one met earliest along the path) whose hitbox the segment
 *  `(fromX,fromY)→(toX,toY)` passes through, plus the contact point on that segment (the detonation centre).
 *  `null` when the path clears every foe. */
export interface SweptHit {
  index: number;
  x: number;
  y: number;
}

export function enemyHit(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  enemies: readonly Enemy[],
): SweptHit | null {
  const segX = toX - fromX;
  const segY = toY - fromY;
  const segLen2 = segX * segX + segY * segY;
  let best: SweptHit | null = null;
  let bestT = Infinity; // smallest path parameter → the enemy struck first

  for (let index = 0; index < enemies.length; index++) {
    const enemy = enemies[index];

    if (enemy.state !== 'alive') {
      continue;
    }
    // Closest point on the travel segment to the enemy centre (clamped to the segment ends — a zero-length
    // step degenerates to the point test against `from`).
    const t =
      segLen2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((enemy.x - fromX) * segX + (enemy.y - fromY) * segY) / segLen2));
    const contactX = fromX + t * segX;
    const contactY = fromY + t * segY;
    const dist = Math.hypot(enemy.x - contactX, enemy.y - contactY);

    if (dist < ENEMY_CONFIG[enemy.kind].radius && t < bestT) {
      best = { index, x: contactX, y: contactY };
      bestT = t;
    }
  }

  return best;
}

/**
 * The pure AOE detonation at `(blastX, blastY)`:
 *  • the directly-hit enemy (`directIndex`, if any) eats `directDamage`;
 *  • EVERY alive enemy within `spec.splashRadius` eats `spec.splashDamage × falloff`
 *    (`falloff = max(0, 1 − dist/radius)`, so the direct enemy also takes near-full splash) and is shoved
 *    `blastKnockback` cells away from the blast (wall-clamped, like an enemy knockback);
 *  • when `spec.selfDamage` AND the player (`pose`) is within `splashRadius`, the player eats the same
 *    falloff-scaled splash through the armor rule and is shoved back from the blast (the rocket-jump,
 *    `blastKnockback × falloff`, wall-clamped).
 * Returns the new enemies, the player's vitals + pose, the per-blast hit/kill tallies, and a `hurt` flag.
 */
export function detonate(
  blastX: number,
  blastY: number,
  directIndex: number | null,
  spec: ProjectileSpec,
  directDamage: number,
  blastKnockback: number,
  enemies: readonly Enemy[],
  pose: Pose,
  playerHp: number,
  playerArmor: number,
  map: GameMap,
): Detonation {
  let hits = 0;
  let kills = 0;
  const nextEnemies = enemies.map((enemy, index) => {
    if (enemy.state !== 'alive') {
      return enemy;
    }
    const dist = Math.hypot(enemy.x - blastX, enemy.y - blastY);
    const inSplash = dist < spec.splashRadius;
    const splash = inSplash ? spec.splashDamage * (1 - dist / spec.splashRadius) : 0;
    const damage = (index === directIndex ? directDamage : 0) + splash;

    if (damage <= 0) {
      return enemy; // outside the blast and not the direct target
    }
    const pushed = pushAway(blastX, blastY, enemy.x, enemy.y, map, blastKnockback);
    const hp = enemy.hp - damage;

    hits += 1;
    if (hp <= 0) {
      kills += 1;

      return {
        ...enemy,
        ...pushed,
        hp,
        state: 'dying' as const,
        deathTime: 0,
        hitFlash: HIT_FLASH_DURATION,
      };
    }

    return { ...enemy, ...pushed, hp, hitFlash: HIT_FLASH_DURATION };
  });

  // Self-damage + rocket-jump: only an AOE that hurts its owner (`selfDamage`), and only when the player
  // stands inside the blast. Then the splash bites through the armor rule and the blast shoves the pose
  // straight back (closer = a bigger jump, via the same falloff), wall-clamped per axis.
  let nextHp = playerHp;
  let nextArmor = playerArmor;
  let nextPose = pose;
  let hurt = false;
  const playerDist = Math.hypot(pose.x - blastX, pose.y - blastY);

  if (spec.selfDamage && playerDist < spec.splashRadius) {
    const falloff = 1 - playerDist / spec.splashRadius;
    const after = applyDamage(playerHp, playerArmor, spec.splashDamage * falloff);
    const jumped = pushAway(blastX, blastY, pose.x, pose.y, map, blastKnockback * falloff);

    nextHp = after.hp;
    nextArmor = after.armor;
    nextPose = { ...pose, x: jumped.x, y: jumped.y };
    hurt = true;
  }

  return {
    enemies: nextEnemies,
    playerHp: nextHp,
    playerArmor: nextArmor,
    pose: nextPose,
    hits,
    kills,
    hurt,
  };
}

/** The outcome of a plasma chain: the enemies after every hop, the visual arc segments between them, and
 *  the per-chain hit/kill tallies the shell folds in (parallels `Detonation`). */
export interface ChainResult {
  enemies: Enemy[];
  arcs: Arc[];
  hits: number;
  kills: number;
}

/**
 * The pure chain-lightning hops after a plasma direct hit: starting at the directly-hit enemy
 * (`firstIndex`, at `fromX,fromY`), repeat up to `chain.targets` times — find the nearest ALIVE,
 * not-yet-hit enemy within `chain.range` cells of the LAST hit enemy, deal `baseDamage × chain.falloff^hop`
 * (hop 1 = the first jump), flash it (and finish it when its hp hits 0), and record an `Arc` from the last
 * enemy to it. Stops when the target cap is reached or no enemy is left in range. Never re-hits an enemy.
 * Deterministic (no RNG); mirrors `detonate`'s enemy-map + tally style.
 */
export function chainHops(
  firstIndex: number,
  fromX: number,
  fromY: number,
  enemies: readonly Enemy[],
  chain: ChainSpec,
  baseDamage: number,
): ChainResult {
  const nextEnemies = enemies.slice();
  const hitIndices = new Set<number>([firstIndex]);
  const arcs: Arc[] = [];
  let hits = 0;
  let kills = 0;
  let lastX = fromX;
  let lastY = fromY;

  for (let hop = 1; hop <= chain.targets; hop++) {
    const targetIndex = nearestChainTarget(nextEnemies, hitIndices, lastX, lastY, chain.range);

    if (targetIndex === null) {
      break; // no enemy left in range → the chain ends
    }
    const enemy = nextEnemies[targetIndex];
    const factor = chain.falloff ** hop;
    const hp = enemy.hp - baseDamage * factor;

    hits += 1;
    if (hp <= 0) {
      kills += 1;
      nextEnemies[targetIndex] = {
        ...enemy,
        hp,
        state: 'dying',
        deathTime: 0,
        hitFlash: HIT_FLASH_DURATION,
      };
    } else {
      nextEnemies[targetIndex] = { ...enemy, hp, hitFlash: HIT_FLASH_DURATION };
    }
    arcs.push({ ax: lastX, ay: lastY, bx: enemy.x, by: enemy.y, age: 0 });
    hitIndices.add(targetIndex);
    lastX = enemy.x;
    lastY = enemy.y;
  }

  return { enemies: nextEnemies, arcs, hits, kills };
}

/** Index of the nearest ALIVE, not-yet-hit enemy within `range` cells of `(fromX, fromY)`, or `null` when
 *  none qualifies — the per-hop target search for `chainHops`. */
function nearestChainTarget(
  enemies: readonly Enemy[],
  hitIndices: ReadonlySet<number>,
  fromX: number,
  fromY: number,
  range: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;

  for (let index = 0; index < enemies.length; index++) {
    if (hitIndices.has(index)) {
      continue; // the struck enemy + every already-chained one
    }
    const enemy = enemies[index];

    if (enemy.state !== 'alive') {
      continue;
    }
    const dist = Math.hypot(enemy.x - fromX, enemy.y - fromY);

    if (dist <= range && dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }

  return best;
}
