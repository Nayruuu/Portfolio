import { describe, it, expect, vi } from 'vitest';
import { buildBsp } from '../../bsp-engine';
import type { LineDef, MapSource, SideDef } from '../../bsp-engine';
import { ENEMY_SEP_DIST, PLAYER_HIT_RADIUS } from '../game-tuning';
import type { CombatFrame } from '../combat';
import type { CombatEnemy, EnemyShot } from './combat-enemy';
import type { EnemyCombat, EnemyProjectile } from './enemy-spec';
import {
  fireShotgun,
  moveEnemy,
  separateEnemies,
  stepEnemies,
  stepEnemyShots,
  throwProjectile,
} from './enemy-ai';

const side: SideDef = {
  sector: 0,
  xOffset: 0,
  yOffset: 0,
  upperTex: 'w',
  lowerTex: 'w',
  middleTex: 'w',
};

const wall = (v1: number, v2: number): LineDef => ({ v1, v2, front: side, back: null });

const OPEN_SOURCE: MapSource = {
  sectors: [{ floorZ: 0, ceilZ: 4, floorTex: 'f', ceilTex: 'c', light: 200 }],
  things: [],
  vertices: [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 60 },
    { x: 0, y: 60 },
  ],
  linedefs: [wall(0, 1), wall(1, 2), wall(2, 3), wall(3, 0)],
};

const WALLED_SOURCE: MapSource = {
  ...OPEN_SOURCE,
  vertices: [...OPEN_SOURCE.vertices, { x: 25, y: 15 }, { x: 25, y: 45 }],
  linedefs: [...OPEN_SOURCE.linedefs, wall(4, 5)],
};

const OPEN = buildBsp(OPEN_SOURCE);
const WALLED = buildBsp(WALLED_SOURCE);

const PLAYER_X = 30;
const PLAYER_Y = 30;

const MELEE: EnemyCombat = {
  worldHeight: 1.7,
  hitRadius: 0.4,
  hp: 30,
  speed: 2,
  standoff: 2,
  windup: 0.3,
  cooldownTime: 1,
  meleeReach: 1.2,
  meleeDamage: 10,
};

const SHOTGUNNER: EnemyCombat = {
  ...MELEE,
  meleeReach: 0,
  meleeDamage: 0,
  shotgun: { range: 8, damage: 15 },
};

const THROW_PROJ: EnemyProjectile = {
  texName: 'spin',
  url: '',
  frames: 4,
  speed: 6,
  damage: 12,
  worldHeight: 0.5,
  aspect: 1,
  spinRate: 2,
  range: 20,
};

const THROWER: EnemyCombat = {
  ...MELEE,
  meleeReach: 0,
  meleeDamage: 0,
  thrower: THROW_PROJ,
};

const makeEnemy = (spec: EnemyCombat, over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  spec,
  x: PLAYER_X,
  y: PLAYER_Y,
  z: 0,
  walkDist: 0,
  hp: spec.hp,
  dying: false,
  deathTime: 0,
  hitFlash: 0,
  windup: 0,
  cooldown: 0,
  ...over,
});

interface TestFrame extends CombatFrame {
  readonly hurtSpy: ReturnType<typeof vi.fn>;
}

const makeFrame = (
  enemies: CombatEnemy[],
  over: Partial<Omit<CombatFrame, 'hurt'>> = {},
): TestFrame => {
  const hurtSpy = vi.fn();

  return {
    map: OPEN,
    slides: [],
    obstacles: [],
    enemies,
    shots: [],
    px: PLAYER_X,
    py: PLAYER_Y,
    ...over,
    hurt: (dmg: number) => hurtSpy(dmg),
    hurtSpy,
  };
};

describe('stepEnemies — chase / hold / retreat by the standoff band', () => {
  it('chases when farther than the standoff band (moves toward the player, legs advance)', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.x).toBeGreaterThan(20);
    expect(e.walkDist).toBeGreaterThan(0);
    expect(e.windup).toBe(0);
  });

  it('holds inside the standoff band (no move)', () => {
    const e = makeEnemy(MELEE, { x: 28, y: 30 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.x).toBe(28);
    expect(e.walkDist).toBe(0);
  });

  it('retreats when closer than the standoff band (backs away from the player)', () => {
    const e = makeEnemy(MELEE, { x: 29, y: 30, cooldown: 1 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.x).toBeLessThan(29);
    expect(e.walkDist).toBeGreaterThan(0);
  });

  it('a shotgunner beyond its gun range closes in rather than firing', () => {
    const e = makeEnemy(SHOTGUNNER, { x: 5, y: 30, cooldown: 0 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.x).toBeGreaterThan(5);
    expect(e.windup).toBe(0);
  });

  it('a thrower beyond its throw range closes in rather than lobbing', () => {
    const e = makeEnemy(THROWER, { x: 5, y: 30, cooldown: 0 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.x).toBeGreaterThan(5);
    expect(e.windup).toBe(0);
  });
});

describe('stepEnemies — the attack gate + release', () => {
  it('starts a wind-up telegraph when ready and in range (no hit that frame)', () => {
    const e = makeEnemy(MELEE, { x: 29, y: 30, cooldown: 0 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.05);

    expect(e.windup).toBeCloseTo(MELEE.windup, 5);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('releases a melee strike when the wind-up expires in reach', () => {
    const e = makeEnemy(MELEE, { x: 29, y: 30, windup: 0.1 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.windup).toBe(0);
    expect(frame.hurtSpy).toHaveBeenCalledWith(MELEE.meleeDamage);
    expect(e.cooldown).toBeCloseTo(MELEE.cooldownTime, 5);
  });

  it('releases a shotgun blast for a shotgunner', () => {
    const e = makeEnemy(SHOTGUNNER, { x: 25, y: 30, windup: 0.1 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(frame.hurtSpy).toHaveBeenCalledWith(SHOTGUNNER.shotgun?.damage);
  });

  it('releases a thrown projectile for a thrower (a shot, not a direct hit)', () => {
    const e = makeEnemy(THROWER, { x: 20, y: 30, windup: 0.1 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(frame.shots).toHaveLength(1);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('idles behind a wall (no line of sight → no move, no telegraph)', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30, cooldown: 0 });
    const frame = makeFrame([e], { map: WALLED });

    stepEnemies(frame, 0.1);

    expect(e.x).toBe(20);
    expect(e.windup).toBe(0);
  });

  it('counts a wind-up down without releasing while it still remains', () => {
    const e = makeEnemy(MELEE, { x: 29, y: 30, windup: 0.3 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.1);

    expect(e.windup).toBeCloseTo(0.2, 5);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('throws nothing when a thrower’s sight is blocked at release', () => {
    const e = makeEnemy(THROWER, { x: 20, y: 30, windup: 0.1 });
    const frame = makeFrame([e], { map: WALLED });

    stepEnemies(frame, 0.1);

    expect(frame.shots).toHaveLength(0);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('handles a foe sharing the player’s exact position (no divide-by-zero)', () => {
    const e = makeEnemy(MELEE, { x: PLAYER_X, y: PLAYER_Y, cooldown: 0 });
    const frame = makeFrame([e]);

    expect(() => stepEnemies(frame, 0.1)).not.toThrow();
    expect(e.windup).toBeCloseTo(MELEE.windup, 5);
  });

  it('is a no-op with no enemies and no shots', () => {
    const frame = makeFrame([]);

    expect(() => stepEnemies(frame, 0.1)).not.toThrow();
  });

  it('advances a dying foe’s death timer without moving it', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30, dying: true, deathTime: 0 });
    const frame = makeFrame([e]);

    stepEnemies(frame, 0.2);

    expect(e.deathTime).toBeCloseTo(0.2, 5);
    expect(e.x).toBe(20);
  });
});

describe('fireShotgun', () => {
  it('hurts the player in range with a clear shot', () => {
    const e = makeEnemy(SHOTGUNNER, { x: 25, y: 30 });
    const frame = makeFrame([e]);

    fireShotgun(frame, e, 1, 0, 5);

    expect(frame.hurtSpy).toHaveBeenCalledWith(15);
  });

  it('does nothing out of range', () => {
    const e = makeEnemy(SHOTGUNNER, { x: 20, y: 30 });
    const frame = makeFrame([e]);

    fireShotgun(frame, e, 1, 0, 10);

    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('does nothing when a wall blocks the blast', () => {
    const e = makeEnemy(SHOTGUNNER, { x: 20, y: 30 });
    const frame = makeFrame([e], { map: WALLED });

    fireShotgun(frame, e, 1, 0, 8);

    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('does nothing for a kind that carries no shotgun', () => {
    const e = makeEnemy(MELEE, { x: 25, y: 30 });
    const frame = makeFrame([e]);

    fireShotgun(frame, e, 1, 0, 5);

    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });
});

describe('throwProjectile', () => {
  it('pushes a spinning shot from the upper body toward (nx, ny)', () => {
    const e = makeEnemy(THROWER, { x: 20, y: 30, z: 0 });
    const frame = makeFrame([e]);

    throwProjectile(frame, e, 1, 0);

    expect(frame.shots).toHaveLength(1);
    const shot = frame.shots[0];

    expect(shot.x).toBe(20);
    expect(shot.y).toBe(30);
    expect(shot.z).toBeCloseTo(0 + THROWER.worldHeight * 0.6, 5);
    expect(shot.dx).toBe(1);
    expect(shot.dy).toBe(0);
    expect(shot.proj).toBe(THROW_PROJ);
    expect(shot.traveled).toBe(0);
  });

  it('does nothing when the kind cannot throw', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30 });
    const frame = makeFrame([e]);

    throwProjectile(frame, e, 1, 0);

    expect(frame.shots).toHaveLength(0);
  });

  it('stops throwing once the shot budget is saturated (> 60 in flight)', () => {
    const e = makeEnemy(THROWER, { x: 20, y: 30 });
    const saturated: EnemyShot[] = Array.from({ length: 61 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      dx: 1,
      dy: 0,
      proj: THROW_PROJ,
      traveled: 0,
    }));
    const frame = makeFrame([e], { shots: saturated });

    throwProjectile(frame, e, 1, 0);

    expect(frame.shots).toHaveLength(61);
  });
});

describe('stepEnemyShots', () => {
  const shot = (over: Partial<EnemyShot> = {}): EnemyShot => ({
    x: 10,
    y: 30,
    z: 1,
    dx: 1,
    dy: 0,
    proj: THROW_PROJ,
    traveled: 0,
    ...over,
  });

  it('advances a shot in open space and keeps it alive', () => {
    const s = shot();
    const frame = makeFrame([], { shots: [s] });

    stepEnemyShots(frame, 0.1);

    expect(frame.shots).toHaveLength(1);
    expect(s.x).toBeCloseTo(10.6, 5);
    expect(s.traveled).toBeCloseTo(0.6, 5);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('hurts the player within the hit radius, then despawns', () => {
    const s = shot({ x: PLAYER_X - 0.2, y: PLAYER_Y });
    const frame = makeFrame([], { shots: [s] });

    expect(PLAYER_HIT_RADIUS).toBeGreaterThan(0.4);

    stepEnemyShots(frame, 0.1);

    expect(frame.hurtSpy).toHaveBeenCalledWith(THROW_PROJ.damage);
    expect(frame.shots).toHaveLength(0);
  });

  it('despawns on a wall', () => {
    const s = shot({ x: 59.8, y: 30 });
    const frame = makeFrame([], { shots: [s] });

    stepEnemyShots(frame, 0.1);

    expect(frame.shots).toHaveLength(0);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('despawns past its range', () => {
    const s = shot({ x: 10, y: 30, traveled: 19.7 });
    const frame = makeFrame([], { shots: [s] });

    stepEnemyShots(frame, 0.1);

    expect(frame.shots).toHaveLength(0);
    expect(frame.hurtSpy).not.toHaveBeenCalled();
  });

  it('compacts the array in place, keeping only the survivors', () => {
    const a = shot({ x: 10, y: 30 });
    const b = shot({ x: 59.8, y: 30 });
    const c = shot({ x: 12, y: 30 });
    const frame = makeFrame([], { shots: [a, b, c] });

    stepEnemyShots(frame, 0.1);

    expect(frame.shots).toHaveLength(2);
    expect(frame.shots).toContain(a);
    expect(frame.shots).toContain(c);
    expect(frame.shots).not.toContain(b);
  });
});

describe('separateEnemies', () => {
  it('pushes two overlapping foes symmetrically apart', () => {
    const a = makeEnemy(MELEE, { x: 30, y: 30 });
    const b = makeEnemy(MELEE, { x: 30.5, y: 30 });
    const frame = makeFrame([a, b]);

    expect(ENEMY_SEP_DIST).toBeGreaterThan(0.5);

    separateEnemies(frame);

    expect(a.x).toBeLessThan(30);
    expect(b.x).toBeGreaterThan(30.5);
    expect(30 - a.x).toBeCloseTo(b.x - 30.5, 5);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.5);
  });

  it('splits an exact overlap along the +x axis', () => {
    const a = makeEnemy(MELEE, { x: 30, y: 30 });
    const b = makeEnemy(MELEE, { x: 30, y: 30 });
    const frame = makeFrame([a, b]);

    separateEnemies(frame);

    expect(a.x).toBeLessThan(30);
    expect(b.x).toBeGreaterThan(30);
    expect(a.y).toBeCloseTo(30, 5);
    expect(b.y).toBeCloseTo(30, 5);
  });

  it('excludes a dying foe from separation', () => {
    const a = makeEnemy(MELEE, { x: 30, y: 30 });
    const b = makeEnemy(MELEE, { x: 30.2, y: 30, dying: true });
    const frame = makeFrame([a, b]);

    separateEnemies(frame);

    expect(a.x).toBe(30);
    expect(b.x).toBe(30.2);
  });

  it('leaves distant living foes untouched', () => {
    const a = makeEnemy(MELEE, { x: 30, y: 30 });
    const b = makeEnemy(MELEE, { x: 35, y: 30 });
    const frame = makeFrame([a, b]);

    separateEnemies(frame);

    expect(a.x).toBe(30);
    expect(b.x).toBe(35);
  });

  it('is a no-op with fewer than two foes', () => {
    const a = makeEnemy(MELEE, { x: 30, y: 30 });
    const frame = makeFrame([a]);

    separateEnemies(frame);

    expect(a.x).toBe(30);
  });
});

describe('moveEnemy', () => {
  it('advances by speed*dt along the direction and accumulates walkDist', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30 });
    const frame = makeFrame([e]);

    moveEnemy(frame, e, 1, 0, 0.5);

    expect(e.x).toBeCloseTo(21, 5);
    expect(e.walkDist).toBeCloseTo(1, 5);
    expect(e.z).toBe(0);
  });

  it('respects a solid obstacle in its path (stops at the summed radii)', () => {
    const e = makeEnemy(MELEE, { x: 20, y: 30 });
    const frame = makeFrame([e], { obstacles: [{ x: 21, y: 30, radius: 0.5 }] });

    moveEnemy(frame, e, 1, 0, 1);

    expect(e.x).toBeLessThan(21);
    expect(Math.hypot(e.x - 21, e.y - 30)).toBeGreaterThanOrEqual(0.5 + 0.3 - 1e-6);
  });
});
