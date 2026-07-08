import { describe, expect, it, vi } from 'vitest';
import type { Camera } from '../../../core/lib/bsp-engine';
import { DoomHud } from '../../../shared/game/doom-hud';
import { ARSENAL } from '../../../shared/game/weapons';
import { PICKUP_FX_DURATION } from '../painters/overlay-painter';
import {
  AMMO_BOX_SPECS,
  EXIT_RADIUS,
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
import type { MutableSector } from '../../../core/lib/bsp-engine';
import type { Door, SlidingDoor, WarmZone, ZoneExit } from './zone-world';
import { CombatRuntime } from './combat-runtime';
import { PickupRuntime } from './pickup-runtime';

/**
 * The pickup-objective subsystem's real net — the Playwright specs shoot the portfolio pages, never the game
 * interior, so the collect / objective / door logic is characterized ONLY here. Each test wires a real {@link
 * PickupRuntime} over a shared camera, a real {@link DoomHud}, a REAL {@link CombatRuntime} as the grant target
 * (so the vital/ammo caps are the real ones), and a MUTABLE fixture zone whose pickup / door / slide arrays the
 * runtime edits IN PLACE — then drives the exact methods the frame loop calls and asserts the mutation.
 */

const STAPLES = AMMO_BOX_SPECS[0]; // box_staples: bullets, +20
const SHOTGUN = ARSENAL.findIndex((weapon) => weapon.id === 'shotgun');

/** A placed vitals pickup carrying its spawn idx (the WarmZone shape). */
function vital(x: number, y: number, kind: 'health' | 'armor', size: 'large' | 'small' = 'large') {
  return { x, y, z: 0, age: 0, spec: vitalSpec(kind, size), idx: 0 } satisfies Vital & {
    idx: number;
  };
}

/** A placed ammo box carrying its spawn idx. */
function ammoBox(x: number, y: number) {
  return { x, y, z: 0, age: 0, spec: STAPLES, idx: 0 } satisfies AmmoBox & { idx: number };
}

/** A placed access badge carrying its spawn idx. */
function keycard(x: number, y: number, color: 'blue' | 'yellow' | 'red') {
  return { x, y, z: 0, age: 0, spec: keycardSpec(color), idx: 0 } satisfies Keycard & {
    idx: number;
  };
}

/** A placed weapon pickup carrying its spawn idx. */
function weaponPickup(x: number, y: number, id: 'shotgun') {
  return {
    x,
    y,
    z: 0,
    age: 0,
    spec: weaponPickupSpec(id),
    idx: 0,
  } satisfies WeaponPickup & { idx: number };
}

/** A blue-badge-locked door whose trigger sits at (`x`,`y`). */
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

/** A legacy exit marker at (`x`,`y`). */
function exitMarker(x: number, y: number): Marker {
  return { x, y, z: 0, spec: EXIT_SPEC };
}

/** A mutable fixture zone — the pickup runtime's {@link PickupZone} seam over a live world, with spy-able
 *  transition + door-stamp drivers. Loosely mutable so a test can seat exits / slides / the transition. */
interface TestZone {
  world: WarmZone;
  exits: ZoneExit[];
  slidingDoors: SlidingDoor[];
  transition: object | null;
  exitsLocked: boolean;
  beginTransition: ReturnType<typeof vi.fn<(to: string, entry: string) => void>>;
  applyDoors: ReturnType<typeof vi.fn<(doors: readonly Door[], sectors: MutableSector[]) => void>>;
}

/** Build the fixture world carrying only the fields the pickup runtime reads (cast to the full WarmZone). */
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

/** Wire a runtime over a fresh camera / HUD / real combat grant / mutable fixture zone. */
function setup(worldOverrides: Partial<WarmZone> = {}): Harness {
  const camera = { x: 0, y: 0, angle: 0, z: 1.4, pitch: 0 };
  const hud = new DoomHud();
  const world = makeWorld(worldOverrides);
  const combat = new CombatRuntime({
    camera,
    config: { width: 1280, height: 720, fov: Math.PI / 2 },
    hud,
    world: () => world,
    projectiles: () => [],
    impacts: () => [],
    arcs: () => [],
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

    combat.hurtPlayer(50); // health 50 → a small (25) top-up is visible

    pr.stepPickups(0.1);

    expect(combat.hp).toBe(75);
    expect(world.vitals).toHaveLength(0); // collected — filtered out in place
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION); // the green flash is armed
  });

  it('caps the heal at the player ceiling', () => {
    const { pr, combat, world } = setup({ vitals: [vital(0, 0, 'health', 'large')] });

    combat.hurtPlayer(10); // health 90; a large (50) heal must cap at 100
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

    expect(combat.hp).toBe(50); // untouched
    expect(world.vitals).toHaveLength(1);
    expect(world.vitals[0].age).toBeCloseTo(0.1, 5); // its turntable advanced
  });
});

describe('PickupRuntime — ammo boxes', () => {
  it('refills the right reserve (from empty) and consumes the box', () => {
    const { pr, combat, world } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    expect(combat.reserveOf('bullets')).toBe(0);

    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(STAPLES.amount); // +20, from 0
    expect(world.ammoBoxes).toHaveLength(0);
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);
  });

  it('keeps the box when the reserve is already full', () => {
    const { pr, combat, world } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    combat.addAmmo('bullets', STAPLES.max, STAPLES.max); // fill bullets to its cap

    pr.stepPickups(0.1);

    expect(combat.reserveOf('bullets')).toBe(STAPLES.max); // no over-fill
    expect(world.ammoBoxes).toHaveLength(1); // kept
  });

  it('caps the refill at the reserve max', () => {
    const { pr, combat } = setup({ ammoBoxes: [ammoBox(0, 0)] });

    combat.addAmmo('bullets', STAPLES.max - 5, STAPLES.max); // 5 short of the cap

    pr.stepPickups(0.1); // +20 must clamp at the cap

    expect(combat.reserveOf('bullets')).toBe(STAPLES.max);
  });
});

describe('PickupRuntime — weapon pickups', () => {
  it('grants the weapon, auto-equips it on first pickup, and doses its ammo type', () => {
    const { pr, combat, world } = setup({ weaponPickups: [weaponPickup(0, 0, 'shotgun')] });

    expect(combat.owns('shotgun')).toBe(false);
    expect(combat.weaponIndex).toBe(0); // fists at start

    pr.stepPickups(0.1);

    expect(combat.owns('shotgun')).toBe(true);
    expect(combat.weaponIndex).toBe(SHOTGUN); // auto-equipped
    expect(combat.reserveOf('shells')).toBeGreaterThan(0); // starter dose granted
    expect(world.weaponPickups).toHaveLength(0);
  });

  it('does NOT re-equip on a repeat pickup (only tops the reserve up)', () => {
    const { pr, combat } = setup({ weaponPickups: [weaponPickup(0, 0, 'shotgun')] });

    combat.grantWeapon('shotgun'); // ALREADY owned — a repeat pickup, player currently on fists
    expect(combat.weaponIndex).toBe(0);
    const shellsBefore = combat.reserveOf('shells');

    pr.stepPickups(0.1);

    expect(combat.weaponIndex).toBe(0); // stayed on fists — no re-equip
    expect(combat.reserveOf('shells')).toBeGreaterThan(shellsBefore); // but the ammo dose still landed
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

  it('begins the zone transition and drops the trigger on walking into a graph exit', () => {
    const { pr, combat, zone } = setup();
    const endFire = vi.spyOn(combat, 'endFire');

    zone.exits = [{ x: 0, y: 0, z: 0, to: 'm2', entry: 'lobby' }];
    pr.stepObjective(0.1);

    expect(zone.beginTransition).toHaveBeenCalledWith('m2', 'lobby');
    expect(endFire).toHaveBeenCalledTimes(1);
  });

  it('holds the arrival guard until the player leaves the exit radius', () => {
    const { pr, camera, zone } = setup();

    zone.exits = [{ x: 0, y: 0, z: 0, to: 'm2', entry: 'lobby' }];
    zone.exitsLocked = true; // arrived here — locked

    pr.stepObjective(0.1); // still inside → stays locked, no transition
    expect(zone.exitsLocked).toBe(true);
    expect(zone.beginTransition).not.toHaveBeenCalled();

    camera.x = 100; // walk out of the exit radius
    pr.stepObjective(0.1);
    expect(zone.exitsLocked).toBe(false); // re-armed
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

    // No badge yet → the near, locked door stays shut and flashes the hint.
    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBe(0);
    expect(pr.hint).toBeGreaterThan(0);
    expect(zone.applyDoors).toHaveBeenCalledWith(world.doors, world.sectors);

    // Collect the blue badge, then the same near door opens.
    pr.stepObjective(0.1);
    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBeGreaterThan(0);
  });

  it('opens an unlocked (no-badge) door on proximity', () => {
    const { pr, world } = setup({ doors: [door(0, 0, null)] });

    pr.stepDoors(0.1);

    expect(world.doors[0].openness).toBeGreaterThan(0);
    expect(pr.hint).toBe(0); // no "badge requis" flash for an unlocked door
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

    pr.stepSliding(0.1); // near → eases open
    const opened = world.slides[0];

    expect(opened).toBeGreaterThan(0);

    camera.x = 100; // walk away
    pr.stepSliding(0.1); // far → eases shut
    expect(world.slides[0]).toBeLessThan(opened);
  });
});

describe('PickupRuntime — feedback timers + reset', () => {
  it('fades the green pickup flash each frame, clamped at 0', () => {
    const { pr } = setup({ vitals: [vital(0, 0, 'health', 'small')] });

    pr.stepPickups(0.1); // arms the flash
    expect(pr.pickupFx).toBe(PICKUP_FX_DURATION);

    pr.decayFx(0.1);
    expect(pr.pickupFx).toBeCloseTo(PICKUP_FX_DURATION - 0.1, 5);

    pr.decayFx(10);
    expect(pr.pickupFx).toBe(0);
  });

  it('clears the badge set, the HUD card bay, and both timers on reset', () => {
    const { pr, hud, world } = setup({
      keycards: [keycard(0, 0, 'blue')],
      doors: [door(0, 0, 'blue')],
    });
    const clearCards = vi.spyOn(hud, 'clearCards');

    pr.stepObjective(0.1); // collect the blue badge (flash armed, badge held)
    expect(pr.pickupFx).toBeGreaterThan(0);

    pr.reset();

    expect(clearCards).toHaveBeenCalledTimes(1);
    expect(pr.pickupFx).toBe(0);
    expect(pr.hint).toBe(0);

    // The badge is gone: the blue-locked door no longer opens.
    pr.stepDoors(0.1);
    expect(world.doors[0].openness).toBe(0);
  });
});
