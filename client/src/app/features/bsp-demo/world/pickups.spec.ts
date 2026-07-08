import { describe, it, expect } from 'vitest';
import { AMMO_MAX, WEAPON_IDS, requireWeapon } from '../../../shared/game/weapons';
import type { ZoneSnapshot, Level } from '../../../core/lib';
import { ACCUEIL } from '../../../core/lib';
import {
  AMMO_BOX_SPECS,
  buildPickups,
  EXIT_SPEC,
  HEALTH_LARGE_SPEC,
  HEALTH_SMALL_SPEC,
  KEYCARD_DIRECTOR,
  KEYCARD_EMPLOYEE,
  KEYCARD_MANAGER,
  keycardSpec,
  MENTAL_LARGE_SPEC,
  MENTAL_SMALL_SPEC,
  PICKUP_TEXTURE_JOBS,
  pickupFrame,
  takenFlags,
  vitalSpec,
  WEAPON_PICKUP_SPECS,
  weaponAmmoDose,
  weaponPickupSpec,
} from './pickups';

const VITAL_SPECS = [HEALTH_LARGE_SPEC, HEALTH_SMALL_SPEC, MENTAL_LARGE_SPEC, MENTAL_SMALL_SPEC];
const KEYCARD_SPECS = [KEYCARD_EMPLOYEE, KEYCARD_MANAGER, KEYCARD_DIRECTOR];

describe('pickups registry', () => {
  it('sources each ammo box cap from AMMO_MAX (single source of truth)', () => {
    for (const spec of AMMO_BOX_SPECS) {
      expect(spec.max).toBe(AMMO_MAX[spec.ammoType]);
      expect(spec.max).toBeGreaterThan(0);
    }
  });

  it('derives each ammo box texName from its unique id (so two boxes of one ammo type never collide)', () => {
    for (const spec of AMMO_BOX_SPECS) {
      expect(spec.texName).toBe(`AMMO_${spec.id.toUpperCase()}`);
      expect(spec.aspect).toBeGreaterThan(0);
      expect(spec.frames).toBeGreaterThan(0);
    }
  });

  it('exposes the four vitals turntables (health + mental, large + small) as spinning specs', () => {
    for (const spec of VITAL_SPECS) {
      expect(spec.frames).toBeGreaterThan(0); // a turntable, not a static frame
      expect(spec.frameMs).toBeGreaterThan(0);
      expect(spec.aspect).toBeGreaterThan(0);
      expect(spec.amount).toBeGreaterThan(0);
    }
    expect(HEALTH_LARGE_SPEC.kind).toBe('health');
    expect(MENTAL_LARGE_SPEC.kind).toBe('armor'); // mental is the second vital (armor under the hood)
    expect(HEALTH_LARGE_SPEC.amount).toBeGreaterThan(HEALTH_SMALL_SPEC.amount); // large grants more
  });

  it('resolves a vitals spec by kind + size (default large)', () => {
    expect(vitalSpec('health', 'small')).toBe(HEALTH_SMALL_SPEC);
    expect(vitalSpec('health', 'large')).toBe(HEALTH_LARGE_SPEC);
    expect(vitalSpec('armor', 'small')).toBe(MENTAL_SMALL_SPEC);
    expect(vitalSpec('health')).toBe(HEALTH_LARGE_SPEC); // size omitted → large
  });

  it('exposes the three access-badge turntables (employee/manager/director) as colour-matched spinning specs', () => {
    for (const spec of KEYCARD_SPECS) {
      expect(spec.frames).toBeGreaterThan(0); // a turntable, not a static frame
      expect(spec.frameMs).toBeGreaterThan(0);
      expect(spec.aspect).toBeGreaterThan(0);
      expect(spec.worldHeight).toBeGreaterThan(0);
    }
    expect(KEYCARD_EMPLOYEE.color).toBe('blue');
    expect(KEYCARD_MANAGER.color).toBe('yellow');
    expect(KEYCARD_DIRECTOR.color).toBe('red');
  });

  it('resolves a keycard spec by colour', () => {
    expect(keycardSpec('blue')).toBe(KEYCARD_EMPLOYEE);
    expect(keycardSpec('yellow')).toBe(KEYCARD_MANAGER);
    expect(keycardSpec('red')).toBe(KEYCARD_DIRECTOR);
  });

  it('declares one weapon pickup spec per registry weapon, in arsenal order, reusing the HUD icon as v1 art', () => {
    expect(WEAPON_PICKUP_SPECS.map((spec) => spec.id)).toEqual([...WEAPON_IDS]);
    for (const spec of WEAPON_PICKUP_SPECS) {
      const weapon = requireWeapon(spec.id);

      expect(spec.texName).toBe(`PICKUP_WEAPON_${spec.id.toUpperCase()}`);
      expect(spec.url).toBe(weapon.icon); // the v1 placeholder — swapped for a real turntable strip later
      expect(spec.frames).toBe(1); // a static single-frame billboard until the rotation art ships
      expect(spec.ammoType).toBe(weapon.ammoType); // the starter dose targets the weapon's own reserve
      expect(spec.aspect).toBeGreaterThan(0);
      expect(spec.worldHeight).toBeGreaterThan(0);
    }
  });

  it('resolves a weapon pickup spec by id', () => {
    expect(weaponPickupSpec('pistol')).toBe(
      WEAPON_PICKUP_SPECS.find((spec) => spec.id === 'pistol'),
    );
    expect(weaponPickupSpec('chainsaw').ammoType).toBeNull(); // the melee alt grants no ammo
  });

  it('grants exactly ONE standard ammo box of the weapon’s type as the pickup dose (0 for melee)', () => {
    expect(weaponAmmoDose('bullets')).toBe(20); // the staples box
    expect(weaponAmmoDose('shells')).toBe(5); // the Hilti canister box
    expect(weaponAmmoDose('cells')).toBe(40); // the standard energy cell (not the 80-round server cell)
    expect(weaponAmmoDose('rockets')).toBe(2); // the battery pack
    expect(weaponAmmoDose(null)).toBe(0); // fist / chainsaw
    expect(weaponAmmoDose('confetti')).toBe(0); // an unknown type grants nothing (defensive)
  });

  it('covers every vitals + ammo + weapon + badge + exit sprite in the texture jobs (no duplicate names)', () => {
    const names = PICKUP_TEXTURE_JOBS.map((job) => job.name);

    for (const spec of VITAL_SPECS) {
      expect(names).toContain(spec.texName);
    }
    for (const spec of KEYCARD_SPECS) {
      expect(names).toContain(spec.texName);
    }
    expect(names).toContain(EXIT_SPEC.texName);
    for (const spec of AMMO_BOX_SPECS) {
      expect(names).toContain(spec.texName);
    }
    for (const spec of WEAPON_PICKUP_SPECS) {
      expect(names).toContain(spec.texName);
    }
    expect(new Set(names).size).toBe(names.length); // no collisions → no texture clobbers another
  });
});

/** A deterministic floor resolver — a UNIQUE z per point, so a placed pickup's z proves it was seated from
 *  the point it was authored at (not a stale/duplicated coordinate). */
const stubFloorAt = (x: number, y: number): number => x * 1000 + y;

/** A controlled placement fixture: known coordinates per kind so idx alignment is asserted directly. Built
 *  off a real level (the heavy `map`/`doors`/`spawn` fields are carried untouched — `buildPickups` reads only
 *  the pickup arrays) with every pickup array overridden. `ammo` carries one coord per `AMMO_BOX_SPECS` entry
 *  (its idx scheme), in order. */
function fixtureLevel(): Level {
  return {
    ...ACCUEIL,
    health: [
      [10, 1, 'large'],
      [11, 2, 'small'],
    ],
    armor: [[12, 3]], // large by default
    ammo: AMMO_BOX_SPECS.map((_, i) => [20 + i, 30 + i] as const),
    keycards: [
      [40, 4, 'blue'],
      [41, 5, 'red'],
    ],
    weapons: [
      [50, 6, 'pistol'],
      [51, 7, 'shotgun'],
    ],
    exit: [60, 8],
  };
}

describe('buildPickups (pure placement)', () => {
  it('places vitals as health-then-armor in spawn order, idx-numbered, seated on floorAt', () => {
    const { vitals } = buildPickups(fixtureLevel(), null, stubFloorAt);

    expect(vitals.map((v) => v.idx)).toEqual([0, 1, 2]); // health[0], health[1], armor[0]
    expect(vitals.map((v) => v.spec)).toEqual([
      vitalSpec('health', 'large'),
      vitalSpec('health', 'small'),
      vitalSpec('armor', 'large'),
    ]);
    expect(vitals.map((v) => [v.x, v.y, v.z])).toEqual([
      [10, 1, stubFloorAt(10, 1)],
      [11, 2, stubFloorAt(11, 2)],
      [12, 3, stubFloorAt(12, 3)],
    ]);
    expect(vitals.every((v) => v.age === 0)).toBe(true);
  });

  it('places one ammo box per AMMO_BOX_SPECS entry, idx-aligned with level.ammo order', () => {
    const { ammoBoxes } = buildPickups(fixtureLevel(), null, stubFloorAt);

    expect(ammoBoxes.map((b) => b.idx)).toEqual(AMMO_BOX_SPECS.map((_, i) => i));
    expect(ammoBoxes.map((b) => b.spec)).toEqual([...AMMO_BOX_SPECS]);
    expect(ammoBoxes.map((b) => [b.x, b.y, b.z])).toEqual(
      AMMO_BOX_SPECS.map((_, i) => [20 + i, 30 + i, stubFloorAt(20 + i, 30 + i)]),
    );
  });

  it('places keycards + weapon pickups in authoring order, idx-numbered, seated on floorAt', () => {
    const { keycards, weaponPickups } = buildPickups(fixtureLevel(), null, stubFloorAt);

    expect(keycards.map((k) => k.idx)).toEqual([0, 1]);
    expect(keycards.map((k) => k.spec)).toEqual([keycardSpec('blue'), keycardSpec('red')]);
    expect(keycards.map((k) => [k.x, k.y, k.z])).toEqual([
      [40, 4, stubFloorAt(40, 4)],
      [41, 5, stubFloorAt(41, 5)],
    ]);

    expect(weaponPickups.map((p) => p.idx)).toEqual([0, 1]);
    expect(weaponPickups.map((p) => p.spec)).toEqual([
      weaponPickupSpec('pistol'),
      weaponPickupSpec('shotgun'),
    ]);
    expect(weaponPickups.map((p) => [p.x, p.y, p.z])).toEqual([
      [50, 6, stubFloorAt(50, 6)],
      [51, 7, stubFloorAt(51, 7)],
    ]);
  });

  it('places the exit marker on floorAt (null when the level omits one)', () => {
    const { exit } = buildPickups(fixtureLevel(), null, stubFloorAt);

    expect(exit).toEqual({ spec: EXIT_SPEC, x: 60, y: 8, z: stubFloorAt(60, 8) });

    const noExit = buildPickups({ ...fixtureLevel(), exit: undefined }, null, stubFloorAt);

    expect(noExit.exit).toBeNull();
  });

  it('treats a missing weapons array as no weapon pickups', () => {
    const { weaponPickups } = buildPickups(
      { ...fixtureLevel(), weapons: undefined },
      null,
      stubFloorAt,
    );

    expect(weaponPickups).toEqual([]);
  });

  it('skips exactly the snapshot-taken pickups, per idx, for every kind', () => {
    const snap: ZoneSnapshot = {
      enemies: [],
      barrels: [],
      vitalsTaken: [false, true, false], // vital idx 1 gone
      ammoTaken: AMMO_BOX_SPECS.map((_, i) => i === 0 || i === 3), // ammo idx 0 + 3 gone
      cardsTaken: [true, false], // keycard idx 0 gone
      weaponsTaken: [false, true], // weapon idx 1 gone
      doors: [],
    };
    const { vitals, ammoBoxes, keycards, weaponPickups } = buildPickups(
      fixtureLevel(),
      snap,
      stubFloorAt,
    );

    expect(vitals.map((v) => v.idx)).toEqual([0, 2]);
    expect(ammoBoxes.map((b) => b.idx)).toEqual([1, 2, 4, 5]);
    expect(keycards.map((k) => k.idx)).toEqual([1]);
    expect(weaponPickups.map((p) => p.idx)).toEqual([0]);
  });
});

describe('takenFlags (pure taken-query)', () => {
  it('flags an index taken iff no remaining pickup carries it (atlases ready)', () => {
    const remaining = [{ idx: 0 }, { idx: 2 }];

    expect(takenFlags(4, remaining, true)).toEqual([false, true, false, true]);
  });

  it('reports nothing taken before the atlases decode (no pickup has spawned yet)', () => {
    expect(takenFlags(3, [], false)).toEqual([false, false, false]);
  });
});

describe('buildPickups ↔ takenFlags idx round-trip (the state-persistence invariant)', () => {
  it('re-marks the SAME collected pickups taken and keeps the rest, 1:1 by idx, across a rebuild', () => {
    const level = fixtureLevel();
    const fresh = buildPickups(level, null, stubFloorAt);

    // 'collect' some of each kind: drop them from the live lists (what the shell's proximity loop does).
    const takenVital = new Set([1]);
    const takenAmmo = new Set([0, 3]);
    const takenCard = new Set([0]);
    const takenWeapon = new Set([1]);
    const remainVitals = fresh.vitals.filter((v) => !takenVital.has(v.idx));
    const remainAmmo = fresh.ammoBoxes.filter((b) => !takenAmmo.has(b.idx));
    const remainCards = fresh.keycards.filter((k) => !takenCard.has(k.idx));
    const remainWeapons = fresh.weaponPickups.filter((p) => !takenWeapon.has(p.idx));

    // Snapshot the taken-state (exactly as snapshotWorld does), then rebuild the zone from it.
    const snap: ZoneSnapshot = {
      enemies: [],
      barrels: [],
      vitalsTaken: takenFlags(level.health.length + level.armor.length, remainVitals, true),
      ammoTaken: takenFlags(level.ammo.length, remainAmmo, true),
      cardsTaken: takenFlags(level.keycards.length, remainCards, true),
      weaponsTaken: takenFlags(level.weapons?.length ?? 0, remainWeapons, true),
      doors: [],
    };
    const rebuilt = buildPickups(level, snap, stubFloorAt);

    // The rebuilt zone shows exactly the pickups NOT collected — same idx set as the live remainder.
    expect(rebuilt.vitals.map((v) => v.idx)).toEqual(remainVitals.map((v) => v.idx));
    expect(rebuilt.ammoBoxes.map((b) => b.idx)).toEqual(remainAmmo.map((b) => b.idx));
    expect(rebuilt.keycards.map((k) => k.idx)).toEqual(remainCards.map((k) => k.idx));
    expect(rebuilt.weaponPickups.map((p) => p.idx)).toEqual(remainWeapons.map((p) => p.idx));

    // And none of the collected idx reappear (the "respawn on return" bug), for every kind.
    expect(rebuilt.vitals.some((v) => takenVital.has(v.idx))).toBe(false);
    expect(rebuilt.ammoBoxes.some((b) => takenAmmo.has(b.idx))).toBe(false);
    expect(rebuilt.keycards.some((k) => takenCard.has(k.idx))).toBe(false);
    expect(rebuilt.weaponPickups.some((p) => takenWeapon.has(p.idx))).toBe(false);
  });
});

describe('pickupFrame (turntable cell math)', () => {
  it('advances one cell per frameMs and wraps at the frame count', () => {
    // 400 ms/frame, 6 frames: age 0 → cell 0, 0.4 s → 1, and 6 frames later it wraps back to 0.
    expect(pickupFrame(0, 400, 6)).toBe(0);
    expect(pickupFrame(0.4, 400, 6)).toBe(1);
    expect(pickupFrame(0.4 * 5, 400, 6)).toBe(5);
    expect(pickupFrame(0.4 * 6, 400, 6)).toBe(0); // wrapped a full turn
    expect(pickupFrame(0.4 * 7, 400, 6)).toBe(1);
  });

  it('holds cell 0 for a non-spinning billboard regardless of age', () => {
    expect(pickupFrame(999, 400, 6, false)).toBe(0);
  });

  it('spins by default (vitals/ammo/badges pass no flag)', () => {
    expect(pickupFrame(0.4, 400, 6, true)).toBe(1);
  });
});
