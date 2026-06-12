import { move } from './move';
import { climbTarget } from './sector';
import { stepEnemy, HIT_FLASH_DURATION } from './enemy';
import { resolveFire, resolveSpread } from './fire';
import { knockback, recoil } from './knockback';
import { stepProjectile, hitsPlayer } from './projectile';
import { chainHops, detonate, enemyHit, stepPlayerProjectile } from './player-projectile';
import { applyDamage } from './vitals';
import { collectPickups } from './pickup';
import { stepAmmoPickups } from './ammo-pickup';
import { collectKeys } from './keys';
import type { GameMap } from './game-map';
import type {
  Arc,
  GameState,
  Impact,
  MoveIntent,
  PlayerProjectile,
  Pose,
  Projectile,
  ProjectileSpec,
  WeaponCombat,
} from './types';

const MOVE_SPEED = 3.2; // cells/second
const TURN_SENSITIVITY = 1;
const BOB_SPEED = 9; // bob radians/second while moving

export const AMMO_START = 50; // per-type reserve seed: each ammo type starts at min(AMMO_START, its max) — see `startingAmmo()` in weapons.ts
/** Shared aim geometry the shell folds into each weapon's `WeaponCombat`: a melee swing's reach + wide
 *  cone, and the narrow cone a ranged weapon aims through. (Per-weapon damage / cooldown / reach for a
 *  ranged weapon all live in the JSON arsenal.) */
export const MELEE_RANGE = 1.4; // melee reach (cells)
export const MELEE_CONE = 0.5; // melee swing half-angle (radians)
export const AIM_CONE = 0.13; // ranged aim half-angle (radians)
const PROJECTILE_DAMAGE = 12;
const HURT_FLASH_DURATION = 0.35; // seconds the red damage flash lingers

/** Seconds a chain-lightning `Arc` lives before the step drops it — shared with the renderer, which fades
 *  it across `age / ARC_DURATION`. Purely visual, but deterministic (no wall-clock) so it stays
 *  unit-testable + SSR-safe. */
export const ARC_DURATION = 0.35;
/** Seconds a hit `Impact` animation lives before the step drops it — covers the kit's 3–4 frame impact
 *  strips (≈0.2 s at 0.05 s/frame) with a short tail. Deterministic + SSR-safe, like `ARC_DURATION`. */
export const IMPACT_DURATION = 0.25;
/** Cells ahead of the player a launched projectile spawns — small, just enough to sit in front of the
 *  camera. The hit test is SWEPT from this muzzle point (see `enemyHit`), so a foe standing closer than the
 *  old large offset is no longer skipped: a point-blank enemy now takes the shot instead of it passing through. */
const PLAYER_PROJECTILE_SPAWN_OFFSET = 0.1;
const HR_SLOW_DURATION = 2; // seconds the HR memo slow lasts
const SLOW_FACTOR = 0.5; // movement speed multiplier while slowed

/** Seconds the auto-climb takes to hoist the player up over a too-tall-but-climbable ledge. */
const MANTLE_DURATION = 0.4;
/** Total cells the climb glides the player FORWARD across the hoist — a continuous vault (keeping the
 *  player's momentum) rather than a freeze-then-teleport. Spread over the duration so by completion the
 *  player has cleared the lip (past the collision radius) and stands ON the climbed cell. */
const VAULT_ADVANCE = 0.5;
/** Cells ahead of the player the climb probe samples — just past the collision radius, into the ledge cell
 *  `move` already blocked the player against. */
const PROBE_REACH = 0.3;

/** Pure simulation tick: move, player attack (driven by `weapon`), enemy AI + projectiles, damage,
 *  pickups, timers. The `weapon` carries the data-driven combat numbers so a new weapon is JSON-only. */
export function step(
  state: GameState,
  intent: MoveIntent,
  map: GameMap,
  dt: number,
  weapon: WeaponCombat,
  aimTarget?: number | null,
): GameState {
  // Player movement. Auto-mantle: a too-tall-but-climbable ledge (rise in (STEP_UP_MAX, CLIMB_MAX]) hoists
  // the player up over `MANTLE_DURATION` while VAULTING it forward over the lip (a continuous glide that keeps
  // the momentum, not a freeze-then-teleport). The heading is held (no look) for the brief vault so it always
  // clears the lip; otherwise the normal turn + `move` runs, then a forward push into a climbable ledge
  // directly ahead starts a new climb. Enemy AI / projectiles / timers below are UNAFFECTED (enemies call
  // `move` directly and never mantle). On a flat level `climbTarget` is always null (rise 0 ≤ STEP_UP_MAX), so
  // no climb ever starts — byte-identical to the pre-mantle move.
  const fromZ = state.pose.z ?? 0; // the floor the player currently stands on (the climb launches from here)
  let pose: Pose;
  let nextMantle: GameState['mantle'] = null;

  if (state.mantle) {
    const m = state.mantle;
    const progress = m.progress + dt / MANTLE_DURATION;
    // Vault forward by the portion of `VAULT_ADVANCE` covered this frame (capped at completion to `1 - prior`
    // so the total glide is exactly `VAULT_ADVANCE`), along the held heading — a smooth continuous advance.
    const stride = VAULT_ADVANCE * Math.min(dt / MANTLE_DURATION, 1 - m.progress);

    if (progress >= 1) {
      // Complete: finish the forward glide over the lip onto the climbed cell + snap z to its floor.
      pose = {
        x: state.pose.x + Math.cos(state.pose.dir) * stride,
        y: state.pose.y + Math.sin(state.pose.dir) * stride,
        z: m.targetZ,
        dir: state.pose.dir,
      };
    } else {
      // Mid-climb: glide forward over the lip while z lerps toward the ledge; the heading is held (no look).
      pose = {
        x: state.pose.x + Math.cos(state.pose.dir) * stride,
        y: state.pose.y + Math.sin(state.pose.dir) * stride,
        z: m.startZ + (m.targetZ - m.startZ) * progress,
        dir: state.pose.dir,
      };
      nextMantle = { ...m, progress };
    }
  } else {
    const turned = { ...state.pose, dir: state.pose.dir + intent.look * TURN_SENSITIVITY };

    pose = move(
      turned,
      intent,
      map,
      dt,
      state.playerSlow > 0 ? MOVE_SPEED * SLOW_FACTOR : MOVE_SPEED,
    );

    // Trigger a climb: pushing forward into a climbable ledge directly ahead. `move` already blocked the
    // player there (the rise is > STEP_UP_MAX), so the probe just classifies that obstacle as climbable.
    const aheadX = pose.x + Math.cos(pose.dir) * PROBE_REACH;
    const aheadY = pose.y + Math.sin(pose.dir) * PROBE_REACH;
    const tz = climbTarget(map, fromZ, aheadX, aheadY);

    if (intent.forward > 0 && tz !== null) {
      nextMantle = { progress: 0, startZ: fromZ, targetZ: tz };
    }
  }

  let enemies = state.enemies;
  let kills = state.kills;
  let hits = state.hits;
  let fireCooldown = Math.max(0, state.fireCooldown - dt);
  // The active weapon draws from its OWN ammo-type reserve (per-type pools). `reserve` is that pool as a
  // plain number for the spend/reload arithmetic below; it is written back into the record once, after the
  // attack. An ammo-less melee weapon (`ammoType === null`) keeps `reserve` at 0 and the record untouched.
  const ammoType = weapon.ammoType;
  let reserve = ammoType !== null ? (state.playerAmmo[ammoType] ?? 0) : 0;
  const launched: PlayerProjectile[] = []; // projectiles the player fired THIS frame (joined below)
  const firedImpacts: Impact[] = []; // hitscan / melee hit impacts spawned THIS frame (joined below)

  // Magazine / reload. `reserve` is the active weapon's per-type pool (the ammo pickups feed it, cap
  // unchanged); a magazine weapon (`magSize > 0`) draws each shot from `mag`, and a reload moves reserve →
  // mag over `reloadTime`. Melee + flat-pool weapons (`magSize === 0`) ignore this — `mag` / `reloadClock`
  // pass straight through.
  let mag = state.mag;
  const wasReloading = state.reloadClock > 0;
  let reloadClock = Math.max(0, state.reloadClock - dt);

  // A reload that elapses THIS frame moves reserve → mag (capped by both the empty mag space and the reserve).
  if (wasReloading && reloadClock <= 0) {
    const loaded = Math.min(weapon.magSize - mag, reserve);

    mag += loaded;
    reserve -= loaded;
  }
  // Start a reload: requested, not already reloading, a magazine weapon, mag not full, reserve available.
  if (
    intent.reload &&
    reloadClock <= 0 &&
    weapon.magSize > 0 &&
    mag < weapon.magSize &&
    reserve > 0
  ) {
    reloadClock = weapon.reloadTime;
  }

  // Player attack: the current weapon (its reach / cone / damage / knockback / ammo cost). A hit removes
  // `weapon.damage` hp, flashes + shoves the enemy straight back (wall-clamped), and may finish it. Firing
  // is blocked mid-reload; a magazine weapon needs `ammoPerShot` loaded rounds and spends them (1 for every
  // weapon but the BFG, whose single charge drains its whole 40-round mag), a flat-pool weapon spends the
  // reserve, and a melee weapon is free. One shot drives EITHER a launched projectile (`projectile !== null`
  // — the rocket / BFG, which detonates an AOE blast on impact below), one hitscan ray (`pellets === 1`), or
  // a whole shotgun spread (`pellets > 1`) — each costs `ammoPerShot` from the magazine.
  if (intent.fire && fireCooldown <= 0 && reloadClock <= 0) {
    const usesMag = weapon.magSize > 0;

    if (!usesMag || mag >= weapon.ammoPerShot) {
      fireCooldown = weapon.fireCooldown;
      if (usesMag) {
        mag -= weapon.ammoPerShot;
      } else if (weapon.costsAmmo) {
        reserve -= 1;
      }

      if (weapon.projectile !== null) {
        // Projectile weapon (the rocket): launch a travelling `PlayerProjectile` straight ahead instead of
        // resolving a hitscan ray. It carries the DIRECT-hit damage (`weapon.damage`), the blast spec, and
        // the blast knockback (`weapon.knockback`); the detonation below applies the AOE. Spawned just ahead
        // of the muzzle so the launch never self-detonates (the `selfKnockback` recoil below is the launch
        // kick — wholly separate from the blast's own `selfDamage` rocket-jump when it lands).
        const forwardX = Math.cos(pose.dir);
        const forwardY = Math.sin(pose.dir);

        launched.push({
          x: pose.x + forwardX * PLAYER_PROJECTILE_SPAWN_OFFSET,
          y: pose.y + forwardY * PLAYER_PROJECTILE_SPAWN_OFFSET,
          vx: forwardX * weapon.projectile.speed,
          vy: forwardY * weapon.projectile.speed,
          directDamage: weapon.damage,
          splashDamage: weapon.projectile.splashDamage,
          splashRadius: weapon.projectile.splashRadius,
          knockback: weapon.knockback,
          selfDamage: weapon.projectile.selfDamage,
          chain: weapon.projectile.chain,
          kind: weapon.projectile.kind,
          impactKind: weapon.impactKind,
        });
      } else if (weapon.pellets > 1) {
        // Shotgun spread: `pellets` rays fanned across the weapon's cone, each landing on the nearest
        // enemy it crosses. A centred/point-blank enemy eats many pellets, an edge one few. Every hit
        // enemy is shoved back once and loses pellets×damage; `hits`/`kills` tally per enemy, not per ray.
        const pelletHits = resolveSpread(
          pose,
          enemies,
          map,
          weapon.range,
          weapon.cone,
          weapon.pellets,
        );

        enemies = enemies.map((enemy, index) => {
          if (pelletHits[index] === 0 || enemy.state !== 'alive') {
            return enemy;
          }
          const pushed = knockback(pose, enemy, map, weapon.knockback);
          const hp = enemy.hp - pelletHits[index] * weapon.damage;

          hits += 1;
          // A hitscan hit plays the weapon's impact effect on the struck enemy (the shotgun's frost).
          firedImpacts.push({ x: enemy.x, y: enemy.y, kind: weapon.impactKind, age: 0 });
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
      } else {
        // Single-ray weapon (melee swing OR one hitscan ray). It snaps to the renderer's sprite-accurate
        // crosshair target (`aimTarget`): a hit lands ONLY on an OPAQUE pixel of the enemy under the crosshair
        // (and in reach) — aiming at a sprite's transparent zone, or off it, never connects. Tests /
        // non-rendered callers omit `aimTarget` (undefined) → the angular `resolveFire` cone fallback.
        const target =
          aimTarget !== undefined
            ? aimTarget !== null &&
              enemies[aimTarget]?.state === 'alive' &&
              Math.hypot(enemies[aimTarget].x - pose.x, enemies[aimTarget].y - pose.y) <=
                weapon.range
              ? aimTarget
              : null
            : resolveFire(pose, enemies, map, weapon.range, weapon.cone);

        if (target !== null) {
          const pushed = knockback(pose, enemies[target], map, weapon.knockback);

          // A melee swing / single-ray hitscan hit plays the weapon's impact at the struck enemy (the
          // fist's metal sparks) — captured before the knockback shoves it.
          firedImpacts.push({
            x: enemies[target].x,
            y: enemies[target].y,
            kind: weapon.impactKind,
            age: 0,
          });
          enemies = enemies.map((enemy, index) => {
            if (index !== target) {
              return enemy;
            }
            const hp = enemy.hp - weapon.damage;

            return hp <= 0
              ? {
                  ...enemy,
                  ...pushed,
                  hp,
                  state: 'dying' as const,
                  deathTime: 0,
                  hitFlash: HIT_FLASH_DURATION,
                }
              : { ...enemy, ...pushed, hp, hitFlash: HIT_FLASH_DURATION };
          });
          hits += 1;
          if (enemies[target].state === 'dying') {
            kills += 1;
          }
        }
      }

      // Self-recoil: the blast shoves the player straight back THIS frame, before the enemy AI reads `pose`.
      if (weapon.selfKnockback > 0) {
        pose = recoil(pose, map, weapon.selfKnockback);
      }
    }
  }

  // Enemy AI → movement + new thrown projectiles + landed melee strikes.
  const spawned: Projectile[] = [];
  let enemyMelee = 0; // total melee damage enemies land on the player this frame

  enemies = enemies.map((enemy, index) => {
    const result = stepEnemy(enemy, pose, map, dt, enemies, index);

    if (result.projectile) {
      spawned.push(result.projectile);
    }
    enemyMelee += result.meleeDamage;

    return result.enemy;
  });

  // Projectiles → motion, wall despawn, player hit.
  let playerHp = state.playerHp;
  let playerArmor = state.playerArmor;
  let hurtFlash = Math.max(0, state.hurtFlash - dt);
  let playerSlow = Math.max(0, state.playerSlow - dt);

  // A melee enemy's strike that landed this frame hurts the player (same flash as a projectile hit).
  if (enemyMelee > 0) {
    const after = applyDamage(playerHp, playerArmor, enemyMelee);

    playerHp = after.hp;
    playerArmor = after.armor;
    hurtFlash = HURT_FLASH_DURATION;
  }
  const projectiles: Projectile[] = [];

  for (const projectile of [...state.projectiles, ...spawned]) {
    const moved = stepProjectile(projectile, map, dt);

    if (!moved) {
      continue; // hit a wall
    }
    if (hitsPlayer(moved, pose)) {
      const after = applyDamage(playerHp, playerArmor, PROJECTILE_DAMAGE);

      playerHp = after.hp;
      playerArmor = after.armor;
      hurtFlash = HURT_FLASH_DURATION;
      if (moved.skin === 'memo') {
        playerSlow = HR_SLOW_DURATION;
      }
      continue; // consumed on the player
    }
    projectiles.push(moved);
  }

  // Player projectiles → travel, then detonate on a wall or a direct enemy hit (AOE splash + knockback +
  // the optional self-damage rocket-jump), spawning a short-lived `Impact` animation at the hit. Existing
  // impacts age out past `IMPACT_DURATION` (purely visual, but deterministic), and this frame's
  // hitscan/melee impacts (`firedImpacts`) join them. Survivors carry to the next frame. The rocket-jump
  // folds into `pose` here — AFTER the enemy AI read it, BEFORE the pickups collect at it.
  const playerProjectiles: PlayerProjectile[] = [];
  const impacts: Impact[] = state.impacts
    .map((impact) => ({ ...impact, age: impact.age + dt }))
    .filter((impact) => impact.age < IMPACT_DURATION);

  impacts.push(...firedImpacts);
  // Chain-lightning arcs age out the same way (purely visual, deterministic). New hops push age-0 arcs
  // below; survivors carry to the next frame and fade against the shared `ARC_DURATION`.
  const arcs: Arc[] = state.arcs
    .map((arc) => ({ ...arc, age: arc.age + dt }))
    .filter((arc) => arc.age < ARC_DURATION);

  for (const projectile of [...state.playerProjectiles, ...launched]) {
    const moved = stepPlayerProjectile(projectile, map, dt);
    // Swept enemy test over the segment actually travelled this frame (muzzle → moved) so a fast or
    // point-blank shot can't tunnel past / overshoot the foe. A wall stop (`moved === null`) skips the sweep.
    const hit = moved ? enemyHit(projectile.x, projectile.y, moved.x, moved.y, enemies) : null;
    const target = hit ? hit.index : null;

    if (moved && hit === null) {
      playerProjectiles.push(moved); // still in flight
      continue;
    }
    // Detonate: a direct enemy contact centres the blast at the swept CONTACT point (where the projectile
    // actually met the foe); a wall stop (`moved === null`, no hit) centres it at the pre-move position.
    const point = hit ?? projectile;
    const spec: ProjectileSpec = {
      speed: Math.hypot(projectile.vx, projectile.vy),
      splashDamage: projectile.splashDamage,
      splashRadius: projectile.splashRadius,
      selfDamage: projectile.selfDamage,
      chain: projectile.chain,
      kind: projectile.kind,
    };
    const blast = detonate(
      point.x,
      point.y,
      target,
      spec,
      projectile.directDamage,
      projectile.knockback,
      enemies,
      pose,
      playerHp,
      playerArmor,
      map,
    );

    enemies = blast.enemies;
    kills += blast.kills;
    hits += blast.hits;
    playerHp = blast.playerHp;
    playerArmor = blast.playerArmor;
    pose = blast.pose;
    if (blast.hurt) {
      hurtFlash = HURT_FLASH_DURATION;
    }
    impacts.push({ x: point.x, y: point.y, kind: projectile.impactKind, age: 0 });
    // A plasma (chain) projectile that struck an enemy: the chain REPLACES the AOE splash (the plasma spec
    // zeroes `splashRadius`, so `detonate`'s splash above is a no-op). Hop from the struck enemy between
    // nearby foes, folding the chained enemies/hits/kills in and spawning the visual arcs.
    if (projectile.chain !== null && target !== null) {
      const chained = chainHops(
        target,
        enemies[target].x,
        enemies[target].y,
        enemies,
        projectile.chain,
        projectile.directDamage,
      );

      enemies = chained.enemies;
      hits += chained.hits;
      kills += chained.kills;
      arcs.push(...chained.arcs);
    }
  }

  // Write the active weapon's spent/reloaded `reserve` back into the per-type record (a no-op record for an
  // ammo-less melee weapon), then let the rotating ammo boxes age + feed the per-type reserves on top of it.
  const spentAmmo =
    ammoType !== null ? { ...state.playerAmmo, [ammoType]: reserve } : state.playerAmmo;

  // Vitals pickups + ammo boxes + keycards.
  const collected = collectPickups(pose, state.pickups, playerHp, playerArmor);
  const collectedAmmo = stepAmmoPickups(pose, state.ammoPickups, spentAmmo, dt);
  const collectedKeys = collectKeys(pose, state.keys, state.heldKeys);

  const moving = intent.forward !== 0 || intent.strafe !== 0;
  const bobPhase = moving ? state.bobPhase + dt * BOB_SPEED : 0;

  return {
    pose,
    enemies,
    kills,
    hits,
    fireCooldown,
    bobPhase,
    playerHp: collected.hp,
    playerArmor: collected.armor,
    playerAmmo: collectedAmmo.playerAmmo,
    mag,
    reloadClock,
    projectiles,
    playerProjectiles,
    impacts,
    arcs,
    pickups: collected.pickups,
    ammoPickups: collectedAmmo.ammoPickups,
    keys: collectedKeys.keys,
    heldKeys: collectedKeys.heldKeys,
    hurtFlash,
    playerSlow,
    mantle: nextMantle,
  };
}
