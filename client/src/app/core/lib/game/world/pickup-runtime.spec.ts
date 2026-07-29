import { describe, expect, it, vi } from 'vitest';
import type { Camera } from '../../bsp-engine';
import { DoomHud } from '../presentation/doom-hud';
import { ARSENAL } from '../presentation/weapons';
import { EXIT_RADIUS, PICKUP_FX_DURATION } from '../game-tuning';
import {
  AMMO_BOX_SPECS,
  EXIT_SPEC,
  keycardSpec,
  vitalSpec,
  weaponPickupSpec,
  type AmmoBox,
  type Keycard,
  type Marker,
  type Vital,
  type WeaponPickup,
} from './pickups';
import type { MutableSector } from '../../bsp-engine';
import type { Door, SlidingDoor, WarmZone, ZoneExit } from './zone-world';
import { CombatRuntime } from './combat-runtime';
import { PickupRuntime } from './pickup-runtime';

const STAPLES = AMMO_BOX_SPECS[0];
const SHOTGUN = ARSENAL.findIndex((weapon) => weapon.id === 'shotgun');

function vital(x: number, y: number, kind: 'health' | 'armor', size: 'large' | 'small' = 'large') {
  return { x, y, z: 0, age: 0, spec: vitalSpec(kind, size), idx: 0 } satisfies Vital & {
    idx: number;
  };
}

function ammoBox(x: number, y: number) {
  return { x, y, z: 0, age: 0, spec: STAPLES, idx: 0 } satisfies AmmoBox & { idx: number };
}

function keycard(x: number, y: number, color: 'blue' | 'yellow' | 'red') {
  return { x, y, z: 0, age: 0, spec: keycardSpec(color), idx: 0 } satisfies Keycard & {
    idx: number;
  };
}

function weaponPickup(x: number, y: number, id: 'shotgun' | 'chainsaw') {
  return {
    x,
    y,
    z: 0,
    age: 0,
    spec: weaponPickupSpec(id),
    idx: 0,
  } satisfies WeaponPickup & { idx: number };
}

function door(x: number, y: number, requiresCard: 'blue' | null): Door {
  return {
    sector: 0,
    triggerX: x,
    triggerY: y,
    closedCeilZ: 0,
    openCeilZ: 4,
    requiresCard,
    openness: 0,
  };
}

function exitMarker(x: number, y: number): Marker {
  return { x, y, z: 0, spec: EXIT_SPEC };
}

interface TestZone {
  world: WarmZone;
  exits: ZoneExit[];
  slidingDoors: SlidingDoor[];
  transition: object | null;
  exitsLocked: boolean;
  beginTransition: ReturnType<typeof vi.fn<(to: string, entry: string) => void>>;
  applyDoors: ReturnType<typeof vi.fn<(doors: readonly Door[], sectors: MutableSector[]) => void>>;
}

function makeWorld(overrides: Partial<WarmZone> = {}): WarmZone {
  return {
    vitals: [],
    ammoBoxes: [],
    keycards: [],
    weaponPickups: [],
    doors: [],
    slides: [],
    sectors: [],
    exit: null,
    ...overrides,
  } as unknown as WarmZone;
}

interface Harness {
  readonly pr: PickupRuntime;
  readonly camera: Camera & { x: number; y: number };
  readonly hud: DoomHud;
  readonly combat: CombatRuntime;
  readonly world: WarmZone;
  readonly zone: TestZone;
}

function setup(worldOverrides: Partial<WarmZone> = {}): Harness {
  const camera = { x: 0, y: 0, angle: 0, z: 1.4, pitch: 0 };
  const hud = new DoomHud();
  const world = makeWorld(worldOverrides);
  const combat = new CombatRuntime({
    view: { camera, config: { width: 1280, height: 720, fov: Math.PI / 2 } },
    fx: { projectiles: [], impacts: [], arcs: [] },
    hud,
    world: () => world,
  });
  const zone: TestZone = {
    world,
    exits: [],
    slidingDoors: [],
    transition: null,
    exitsLocked: false,
    beginTransition: vi.fn<(to: string, entry: string) => void>(),
    applyDoors: vi.fn<(doors: readonly Door[], sectors: MutableSector[]) => void>(),
  };
  const pr = new PickupRuntime({ camera, hud, combat, zone });

  return { pr, camera, hud, combat, world, zone };
}

describe('PickupRuntime — vitals', () => {
  it('heals on a health pickup the player walks onto, marks it taken, and flashes', () => {
    const { pr, combat, world } = setup({ vitals: [vital(0, 0, 'health', 'small')] });

    combat.hurtPlayer(50);

    pr.stepPickups(0.1);

    expect(combat.hp).toBe(75);
    expect(world.vitals).toHaveLength(0);
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);
  });

  it('caps the heal at the player ceiling', () => {
    const { pr, combat, world } = setup({ vitals: [vital(0, 0, 'health', 'large')] });

    combat.hurtPlayer(10);
    pr.stepPickups(0.1);

    expect(combat.hp).toBe(100);
    expect(world.vitals).toHaveLength(0);
  });

  it('adds armour on a mental pickup', () => {
    const { pr, combat, world } = setup({ vitals: [vital(0, 0, 'armor', 'small')] });

    pr.stepPickups(0.1);

    expect(combat.armor).toBe(25);
    expect(world.vitals).toHaveLength(0);
  });

  it('leaves an out-of-reach vital in place, still spinning', () => {
    const { pr, combat, world } = setup({ vitals: [vital(5, 5, 'health', 'small')] });

    combat.hurtPlayer(50);
    pr.stepPickups(0.1);

    expect(combat.hp).toBe(50);
    expect(world.vitals).toHaveLength(1);
    expect(world.vitals[0].age).toBeCloseTo(0.1, 5);
  });
});

describe('PickupRuntime — ammo boxes', () => {
  it('refills the right reserve (from empty) and consumes the box', () => {
    const { pr, combat, world } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    expect(combat.reserveOf('bullets')).toBe(0);

    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(STAPLES.amount);
    expect(world.ammoBoxes).toHaveLength(0);
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);
  });

  it('spins but never collects an ammo box in art-inspection mode', () => {
    const { pr, combat, world } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    pr.setInspectMode(true);
    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(0);
    expect(world.ammoBoxes).toHaveLength(1);
    expect(world.ammoBoxes[0].age).toBeCloseTo(0.1, 5);
  });

  it('keeps the box when the reserve is already full', () => {
    const { pr, combat, world } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    combat.addAmmo('bullets', STAPLES.max, STAPLES.max);

    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(STAPLES.max);
    expect(world.ammoBoxes).toHaveLength(1);
  });

  it('caps the refill at the reserve max', () => {
    const { pr, combat } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    combat.addAmmo('bullets', STAPLES.max - 5, STAPLES.max);

    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(STAPLES.max);
  });
});

describe('PickupRuntime — weapon pickups', () => {
  it('grants the weapon, auto-equips it on first pickup, and doses its ammo type', () => {
    const { pr, combat, world } = setup({ weaponPickups: [weaponPickup(0, 0, 'shotgun')] });

    expect(combat.owns('shotgun')).toBe(false);
    expect(combat.weaponIndex).toBe(0);

    pr.stepPickups(0.1);

    expect(combat.owns('shotgun')).toBe(true);
    expect(combat.weaponIndex).toBe(SHOTGUN);
    expect(combat.reserveOf('shells')).toBeGreaterThan(0);
    expect(world.weaponPickups).toHaveLength(0);
  });

  it('grants a melee weapon without dosing any ammo (null ammo type)', () => {
    const { pr, combat, world } = setup({ weaponPickups: [weaponPickup(0, 0, 'chainsaw')] });

    pr.stepPickups(0.1);

    expect(combat.owns('chainsaw')).toBe(true);
    expect(world.weaponPickups).toHaveLength(0);
  });

  it('collects a weapon anywhere ON its visual footprint — a 2u-wide chainsaw must not need a center-hug', () => {
    // standing at 1.1u from center = on the blade of the displayed volume, well past the old 0.6
    const { pr, combat } = setup({ weaponPickups: [weaponPickup(1.1, 0, 'chainsaw')] });

    pr.stepPickups(0.1);

    expect(combat.owns('chainsaw')).toBe(true);
  });

  it('leaves an out-of-reach weapon pickup in place, still spinning', () => {
    const { pr, combat, world } = setup({ weaponPickups: [weaponPickup(5, 5, 'shotgun')] });

    pr.stepPickups(0.1);

    expect(combat.owns('shotgun')).toBe(false);
    expect(world.weaponPickups).toHaveLength(1);
    expect(world.weaponPickups[0].age).toBeCloseTo(0.1, 5);
  });

  it('does NOT re-equip on a repeat pickup (only tops the reserve up)', () => {
    const { pr, combat } = setup({ weaponPickups: [weaponPickup(0, 0, 'shotgun')] });

    combat.grantWeapon('shotgun');
    expect(combat.weaponIndex).toBe(0);
    const shellsBefore = combat.reserveOf('shells');

    pr.stepPickups(0.1);

    expect(combat.weaponIndex).toBe(0);
    expect(combat.reserveOf('shells')).toBeGreaterThan(shellsBefore);
  });
});

describe('PickupRuntime — the objective', () => {
  it('collects a badge into the HUD card bay and marks it taken', () => {
    const { pr, hud, world } = setup({ keycards: [keycard(0, 0, 'blue')] });
    const addCard = vi.spyOn(hud, 'addCard');

    pr.stepObjective(0.1);

    expect(addCard).toHaveBeenCalledWith('blue');
    expect(world.keycards).toHaveLength(0);
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);
  });

  it('leaves an out-of-reach badge on the floor, still spinning', () => {
    const { pr, world } = setup({ keycards: [keycard(5, 5, 'blue')] });

    pr.stepObjective(0.1);

    expect(world.keycards).toHaveLength(1);
    expect(world.keycards[0].age).toBeCloseTo(0.1, 5);
    expect(pr.pickupFx).toBe(0);
  });

  it('begins the zone transition and drops the trigger on walking into a graph exit', () => {
    const { pr, combat, zone } = setup();
    const endFire = vi.spyOn(combat, 'endFire');

    zone.exits = [{ x: 0, y: 0, z: 0, to: 'm2', entry: 'lobby' }];
    pr.stepObjective(0.1);

    expect(zone.beginTransition).toHaveBeenCalledWith('m2', 'lobby');
    expect(endFire).toHaveBeenCalledTimes(1);
  });

  it('skips the graph-exit scan entirely while a zone transition is already in flight', () => {
    const { pr, zone } = setup();

    zone.transition = {}; // a transition is mid-flight → the exit-scan block is skipped
    zone.exits = [{ x: 0, y: 0, z: 0, to: 'm2', entry: 'lobby' }];

    pr.stepObjective(0.1);

    expect(zone.beginTransition).not.toHaveBeenCalled();
  });

  it('holds the arrival guard until the player leaves the exit radius', () => {
    const { pr, camera, zone } = setup();

    zone.exits = [{ x: 0, y: 0, z: 0, to: 'm2', entry: 'lobby' }];
    zone.exitsLocked = true;

    pr.stepObjective(0.1);
    expect(zone.exitsLocked).toBe(true);
    expect(zone.beginTransition).not.toHaveBeenCalled();

    camera.x = 100;
    pr.stepObjective(0.1);
    expect(zone.exitsLocked).toBe(false);
  });

  it('wins on reaching the legacy single exit', () => {
    const { pr, combat } = setup({ exit: exitMarker(0, 0) });
    const win = vi.spyOn(combat, 'win');

    pr.stepObjective(0.1);

    expect(win).toHaveBeenCalledTimes(1);
    expect(combat.won).toBe(true);
  });

  it('does not win from outside the exit radius', () => {
    const { pr, combat } = setup({ exit: exitMarker(EXIT_RADIUS + 1, 0) });

    pr.stepObjective(0.1);

    expect(combat.won).toBe(false);
  });
});

describe('PickupRuntime — doors', () => {
  it('opens a badge-locked door only once the matching badge is held', () => {
    const { pr, world, zone } = setup({
      doors: [door(0, 0, 'blue')],
      keycards: [keycard(0, 0, 'blue')],
    });

    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBe(0);
    expect(pr.hint).toBeGreaterThan(0);
    expect(zone.applyDoors).toHaveBeenCalledWith(world.doors, world.sectors);

    pr.stepObjective(0.1);
    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBeGreaterThan(0);
  });

  it('opens an unlocked (no-badge) door on proximity', () => {
    const { pr, world } = setup({ doors: [door(0, 0, null)] });

    pr.stepDoors(0.1);

    expect(world.doors[0].openness).toBeGreaterThan(0);
    expect(pr.hint).toBe(0);
  });

  it('leaves a far door shut', () => {
    const { pr, world } = setup({ doors: [door(100, 100, null)] });

    pr.stepDoors(0.1);

    expect(world.doors[0].openness).toBe(0);
  });
});

describe('PickupRuntime — sliding doors', () => {
  it('opens a slide by proximity and closes it once the player leaves', () => {
    const { pr, camera, world, zone } = setup({ slides: [0] });

    zone.slidingDoors = [{ line: 0, mx: 0, my: 0 }];

    pr.stepSliding(0.1);
    const opened = world.slides[0];

    expect(opened).toBeGreaterThan(0);

    camera.x = 100;
    pr.stepSliding(0.1);
    expect(world.slides[0]).toBeLessThan(opened);
  });
});

describe('PickupRuntime — feedback timers + reset', () => {
  it('fades the green pickup flash each frame, clamped at 0', () => {
    const { pr } = setup({ vitals: [vital(0, 0, 'health', 'small')] });

    pr.stepPickups(0.1);
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);

    pr.decayFx(0.1);
    expect(pr.pickupFx).toBeCloseTo(PICKUP_FX_DURATION - 0.1, 5);

    pr.decayFx(10);
    expect(pr.pickupFx).toBe(0);
  });

  it('clears the badge set, the HUD card bay, and both timers on a fresh-run reset', () => {
    const { pr, hud, world } = setup({
      keycards: [keycard(0, 0, 'blue')],
      doors: [door(0, 0, 'blue')],
    });
    const clearCards = vi.spyOn(hud, 'clearCards');

    pr.stepObjective(0.1);
    expect(pr.pickupFx).toBeGreaterThan(0);

    pr.reset(true);

    expect(clearCards).toHaveBeenCalledTimes(1);
    expect(pr.pickupFx).toBe(0);
    expect(pr.hint).toBe(0);

    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBe(0);
  });

  it('keeps earned badges (and their HUD cards) on a death respawn', () => {
    // Badges gate exactly once: a respawned player stripped of a spent colour can be sealed behind
    // its door with no way to re-earn it (the M6 CEO pocket ⇄ M7 red-door softlock).
    const { pr, hud, world } = setup({
      keycards: [keycard(0, 0, 'blue')],
      doors: [door(0, 0, 'blue')],
    });
    const clearCards = vi.spyOn(hud, 'clearCards');

    pr.stepObjective(0.1);

    pr.reset(false);

    expect(clearCards).not.toHaveBeenCalled();
    expect(pr.pickupFx).toBe(0);
    expect(pr.hint).toBe(0);

    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBeGreaterThan(0);
  });
});
