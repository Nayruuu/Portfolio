import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBsp } from '../../bsp-engine';
import type { Camera, LineDef, MapSource, SideDef } from '../../bsp-engine';
import { HIT_FLASH_DURATION, HURT_FX_DURATION, SHOT_FX_DURATION } from '../game-tuning';
import type { Arc, Impact, Projectile } from '../combat';
import type { CombatEnemy, EnemyCombat } from '../enemy';
import { DoomHud } from '../presentation/doom-hud';
import { ARSENAL, ammoTypeMax } from '../presentation/weapons';
import type { WarmZone } from './zone-world';
import { CombatRuntime, type CombatRuntimeHooks } from './combat-runtime';

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
const OPEN = buildBsp(OPEN_SOURCE);

const ENEMY_SPEC: EnemyCombat = {
  worldHeight: 2,
  hitRadius: 0.4,
  hp: 30,
  speed: 2,
  standoff: 2,
  windup: 0.3,
  cooldownTime: 1,
  meleeReach: 1.2,
  meleeDamage: 10,
};

const CHAINGUN = ARSENAL.findIndex((weapon) => weapon.id === 'chaingun');

function makeEnemy(): CombatEnemy {
  return {
    spec: ENEMY_SPEC,
    x: 35,
    y: 30,
    z: 0,
    walkDist: 0,
    hp: 30,
    dying: false,
    deathTime: 0,
    hitFlash: 0,
    windup: 0,
    cooldown: 0,
  };
}

function makeWorld(overrides: Record<string, unknown> = {}): WarmZone {
  return {
    map: OPEN,
    slides: [0, 0, 0, 0],
    obstacles: [],
    enemies: [],
    enemyShots: [],
    targets: [],
    ...overrides,
  } as unknown as WarmZone;
}

interface Harness {
  readonly cr: CombatRuntime;
  readonly camera: Camera & { pitch: number };
  readonly hud: DoomHud;
  readonly world: WarmZone;
  readonly fx: { projectiles: Projectile[]; impacts: Impact[]; arcs: Arc[] };
}

function setup(overrides: Record<string, unknown> = {}): Harness {
  const camera = { x: 30, y: 30, angle: 0, z: 1.4, pitch: 0 };
  const config = { width: 1280, height: 720, fov: Math.PI / 2 };
  const hud = new DoomHud();
  const world = makeWorld(overrides);
  const fx = {
    projectiles: [] as Projectile[],
    impacts: [] as Impact[],
    arcs: [] as Arc[],
  };
  const hooks: CombatRuntimeHooks = {
    view: { camera, config },
    fx,
    hud,
    world: () => world,
  };

  return { cr: new CombatRuntime(hooks), camera, hud, world, fx };
}

describe('CombatRuntime — taking damage', () => {
  it('drains health directly when there is no armour', () => {
    const { cr } = setup();

    cr.hurtPlayer(15);

    expect(cr.hp).toBe(85);
    expect(cr.armor).toBe(0);
    expect(cr.hurtFx).toBe(HURT_FX_DURATION);
  });

  it('soaks a third of the hit into armour (floored), the rest into health', () => {
    const { cr } = setup();

    cr.addArmor(30);
    cr.hurtPlayer(30);

    expect(cr.armor).toBe(20);
    expect(cr.hp).toBe(80);
  });

  it('makes the HUD face react on every landed hit', () => {
    const { cr, hud } = setup();
    const onHit = vi.spyOn(hud, 'onHit');

    cr.hurtPlayer(5);

    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it('enters the game-over latch when health reaches 0 and then ignores further hits', () => {
    const { cr } = setup();

    cr.hurtPlayer(100);

    expect(cr.hp).toBe(0);
    expect(cr.dead).toBe(true);

    cr.hurtPlayer(10);

    expect(cr.hp).toBe(0);
  });

  it('ages the game-over restart clock while dead', () => {
    const { cr } = setup();

    cr.hurtPlayer(100);
    cr.tickDeadClock(0.5);
    cr.tickDeadClock(0.7);

    expect(cr.deadClock).toBeCloseTo(1.2, 5);
  });
});

describe('CombatRuntime — hurting an enemy', () => {
  it('subtracts damage and flashes the enemy white without killing it', () => {
    const { cr } = setup();
    const enemy = makeEnemy();

    cr.hurtEnemy(enemy, 10);

    expect(enemy.hp).toBe(20);
    expect(enemy.hitFlash).toBe(HIT_FLASH_DURATION);
    expect(enemy.dying).toBe(false);
  });

  it('switches the enemy to the death animation once its hp drops to or below 0', () => {
    const { cr } = setup();
    const enemy = makeEnemy();

    cr.hurtEnemy(enemy, 35);

    expect(enemy.hp).toBeLessThanOrEqual(0);
    expect(enemy.dying).toBe(true);
    expect(enemy.deathTime).toBe(0);
  });
});

describe('CombatRuntime — combat frames', () => {
  it('builds the enemy CombatFrame from the live world + camera, routing hurt back to the player', () => {
    const enemies = [makeEnemy()];
    const { cr, world, camera } = setup({ enemies });
    const frame = cr.activeFrame();

    expect(frame.map).toBe(world.map);
    expect(frame.enemies).toBe(world.enemies);
    expect(frame.px).toBe(camera.x);
    expect(frame.py).toBe(camera.y);

    frame.hurt(20);

    expect(cr.hp).toBe(80);
  });

  it('builds the player CombatFrame from state + world, wiring the FX side-effect callbacks', () => {
    const enemies = [makeEnemy()];
    const { cr, fx, camera } = setup({ enemies });

    camera.pitch = 0.5;
    const frame = cr.playerCombatFrame();

    expect(frame.cameraX).toBe(camera.x);
    expect(frame.cameraZ).toBe(camera.z);
    expect(frame.angle).toBe(camera.angle);
    expect(frame.projectiles).toBe(fx.projectiles);
    expect(frame.enemies).toBe(enemies);
    expect(frame.vSlope).toBeCloseTo((0.5 * 360) / 640, 6);

    frame.hurtEnemy(enemies[0], 10);
    expect(enemies[0].hp).toBe(20);

    frame.addImpact('impact_metal', 1, 2, 3);
    expect(fx.impacts).toEqual([{ kind: 'impact_metal', x: 1, y: 2, z: 3, age: 0 }]);

    frame.addImpact('', 4, 5, 6);
    expect(fx.impacts).toHaveLength(1);

    const arc = { ax: 0, ay: 0, bx: 1, by: 1, age: 0 } as unknown as Arc;

    frame.addArc(arc);
    expect(fx.arcs).toEqual([arc]);
  });
});

describe('CombatRuntime — the weapon fire step', () => {
  it('spends one magazine round per shot and then respects the fire cooldown', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    cr.beginFire();

    cr.stepWeapon(0.02, false);
    expect(cr.mag[CHAINGUN]).toBe(79);
    expect(cr.shotFx).toBe(SHOT_FX_DURATION);

    cr.stepWeapon(0.02, false);
    expect(cr.mag[CHAINGUN]).toBe(79);

    cr.stepWeapon(0.06, false);
    expect(cr.mag[CHAINGUN]).toBe(78);
  });

  it('does not fire or drop a round while mid-mantle (the climb pull replaces the weapon)', () => {
    const { cr } = setup();

    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    cr.beginFire();

    cr.stepWeapon(0.02, true);

    expect(cr.mag[CHAINGUN]).toBe(80);
    expect(cr.shotFx).toBe(0);
  });

  it('stages a reload that moves reserve → magazine once the reload time elapses', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    const reserveBefore = cr.reserveOf('bullets');

    cr.beginFire();
    cr.stepWeapon(0.02, false);
    cr.endFire();
    expect(cr.mag[CHAINGUN]).toBe(79);

    cr.reload();
    cr.stepWeapon(0.02, false);
    expect(cr.mag[CHAINGUN]).toBe(79);

    cr.stepWeapon(1.7, false);
    expect(cr.mag[CHAINGUN]).toBe(80);
    expect(cr.reserveOf('bullets')).toBe(reserveBefore - 1);
  });

  it('does not reload a full magazine', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    const reserveBefore = cr.reserveOf('bullets');

    cr.reload();
    cr.stepWeapon(1.7, false);

    expect(cr.mag[CHAINGUN]).toBe(80);
    expect(cr.reserveOf('bullets')).toBe(reserveBefore);
  });
});

describe('CombatRuntime — weapon selection', () => {
  it('ignores a switch to an UNOWNED slot (the DOOM progression)', () => {
    const { cr } = setup();

    cr.selectWeapon(CHAINGUN);

    expect(cr.weaponIndex).toBe(0);
  });

  it('ignores an out-of-range slot', () => {
    const { cr } = setup();

    cr.selectWeapon(99);

    expect(cr.weaponIndex).toBe(0);
  });

  it('switches to an owned slot', () => {
    const { cr } = setup();

    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);

    expect(cr.weaponIndex).toBe(CHAINGUN);
    expect(cr.weaponView).toBeDefined();
  });

  it('cycles only across owned weapons on the wheel', () => {
    const { cr } = setup();

    cr.cycleWeapon(1);
    expect(cr.weaponIndex).toBe(0);

    cr.grantWeapon('chaingun');
    cr.cycleWeapon(1);
    expect(cr.weaponIndex).toBe(CHAINGUN);
  });
});

describe('CombatRuntime — the grant API', () => {
  it('heals up to the player ceiling', () => {
    const { cr } = setup();

    cr.hurtPlayer(80);
    cr.heal(15);
    expect(cr.hp).toBe(35);

    cr.heal(1000);
    expect(cr.hp).toBe(100);
  });

  it('adds armour up to the ceiling', () => {
    const { cr } = setup();

    cr.addArmor(200);

    expect(cr.armor).toBe(100);
  });

  it('adds ammo to a reserve, clamped to the passed cap', () => {
    const { cr } = setup();

    cr.addAmmo('bullets', 10, 8);

    expect(cr.reserveOf('bullets')).toBe(8);
  });

  it('grants weapon ownership (survives a repeat query) and reports it', () => {
    const { cr } = setup();

    expect(cr.owns('chaingun')).toBe(false);
    cr.grantWeapon('chaingun');
    expect(cr.owns('chaingun')).toBe(true);
    expect(cr.ownedWeapons.has('chaingun')).toBe(true);
  });

  it('refills every magazine to its full size', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    cr.beginFire();
    cr.stepWeapon(0.02, false);
    expect(cr.mag[CHAINGUN]).toBe(79);

    cr.refillMag();

    expect(cr.mag[CHAINGUN]).toBe(80);
  });
});

describe('CombatRuntime — seeding reserves', () => {
  it('fills every ammo type to RESERVE_START clamped to its cap', () => {
    const { cr } = setup();

    expect(cr.reserveOf('bullets')).toBe(0);

    cr.seedReserves();

    expect(cr.reserveOf('bullets')).toBe(Math.min(ammoTypeMax('bullets'), 50));
    expect(cr.reserveOf('cells')).toBe(Math.min(ammoTypeMax('cells'), 50));
  });
});

describe('CombatRuntime — FX decay', () => {
  it('fades the muzzle, hurt and discharge feedback timers each frame', () => {
    const { cr } = setup();

    cr.hurtPlayer(5);
    cr.decayFx(0.1);
    expect(cr.hurtFx).toBeCloseTo(HURT_FX_DURATION - 0.1, 5);

    cr.decayFx(1);
    expect(cr.hurtFx).toBe(0);
  });
});

describe('CombatRuntime — the debug stress load', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('ramps synthetic enemies and fires their shots into the shared projectile pool once toggled on', () => {
    const { cr, fx } = setup();

    cr.toggleStress();
    cr.stepStress(1);

    expect(cr.stressEnemyCount).toBe(8);
    expect(fx.projectiles).toHaveLength(8);
    expect(fx.projectiles[0].kind).toBe('nail');
    expect(fx.projectiles[0].damage).toBe(0);
    expect(cr.aiMs).toBeGreaterThanOrEqual(0);
  });

  it('treats a synthetic enemy sitting on the camera as a unit-distance approach (no divide-by-zero)', () => {
    // The camera sits ON the mocked spawn point (1 + 0.5 × 13, 1 + 0.5 × 10) → dx = dy = 0 → the `|| 1` guard.
    const camera = { x: 7.5, y: 6, angle: 0, z: 1.4, pitch: 0 };
    const world = makeWorld();
    const cr = new CombatRuntime({
      view: { camera, config: { width: 1280, height: 720, fov: Math.PI / 2 } },
      fx: { projectiles: [], impacts: [], arcs: [] },
      hud: new DoomHud(),
      world: () => world,
    });

    cr.toggleStress();
    cr.stepStress(1);

    expect(cr.stressEnemyCount).toBe(8);
  });

  it('holds a synthetic enemy’s fire while it is still on cooldown', () => {
    const { cr, fx } = setup();

    cr.toggleStress();
    cr.stepStress(0.001); // enemies spawn + approach, but the cooldown never reaches zero this frame

    expect(cr.stressEnemyCount).toBe(8);
    expect(fx.projectiles).toHaveLength(0);
  });

  it('leaves a synthetic enemy idle when a wall blocks its line to the player', () => {
    const camera = { x: 100, y: 100, angle: 0, z: 1.4, pitch: 0 }; // OUTSIDE the 0..60 room
    const fx = { projectiles: [] as Projectile[], impacts: [] as Impact[], arcs: [] as Arc[] };
    const cr = new CombatRuntime({
      view: { camera, config: { width: 1280, height: 720, fov: Math.PI / 2 } },
      fx,
      hud: new DoomHud(),
      world: () => makeWorld(),
    });

    cr.toggleStress();
    cr.stepStress(1); // the ray to the out-of-room player hits a wall → no approach, no fire

    expect(cr.stressEnemyCount).toBe(8);
    expect(fx.projectiles).toHaveLength(0);
  });

  it('stops queueing synthetic shots once the projectile pool is saturated', () => {
    const { cr, fx } = setup();

    for (let i = 0; i < 200; i++) {
      fx.projectiles.push({ kind: 'nail' } as unknown as Projectile);
    }
    cr.toggleStress();
    cr.stepStress(3); // the enemies want to fire, but the cap short-circuits fireEnemyShot

    expect(fx.projectiles).toHaveLength(200);
  });

  it('is inert until toggled and clears the roster when toggled back off', () => {
    const { cr, fx } = setup();

    cr.stepStress(1);
    expect(cr.stressEnemyCount).toBe(0);
    expect(fx.projectiles).toHaveLength(0);

    cr.toggleStress();
    cr.stepStress(1);
    expect(cr.stressEnemyCount).toBe(8);

    cr.toggleStress();
    expect(cr.stressEnemyCount).toBe(0);
    expect(cr.aiMs).toBe(0);
  });
});

describe('CombatRuntime — the read-only getters', () => {
  it('exposes the reserve map, climb view, won clock, glow feedback and the empty stress roster', () => {
    const { cr } = setup();

    cr.seedReserves();

    expect(cr.reserve.get('bullets')).toBe(cr.reserveOf('bullets'));
    expect(cr.climbView).toBeDefined();
    expect(cr.chargeGlow).toBe(0);
    expect(cr.dischargeFlash).toBe(0);
    expect(cr.stressEnemies).toEqual([]);

    expect(cr.wonClock).toBe(0);
    cr.tickWonClock(0.4);
    expect(cr.wonClock).toBeCloseTo(0.4, 5);
  });

  it('reads a zero vertical slope when the camera carries no pitch', () => {
    const camera = { x: 30, y: 30, angle: 0, z: 1.4 }; // pitch omitted → the `?? 0` fallback
    const world = makeWorld({ enemies: [makeEnemy()] });
    const cr = new CombatRuntime({
      view: { camera, config: { width: 1280, height: 720, fov: Math.PI / 2 } },
      fx: { projectiles: [], impacts: [], arcs: [] },
      hud: new DoomHud(),
      world: () => world,
    });

    expect(cr.playerCombatFrame().vSlope).toBe(0);
  });
});

describe('CombatRuntime — the weapon fire modes', () => {
  const ROCKET = ARSENAL.findIndex((weapon) => weapon.id === 'rocket');
  const BFG = ARSENAL.findIndex((weapon) => weapon.id === 'bfg');

  it('swings the default melee (semi, magazine-less) on a fire edge, spending no reserve', () => {
    const { cr } = setup();

    cr.beginFire();
    cr.stepWeapon(0.2, false); // fist: fireMode undefined → 'semi'; magSize 0 → loaded; ammoType null → 0 reserve

    expect(cr.weaponIndex).toBe(0);
    expect(cr.shotFx).toBe(SHOT_FX_DURATION);
  });

  it('dry-clicks a magazine SEMI weapon on an empty chamber', () => {
    const { cr } = setup();

    cr.grantWeapon('rocket');
    cr.selectWeapon(ROCKET);
    cr.beginFire();
    cr.stepWeapon(0.5, false); // magSize 1 → the single round fires
    expect(cr.mag[ROCKET]).toBe(0);

    const dryFire = vi.spyOn(cr.weaponView, 'dryFire');

    cr.beginFire();
    cr.stepWeapon(0.5, false); // empty chamber, magSize > 0 → dry-click

    expect(dryFire).toHaveBeenCalled();
    expect(cr.mag[ROCKET]).toBe(0);
  });

  it('dry-clicks an AUTO weapon whose magazine has run dry under a held trigger', () => {
    const { cr } = setup();

    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    cr.beginFire();
    for (let i = 0; i < 120; i++) {
      cr.stepWeapon(0.1, false); // drain the mag — no reserve seeded, so no auto-reload refills it
    }
    expect(cr.mag[CHAINGUN]).toBe(0);

    const dryFire = vi.spyOn(cr.weaponView, 'dryFire');

    cr.stepWeapon(0.1, false);

    expect(dryFire).toHaveBeenCalled();
  });

  it('spins up the CHARGE weapon (lighting the charge glow) then discharges (the flash)', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('bfg');
    cr.selectWeapon(BFG);

    cr.beginFire();
    cr.stepWeapon(0.1, false); // enters the spin-up
    expect(cr.chargeGlow).toBeGreaterThan(0);

    cr.beginFire(); // a re-press mid-charge is swallowed (charge + swinging → no re-trigger)
    for (let i = 0; i < 20 && cr.dischargeFlash === 0; i++) {
      cr.stepWeapon(0.1, false);
    }

    expect(cr.dischargeFlash).toBe(1);
  });
});

describe('CombatRuntime — the new-game reset', () => {
  it('restores health, armour, the fists-only loadout, full magazines and seeded reserves', () => {
    const { cr } = setup();

    cr.seedReserves();
    cr.grantWeapon('chaingun');
    cr.selectWeapon(CHAINGUN);
    cr.beginFire();
    cr.stepWeapon(0.02, false);
    cr.hurtPlayer(60);
    cr.addArmor(50);
    cr.win();

    cr.resetPlayer();

    expect(cr.hp).toBe(100);
    expect(cr.armor).toBe(0);
    expect(cr.dead).toBe(false);
    expect(cr.won).toBe(false);
    expect(cr.weaponIndex).toBe(0);
    expect(cr.owns('chaingun')).toBe(false);
    expect(cr.owns('fist')).toBe(true);
    expect(cr.mag[CHAINGUN]).toBe(80);
    expect(cr.reserveOf('bullets')).toBe(Math.min(ammoTypeMax('bullets'), 50));
  });
});
