import { describe, it, expect } from 'vitest';
import { buildAtlasJobs } from './load-textures';
import { ENEMY_SPECS } from '../../../core/lib';
import { PICKUP_TEXTURE_JOBS } from '../world/pickups';

describe('buildAtlasJobs', () => {
  it('emits every enemy atlas (walk/death/attack/pain + a thrower strip) then every pickup sheet, in order', () => {
    const expected = [
      ...ENEMY_SPECS.flatMap((spec) => [
        { name: spec.texName, url: spec.atlasUrl, rows: spec.walkRows },
        { name: spec.deathTexName, url: spec.deathUrl, rows: 1 },
        { name: spec.attackTexName, url: spec.attackUrl, rows: 1 },
        { name: spec.painTexName, url: spec.painUrl, rows: 1 },
        ...(spec.thrower ? [{ name: spec.thrower.texName, url: spec.thrower.url, rows: 1 }] : []),
      ]),
      ...PICKUP_TEXTURE_JOBS.map((job) => ({ name: job.name, url: job.url, rows: 1 })),
    ];

    expect(buildAtlasJobs()).toEqual(expected);
  });

  it('leads with the first enemy walk atlas at its own row count', () => {
    const first = ENEMY_SPECS[0];

    expect(buildAtlasJobs()[0]).toEqual({
      name: first.texName,
      url: first.atlasUrl,
      rows: first.walkRows,
    });
  });

  it('appends the pickup jobs last (single-row) so the index pairs with the decoded texture', () => {
    const jobs = buildAtlasJobs();
    const tail = jobs.slice(jobs.length - PICKUP_TEXTURE_JOBS.length);

    expect(tail).toEqual(
      PICKUP_TEXTURE_JOBS.map((job) => ({ name: job.name, url: job.url, rows: 1 })),
    );
  });

  it('includes the ranged thrower spin strip exactly for the specs that have one', () => {
    const jobs = buildAtlasJobs();
    const throwerJobs = ENEMY_SPECS.flatMap((spec) =>
      spec.thrower ? [{ name: spec.thrower.texName, url: spec.thrower.url, rows: 1 }] : [],
    );

    for (const throwerJob of throwerJobs) {
      expect(jobs).toContainEqual(throwerJob);
    }
  });
});
