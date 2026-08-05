import { describe, it, expect, vi } from 'vitest';
import { buildBsp } from '../../bsp-engine';
import type { LineDef, MapSource, SideDef, Sprite } from '../../bsp-engine';
import type { CombatEnemy } from '../enemy';
import type { EnemyCombat } from '../enemy';
import type { ChainSpec, WeaponCombat } from '../types';
import type { Barrel } from './barrel';
import type { Arc, Projectile } from './projectile';
import type { PlayerCombatFrame } from './player-combat-frame';
import { collectHittables } from './hittables';
import { fireWeapon, fireSpread, resolveHitscan } from './weapon-fire';
import { stepProjectiles, detonate, chainFrom } from './projectile-step';

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
const GLASSED_SOURCE: MapSource = {
  ...OPEN_SOURCE,
  vertices: [...OPEN_SOURCE.vertices, { x: 35, y: 15 }, { x: 35, y: 45 }],
  linedefs: [
    ...OPEN_SOURCE.linedefs,
    { v1: 4, v2: 5, front: side, back: { ...side }, glass: true },
  ],
};

const OPEN = buildBsp(OPEN_SOURCE);
const GLASSED = buildBsp(GLASSED_SOURCE);

const PLAYER_X = 30;
const PLAYER_Y = 30;
const EYE_Z = 1;

const makeSprite = (x: number, y: number, z = 0, height = 2): Sprite => ({
  x,
  y,
  z,
  tex: 'BARREL',
  width: 0.8,
  height,
});

const makeBarrel = (x: number, y: number, z = 0, height = 2): Barrel => ({
  sprite: makeSprite(x, y, z, height),
  alive: true,
});

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

const makeEnemy = (x: number, y: number, over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  spec: ENEMY_SPEC,
  x,
  y,
  z: 0,
  walkDist: 0,
  hp: ENEMY_SPEC.hp,
  dying: false,
  deathTime: 0,
  hitFlash: 0,
  windup: 0,
  cooldown: 0,
  dormant: false,
  ...over,
});

const HITSCAN_COMBAT: WeaponCombat = {
  damage: 20,
  range: 40,
  cone: 0,
  fireCooldown: 0.2,
  knockback: 0,
  costsAmmo: true,
  ammoType: 'bullets',
  ammoPerShot: 1,
  magSize: 12,
  reloadTime: 1,
  pellets: 1,
  selfKnockback: 0,
  projectile: null,
  impactKind: 'impact_metal',
};

const makeCombat = (over: Partial<WeaponCombat> = {}): WeaponCombat => ({
  ...HITSCAN_COMBAT,
  ...over,
});

const makeProjectile = (over: Partial<Projectile> = {}): Projectile => ({
  x: PLAYER_X,
  y: PLAYER_Y,
  z: EYE_Z,
  dx: 1,
  dy: 0,
  vSlope: 0,
  speed: 10,
  kind: 'nail',
  impactKind: 'impact_metal',
  damage: 20,
  radius: 0.2,
  splashR: 0,
  chain: null,
  traveled: 0,
  alive: true,
  ...over,
});

interface TestBag extends PlayerCombatFrame {
  readonly hurtSpy: ReturnType<typeof vi.fn>;
  readonly impactSpy: ReturnType<typeof vi.fn>;
  readonly arcSpy: ReturnType<typeof vi.fn>;
}

const makeBag = (
  over: Partial<Omit<PlayerCombatFrame, 'hurtEnemy' | 'addImpact' | 'addArc'>> = {},
): TestBag => {
  const hurtSpy = vi.fn();
  const impactSpy = vi.fn();
  const arcSpy = vi.fn();

  return {
    map: OPEN,
    slides: [],
    targets: [],
    enemies: [],
    projectiles: [],
    cameraX: PLAYER_X,
    cameraY: PLAYER_Y,
    cameraZ: EYE_Z,
    angle: 0,
    vSlope: 0,
    projectileWidth: () => 0.4,
    ...over,
    hurtEnemy: (enemy: CombatEnemy, damage: number) => hurtSpy(enemy, damage),
    addImpact: (kind: string, x: number, y: number, z: number) => impactSpy(kind, x, y, z),
    addArc: (arc: Arc) => arcSpy(arc),
    hurtSpy,
    impactSpy,
    arcSpy,
  };
};

describe('collectHittables', () => {
  it('includes a standing barrel + its pop closure, at its billboard mid-height', () => {
    const barrel = makeBarrel(40, 30);
    const bag = makeBag({ targets: [barrel] });

    const hittables = collectHittables(bag);

    expect(hittables).toHaveLength(1);
    expect(hittables[0].x).toBe(40);
    expect(hittables[0].z).toBe(1);
    expect(hittables[0].target.radius).toBeGreaterThan(0);

    hittables[0].hit(5);
    expect(barrel.alive).toBe(false);
  });

  it('skips a popped barrel', () => {
    const barrel = makeBarrel(40, 30);

    barrel.alive = false;
    const bag = makeBag({ targets: [barrel] });

    expect(collectHittables(bag)).toHaveLength(0);
  });

  it('includes a living enemy + a hurt closure that routes damage through the callback', () => {
    const enemy = makeEnemy(40, 30);
    const bag = makeBag({ enemies: [enemy] });

    const hittables = collectHittables(bag);

    expect(hittables).toHaveLength(1);
    expect(hittables[0].z).toBe(1);

    hittables[0].hit(7);
    expect(bag.hurtSpy).toHaveBeenCalledWith(enemy, 7);
  });

  it('skips a dying enemy', () => {
    const bag = makeBag({ enemies: [makeEnemy(40, 30, { dying: true })] });

    expect(collectHittables(bag)).toHaveLength(0);
  });

  it('omits a dormant enemy — you cannot shoot what has not spawned', () => {
    const bag = makeBag({ enemies: [makeEnemy(40, 30), { ...makeEnemy(42, 30), dormant: true }] });

    const hittables = collectHittables(bag);

    expect(hittables).toHaveLength(1);
    expect(hittables[0].x).toBe(40);
  });

  it('inflates every silhouette (radius + vertical span) by the projectile radius', () => {
    const bag = makeBag({ targets: [makeBarrel(40, 30)], enemies: [makeEnemy(41, 30)] });

    const tight = collectHittables(bag, 0);
    const fat = collectHittables(bag, 0.5);

    expect(fat[0].target.radius).toBeCloseTo(tight[0].target.radius + 0.5, 5);
    expect(fat[0].target.zMin).toBeCloseTo((tight[0].target.zMin ?? 0) - 0.5, 5);
    expect(fat[0].target.zMax).toBeCloseTo((tight[0].target.zMax ?? 0) + 0.5, 5);
    expect(fat[1].target.radius).toBeCloseTo(tight[1].target.radius + 0.5, 5);
  });
});

describe('resolveHitscan', () => {
  it('hits the nearest target in the cone and sparks an impact on it (returns true)', () => {
    const near = makeBarrel(40, 30);
    const far = makeBarrel(50, 30);
    const bag = makeBag({ targets: [far, near] });

    const hit = resolveHitscan(bag, 1, 0, 0, 40, 'impact_metal', 20);

    expect(hit).toBe(true);
    expect(near.alive).toBe(false);
    expect(far.alive).toBe(true);
    expect(bag.impactSpy).toHaveBeenCalledWith('impact_metal', 40, 30, 1);
  });

  it('stops at a glass pane — the target behind is unhittable, the impact sparks on the pane', () => {
    const enemy = makeEnemy(40, 30);
    const bag = makeBag({ enemies: [enemy], map: GLASSED });

    const hit = resolveHitscan(bag, 1, 0, 0, 40, 'impact_metal', 25);

    expect(hit).toBe(false);
    expect(bag.hurtSpy).not.toHaveBeenCalled();
    expect(bag.impactSpy).toHaveBeenCalledWith('impact_metal', 35, 30, EYE_Z);
  });

  it('routes damage to a hit enemy through the hurt callback', () => {
    const enemy = makeEnemy(40, 30);
    const bag = makeBag({ enemies: [enemy] });

    resolveHitscan(bag, 1, 0, 0, 40, 'impact_metal', 25);

    expect(bag.hurtSpy).toHaveBeenCalledWith(enemy, 25);
  });

  it('misses a target the aim line sails over (vertical tolerance), returning false', () => {
    const barrel = makeBarrel(40, 30, 0, 2);
    const bag = makeBag({ targets: [barrel], vSlope: 0.5 });

    const hit = resolveHitscan(bag, 1, 0, 0, 40, 'impact_metal', 20);

    expect(hit).toBe(false);
    expect(barrel.alive).toBe(true);
  });

  it('a wide cone catches an off-centre target a zero cone would miss', () => {
    const barrel = makeBarrel(40, 33);
    const narrow = makeBag({ targets: [makeBarrel(40, 33)] });
    const wide = makeBag({ targets: [barrel] });

    expect(resolveHitscan(narrow, 1, 0, 0, 40, 'impact_metal', 20)).toBe(false);
    expect(resolveHitscan(wide, 1, 0, 0.5, 40, 'impact_metal', 20)).toBe(true);
  });

  it('sparks on the floor for a downward shot past the muzzle grace (no target)', () => {
    const bag = makeBag({ vSlope: -0.5 });

    const hit = resolveHitscan(bag, 1, 0, 0, 10, 'impact_metal', 20);

    expect(hit).toBe(false);
    expect(bag.impactSpy).toHaveBeenCalledTimes(1);
    expect(bag.impactSpy.mock.calls[0][0]).toBe('impact_metal');
    expect(bag.impactSpy.mock.calls[0][3]).toBeCloseTo(0, 5);
  });

  it('respects the muzzle grace: a steep downward shot within it does NOT spark at the feet', () => {
    const bag = makeBag({ vSlope: -1 });

    const hit = resolveHitscan(bag, 1, 0, 0, 1.2, 'impact_metal', 20);

    expect(hit).toBe(false);
    expect(bag.impactSpy).not.toHaveBeenCalled();
  });

  it('sparks on a wall at the aim height when nothing else is in the way', () => {
    const bag = makeBag();

    const hit = resolveHitscan(bag, 1, 0, 0, 40, 'impact_metal', 20);

    expect(hit).toBe(false);
    const [kind, x, , z] = bag.impactSpy.mock.calls[0];

    expect(kind).toBe('impact_metal');
    expect(x).toBeCloseTo(60, 3);
    expect(z).toBeCloseTo(EYE_Z, 5);
  });

  it('sparks nothing when the shot reaches neither target, floor, nor wall', () => {
    const bag = makeBag();

    const hit = resolveHitscan(bag, 1, 0, 0, 5, 'impact_metal', 20);

    expect(hit).toBe(false);
    expect(bag.impactSpy).not.toHaveBeenCalled();
  });
});

describe('fireWeapon', () => {
  it('launches a travelling projectile for a projectile weapon (fields from the combat spec)', () => {
    const chain: ChainSpec = { targets: 3, range: 4, falloff: 0.6 };
    const combat = makeCombat({
      damage: 30,
      impactKind: 'impact_plasma',
      projectile: {
        speed: 12,
        splashDamage: 0,
        splashRadius: 2.5,
        selfDamage: false,
        chain,
        kind: 'plasma',
      },
    });
    const bag = makeBag({ vSlope: 0.25 });

    fireWeapon(bag, combat);

    expect(bag.projectiles).toHaveLength(1);
    const p = bag.projectiles[0];

    expect(p.dx).toBeCloseTo(1, 5);
    expect(p.dy).toBeCloseTo(0, 5);
    expect(p.vSlope).toBe(0.25);
    expect(p.speed).toBe(12);
    expect(p.kind).toBe('plasma');
    expect(p.impactKind).toBe('impact_plasma');
    expect(p.damage).toBe(30);
    expect(p.radius).toBeCloseTo(0.2, 5);
    expect(p.splashR).toBe(2.5);
    expect(p.chain).toBe(chain);
    expect(p.x).toBeGreaterThan(PLAYER_X);
    expect(p.z).toBeGreaterThan(EYE_Z);
  });

  it('launches nothing when the projectile kind has no known width', () => {
    const combat = makeCombat({
      projectile: {
        speed: 12,
        splashDamage: 0,
        splashRadius: 0,
        selfDamage: false,
        chain: null,
        kind: 'x',
      },
    });
    const bag = makeBag({ projectileWidth: () => undefined });

    fireWeapon(bag, combat);

    expect(bag.projectiles).toHaveLength(0);
  });

  it('fans a spread for a multi-pellet weapon (each pellet resolves a hitscan)', () => {
    const barrel = makeBarrel(40, 30);
    const bag = makeBag({ targets: [barrel] });

    fireWeapon(bag, makeCombat({ pellets: 5, cone: 0.2 }));

    expect(barrel.alive).toBe(false);
    expect(bag.impactSpy).toHaveBeenCalled();
  });

  it('resolves a single hitscan for a one-pellet non-projectile weapon', () => {
    const enemy = makeEnemy(40, 30);
    const bag = makeBag({ enemies: [enemy] });

    fireWeapon(bag, makeCombat({ pellets: 1, damage: 15 }));

    expect(bag.hurtSpy).toHaveBeenCalledWith(enemy, 15);
  });
});

describe('fireSpread', () => {
  it('fires exactly `pellets` rays across the cone', () => {
    const bag = makeBag();

    fireSpread(bag, makeCombat({ pellets: 4, cone: 0.15 }));

    expect(bag.impactSpy).toHaveBeenCalledTimes(4);
  });

  it('fires a single centred ray when called with one pellet', () => {
    const barrel = makeBarrel(40, 30);
    const bag = makeBag({ targets: [barrel] });

    fireSpread(bag, makeCombat({ pellets: 1, cone: 0.15 }));

    expect(barrel.alive).toBe(false);
  });
});

describe('stepProjectiles', () => {
  it('advances a shot through open space, climbing along its pitch, keeping it alive', () => {
    const p = makeProjectile({ vSlope: 0.1, speed: 10 });
    const bag = makeBag({ projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(bag.projectiles).toHaveLength(1);
    expect(p.x).toBeCloseTo(PLAYER_X + 1, 5);
    expect(p.z).toBeCloseTo(EYE_Z + 0.1, 5);
    expect(p.traveled).toBeCloseTo(1, 5);
  });

  it('detonates on a direct target hit: deals damage, sparks, and is culled', () => {
    const barrel = makeBarrel(30.5, 30);
    const p = makeProjectile({ speed: 10, damage: 40, impactKind: 'impact_metal' });
    const bag = makeBag({ targets: [barrel], projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(barrel.alive).toBe(false);
    expect(bag.impactSpy).toHaveBeenCalledWith('impact_metal', 30.5, 30, 1);
    expect(bag.projectiles).toHaveLength(0);
  });

  it('applies splash to every barrel + enemy within the blast radius on a direct hit', () => {
    const struck = makeBarrel(30.5, 30);
    const splashed = makeBarrel(31.5, 30);
    const outside = makeBarrel(40, 30);
    const enemy = makeEnemy(31.6, 30);
    const p = makeProjectile({ speed: 10, damage: 40, splashR: 2 });
    const bag = makeBag({
      targets: [struck, splashed, outside],
      enemies: [enemy],
      projectiles: [p],
    });

    stepProjectiles(bag, 0.1);

    expect(struck.alive).toBe(false);
    expect(splashed.alive).toBe(false);
    expect(outside.alive).toBe(true);
    expect(bag.hurtSpy).toHaveBeenCalledWith(enemy, 40);
  });

  it('chains lightning between nearby barrels in nearest-first order on a plasma hit', () => {
    const struck = makeBarrel(30.5, 30);
    const hopA = makeBarrel(32, 30);
    const hopB = makeBarrel(33.5, 30);
    const chain: ChainSpec = { targets: 2, range: 3, falloff: 0.6 };
    const p = makeProjectile({ speed: 10, chain });
    const bag = makeBag({ targets: [struck, hopA, hopB], projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(hopA.alive).toBe(false);
    expect(hopB.alive).toBe(false);
    expect(bag.arcSpy).toHaveBeenCalledTimes(2);
  });

  it('detonates on the floor for a diving shot past the muzzle grace', () => {
    const p = makeProjectile({ vSlope: -0.5, speed: 10, splashR: 0 });
    const bag = makeBag({ projectiles: [p] });

    stepProjectiles(bag, 0.3);

    expect(bag.projectiles).toHaveLength(0);
    expect(bag.impactSpy.mock.calls[0][3]).toBeCloseTo(0, 5);
  });

  it('detonates on a wall it strikes', () => {
    const p = makeProjectile({ x: 59, y: 30, dx: 1, dy: 0, speed: 20 });
    const bag = makeBag({ projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(bag.projectiles).toHaveLength(0);
    expect(bag.impactSpy).toHaveBeenCalled();
    expect(bag.impactSpy.mock.calls[0][1]).toBeCloseTo(60, 3);
  });

  it('spends a shot once it has flown its maximum range', () => {
    const p = makeProjectile({ x: 20, y: 30, speed: 10, traveled: 39.5 });
    const bag = makeBag({ projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(bag.projectiles).toHaveLength(0);
  });

  it('a shot flying over a short barrel sails past it', () => {
    const low = makeBarrel(35, 30, 0, 0.5);
    const p = makeProjectile({ z: 3, vSlope: 0, speed: 10 });
    const bag = makeBag({ targets: [low], projectiles: [p] });

    stepProjectiles(bag, 0.1);

    expect(low.alive).toBe(true);
    expect(bag.projectiles).toHaveLength(1);
  });

  it('compacts the pool in place, keeping the survivors in order', () => {
    const flying = makeProjectile({ x: 20, y: 30 });
    const walled = makeProjectile({ x: 59, y: 30, speed: 20 });
    const flying2 = makeProjectile({ x: 22, y: 30 });
    const pool = [flying, walled, flying2];
    const bag = makeBag({ projectiles: pool });

    stepProjectiles(bag, 0.1);

    expect(bag.projectiles).toBe(pool);
    expect(bag.projectiles).toHaveLength(2);
    expect(bag.projectiles[0]).toBe(flying);
    expect(bag.projectiles[1]).toBe(flying2);
  });
});

describe('detonate', () => {
  it('with a positive radius pops barrels and hurts enemies within it, then sparks', () => {
    const inside = makeBarrel(30.5, 30);
    const outside = makeBarrel(40, 30);
    const enemyIn = makeEnemy(31, 30);
    const enemyOut = makeEnemy(40, 30);
    const bag = makeBag({ targets: [inside, outside], enemies: [enemyIn, enemyOut] });

    detonate(bag, 30, 30, 1, 2, 15, 'impact_boom');

    expect(inside.alive).toBe(false);
    expect(outside.alive).toBe(true);
    expect(bag.hurtSpy).toHaveBeenCalledWith(enemyIn, 15);
    expect(bag.hurtSpy).not.toHaveBeenCalledWith(enemyOut, 15);
    expect(bag.impactSpy).toHaveBeenCalledWith('impact_boom', 30, 30, 1);
  });

  it('skips a dying enemy in the blast', () => {
    const enemy = makeEnemy(31, 30, { dying: true });
    const bag = makeBag({ enemies: [enemy] });

    detonate(bag, 30, 30, 1, 2, 15, 'impact_boom');

    expect(bag.hurtSpy).not.toHaveBeenCalled();
  });

  it('skips a DORMANT enemy in the blast — splash must not hurt a foe whose art has not landed', () => {
    const enemy = makeEnemy(31, 30, { dormant: true });
    const bag = makeBag({ enemies: [enemy] });

    detonate(bag, 30, 30, 1, 2, 15, 'impact_boom');

    expect(bag.hurtSpy).not.toHaveBeenCalled(); // an off-screen husk must not be damaged/killed
  });

  it('with a zero radius only sparks (no splash sweep)', () => {
    const near = makeBarrel(30.1, 30);
    const bag = makeBag({ targets: [near] });

    detonate(bag, 30, 30, 1, 0, 15, 'impact_metal');

    expect(near.alive).toBe(true);
    expect(bag.impactSpy).toHaveBeenCalledWith('impact_metal', 30, 30, 1);
  });
});

describe('chainFrom', () => {
  it('hops nearest-first, culling each barrel and drawing an arc, up to the hop count', () => {
    const hopA = makeBarrel(31, 30);
    const hopB = makeBarrel(32.5, 30);
    const bag = makeBag({ targets: [hopB, hopA] });
    const chain: ChainSpec = { targets: 3, range: 2, falloff: 0.5 };

    chainFrom(bag, 30, 30, 1, chain);

    expect(hopA.alive).toBe(false);
    expect(hopB.alive).toBe(false);
    expect(bag.arcSpy).toHaveBeenCalledTimes(2);
  });

  it('stops when no standing barrel remains within range', () => {
    const far = makeBarrel(40, 30);
    const bag = makeBag({ targets: [far] });
    const chain: ChainSpec = { targets: 3, range: 2, falloff: 0.5 };

    chainFrom(bag, 30, 30, 1, chain);

    expect(far.alive).toBe(true);
    expect(bag.arcSpy).not.toHaveBeenCalled();
  });

  it('skips already-popped barrels while hopping', () => {
    const dead = makeBarrel(30.5, 30);

    dead.alive = false;
    const live = makeBarrel(31, 30);
    const bag = makeBag({ targets: [dead, live] });
    const chain: ChainSpec = { targets: 1, range: 2, falloff: 0.5 };

    chainFrom(bag, 30, 30, 1, chain);

    expect(live.alive).toBe(false);
    expect(bag.arcSpy).toHaveBeenCalledTimes(1);
  });
});
