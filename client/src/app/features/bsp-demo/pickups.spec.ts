import { describe, it, expect } from 'vitest';
import { AMMO_MAX } from '../../shared/game/weapons';
import {
  AMMO_BOX_SPECS,
  ARMOR_SPEC,
  EXIT_SPEC,
  HEALTH_SPEC,
  KEYCARD_SPEC,
  PICKUP_TEXTURE_JOBS,
} from './pickups';

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

  it('covers every vitals + ammo + objective sprite in the texture jobs (no duplicate names)', () => {
    const names = PICKUP_TEXTURE_JOBS.map((job) => job.name);

    expect(names).toContain(HEALTH_SPEC.texName);
    expect(names).toContain(ARMOR_SPEC.texName);
    expect(names).toContain(KEYCARD_SPEC.texName);
    expect(names).toContain(EXIT_SPEC.texName);
    for (const spec of AMMO_BOX_SPECS) {
      expect(names).toContain(spec.texName);
    }
    expect(new Set(names).size).toBe(names.length); // no collisions → no texture clobbers another
  });
});
