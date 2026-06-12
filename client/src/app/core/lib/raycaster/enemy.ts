import { move } from './move';
import { hasLineOfSight } from './fire';
import type { GameMap } from './game-map';
import type { Enemy, EnemyKind, Pose, Projectile, ProjectileSkin } from './types';

const ENEMY_TURN = 2.4; // radians applied when a wander step is blocked
const ENEMY_SIGHT = 12; // cells — max distance it can see the player
const KITE_MIN = 3.5; // cells — HR retreats when the player is nearer than this
const PROJECTILE_SPEED = 4.5; // cells/second
const FORWARD = { forward: 1, strafe: 0, look: 0, fire: false, reload: false };
const WINDUP_DURATION = 0.5; // seconds of telegraphed wind-up before an attack releases (dodge window)
const MELEE_REACH = 1.3; // cells — a melee enemy strikes (and lands) only within this range of the player
const MELEE_DAMAGE = 12; // damage a melee enemy's strike deals to the player on the release frame
const STANDOFF_BAND = 0.25; // cells of hysteresis around the standoff: hold inside ±this, advance/retreat outside
const SHOT_BLOCK_HALF_WIDTH = 0.4; // cells — a teammate this close to the shooter→player line masks the player (hold fire)
const SHOT_BLOCK_DEPTH_MARGIN = 0.5; // cells — a teammate must be at least this much NEARER the player to mask it (peers at ~equal range don't)

export const DEATH_DURATION = 0.7; // seconds of death animation before 'dead' (the 6-frame death plays fully,
// then the corpse freezes on its last frame and stays on the floor)
export const HIT_FLASH_DURATION = 0.12; // seconds the white hit-flash shows after a player hit

interface KindConfig {
  hp: number;
  speed: number; // cells/second (0 = stationary turret)
  fireCooldown: number; // seconds between throws
  behavior: 'rush' | 'turret' | 'kite';
  skin: ProjectileSkin;
  melee?: boolean; // true = never throws (the zombie just chases; damage lands on contact)
  radius: number; // hit half-width (cells) — the enemy's shootable silhouette, sized to its sprite WIDTH
  standoff: number; // cells — the distance a rusher holds at: it advances to here, then stops instead of
  // crowding into the player (melee → just inside its reach; ranged → a firing-lane gap). Unused by turret/kite.
}

/** Per-kind tuning (pure data). Tweak via a browser probe. */
export const ENEMY_CONFIG: Record<EnemyKind, KindConfig> = {
  // The zombie "Corporate Husk" (melee) — hp is DAMAGE points (`hp - weapon.damage` per hit); the starting
  // fist does 35, so 80 takes ~3 hits. `radius` matches the narrow husk sprite.
  manager: {
    hp: 80,
    speed: 1.1,
    fireCooldown: 2.0,
    behavior: 'rush',
    skin: 'invite',
    melee: true,
    radius: 0.16, // matches the husk's VISIBLE body half-width (measured), so a projectile past it misses
    standoff: 0.7, // closes right up to swinging range (well inside MELEE_REACH 1.3) and holds — in your face but not overlapping
  },
  // The "Middle Manager" — a tankier RANGED bruiser (~4 fist hits); throws the TPS report. Wider sprite
  // → a wider hitbox.
  middle_manager: {
    hp: 120,
    speed: 1.0,
    fireCooldown: 2.2,
    behavior: 'rush',
    skin: 'tps',
    melee: false,
    radius: 0.21, // the wider suit body
    standoff: 4.5, // keeps a firing lane: advances to ~4.5 cells, lobs the TPS report, never crowds in
  },
  // The "Junior Office Drone" — a RANGED but FRAGILE foe (weaker than the manager): low hp (~2 fist hits),
  // eager and a touch quick, lobbing a spinning binder clip from a firing lane.
  junior_office_drone: {
    hp: 45,
    speed: 1.2,
    fireCooldown: 1.6,
    behavior: 'rush',
    skin: 'clip',
    melee: false,
    radius: 0.18,
    standoff: 4.0, // keeps a firing lane, a touch closer than the middle manager
  },
  // The "Security Guard" — the TOUGHEST ranged foe (tougher than the middle manager): high hp, a wide
  // imposing body, fires a spinning staple spray from a firing lane. A slow, durable mini-threat per arena.
  security_guard: {
    hp: 150,
    speed: 0.9,
    fireCooldown: 2.0,
    behavior: 'rush',
    skin: 'spread',
    melee: false,
    radius: 0.22, // the wide guard body
    standoff: 4.5, // keeps a firing lane, like the middle manager
  },
  printer: {
    hp: 6,
    speed: 0,
    fireCooldown: 1.2,
    behavior: 'turret',
    skin: 'paper',
    radius: 0.18,
    standoff: 0,
  },
  hr: {
    hp: 3,
    speed: 1.4,
    fireCooldown: 1.8,
    behavior: 'kite',
    skin: 'memo',
    radius: 0.16,
    standoff: KITE_MIN,
  },
};

/** What advancing one enemy yields: the updated enemy, any projectile it threw, and the melee damage its
 *  strike landed on the player this frame (0 unless a melee enemy's wind-up released within reach). */
export interface EnemyStep {
  enemy: Enemy;
  projectile: Projectile | null;
  meleeDamage: number;
}

/** Advance one enemy by its kind's behaviour. `enemies` (the full roster) + `selfIndex` let a RANGED kind
 *  hold fire while a teammate masks the player on its line of fire (see `allyBlocksShot`); both are optional
 *  so non-rendered callers (and tests) that pass neither simply never see an ally blocking. */
export function stepEnemy(
  enemy: Enemy,
  pose: Pose,
  map: GameMap,
  dt: number,
  enemies: readonly Enemy[] = [],
  selfIndex = -1,
): EnemyStep {
  if (enemy.state === 'dead') {
    return { enemy, projectile: null, meleeDamage: 0 };
  }
  if (enemy.state === 'dying') {
    const deathTime = enemy.deathTime + dt;
    const next =
      deathTime >= DEATH_DURATION
        ? { ...enemy, state: 'dead' as const, deathTime }
        : { ...enemy, deathTime };

    return { enemy: next, projectile: null, meleeDamage: 0 };
  }

  const config = ENEMY_CONFIG[enemy.kind];
  const hitFlash = Math.max(0, enemy.hitFlash - dt);
  const dist = Math.hypot(pose.x - enemy.x, pose.y - enemy.y);
  const sees = dist <= ENEMY_SIGHT && hasLineOfSight(enemy.x, enemy.y, pose.x, pose.y, map);

  if (!sees) {
    // Out of sight: keep patrolling and abandon any half-charged attack.
    return {
      enemy: { ...wander(enemy, map, dt, config.speed), windup: 0, hitFlash },
      projectile: null,
      meleeDamage: 0,
    };
  }

  const dir = Math.atan2(pose.y - enemy.y, pose.x - enemy.x); // always face the player

  // Two-phase attack: a ready enemy first WINDS UP (a visible telegraph that plays the attack animation), then
  // RELEASES on completion — a thrown projectile for a ranged kind, or a contact hit for a melee kind (landed
  // only if the player is still within `MELEE_REACH`). A melee kind only starts a wind-up once it is in reach.
  const cooled = Math.max(0, enemy.fireCooldown - dt);
  const inReach = dist <= MELEE_REACH;
  const wasWinding = enemy.windup > 0;
  let windup = enemy.windup;
  let fireCooldown = cooled;
  let projectile: Projectile | null = null;
  let meleeDamage = 0;

  if (wasWinding) {
    windup = Math.max(0, windup - dt);
    if (windup <= 0) {
      // Release: point-blank → a melee CONTACT strike (ANY kind swings when the player is within reach, even
      // a ranged one cornered at the wall); otherwise a ranged kind lobs its projectile. A melee kind whose
      // target stepped out of reach simply whiffs.
      if (inReach) {
        meleeDamage = MELEE_DAMAGE;
      } else if (!config.melee) {
        projectile = {
          x: enemy.x,
          y: enemy.y,
          velocityX: Math.cos(dir) * PROJECTILE_SPEED,
          velocityY: Math.sin(dir) * PROJECTILE_SPEED,
          skin: config.skin,
        };
      }
      fireCooldown = config.fireCooldown;
    }
  } else if (
    cooled <= 0 &&
    (inReach || (!config.melee && !allyBlocksShot(enemy, pose, enemies, selfIndex)))
  ) {
    // Start a telegraph when the player is in MELEE reach (any kind brawls — the close-up attack animation),
    // OR when a ranged kind has a CLEAR lane to throw (no teammate masking the player). So a ranged foe cornered
    // at point-blank swings instead of standing idle, and it never lobs a report straight through a colleague.
    windup = WINDUP_DURATION; // start the telegraph (does not strike this frame)
  }

  // Movement: a rusher/melee PLANTS its feet for the whole wind-up + strike (so it doesn't slide while
  // throwing or swinging); a KITER keeps retreating as it throws (that's its whole identity).
  const planted = (wasWinding || windup > 0) && config.behavior !== 'kite';
  let moved = { x: enemy.x, y: enemy.y };

  if (!planted) {
    if (config.behavior === 'rush') {
      // Hold station at the kind's standoff: close right up TO it, then ease back only if the player
      // crowds well inside it. The band is one-sided (retreat side only) so an enemy approaching from
      // afar parks AT the standoff — not at standoff+band — while still not jittering when shoved.
      if (dist > config.standoff) {
        moved = move({ x: enemy.x, y: enemy.y, dir }, FORWARD, map, dt, config.speed);
      } else if (dist < config.standoff - STANDOFF_BAND && !(inReach && !config.melee)) {
        // Ease back toward the firing lane when crowded — UNLESS a ranged kind is point-blank (in melee reach):
        // then it plants and brawls instead of fleeing, so a cornered shooter fights rather than backpedals.
        moved = move(
          { x: enemy.x, y: enemy.y, dir: dir + Math.PI },
          FORWARD,
          map,
          dt,
          config.speed,
        );
      }
    } else if (config.behavior === 'kite' && dist < KITE_MIN) {
      moved = move({ x: enemy.x, y: enemy.y, dir: dir + Math.PI }, FORWARD, map, dt, config.speed);
    }
  }

  return {
    enemy: { ...enemy, x: moved.x, y: moved.y, dir, fireCooldown, windup, hitFlash },
    projectile,
    meleeDamage,
  };
}

/** True when ANOTHER alive enemy sits on the shooter→player line AND is meaningfully closer to the player
 *  (genuinely masking it) — so a ranged kind holds fire rather than throw through a teammate. Tests each
 *  ally's perpendicular distance to the segment, keeps only those BETWEEN the shooter and the player (path
 *  parameter `t` in (0,1)), and ignores PEERS at roughly the same range (`SHOT_BLOCK_DEPTH_MARGIN`) — so two
 *  shooters side-by-side (e.g. clumped against a wall) don't mutually block and freeze. Only ever reached when
 *  the player is out of melee reach (the caller brawls point-blank), so the shooter→player line is never
 *  zero-length. */
function allyBlocksShot(
  shooter: Enemy,
  pose: Pose,
  enemies: readonly Enemy[],
  selfIndex: number,
): boolean {
  const segX = pose.x - shooter.x;
  const segY = pose.y - shooter.y;
  const shooterToPlayer = Math.hypot(segX, segY);
  const segLen2 = segX * segX + segY * segY;

  for (let index = 0; index < enemies.length; index++) {
    if (index === selfIndex) {
      continue; // the shooter never blocks its own shot
    }
    const ally = enemies[index];

    if (ally.state !== 'alive') {
      continue; // a corpse on the floor doesn't mask the player
    }
    // Only a teammate clearly IN FRONT (nearer the player by a margin) masks it; a peer at ~the same range
    // does not — otherwise two clumped shooters each see the other "in the way" and neither ever fires.
    const allyToPlayer = Math.hypot(pose.x - ally.x, pose.y - ally.y);

    if (allyToPlayer >= shooterToPlayer - SHOT_BLOCK_DEPTH_MARGIN) {
      continue;
    }
    const t = ((ally.x - shooter.x) * segX + (ally.y - shooter.y) * segY) / segLen2;

    if (t <= 0 || t >= 1) {
      continue; // closest approach is behind the shooter or past the player → not in the way
    }
    const perpX = shooter.x + t * segX - ally.x;
    const perpY = shooter.y + t * segY - ally.y;

    if (Math.hypot(perpX, perpY) < SHOT_BLOCK_HALF_WIDTH) {
      return true;
    }
  }

  return false;
}

/** Patrol: step forward, bounce when blocked. Speed 0 (turret) stays put. */
function wander(enemy: Enemy, map: GameMap, dt: number, speed: number): Enemy {
  if (speed === 0) {
    return enemy;
  }
  const moved = move({ x: enemy.x, y: enemy.y, dir: enemy.dir }, FORWARD, map, dt, speed);

  if (Math.hypot(moved.x - enemy.x, moved.y - enemy.y) < speed * dt * 0.5) {
    return { ...enemy, dir: enemy.dir + ENEMY_TURN };
  }

  return { ...enemy, x: moved.x, y: moved.y };
}
