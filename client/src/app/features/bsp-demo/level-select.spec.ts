import { describe, it, expect } from 'vitest';
import { ACCUEIL } from './level-accueil';
import { DEMO_LEVEL } from './level-demo';
import { HANGAR } from './level-hangar';
import { M1_LOBBY } from './level-m1-lobby';
import {
  DEFAULT_LEVEL_KEY,
  LEVELS,
  parseLevelParams,
  resolveZone,
  type LevelParams,
} from './level-select';

/** A param-less URL (the plain `/bsp` default) — the baseline for the resolveZone placement tests. */
const NO_PARAMS: LevelParams = {
  levelKey: DEFAULT_LEVEL_KEY,
  spawn: null,
  noEnemies: false,
  perfRing: false,
  noGovernor: false,
  renderer: 'gpu',
};

describe('level registry', () => {
  it('maps every URL key to its level module (m1 is the default key)', () => {
    expect(LEVELS).toEqual({ m1: M1_LOBBY, accueil: ACCUEIL, hangar: HANGAR, demo: DEMO_LEVEL });
    expect(DEFAULT_LEVEL_KEY).toBe('m1');
    expect(LEVELS[DEFAULT_LEVEL_KEY]).toBe(M1_LOBBY);
  });

  it('registers only complete levels (map + spawn + a way on: an exit, graph exits, or a passable seam)', () => {
    for (const level of Object.values(LEVELS)) {
      expect(level.map.sectors.length).toBeGreaterThan(0);
      expect(Number.isFinite(level.spawn.x)).toBe(true);
      expect(Number.isFinite(level.spawn.y)).toBe(true);
      const crossable = level.map.linedefs.some((l) => l.zonePortal?.passable === true);

      expect(level.exit !== undefined || (level.exits?.length ?? 0) > 0 || crossable).toBe(true);
      if (level.exit !== undefined) {
        expect(level.exit).toHaveLength(2);
      }
    }
  });

  it('keeps the zone graph well-formed: every exit targets a registry level at one of its named entries', () => {
    for (const level of Object.values(LEVELS)) {
      for (const exit of level.exits ?? []) {
        const target = LEVELS[exit.to];

        expect(target).toBeDefined();
        expect(target.entries?.[exit.entry]).toBeDefined();
        expect(Number.isFinite(exit.x)).toBe(true);
        expect(Number.isFinite(exit.y)).toBe(true);
      }
      for (const entry of Object.values(level.entries ?? {})) {
        expect(Number.isFinite(entry.x)).toBe(true);
        expect(Number.isFinite(entry.y)).toBe(true);
        expect(Number.isFinite(entry.angle)).toBe(true);
      }
    }
  });

  it('owns the TEMP M1 ↔ hangar edge with the PASSABLE seam alone — no walk-into exits remain there', () => {
    expect(M1_LOBBY.exits).toBeUndefined(); // the seamless seam crossing replaced the fade exit
    expect(HANGAR.exits).toBeUndefined();
    expect(HANGAR.entries?.['from-m1']).toBeDefined(); // named arrivals stay (fade mechanism / dev loads)
    expect(M1_LOBBY.entries?.['from-above']).toBeDefined();
  });

  it('makes the TEMP edge a LIVE + PASSABLE window: each side carries the reciprocal zonePortal seam', () => {
    const m1Seam = M1_LOBBY.map.linedefs.find((l) => l.zonePortal !== undefined);
    const hangarSeam = HANGAR.map.linedefs.find((l) => l.zonePortal !== undefined);

    expect(m1Seam?.zonePortal).toEqual({ zone: 'hangar', dx: 10, dy: -30, passable: true });
    expect(m1Seam?.back).toBeNull(); // one-sided → solid for hitscan (movement crosses via `passable`)
    expect(hangarSeam?.zonePortal).toEqual({ zone: 'm1', dx: -10, dy: 30, passable: true });
    expect(hangarSeam?.back).toBeNull();
    if (m1Seam === undefined || hangarSeam === undefined) {
      return; // the expects above already failed
    }
    // The two seam lines are COINCIDENT under the translation (the same 4-wide opening in both maps) — the
    // property that makes the live view read continuous. Hangar point + (dx, dy) = M1 point; the endpoint
    // order reverses because reciprocal seams front opposite sides.
    const at = (level: typeof M1_LOBBY, line: typeof m1Seam): number[][] => [
      [level.map.vertices[line.v1].x, level.map.vertices[line.v1].y],
      [level.map.vertices[line.v2].x, level.map.vertices[line.v2].y],
    ];
    const { dx, dy } = m1Seam.zonePortal ?? { dx: 0, dy: 0 };

    expect(at(HANGAR, hangarSeam).map(([x, y]) => [x + dx, y + dy])).toEqual(
      at(M1_LOBBY, m1Seam).reverse(),
    );
  });
});

describe('parseLevelParams', () => {
  it('parses all params together', () => {
    expect(
      parseLevelParams(
        '?level=hangar&spawn=17,108,4.71&noenemies=1&perflog=1&nogov=1&renderer=gpu',
      ),
    ).toEqual({
      levelKey: 'hangar',
      spawn: { x: 17, y: 108, angle: 4.71 },
      noEnemies: true,
      perfRing: true,
      noGovernor: true,
      renderer: 'gpu',
    });
  });

  it('defaults everything on an empty search string (GPU is the default backend)', () => {
    expect(parseLevelParams('')).toEqual({
      levelKey: DEFAULT_LEVEL_KEY,
      spawn: null,
      noEnemies: false,
      perfRing: false,
      noGovernor: false,
      renderer: 'gpu',
    });
  });

  it('accepts partial params (each is independent)', () => {
    expect(parseLevelParams('?spawn=-2,3.5,0')).toEqual({
      levelKey: DEFAULT_LEVEL_KEY,
      spawn: { x: -2, y: 3.5, angle: 0 },
      noEnemies: false,
      perfRing: false,
      noGovernor: false,
      renderer: 'gpu',
    });
    expect(parseLevelParams('?level=demo')).toEqual({
      levelKey: 'demo',
      spawn: null,
      noEnemies: false,
      perfRing: false,
      noGovernor: false,
      renderer: 'gpu',
    });
  });

  it('drops a malformed spawn (bad numbers or wrong arity) back to null', () => {
    expect(parseLevelParams('?spawn=a,b,c').spawn).toBeNull();
    expect(parseLevelParams('?spawn=1,2').spawn).toBeNull();
    expect(parseLevelParams('?spawn=1,2,3,4').spawn).toBeNull();
    expect(parseLevelParams('?spawn=').spawn).toBeNull();
    expect(parseLevelParams('?spawn=1,NaN,3').spawn).toBeNull();
  });

  it('treats noenemies as true only for the literal value 1', () => {
    expect(parseLevelParams('?noenemies=1').noEnemies).toBe(true);
    expect(parseLevelParams('?noenemies=0').noEnemies).toBe(false);
    expect(parseLevelParams('?noenemies=yes').noEnemies).toBe(false);
    expect(parseLevelParams('?noenemies').noEnemies).toBe(false);
  });

  it('treats perflog as true only for the literal value 1', () => {
    expect(parseLevelParams('?perflog=1').perfRing).toBe(true);
    expect(parseLevelParams('?perflog=0').perfRing).toBe(false);
    expect(parseLevelParams('?perflog').perfRing).toBe(false);
  });

  it('treats nogov as true only for the literal value 1', () => {
    expect(parseLevelParams('?nogov=1').noGovernor).toBe(true);
    expect(parseLevelParams('?nogov=0').noGovernor).toBe(false);
    expect(parseLevelParams('?nogov').noGovernor).toBe(false);
  });

  it('forces the CPU renderer only for the literal value cpu (anything else = GPU-when-available)', () => {
    expect(parseLevelParams('?renderer=cpu').renderer).toBe('cpu');
    expect(parseLevelParams('?renderer=gpu').renderer).toBe('gpu');
    expect(parseLevelParams('?renderer=webgpu').renderer).toBe('gpu'); // junk → the default (GPU + auto fallback)
    expect(parseLevelParams('?renderer').renderer).toBe('gpu');
  });

  it('ignores unknown params', () => {
    expect(parseLevelParams('?foo=bar&level=accueil').levelKey).toBe('accueil');
  });
});

describe('resolveZone', () => {
  it('resolves a registry zone at its own spawn (same underlying data)', () => {
    const zone = resolveZone('m1', undefined, NO_PARAMS);

    expect(zone.key).toBe('m1');
    expect(zone.level.map).toBe(M1_LOBBY.map);
    expect(zone.level.enemies).toBe(M1_LOBBY.enemies);
    expect(zone.at).toEqual(M1_LOBBY.spawn);
  });

  it('falls back to the default zone on an unknown key', () => {
    const zone = resolveZone('nope', undefined, NO_PARAMS);

    expect(zone.key).toBe(DEFAULT_LEVEL_KEY);
    expect(zone.level.map).toBe(M1_LOBBY.map);
  });

  it('places the player at a named entry (a graph arrival)', () => {
    const zone = resolveZone('hangar', 'from-m1', NO_PARAMS);

    expect(zone.at).toEqual(HANGAR.entries?.['from-m1']);
  });

  it('falls back to the level spawn for an unknown entry name', () => {
    expect(resolveZone('hangar', 'no-such-door', NO_PARAMS).at).toEqual(HANGAR.spawn);
  });

  it("applies the dev spawn override only to the URL's own level, on entry-less loads", () => {
    const spawn = { x: 17, y: 108, angle: 4.71 };
    const params: LevelParams = { ...NO_PARAMS, levelKey: 'hangar', spawn };

    expect(resolveZone('hangar', undefined, params).at).toEqual(spawn); // the URL level itself
    expect(resolveZone('m1', undefined, params).at).toEqual(M1_LOBBY.spawn); // another zone — untouched
    expect(resolveZone('hangar', 'from-m1', params).at).toEqual(HANGAR.entries?.['from-m1']); // entry wins
  });

  it('empties the enemy roster of EVERY zone with noenemies', () => {
    const params: LevelParams = { ...NO_PARAMS, noEnemies: true };

    expect(resolveZone('hangar', undefined, params).level.enemies).toEqual([]);
    expect(resolveZone('m1', 'from-above', params).level.enemies).toEqual([]);
    expect(HANGAR.enemies.length).toBeGreaterThan(0); // registry entry untouched
  });

  it('never mutates the registry entries (shallow-adapted copies only)', () => {
    const before = { spawn: M1_LOBBY.spawn, enemies: M1_LOBBY.enemies };

    resolveZone('m1', undefined, {
      ...NO_PARAMS,
      levelKey: 'm1',
      spawn: { x: 1, y: 2, angle: 3 },
      noEnemies: true,
    });

    expect(M1_LOBBY.spawn).toBe(before.spawn);
    expect(M1_LOBBY.enemies).toBe(before.enemies);
  });
});
