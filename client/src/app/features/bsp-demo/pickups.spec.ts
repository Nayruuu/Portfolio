import { describe, it, expect } from 'vitest';
import { AMMO_MAX } from '../../shared/game/weapons';
import {
  AMMO_BOX_SPECS,
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
  vitalSpec,
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

  it('covers every vitals + ammo + badge + exit sprite in the texture jobs (no duplicate names)', () => {
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
    expect(new Set(names).size).toBe(names.length); // no collisions → no texture clobbers another
  });
});
