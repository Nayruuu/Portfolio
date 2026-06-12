import { describe, it, expect } from 'vitest';
import { chainHops, stepPlayerProjectile, enemyHit, detonate } from './player-projectile';
import type { ChainSpec, Enemy, PlayerProjectile, Pose, ProjectileSpec } from './types';

// A 4×4 room with a 2×2 open core (cells (1,1)(2,1)(1,2)(2,2)); the frame is solid, so a projectile that
// crosses x≥3 or y≥3 enters a wall.
const MAP = {
  width: 4,
  height: 4,
  cells: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1],
};

const foe = (x: number, y: number, hp = 200, state: Enemy['state'] = 'alive'): Enemy => ({
  x,
  y,
  dir: 0,
  state,
  deathTime: 0,
  hp,
  fireCooldown: 0,
  hitFlash: 0,
  windup: 0,
  kind: 'manager',
});

const rocket = (x: number, y: number, vx: number, vy: number): PlayerProjectile => ({
  x,
  y,
  vx,
  vy,
  directDamage: 55,
  splashDamage: 90,
  splashRadius: 1,
  knockback: 3,
  selfDamage: true,
  chain: null,
  kind: 'rocket',
  impactKind: 'explosion',
});

// A small-radius spec so near/far enemies fit the 2×2 open core (the logic is radius-agnostic).
const SPEC: ProjectileSpec = {
  speed: 11,
  splashDamage: 90,
  splashRadius: 1,
  selfDamage: true,
  chain: null,
  kind: 'rocket',
};

describe('stepPlayerProjectile', () => {
  it('advances the projectile by its velocity when the path stays in open space', () => {
    const moved = stepPlayerProjectile(rocket(1.5, 1.5, 2, 0), MAP, 0.1);

    expect(moved).not.toBeNull();
    expect(moved?.x).toBeCloseTo(1.7, 5);
    expect(moved?.y).toBeCloseTo(1.5, 5);
  });

  it('despawns (returns null) when the step would carry it into a wall', () => {
    // From x=2.4 heading +x fast → next x≈3.4, inside the column-3 wall.
    expect(stepPlayerProjectile(rocket(2.4, 1.5, 10, 0), MAP, 0.1)).toBeNull();
  });
});

describe('enemyHit (swept)', () => {
  it('returns the FIRST alive enemy met along the swept path, with the contact point on the segment', () => {
    // Sweep +x from 1.5 to 2.5; both foes sit dead on the path → the earlier one (t=0.3) wins over the later.
    const hit = enemyHit(1.5, 1.5, 2.5, 1.5, [foe(2.2, 1.5), foe(1.8, 1.5)]);

    expect(hit?.index).toBe(1); // foe(1.8) is reached before foe(2.2)
    expect(hit?.x).toBeCloseTo(1.8, 5); // contact at the enemy, on the segment
    expect(hit?.y).toBeCloseTo(1.5, 5);
  });

  it('catches a foe the END point overshoots (no tunnelling) — the whole segment is tested, not just `to`', () => {
    // The step ends at 2.5, well past the foe at 2.0 (0.5 > radius), yet the swept segment still hits it.
    const hit = enemyHit(1.5, 1.5, 2.5, 1.5, [foe(2.0, 1.5)]);

    expect(hit?.index).toBe(0);
    expect(hit?.x).toBeCloseTo(2.0, 5);
  });

  it('returns null when the path clears every foe, and skips dead enemies on the line', () => {
    expect(enemyHit(1.5, 1.5, 2.5, 1.5, [foe(2.0, 1.8)])).toBeNull(); // 0.3 off the path > radius
    expect(enemyHit(1.5, 1.5, 2.5, 1.5, [foe(2.0, 1.5, 200, 'dying')])).toBeNull(); // not alive → ignored
  });

  it('degenerates to a point test when the step has zero length (from === to)', () => {
    // A stationary projectile: the segment collapses, so the test is the pre-move point against the foe.
    expect(enemyHit(2.0, 1.5, 2.0, 1.5, [foe(2.0, 1.5)])?.index).toBe(0); // foe on the point → hit
    expect(enemyHit(2.0, 1.5, 2.0, 1.5, [foe(2.3, 1.5)])).toBeNull(); // 0.3 away > radius → clear
  });
});

describe('detonate', () => {
  it('deals direct + falloff splash, leaves enemies outside the radius untouched, and tallies hits', () => {
    const enemies = [foe(1.5, 1.5), foe(1.5, 2.4), foe(2.8, 1.5)]; // centre, 0.9 away, 1.3 away (outside r=1)
    const result = detonate(
      1.5,
      1.5,
      0,
      SPEC,
      55,
      3,
      enemies,
      { x: 0.5, y: 0.5, dir: 0 },
      100,
      0,
      MAP,
    );

    expect(result.enemies[0].hp).toBeCloseTo(200 - (55 + 90), 5); // direct 55 + full splash 90
    expect(result.enemies[1].hp).toBeCloseTo(200 - 90 * (1 - 0.9), 5); // splash only, 0.9 falloff
    expect(result.enemies[2]).toBe(enemies[2]); // outside the blast + not the direct target → unchanged
    expect(result.hits).toBe(2); // the blast-shove itself is `pushAway`, covered in knockback.spec
    expect(result.kills).toBe(0);
  });

  it('counts a kill + flips the enemy to dying when the blast drops its hp to 0, and skips a dead enemy', () => {
    const enemies = [foe(1.5, 1.5, 30), foe(1.6, 1.6, 200, 'dead')];
    const result = detonate(
      1.5,
      1.5,
      0,
      SPEC,
      55,
      3,
      enemies,
      { x: 0.5, y: 0.5, dir: 0 },
      100,
      0,
      MAP,
    );

    expect(result.enemies[0].state).toBe('dying');
    expect(result.kills).toBe(1);
    expect(result.enemies[1]).toBe(enemies[1]); // already dead → returned untouched, not re-hit
  });

  it('rocket-jumps: self-damage + a shove away when selfDamage is set AND the player is in the blast', () => {
    const pose: Pose = { x: 1.6, y: 1.5, dir: 0 };
    const result = detonate(1.5, 1.5, null, SPEC, 55, 0.3, [], pose, 100, 0, MAP);

    expect(result.hurt).toBe(true);
    expect(result.playerHp).toBeLessThan(100); // ate falloff-scaled splash through the armor rule
    expect(result.pose.x).toBeGreaterThan(1.6); // shoved +x (a small in-bounds jump), straight away from the blast
  });

  it('leaves the player untouched when the blast does not self-damage, or when the player is out of range', () => {
    const pose: Pose = { x: 1.6, y: 1.5, dir: 0 };
    const noSelf = detonate(
      1.5,
      1.5,
      null,
      { ...SPEC, selfDamage: false },
      55,
      3,
      [],
      pose,
      100,
      0,
      MAP,
    );

    expect(noSelf.hurt).toBe(false);
    expect(noSelf.playerHp).toBe(100);
    expect(noSelf.pose).toBe(pose);

    const farPose: Pose = { x: 2.9, y: 2.9, dir: 0 }; // > r=1 from the blast at (1.5,1.5)
    const outOfRange = detonate(1.5, 1.5, null, SPEC, 55, 3, [], farPose, 100, 0, MAP);

    expect(outOfRange.hurt).toBe(false);
    expect(outOfRange.playerHp).toBe(100);
  });
});

describe('chainHops', () => {
  it('chains to the nearest un-hit enemies in range, with per-hop falloff and the right arc endpoints', () => {
    // Start = index 0 at (1.5,1.5). foe1 (0.4 away) beats the decoy foe2 (0.5) for hop 1; from foe1, the
    // decoy is now out of range (0.64 > 0.6) so hop 2 lands on foe3; from foe3 nothing is left in range.
    const enemies = [
      foe(1.5, 1.5), // 0: directly-hit start (excluded from the search)
      foe(1.9, 1.5), // 1: hop 1 — nearer than the decoy
      foe(1.5, 2.0), // 2: decoy — farther from the start, then out of range from foe1
      foe(2.3, 1.5), // 3: hop 2 — reachable from foe1 only
    ];
    const chain: ChainSpec = { targets: 3, range: 0.6, falloff: 0.5 };
    const result = chainHops(0, 1.5, 1.5, enemies, chain, 100);

    expect(result.enemies[1].hp).toBeCloseTo(200 - 100 * 0.5, 5); // hop 1: falloff^1
    expect(result.enemies[1].hitFlash).toBeGreaterThan(0);
    expect(result.enemies[3].hp).toBeCloseTo(200 - 100 * 0.25, 5); // hop 2: falloff^2
    expect(result.enemies[0]).toBe(enemies[0]); // the struck enemy is never re-hit by its own chain
    expect(result.enemies[2]).toBe(enemies[2]); // the decoy stayed out of range → untouched
    expect(result.hits).toBe(2);
    expect(result.kills).toBe(0);
    expect(result.arcs).toEqual([
      { ax: 1.5, ay: 1.5, bx: 1.9, by: 1.5, age: 0 },
      { ax: 1.9, ay: 1.5, bx: 2.3, by: 1.5, age: 0 },
    ]);
  });

  it('honours the target cap, finishes a low-hp enemy (a kill), and never chains to a dead enemy', () => {
    const enemies = [
      foe(1.5, 1.5), // 0: start
      foe(1.7, 1.5, 30), // 1: in range, low hp → finished by hop 1
      foe(1.5, 1.5, 200, 'dead'), // 2: dead, sitting on the start → must be skipped
      foe(1.9, 1.5), // 3: in range but beyond the 1-hop cap
    ];
    const result = chainHops(0, 1.5, 1.5, enemies, { targets: 1, range: 1, falloff: 1 }, 50);

    expect(result.enemies[1].state).toBe('dying'); // 50 > 30 → finished
    expect(result.enemies[1].hitFlash).toBeGreaterThan(0);
    expect(result.kills).toBe(1);
    expect(result.hits).toBe(1);
    expect(result.arcs).toHaveLength(1); // exactly one hop — the cap
    expect(result.enemies[2]).toBe(enemies[2]); // dead → never chained to
    expect(result.enemies[3]).toBe(enemies[3]); // beyond the cap → untouched
  });

  it('returns no hops when nothing alive sits in range of the struck enemy', () => {
    const enemies = [foe(1.5, 1.5), foe(2.8, 1.5)]; // the only other foe is 1.3 cells away, out of range
    const result = chainHops(0, 1.5, 1.5, enemies, { targets: 4, range: 1, falloff: 0.75 }, 16);

    expect(result.arcs).toHaveLength(0);
    expect(result.hits).toBe(0);
    expect(result.kills).toBe(0);
    expect(result.enemies[1]).toBe(enemies[1]); // untouched
  });
});
