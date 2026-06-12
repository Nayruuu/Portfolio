import { describe, it, expect } from 'vitest';
import { stepEnemy, DEATH_DURATION, ENEMY_CONFIG } from './enemy';
import type { Enemy, EnemyKind, ProjectileSkin } from './types';

const MAP = {
  width: 8,
  height: 3,
  cells: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
};
const at = (kind: EnemyKind, over: Partial<Enemy> = {}): Enemy => ({
  x: 5.5,
  y: 1.5,
  dir: 0,
  state: 'alive',
  deathTime: 0,
  hp: 4,
  fireCooldown: 0,
  hitFlash: 0,
  windup: 0,
  kind,
  ...over,
});
const player = { x: 1.5, y: 1.5, dir: 0 };
const away = { x: 100, y: 100, dir: 0 };

describe('stepEnemy — per-kind movement', () => {
  it('manager (rush): advances toward the player', () => {
    const { enemy } = stepEnemy(at('manager'), player, MAP, 0.1);

    expect(enemy.x).toBeLessThan(5.5);
  });

  it('manager (rush): HOLDS at its standoff instead of crowding into the player', () => {
    // Player parked just inside its standoff (dist 0.6 < 0.7, above the 0.45 retreat edge); fireCooldown high so no wind-up plants it.
    const atStandoff = { x: 4.9, y: 1.5, dir: 0 };
    const { enemy } = stepEnemy(at('manager', { fireCooldown: 5 }), atStandoff, MAP, 0.1);

    expect(enemy.x).toBe(5.5); // neither advanced nor retreated — held its zone
  });

  it('manager (rush): backs off when the player has crowded inside its standoff', () => {
    const tooClose = { x: 5.2, y: 1.5, dir: 0 }; // dist 0.3 < standoff 0.7 − band
    const { enemy } = stepEnemy(at('manager', { fireCooldown: 5 }), tooClose, MAP, 0.1);

    expect(enemy.x).toBeGreaterThan(5.5); // eased back toward its zone
  });

  it('middle_manager (ranged): point-blank it PLANTS to brawl instead of retreating to its firing lane', () => {
    // standoff 4.5, but the player is in MELEE_REACH (dist 1.1): a ranged kind commits to melee rather than fleeing.
    const reach = { x: 4.4, y: 1.5, dir: 0 };
    const { enemy } = stepEnemy(at('middle_manager', { fireCooldown: 5 }), reach, MAP, 0.1);

    expect(enemy.x).toBe(5.5); // held — did NOT back off despite being far inside its standoff
  });

  it('printer (turret): holds its ground while it sees the player', () => {
    const { enemy } = stepEnemy(at('printer'), player, MAP, 0.1);

    expect(enemy.x).toBe(5.5);
    expect(enemy.y).toBe(1.5);
  });

  it('hr (kite): retreats when the player is close', () => {
    const near = { x: 4.8, y: 1.5, dir: 0 };
    const { enemy } = stepEnemy(at('hr'), near, MAP, 0.1);

    expect(enemy.x).toBeGreaterThan(5.5);
  });

  it('with no line of sight a mover wanders and throws nothing', () => {
    const { projectile } = stepEnemy(
      at('manager', { fireCooldown: 0 }),
      { ...player, x: 100 },
      MAP,
      0.1,
    );

    expect(projectile).toBeNull();
  });

  it('with no line of sight a turret stays put', () => {
    const { enemy } = stepEnemy(at('printer'), away, MAP, 0.1);

    expect(enemy.x).toBe(5.5);
  });

  it('bounces when a wander step is blocked', () => {
    const blocked = at('manager', { x: 5.5, y: 1.05, dir: -Math.PI / 2 });
    const { enemy } = stepEnemy(blocked, away, MAP, 0.1);

    expect(enemy.dir).not.toBe(blocked.dir);
  });
});

describe('stepEnemy — telegraphed throw (wind-up)', () => {
  it('enters a wind-up on the first ready frame and does not throw yet', () => {
    const { enemy, projectile } = stepEnemy(at('printer', { fireCooldown: 0 }), player, MAP, 0.1);

    expect(enemy.windup).toBeGreaterThan(0);
    expect(projectile).toBeNull();
  });

  it('on cooldown, with no wind-up yet, it neither winds up nor throws', () => {
    const { enemy, projectile } = stepEnemy(at('printer', { fireCooldown: 1 }), player, MAP, 0.1);

    expect(enemy.windup).toBe(0);
    expect(projectile).toBeNull();
  });

  it('a wind-up in progress decays but holds the throw until it elapses', () => {
    const { enemy, projectile } = stepEnemy(
      at('printer', { windup: 0.5, fireCooldown: 0 }),
      player,
      MAP,
      0.1,
    );

    expect(enemy.windup).toBeGreaterThan(0);
    expect(enemy.windup).toBeLessThan(0.5);
    expect(projectile).toBeNull();
  });

  // Only the RANGED kinds throw; the melee manager (the zombie) is covered separately below.
  const SKIN: Partial<Record<EnemyKind, ProjectileSkin>> = {
    printer: 'paper',
    hr: 'memo',
    security_guard: 'spread', // the tough guard lobs its spinning staple spray
  };

  for (const [kind, skin] of Object.entries(SKIN) as [EnemyKind, ProjectileSkin][]) {
    it(`${kind} releases its ${skin} once the wind-up elapses`, () => {
      const { enemy, projectile } = stepEnemy(at(kind, { windup: 0.05 }), player, MAP, 0.1);

      expect(projectile?.skin).toBe(skin);
      expect(enemy.windup).toBe(0);
      expect(enemy.fireCooldown).toBe(ENEMY_CONFIG[kind].fireCooldown);
    });
  }

  it('a MELEE kind (the manager/zombie) never throws: ready but no telegraph, no projectile', () => {
    const { enemy, projectile } = stepEnemy(
      at('manager', { windup: 0, fireCooldown: 0 }),
      player,
      MAP,
      0.1,
    );

    expect(projectile).toBeNull(); // cooldown is ready, but a melee kind skips the throw entirely
    expect(enemy.windup).toBe(0); // and never starts a wind-up telegraph (player out of reach)
  });

  const close = { x: 4.4, y: 1.5, dir: 0 }; // dist 1.1 from the enemy at (5.5,1.5) → within MELEE_REACH (1.3)

  it('a MELEE kind in reach winds up (planted, no hit yet) then STRIKES on release', () => {
    // ready + in reach → the telegraph starts, the enemy plants its feet, nothing lands yet
    const start = stepEnemy(at('manager', { windup: 0, fireCooldown: 0 }), close, MAP, 0.016);

    expect(start.enemy.windup).toBeGreaterThan(0); // wind-up started (drives the attack animation)
    expect(start.meleeDamage).toBe(0);
    expect(start.projectile).toBeNull();
    expect(start.enemy.x).toBe(5.5); // PLANTED — did not rush while winding up

    // the wind-up elapses while still in reach → the strike lands + the attack re-arms
    const hit = stepEnemy(at('manager', { windup: 0.01, fireCooldown: 0 }), close, MAP, 0.1);

    expect(hit.meleeDamage).toBeGreaterThan(0);
    expect(hit.enemy.windup).toBe(0);
    expect(hit.enemy.fireCooldown).toBe(ENEMY_CONFIG.manager.fireCooldown);
  });

  it('a MELEE strike that completes with the player OUT of reach lands nothing (dodged)', () => {
    const dodged = stepEnemy(at('manager', { windup: 0.01, fireCooldown: 0 }), player, MAP, 0.1);

    expect(dodged.meleeDamage).toBe(0); // player at dist 4 → no contact
    expect(dodged.enemy.windup).toBe(0);
  });

  it('losing sight mid-wind-up cancels it', () => {
    const { enemy, projectile } = stepEnemy(at('printer', { windup: 0.3 }), away, MAP, 0.1);

    expect(enemy.windup).toBe(0);
    expect(projectile).toBeNull();
  });

  // A cornered RANGED kind brawls instead of standing idle: point-blank it swings (contact) rather than throwing.
  const reach = { x: 4.4, y: 1.5, dir: 0 }; // dist 1.1 from a foe at (5.5,1.5) → within MELEE_REACH (1.3)

  it('a RANGED kind point-blank winds up to melee (does not idle while in reach)', () => {
    const { enemy, projectile } = stepEnemy(at('printer', { fireCooldown: 0 }), reach, MAP, 0.1);

    expect(enemy.windup).toBeGreaterThan(0); // in reach → telegraphs a swing
    expect(projectile).toBeNull(); // nothing thrown on the wind-up frame
  });

  it('a RANGED kind point-blank RELEASES a melee strike, not a projectile', () => {
    const hit = stepEnemy(at('printer', { windup: 0.01, fireCooldown: 0 }), reach, MAP, 0.1);

    expect(hit.meleeDamage).toBeGreaterThan(0); // contact damage, like a melee kind
    expect(hit.projectile).toBeNull(); // it brawls instead of throwing while point-blank
  });
});

describe('stepEnemy — holds fire when a teammate masks the player', () => {
  // shooter (turret) at (5.5,1.5), player at (1.5,1.5): the line of fire runs down the open row y=1.5.
  const ready = (): Enemy => at('printer', { fireCooldown: 0 });

  it('does NOT wind up while a living teammate sits on the line of fire to the player', () => {
    const shooter = ready();
    const ally = at('manager', { x: 3.5, y: 1.5 }); // dead on the line, between shooter and player
    const { enemy, projectile } = stepEnemy(shooter, player, MAP, 0.1, [shooter, ally], 0);

    expect(enemy.windup).toBe(0); // line masked → holds fire, waits for a clear lane
    expect(projectile).toBeNull();
  });

  it('winds up once the teammate steps off the line (clear lane)', () => {
    const shooter = ready();
    const ally = at('manager', { x: 3.5, y: 2.5 }); // 1.0 cell off the line → no longer masking
    const { enemy } = stepEnemy(shooter, player, MAP, 0.1, [shooter, ally], 0);

    expect(enemy.windup).toBeGreaterThan(0);
  });

  it('a teammate BEHIND the player (past the target) never masks it', () => {
    const shooter = ready();
    const ally = at('manager', { x: 0.5, y: 1.5 }); // beyond the player on the same line → path param > 1
    const { enemy } = stepEnemy(shooter, player, MAP, 0.1, [shooter, ally], 0);

    expect(enemy.windup).toBeGreaterThan(0);
  });

  it('a DEAD teammate on the line does not mask the player (only living bodies block)', () => {
    const shooter = ready();
    const ally = at('manager', { x: 3.5, y: 1.5, state: 'dead' });
    const { enemy } = stepEnemy(shooter, player, MAP, 0.1, [shooter, ally], 0);

    expect(enemy.windup).toBeGreaterThan(0);
  });

  it('two shooters clumped at ~equal range BOTH wind up — a near-peer does not mask (no deadlock)', () => {
    // a behind b on the line, but only 0.3 nearer the player — within the depth margin, so neither masks.
    const a = at('printer', { x: 5.5, y: 1.5, fireCooldown: 0 });
    const b = at('printer', { x: 5.2, y: 1.5, fireCooldown: 0 });
    const roster = [a, b];

    expect(stepEnemy(a, player, MAP, 0.1, roster, 0).enemy.windup).toBeGreaterThan(0);
    expect(stepEnemy(b, player, MAP, 0.1, roster, 1).enemy.windup).toBeGreaterThan(0);
  });
});

describe('stepEnemy — hit-flash + death timer', () => {
  it('the hit-flash decays each step and clamps at zero', () => {
    const decayed = stepEnemy(
      at('printer', { hitFlash: 0.1, fireCooldown: 1 }),
      player,
      MAP,
      0.05,
    ).enemy;

    expect(decayed.hitFlash).toBeCloseTo(0.05, 5);
    expect(decayed.hitFlash).toBeLessThan(0.1);

    const cleared = stepEnemy(
      at('printer', { hitFlash: 0.02, fireCooldown: 1 }),
      player,
      MAP,
      0.1,
    ).enemy;

    expect(cleared.hitFlash).toBe(0);
  });

  it('runs the death timer while dying, then dead', () => {
    expect(
      stepEnemy(at('manager', { state: 'dying', deathTime: DEATH_DURATION }), player, MAP, 0.1)
        .enemy.state,
    ).toBe('dead');
  });

  it('still dying below the threshold', () => {
    expect(
      stepEnemy(at('manager', { state: 'dying', deathTime: 0 }), player, MAP, 0.1).enemy.state,
    ).toBe('dying');
  });

  it('a dead enemy is returned untouched', () => {
    const dead = at('manager', { state: 'dead' });

    expect(stepEnemy(dead, player, MAP, 0.1).enemy).toBe(dead);
  });
});
