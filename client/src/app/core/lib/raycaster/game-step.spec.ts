import { describe, it, expect } from 'vitest';
import { step } from './game-step';
import { WALL_HEIGHT } from './floor-cast';
import { SAMPLE_LEVEL, SAMPLE_SPAWN } from './game-map';
import type { GameMap } from './game-map';
import type { Enemy, GameState, MoveIntent, WeaponCombat } from './types';

const MAP = {
  width: 8,
  height: 3,
  cells: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
};
// The two combat fixtures: the shipped melee fist (no ammo, short reach, knockback) and a synthetic
// ranged weapon (spends ammo, long reach) so the spec drives both `costsAmmo` arms.
const MELEE: WeaponCombat = {
  damage: 35,
  range: 1.4,
  cone: 0.5,
  fireCooldown: 0.55,
  knockback: 0.6,
  costsAmmo: false,
  ammoType: null,
  ammoPerShot: 1,
  magSize: 0,
  reloadTime: 0,
  pellets: 1,
  selfKnockback: 0,
  projectile: null,
  impactKind: 'impact_metal',
};
const RANGED: WeaponCombat = {
  damage: 1,
  range: 14,
  cone: 0.13,
  fireCooldown: 0.28,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'staples',
  ammoPerShot: 1,
  magSize: 0,
  reloadTime: 0,
  pellets: 1,
  selfKnockback: 0,
  projectile: null,
  impactKind: 'impact_metal',
};
// A magazine weapon: spends a loaded round per shot, reloads the reserve into `mag` over `reloadTime`.
const MAG: WeaponCombat = {
  damage: 1,
  range: 14,
  cone: 0.13,
  fireCooldown: 0.28,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'staples',
  ammoPerShot: 1,
  magSize: 24,
  reloadTime: 1.1,
  pellets: 1,
  selfKnockback: 0,
  projectile: null,
  impactKind: 'impact_metal',
};
// A CO2 shotgun: one magazine round fans 9 pellets across a wide cone, each landing on the nearest enemy
// it crosses, and recoils the player straight back (`selfKnockback`). Damage 1/pellet so a hit enemy's hp
// drops by its pellet count (easy to assert the per-enemy falloff).
const SHOTGUN: WeaponCombat = {
  damage: 1,
  range: 6,
  cone: 0.28,
  fireCooldown: 0.85,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'canisters',
  ammoPerShot: 1,
  magSize: 6,
  reloadTime: 1.4,
  pellets: 9,
  selfKnockback: 0.4,
  projectile: null,
  impactKind: 'impact_frost',
};
// A rocket: one magazine round launches a travelling projectile that detonates an AOE blast on impact —
// direct hit 50, splash 30 over a 2.6-cell radius, knockback 3, and a self-damage rocket-jump. magSize 1.
const ROCKET: WeaponCombat = {
  damage: 50,
  range: 14,
  cone: 0.13,
  fireCooldown: 1.1,
  knockback: 3,
  costsAmmo: true,
  ammoType: 'batteries',
  ammoPerShot: 1,
  magSize: 1,
  reloadTime: 1.5,
  pellets: 1,
  selfKnockback: 1.6,
  projectile: {
    speed: 11,
    splashDamage: 30,
    splashRadius: 2.6,
    selfDamage: true,
    chain: null,
    kind: 'rocket',
  },
  impactKind: 'explosion',
};
// A plasma cable: an auto projectile whose detonation CHAINS between nearby enemies instead of splashing
// (splash zeroed, a `chain` rider set). Direct hit 16, then `falloff^hop` of 16 per chained foe.
const PLASMA: WeaponCombat = {
  damage: 16,
  range: 10,
  cone: 0.13,
  fireCooldown: 0.1,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'cells',
  ammoPerShot: 1,
  magSize: 40,
  reloadTime: 1.5,
  pellets: 1,
  selfKnockback: 0,
  projectile: {
    speed: 14,
    splashDamage: 0,
    splashRadius: 0,
    selfDamage: false,
    chain: { targets: 4, range: 4, falloff: 0.75 },
    kind: 'plasma',
  },
  impactKind: 'impact_plasma',
};
// The datacenter BFG: one charged shot drains a WHOLE 40-round magazine (`ammoPerShot: 40`) and launches a
// slow, huge-AOE projectile (splash 500 over 5.5 cells, self-damaging). magSize 40 → it needs a full mag.
const BFG: WeaponCombat = {
  damage: 300,
  range: 24,
  cone: 0.13,
  fireCooldown: 1.6,
  knockback: 4,
  costsAmmo: true,
  ammoType: 'cells',
  ammoPerShot: 40,
  magSize: 40,
  reloadTime: 2,
  pellets: 1,
  selfKnockback: 1.2,
  projectile: {
    speed: 8,
    splashDamage: 500,
    splashRadius: 5.5,
    selfDamage: true,
    chain: null,
    kind: 'bfg',
  },
  impactKind: 'explosion',
};
const intent = (over: Partial<MoveIntent> = {}): MoveIntent => ({
  forward: 0,
  strafe: 0,
  look: 0,
  fire: false,
  reload: false,
  ...over,
});
const foe = (over: Partial<Enemy> = {}): Enemy => ({
  x: 4.5,
  y: 1.5,
  dir: 0,
  state: 'alive',
  deathTime: 0,
  hp: 3,
  fireCooldown: 99,
  hitFlash: 0,
  windup: 0,
  kind: 'manager',
  ...over,
});
const base = (over: Partial<GameState> = {}): GameState => ({
  pose: { x: 1.5, y: 1.5, dir: 0 }, // facing +x down the corridor
  enemies: [],
  playerProjectiles: [],
  impacts: [],
  arcs: [],
  kills: 0,
  hits: 0,
  fireCooldown: 0,
  bobPhase: 0,
  playerHp: 100,
  playerArmor: 0,
  playerAmmo: { staples: 50, canisters: 50, batteries: 200, cells: 200 },
  mag: 0,
  reloadClock: 0,
  projectiles: [],
  pickups: [],
  ammoPickups: [],
  keys: [],
  heldKeys: 0,
  hurtFlash: 0,
  playerSlow: 0,
  ...over,
});

describe('step — player projectiles (the rocket)', () => {
  it('launches a travelling player projectile (not a hitscan ray) and spends one mag round', () => {
    const next = step(base({ mag: 1 }), intent({ fire: true }), MAP, 0.016, ROCKET);

    expect(next.playerProjectiles).toHaveLength(1);
    expect(next.mag).toBe(0); // the single rocket spent
    expect(next.playerProjectiles[0].vx).toBeGreaterThan(0); // launched +x, the player's facing
    expect(next.playerProjectiles[0].directDamage).toBe(50);
  });

  it('detonates on a direct enemy hit: AOE damage + an explosion impact, then despawns the projectile', () => {
    let state = step(
      base({ mag: 1, enemies: [foe({ x: 3, hp: 200 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      ROCKET,
    );

    for (let frame = 0; frame < 40 && state.playerProjectiles.length > 0; frame++) {
      state = step(state, intent(), MAP, 0.016, ROCKET);
    }

    expect(state.playerProjectiles).toHaveLength(0); // detonated → gone
    expect(state.impacts.length).toBeGreaterThan(0); // a hit impact was spawned
    expect(state.impacts.some((impact) => impact.kind === 'explosion')).toBe(true); // the rocket's impactKind
    expect(state.enemies[0].hp).toBeLessThan(200); // the enemy ate the blast
  });

  it('detonates with the FIRING weapon impact kind even if the active weapon changed mid-flight', () => {
    // Fire a rocket (impactKind 'explosion'), then advance with MELEE active ('impact_metal') — an auto
    // weapon never blocks a swap, so a bolt can outlive its weapon. The blast must keep the rocket's impact.
    let state = step(
      base({ mag: 1, enemies: [foe({ x: 3, hp: 200 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      ROCKET,
    );

    for (let frame = 0; frame < 40 && state.playerProjectiles.length > 0; frame++) {
      state = step(state, intent(), MAP, 0.016, MELEE); // active weapon swapped while the bolt flies
    }

    expect(state.impacts.some((impact) => impact.kind === 'explosion')).toBe(true); // the rocket's own impact
    expect(state.impacts.some((impact) => impact.kind === 'impact_metal')).toBe(false); // NOT the melee's
  });

  it('detonates on a wall when it strikes no enemy (an impact, no projectile left)', () => {
    let state = step(base({ mag: 1 }), intent({ fire: true }), MAP, 0.05, ROCKET);

    for (let frame = 0; frame < 200 && state.playerProjectiles.length > 0; frame++) {
      state = step(state, intent(), MAP, 0.05, ROCKET);
    }

    expect(state.playerProjectiles).toHaveLength(0); // travelled into a wall + detonated
    expect(state.impacts.some((impact) => impact.kind === 'explosion')).toBe(true);
  });

  it('ages a young impact and drops one past IMPACT_DURATION', () => {
    const young = step(
      base({ impacts: [{ x: 3, y: 1.5, kind: 'explosion', age: 0 }] }),
      intent(),
      MAP,
      0.1,
      MELEE,
    );

    expect(young.impacts).toHaveLength(1);
    expect(young.impacts[0].age).toBeCloseTo(0.1, 5);

    const expired = step(
      base({ impacts: [{ x: 3, y: 1.5, kind: 'explosion', age: 0 }] }),
      intent(),
      MAP,
      0.3,
      MELEE,
    );

    expect(expired.impacts).toHaveLength(0); // older than IMPACT_DURATION (0.25) → dropped
  });
});

describe('step — player projectiles (the plasma chain)', () => {
  it('chains between enemies on a direct hit: falloff damage down the line + one arc per hop', () => {
    // Three stationary printers in a line down the corridor: the bolt detonates on the first, then the
    // chain hops to the next two (each within the 4-cell chain range of the previous).
    const enemies = [
      foe({ x: 3, y: 1.5, hp: 200, kind: 'printer' }),
      foe({ x: 3.5, y: 1.5, hp: 200, kind: 'printer' }),
      foe({ x: 4, y: 1.5, hp: 200, kind: 'printer' }),
    ];
    let state = step(base({ mag: 40, enemies }), intent({ fire: true }), MAP, 0.016, PLASMA);

    for (let frame = 0; frame < 60 && state.playerProjectiles.length > 0; frame++) {
      state = step(state, intent(), MAP, 0.016, PLASMA);
    }

    expect(state.playerProjectiles).toHaveLength(0); // detonated on the first printer
    expect(state.enemies[0].hp).toBeCloseTo(200 - 16, 5); // direct hit only (splash is zeroed)
    expect(state.enemies[1].hp).toBeCloseTo(200 - 16 * 0.75, 5); // chain hop 1: 16 × falloff^1
    expect(state.enemies[2].hp).toBeCloseTo(200 - 16 * 0.75 ** 2, 5); // chain hop 2: 16 × falloff^2
    expect(state.arcs).toHaveLength(2); // one electric arc per hop
  });

  it('ages a young chain arc and drops one past ARC_DURATION', () => {
    const young = step(
      base({ arcs: [{ ax: 3, ay: 1.5, bx: 3.5, by: 1.5, age: 0 }] }),
      intent(),
      MAP,
      0.1,
      MELEE,
    );

    expect(young.arcs).toHaveLength(1);
    expect(young.arcs[0].age).toBeCloseTo(0.1, 5);

    const expired = step(
      base({ arcs: [{ ax: 3, ay: 1.5, bx: 3.5, by: 1.5, age: 0 }] }),
      intent(),
      MAP,
      0.5,
      MELEE,
    );

    expect(expired.arcs).toHaveLength(0); // older than ARC_DURATION → dropped
  });
});

describe('step — hit impacts (the world-effects layer)', () => {
  it('a melee hit pushes an impact carrying the weapon impactKind at the struck enemy', () => {
    const next = step(
      base({ enemies: [foe({ x: 2.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
    );

    expect(next.impacts).toHaveLength(1);
    expect(next.impacts[0].kind).toBe('impact_metal'); // MELEE's impactKind
    expect(next.impacts[0].x).toBeCloseTo(2.5, 5); // at the struck enemy (pre-knockback position)
    expect(next.impacts[0].age).toBe(0);
  });

  it('a RANGED ray uses the sprite-accurate aimTarget; null / out-of-range / dead targets miss', () => {
    const at = (enemies: Enemy[], aim: number | null, weapon = RANGED): GameState =>
      step(base({ enemies }), intent({ fire: true }), MAP, 0.016, weapon, aim);

    const hit = at([foe({ x: 2.5, y: 1.5, hp: 3 })], 0);

    expect(hit.hits + hit.kills).toBeGreaterThan(0); // landed on the aimed sprite

    // null aim → MISS even though the enemy is dead-centre in the (narrow) ranged cone
    expect(at([foe({ x: 2.5, y: 1.5, hp: 3 })], null).enemies[0].hp).toBe(3);
    // aimed enemy beyond the weapon's range → miss (short-range variant; the map is only 8 wide)
    expect(at([foe({ x: 4.5, y: 1.5, hp: 3 })], 0, { ...RANGED, range: 2 }).enemies[0].hp).toBe(3);
    // aimed enemy not alive → miss
    expect(
      at([foe({ x: 2.5, y: 1.5, hp: 3, state: 'dying', deathTime: 0 })], 0).enemies[0].hp,
    ).toBe(3);
  });

  it('a MELEE swing ALSO respects sprite opacity: on the sprite hits, a transparent/off aim (null) misses', () => {
    const onSprite = step(
      base({ enemies: [foe({ x: 2.5, y: 1.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
      0, // crosshair on the enemy's opaque pixel
    );

    expect(onSprite.hits + onSprite.kills).toBeGreaterThan(0);

    const transparentAim = step(
      base({ enemies: [foe({ x: 2.5, y: 1.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
      null, // crosshair on a transparent zone / off the sprite
    );

    expect(transparentAim.enemies[0].hp).toBe(3); // no hit, even for melee
  });

  it('a hitscan spread pushes one impact per struck enemy (the shotgun frost)', () => {
    // Two enemies dead ahead: one centred (eats the fan), one off the +y edge (catches the outer pellets).
    const next = step(
      base({ enemies: [foe({ x: 3.5, y: 1.5, hp: 20 }), foe({ x: 3.5, y: 1.9, hp: 20 })], mag: 6 }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(next.impacts).toHaveLength(2); // one frost burst per hit enemy
    expect(next.impacts.every((impact) => impact.kind === 'impact_frost')).toBe(true);
  });

  it('a melee swing that hits nothing pushes no impact', () => {
    const next = step(base(), intent({ fire: true }), MAP, 0.016, MELEE);

    expect(next.impacts).toHaveLength(0); // no enemy struck → no hit impact
  });
});

describe('step — combat', () => {
  it('a melee swing removes the weapon damage, flashes + knocks the enemy straight back, and kills it', () => {
    const next = step(
      base({ enemies: [foe({ x: 2.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
    );

    expect(next.enemies[0].state).toBe('dying'); // 35 damage one-shots the 3-hp foe
    expect(next.enemies[0].hitFlash).toBeGreaterThan(0);
    expect(next.enemies[0].x).toBeCloseTo(3.1, 5); // shoved +x by the 0.6 knockback (2.5 → 3.1)
    expect(next.hits).toBe(1);
    expect(next.kills).toBe(1);
    expect(next.playerAmmo['staples']).toBe(50); // melee spends no ammo
  });

  it('a ranged shot spends one ammo and removes its damage without a kill', () => {
    const next = step(
      base({ enemies: [foe({ x: 4.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      RANGED,
    );

    expect(next.playerAmmo['staples']).toBe(49); // one ammo spent
    expect(next.enemies[0].hp).toBe(2); // 3 − 1 damage, still alive
    expect(next.enemies[0].state).toBe('alive');
    expect(next.enemies[0].hitFlash).toBeGreaterThan(0);
    expect(next.hits).toBe(1);
    expect(next.kills).toBe(0);
  });

  it('three ranged hits finish a foe and bump the kill counter', () => {
    let state = base({ enemies: [foe({ x: 4.5, hp: 3 })] });

    state = step(state, intent({ fire: true }), MAP, 0.016, RANGED);
    state = step({ ...state, fireCooldown: 0 }, intent({ fire: true }), MAP, 0.016, RANGED);
    state = step({ ...state, fireCooldown: 0 }, intent({ fire: true }), MAP, 0.016, RANGED);

    expect(state.enemies[0].state).toBe('dying');
    expect(state.kills).toBe(1);
  });

  it('a swing on cooldown does nothing (the fire is ignored until the cooldown clears)', () => {
    const fired = step(
      base({ enemies: [foe({ x: 2.5, hp: 3 })] }),
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
    );
    // `fired.fireCooldown` is now 0.55; firing again the next frame must be ignored.
    const again = step(
      { ...fired, hits: 0, enemies: [foe({ x: 2.5, hp: 3 })] },
      intent({ fire: true }),
      MAP,
      0.016,
      MELEE,
    );

    expect(again.hits).toBe(0); // still on cooldown → no new hit
    expect(again.enemies[0].state).toBe('alive');
    expect(again.fireCooldown).toBeGreaterThan(0); // the cooldown is still ticking down
  });

  it('a swing into empty space spends the cooldown but hits nothing', () => {
    const next = step(base(), intent({ fire: true }), MAP, 0.016, MELEE);

    expect(next.kills).toBe(0);
    expect(next.hits).toBe(0);
    expect(next.fireCooldown).toBeGreaterThan(0);
  });

  it('only the targeted enemy takes the hit; others are left untouched', () => {
    const state = base({
      enemies: [
        foe({ x: 4.5, hp: 3 }), // farther
        foe({ x: 2.5, hp: 3 }), // nearer → the target
      ],
    });
    const next = step(state, intent({ fire: true }), MAP, 0.016, RANGED);

    expect(next.enemies[1].hp).toBe(2); // nearest, in the crosshair, took the hit
    expect(next.enemies[0].hp).toBe(3); // the other is untouched
  });

  it('a melee swing misses an enemy beyond its reach but still costs the cooldown', () => {
    // A stationary printer ~3 cells away, out of the 1.4 melee reach (its own AI never moves it).
    const state = base({ enemies: [foe({ x: 4.5, hp: 3, kind: 'printer', fireCooldown: 99 })] });
    const next = step(state, intent({ fire: true }), MAP, 0.016, MELEE);

    expect(next.enemies[0].hp).toBe(3); // untouched
    expect(next.enemies[0].x).toBe(4.5); // not knocked back
    expect(next.fireCooldown).toBeGreaterThan(0);
  });

  it('a projectile that reaches the player lowers hp (armor first) and sets the hurt flash', () => {
    const state = base({
      playerArmor: 30,
      projectiles: [{ x: 1.7, y: 1.5, velocityX: -1, velocityY: 0, skin: 'invite' }], // next to the player, moving onto them
    });
    const next = step(state, intent(), MAP, 0.05, MELEE);

    expect(next.playerHp).toBeLessThan(100);
    expect(next.playerArmor).toBeLessThan(30); // armor absorbed its share
    expect(next.hurtFlash).toBeGreaterThan(0);
    expect(next.projectiles).toHaveLength(0); // consumed on hit
  });

  it('walking onto a coffee heals (and removes it)', () => {
    const state = base({ playerHp: 50, pickups: [{ x: 1.5, y: 1.5, kind: 'health' }] });
    const next = step(state, intent(), MAP, 0.016, MELEE);

    expect(next.playerHp).toBe(75);
    expect(next.pickups).toHaveLength(0);
  });

  it('walking onto a keycard sets its colour bit and removes it from the floor', () => {
    const state = base({ keys: [{ x: 1.5, y: 1.5, color: 'blue' }] });
    const next = step(state, intent(), MAP, 0.016, MELEE);

    expect(next.heldKeys).toBe(0b10); // blue = bit 1
    expect(next.keys).toHaveLength(0);
  });

  it('leaves a distant keycard on the floor, heldKeys unchanged', () => {
    const state = base({ keys: [{ x: 6.5, y: 1.5, color: 'red' }] });
    const next = step(state, intent(), MAP, 0.016, MELEE);

    expect(next.heldKeys).toBe(0);
    expect(next.keys).toHaveLength(1);
  });

  it('a RANGED enemy in sight throws a projectile (once its wind-up elapses) that joins the travelling projectiles', () => {
    const state = base({
      // A ranged kind (the zombie/manager is melee + never throws); already winding up → this frame releases.
      enemies: [foe({ x: 6.5, dir: Math.PI, fireCooldown: 0, windup: 0.01, kind: 'printer' })],
    });
    const next = step(state, intent(), MAP, 0.016, MELEE);

    expect(next.projectiles.length).toBeGreaterThan(0); // the enemy's projectile, still in flight
  });

  it('a MELEE enemy whose wind-up completes in reach hurts the player', () => {
    const state = base({
      playerHp: 100,
      // a melee manager 1 cell from the player (1.5,1.5), wind-up about to elapse → it strikes this frame
      enemies: [foe({ x: 2.5, y: 1.5, dir: Math.PI, fireCooldown: 0, windup: 0.01 })],
    });
    const next = step(state, intent(), MAP, 0.1, MELEE);

    expect(next.playerHp).toBeLessThan(100); // the contact strike landed
    expect(next.hurtFlash).toBeGreaterThan(0);
  });

  it('a projectile heading into a wall despawns without hitting the player', () => {
    const state = base({
      projectiles: [{ x: 1.5, y: 1.5, velocityX: 0, velocityY: -20, skin: 'invite' }], // up into the top wall (lands at y=0.5, row 0)
    });
    const next = step(state, intent(), MAP, 0.05, MELEE);

    expect(next.projectiles).toHaveLength(0);
    expect(next.playerHp).toBe(100);
  });

  it('bobPhase advances while the player is moving', () => {
    expect(step(base(), intent({ forward: 1 }), MAP, 0.1, MELEE).bobPhase).toBeGreaterThan(0);
  });

  it('an HR memo hit slows the player; the slow decays; a non-memo hit does not slow', () => {
    const hit = step(
      base({ projectiles: [{ x: 1.7, y: 1.5, velocityX: -1, velocityY: 0, skin: 'memo' }] }),
      intent(),
      MAP,
      0.05,
      MELEE,
    );

    expect(hit.playerSlow).toBeGreaterThan(0);

    const decayed = step({ ...base(), playerSlow: 0.03 }, intent(), MAP, 0.05, MELEE);

    expect(decayed.playerSlow).toBe(0);

    const paper = step(
      base({ projectiles: [{ x: 1.7, y: 1.5, velocityX: -1, velocityY: 0, skin: 'paper' }] }),
      intent(),
      MAP,
      0.05,
      MELEE,
    );

    expect(paper.playerSlow).toBe(0);
  });

  it('a slowed player moves at half speed', () => {
    const slow = step({ ...base(), playerSlow: 1 }, intent({ forward: 1 }), MAP, 0.1, MELEE).pose.x;
    const fast = step(base(), intent({ forward: 1 }), MAP, 0.1, MELEE).pose.x;

    expect(slow - 1.5).toBeCloseTo((fast - 1.5) * 0.5, 5); // half the displacement
  });
});

describe('step — magazine + reload', () => {
  it('a magazine shot spends a loaded round, not the reserve', () => {
    const next = step(
      base({ enemies: [foe({ x: 4.5, hp: 3 })], mag: 24, playerAmmo: { staples: 50 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(next.mag).toBe(23); // one round out of the magazine
    expect(next.playerAmmo['staples']).toBe(50); // the reserve is untouched (a reload draws from it, not a shot)
    expect(next.enemies[0].hp).toBe(2); // landed its 1 damage
    expect(next.fireCooldown).toBeGreaterThan(0);
  });

  it('a magazine weapon with an empty mag dry-fires: no hit, the cooldown is NOT armed', () => {
    const next = step(
      base({ enemies: [foe({ x: 4.5, hp: 3 })], mag: 0, playerAmmo: { staples: 50 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(next.enemies[0].hp).toBe(3); // nothing fired
    expect(next.hits).toBe(0);
    expect(next.fireCooldown).toBe(0); // a dry-fire never arms the cooldown
    expect(next.mag).toBe(0);
    expect(next.playerAmmo['staples']).toBe(50); // reserve untouched (no auto-reload)
  });

  it('a reload request arms the reload clock; firing is blocked while it runs', () => {
    const reloading = step(
      base({ mag: 5, playerAmmo: { staples: 50 } }),
      intent({ reload: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(reloading.reloadClock).toBeCloseTo(1.1, 5); // set to the weapon's reloadTime

    const blocked = step(
      { ...reloading, enemies: [foe({ x: 4.5, hp: 3 })] },
      intent({ fire: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(blocked.mag).toBe(5); // no shot — firing is blocked mid-reload
    expect(blocked.enemies[0].hp).toBe(3);
    expect(blocked.fireCooldown).toBe(0);
    expect(blocked.reloadClock).toBeLessThan(1.1); // the clock keeps ticking down
  });

  it('a reload that elapses tops the mag up from the reserve (capped by the empty mag space)', () => {
    const next = step(
      base({ mag: 20, playerAmmo: { staples: 50 }, reloadClock: 1.1 }),
      intent(),
      MAP,
      1.2,
      MAG,
    );

    expect(next.mag).toBe(24); // refilled by min(magSize − mag, reserve) = min(4, 50)
    expect(next.playerAmmo['staples']).toBe(46); // reserve reduced by the 4 loaded
    expect(next.reloadClock).toBe(0); // reload finished
  });

  it('a reload refill is capped by the reserve when the reserve is smaller than the empty space', () => {
    const next = step(
      base({ mag: 2, playerAmmo: { staples: 5 }, reloadClock: 1.1 }),
      intent(),
      MAP,
      1.2,
      MAG,
    );

    expect(next.mag).toBe(7); // 2 + min(magSize − 2 = 22, reserve 5) = 7
    expect(next.playerAmmo['staples']).toBe(0); // the reserve is drained
  });

  it('no reload starts when the mag is already full', () => {
    const next = step(
      base({ mag: 24, playerAmmo: { staples: 50 } }),
      intent({ reload: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(next.reloadClock).toBe(0);
  });

  it('no reload starts when the reserve is empty', () => {
    const next = step(
      base({ mag: 5, playerAmmo: { staples: 0 } }),
      intent({ reload: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(next.reloadClock).toBe(0);
  });

  it('a reload request does not restart a reload already in progress', () => {
    const next = step(
      base({ mag: 5, playerAmmo: { staples: 50 }, reloadClock: 0.5 }),
      intent({ reload: true }),
      MAP,
      0.1,
      MAG,
    );

    expect(next.reloadClock).toBeCloseTo(0.4, 5); // ticked down from 0.5, NOT reset to 1.1
  });

  it('a melee weapon ignores the magazine entirely: mag/reloadClock pass through, the swing is free', () => {
    const next = step(
      base({
        enemies: [foe({ x: 2.5, hp: 3 })],
        mag: 9,
        reloadClock: 0,
        playerAmmo: { staples: 50 },
      }),
      intent({ fire: true, reload: true }),
      MAP,
      0.016,
      MELEE,
    );

    expect(next.mag).toBe(9); // untouched by a magazine-less weapon
    expect(next.reloadClock).toBe(0); // a reload never starts on a melee weapon
    expect(next.playerAmmo['staples']).toBe(50); // the melee swing is free
    expect(next.enemies[0].hitFlash).toBeGreaterThan(0); // still hits
  });

  it('the flat-pool path still spends the reserve per shot (no magazine)', () => {
    const next = step(
      base({ enemies: [foe({ x: 4.5, hp: 3 })], mag: 0, playerAmmo: { staples: 50 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      RANGED,
    );

    expect(next.playerAmmo['staples']).toBe(49); // a flat-pool weapon spends the reserve directly
    expect(next.mag).toBe(0); // no magazine to draw from
  });
});

describe('step — per-shot ammo cost (the BFG drains its whole 40-round mag)', () => {
  it("won't fire when the mag holds fewer than `ammoPerShot` rounds (39 < 40)", () => {
    const next = step(
      base({ mag: 39, playerAmmo: { cells: 200 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      BFG,
    );

    expect(next.playerProjectiles).toHaveLength(0); // not a full charge → nothing launched
    expect(next.mag).toBe(39); // the magazine is untouched
    expect(next.fireCooldown).toBe(0); // a dry-fire never arms the cooldown
  });

  it('drains the whole 40-round mag in one shot and launches the big projectile', () => {
    const next = step(
      base({ mag: 40, playerAmmo: { cells: 200 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      BFG,
    );

    expect(next.playerProjectiles).toHaveLength(1); // one huge projectile launched
    expect(next.mag).toBe(0); // the whole 40-round charge spent at once
    expect(next.fireCooldown).toBeCloseTo(1.6, 5); // its slow fire rate is now armed
    expect(next.playerProjectiles[0].directDamage).toBe(300);
    expect(next.playerProjectiles[0].splashRadius).toBeCloseTo(5.5, 5);
    expect(next.playerProjectiles[0].splashDamage).toBe(500);
  });

  it('a magazine weapon still spends exactly 1 per shot when `ammoPerShot` is 1 (unchanged behaviour)', () => {
    const next = step(
      base({ mag: 24, playerAmmo: { staples: 50 } }),
      intent({ fire: true }),
      MAP,
      0.016,
      MAG,
    );

    expect(next.mag).toBe(23); // one round — the generalization leaves every ammoPerShot-1 weapon identical
  });
});

describe('step — shotgun spread + self-knockback', () => {
  // Two enemies dead ahead: one centred (eats most of the fan), one off to the +y edge (catches only the
  // outer pellets). One blast hits BOTH; the per-enemy pellet count drives the hp drop (SHOTGUN damage 1).
  const centred = (over: Partial<Enemy> = {}): Enemy => foe({ x: 3.5, y: 1.5, ...over });
  const edge = (over: Partial<Enemy> = {}): Enemy => foe({ x: 3.5, y: 1.9, ...over });

  it('a single blast hits multiple enemies, dropping each by its own pellet count, for one mag round', () => {
    const next = step(
      base({
        enemies: [centred({ hp: 20 }), edge({ hp: 20 })],
        mag: 6,
        playerAmmo: { canisters: 50 },
      }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(next.enemies[0].hp).toBeLessThan(20); // centred enemy ate the bulk of the fan
    expect(next.enemies[1].hp).toBeLessThan(20); // edge enemy caught only the outer pellets
    expect(next.enemies[0].hp).toBeLessThan(next.enemies[1].hp); // centred took more — authentic falloff
    expect(next.enemies[0].hitFlash).toBeGreaterThan(0);
    expect(next.enemies[1].hitFlash).toBeGreaterThan(0);
    expect(next.hits).toBe(2); // tallied per enemy hit, not per pellet
    expect(next.mag).toBe(5); // exactly ONE round spent for the whole spread
    expect(next.playerAmmo['canisters']).toBe(50); // the reserve is untouched (mag-fed)
  });

  it('tallies a kill only for an enemy the blast finishes, leaving a survivor alive', () => {
    const next = step(
      base({ enemies: [centred({ hp: 2 }), edge({ hp: 10 })], mag: 6 }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(next.enemies[0].state).toBe('dying'); // its pellets ≥ 2 hp → finished
    expect(next.enemies[1].state).toBe('alive'); // a couple of edge pellets < 10 hp → survives
    expect(next.kills).toBe(1);
    expect(next.hits).toBe(2);
  });

  it('an out-of-range enemy is untouched by the spread, but the round is still spent', () => {
    // Player pulled back to (0.5,1.5) so the foe at (7.5,1.5) is 7 cells away — beyond the 6-cell reach.
    const next = step(
      base({
        pose: { x: 0.5, y: 1.5, dir: 0 },
        enemies: [foe({ x: 7.5, y: 1.5, hp: 20 })],
        mag: 6,
      }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(next.enemies[0].hp).toBe(20); // out of the 6-cell reach
    expect(next.hits).toBe(0);
    expect(next.mag).toBe(5); // the round is still spent (a miss)
  });

  it('recoils the player straight back on firing, wall-clamped per axis', () => {
    // Open space behind: the recoil shifts the player straight back along −facing.
    const open = step(
      base({ pose: { x: 3.5, y: 1.5, dir: 0 }, mag: 6 }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(open.pose.x).toBeCloseTo(3.1, 5); // 3.5 − selfKnockback 0.4 (straight back along −x)
    expect(open.pose.y).toBeCloseTo(1.5, 5);
    expect(open.mag).toBe(5); // the blast still spent exactly one round

    // Facing the top wall: the −facing recoil would cross into row 0, so it clamps and the player holds.
    const clamped = step(
      base({ pose: { x: 3.5, y: 1.2, dir: Math.PI / 2 }, mag: 6 }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(clamped.pose.y).toBeCloseTo(1.2, 5); // recoil into the top wall is clamped — no move
  });

  it('a magazine-empty spread weapon fires nothing: no hit, no recoil, the cooldown stays disarmed', () => {
    const next = step(
      base({ pose: { x: 1.5, y: 1.5, dir: 0 }, enemies: [centred({ hp: 20 })], mag: 0 }),
      intent({ fire: true }),
      MAP,
      0.016,
      SHOTGUN,
    );

    expect(next.enemies[0].hp).toBe(20); // nothing fired
    expect(next.hits).toBe(0);
    expect(next.fireCooldown).toBe(0); // a dry-fire never arms the cooldown
    expect(next.pose.x).toBeCloseTo(1.5, 5); // no recoil with an empty mag
  });
});

describe('step — per-type ammo reserves + ammo pickups', () => {
  it('reads an unstocked ammo type as 0 and seeds the key in the per-type record', () => {
    // The flat-pool weapon (`staples`) is fired off an EMPTY record, so its reserve reads as 0 (the missing
    // key), then the shot drives it negative — proving the `?? 0` fallback + the per-type write-back.
    const next = step(base({ playerAmmo: {} }), intent({ fire: true }), MAP, 0.016, RANGED);

    expect(next.playerAmmo['staples']).toBe(-1); // (undefined ?? 0) − 1 — the key is now present
  });

  it('walking onto an ammo box refills only that type and removes it', () => {
    const next = step(
      base({
        playerAmmo: { staples: 50, cells: 200 },
        ammoPickups: [
          {
            x: 1.5,
            y: 1.5,
            kind: 'box_staples',
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0,
          },
        ],
      }),
      intent(),
      MAP,
      0.016,
      MELEE,
    );

    expect(next.playerAmmo['staples']).toBe(70); // 50 + 20
    expect(next.playerAmmo['cells']).toBe(200); // a different type is untouched
    expect(next.ammoPickups).toHaveLength(0); // collected
  });

  it('ages an out-of-reach ammo box and keeps it', () => {
    const next = step(
      base({
        ammoPickups: [
          {
            x: 6.5,
            y: 1.5,
            kind: 'box_staples',
            ammoType: 'staples',
            amount: 20,
            max: 200,
            age: 0,
          },
        ],
      }),
      intent(),
      MAP,
      0.05,
      MELEE,
    );

    expect(next.ammoPickups).toHaveLength(1);
    expect(next.ammoPickups[0].age).toBeCloseTo(0.05, 5);
  });
});

describe('step — auto-mantle (climbing a too-tall-but-climbable ledge)', () => {
  // A 3-row height corridor (solid wall rows top + bottom): `spec[i]` is the floor/ceiling of corridor cell
  // (i, 1). Sector 0 is the wall row's flat sector; corridor cell i maps to sector i + 1.
  function corridor(spec: readonly { wall?: boolean; floorZ: number; ceilZ: number }[]): GameMap {
    const w = spec.length;
    const wallRow = Array<number>(w).fill(1);
    const wallIds = Array<number>(w).fill(0); // every wall-row cell maps to sector 0

    return {
      width: w,
      height: 3,
      cells: [...wallRow, ...spec.map((s) => (s.wall ? 1 : 0)), ...wallRow],
      sectors: [
        { floorZ: 0, ceilZ: WALL_HEIGHT, floorMat: 0, ceilMat: 0 },
        ...spec.map((s) => ({ floorZ: s.floorZ, ceilZ: s.ceilZ, floorMat: 0, ceilMat: 0 })),
      ],
      sectorId: [...wallIds, ...spec.map((_, i) => i + 1), ...wallIds],
    };
  }

  // x0 wall · x1 floor (z0, the player starts here) · x2 climbable ledge (z0.6, > STEP_UP_MAX 0.35 and
  // ≤ CLIMB_MAX 1.4) · x3 floor at the ledge top · x4 wall. The player at (1.8, 1.5) faces +x into the ledge.
  const CLIMBABLE = corridor([
    { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
    { floorZ: 0, ceilZ: WALL_HEIGHT },
    { floorZ: 0.6, ceilZ: 0.6 + WALL_HEIGHT },
    { floorZ: 0.6, ceilZ: 0.6 + WALL_HEIGHT },
    { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
  ]);
  const atLedge = (over: Partial<GameState> = {}): GameState =>
    base({ pose: { x: 1.8, y: 1.5, z: 0, dir: 0 }, ...over });

  it('a forward push into a climbable ledge starts a mantle (frozen x/y, target = the ledge floorZ)', () => {
    const next = step(atLedge(), intent({ forward: 1 }), CLIMBABLE, 0.016, MELEE);

    expect(next.mantle).not.toBeNull();
    expect(next.mantle?.progress).toBe(0);
    expect(next.mantle?.startZ).toBe(0);
    expect(next.mantle?.targetZ).toBeCloseTo(0.6, 5);
    expect(next.pose.x).toBeCloseTo(1.8, 5); // the ledge blocks `move` → x is frozen this frame
    expect(next.pose.y).toBeCloseTo(1.5, 5);
  });

  it('while a mantle is active the player VAULTS forward along the held heading as z lerps, look ignored', () => {
    const next = step(
      atLedge({ mantle: { progress: 0, startZ: 0, targetZ: 0.6 } }),
      intent({ forward: 1, strafe: 1, look: 1 }), // the vault drives x/y itself; look is ignored
      CLIMBABLE,
      0.016,
      MELEE,
    );

    expect(next.mantle).not.toBeNull();
    expect(next.mantle?.progress).toBeCloseTo(0.04, 5); // 0 + 0.016 / MANTLE_DURATION (0.4)
    expect(next.pose.z).toBeCloseTo(0.6 * 0.04, 5); // z lerped 0 → 0.6 by `progress`
    expect(next.pose.x).toBeCloseTo(1.8 + 0.5 * 0.04, 5); // glided forward VAULT_ADVANCE (0.5) × this frame's progress
    expect(next.pose.y).toBeCloseTo(1.5, 5); // heading is +x → no y drift (strafe ignored)
    expect(next.pose.dir).toBe(0); // dir held despite look
  });

  it('when the climb completes the mantle clears, z snaps to the ledge, and the vault finishes onto it', () => {
    const next = step(
      atLedge({ mantle: { progress: 0, startZ: 0, targetZ: 0.6 } }),
      intent(),
      CLIMBABLE,
      0.4, // dt / MANTLE_DURATION = 1.0 ≥ 1 → completes this frame
      MELEE,
    );

    expect(next.mantle).toBeNull();
    expect(next.pose.z).toBeCloseTo(0.6, 5); // snapped to targetZ
    expect(next.pose.x).toBeCloseTo(1.8 + 0.5, 5); // full VAULT_ADVANCE (0.5) glide along +x onto the ledge
    expect(next.pose.y).toBeCloseTo(1.5, 5);
  });

  it('a full climb start→finish over several frames lands the player standing on the ledge', () => {
    let state = step(atLedge(), intent({ forward: 1 }), CLIMBABLE, 0.016, MELEE);

    expect(state.mantle).not.toBeNull(); // started

    for (let frame = 0; frame < 40 && state.mantle; frame++) {
      state = step(state, intent({ forward: 1 }), CLIMBABLE, 0.05, MELEE);
    }

    expect(state.mantle).toBeNull(); // finished
    expect(state.pose.z).toBeCloseTo(0.6, 5); // on top of the ledge
    expect(state.pose.x).toBeGreaterThan(2); // advanced into the ledge cell (x2)
  });

  it('a rise taller than CLIMB_MAX is a true wall: pushing forward starts no mantle, the player is blocked', () => {
    const TOO_TALL = corridor([
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 1.5, ceilZ: 1.5 + WALL_HEIGHT }, // 1.5 > CLIMB_MAX 1.4
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
    ]);
    const next = step(atLedge(), intent({ forward: 1 }), TOO_TALL, 0.016, MELEE);

    expect(next.mantle).toBeNull();
    expect(next.pose.x).toBeCloseTo(1.8, 5); // blocked, no climb
  });

  it('a small rise (≤ STEP_UP_MAX) is walked up normally — no mantle starts', () => {
    const SMALL_RISE = corridor([
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.3, ceilZ: 0.3 + WALL_HEIGHT }, // 0.3 ≤ STEP_UP_MAX → just a step
      { floorZ: 0.3, ceilZ: 0.3 + WALL_HEIGHT },
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
    ]);
    const next = step(atLedge(), intent({ forward: 1 }), SMALL_RISE, 0.05, MELEE);

    expect(next.mantle).toBeNull();
    expect(next.pose.x).toBeGreaterThan(1.8); // `move` stepped the player up the small rise
  });

  it('facing a climbable ledge but NOT pushing forward starts no mantle', () => {
    const next = step(atLedge(), intent({ forward: 0 }), CLIMBABLE, 0.016, MELEE);

    expect(next.mantle).toBeNull();
  });

  it('a climbable rise with too low a ceiling at the top starts no mantle', () => {
    const LOW_CEIL = corridor([
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0, ceilZ: WALL_HEIGHT },
      { floorZ: 0.6, ceilZ: 1.1 }, // clearance 0.5 < PLAYER_HEIGHT 0.9 → can't stand at the top
      { wall: true, floorZ: 0, ceilZ: WALL_HEIGHT },
    ]);
    const next = step(atLedge(), intent({ forward: 1 }), LOW_CEIL, 0.016, MELEE);

    expect(next.mantle).toBeNull();
  });

  it('mantling freezes the player but the rest of the step still runs (enemy projectiles keep flying)', () => {
    const next = step(
      atLedge({
        mantle: { progress: 0, startZ: 0, targetZ: 0.6 },
        projectiles: [{ x: 2.5, y: 1.5, velocityX: 1, velocityY: 0, skin: 'paper' }],
      }),
      intent({ forward: 1 }),
      CLIMBABLE,
      0.016,
      MELEE,
    );

    expect(next.mantle).not.toBeNull(); // still climbing
    expect(next.projectiles[0].x).toBeGreaterThan(2.5); // the projectile advanced — timers/sim not frozen
  });
});

describe('step — flat levels never auto-mantle (byte-identical)', () => {
  it('pushing forward on the flat corridor fixture never produces a mantle', () => {
    let state = base();

    for (let frame = 0; frame < 30; frame++) {
      state = step(state, intent({ forward: 1 }), MAP, 0.05, MELEE);
      expect(state.mantle).toBeNull();
    }
  });

  it('pushing + turning across the flat SAMPLE_LEVEL never produces a mantle', () => {
    let state = base({ pose: { ...SAMPLE_SPAWN } });

    for (let frame = 0; frame < 30; frame++) {
      state = step(state, intent({ forward: 1, look: 0.3 }), SAMPLE_LEVEL, 0.05, MELEE);
      expect(state.mantle).toBeNull();
    }
  });
});
