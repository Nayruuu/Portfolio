import { describe, it, expect } from 'vitest';
import {
  ACCUEIL,
  DEMO_LEVEL,
  HANGAR,
  M1_LOBBY,
  M2_OPENSPACE,
  M3_HR,
  M4_MEETINGS,
  M5_CAFETERIA,
  M6_DIRECTION,
  M7_SERVEURS,
  M8_DATACENTER,
  M9_ARCHIVES,
  SHOWROOM,
} from '../levels';
import { EXIT_RADIUS } from '../game-tuning';
import {
  DEFAULT_LEVEL_KEY,
  LEVEL_TITLES,
  LEVELS,
  parseLevelParams,
  resolveZone,
  type LevelParams,
} from './level-select';
import { WEAPON_IDS, type WeaponId } from '../../../../domain';

const MELEE_WEAPON_IDS: readonly WeaponId[] = ['fist', 'chainsaw'];

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
    expect(LEVELS).toEqual({
      m1: M1_LOBBY,
      m2: M2_OPENSPACE,
      m3: M3_HR,
      m4: M4_MEETINGS,
      m5: M5_CAFETERIA,
      m6: M6_DIRECTION,
      m7: M7_SERVEURS,
      m8: M8_DATACENTER,
      m9: M9_ARCHIVES,
      accueil: ACCUEIL,
      hangar: HANGAR,
      demo: DEMO_LEVEL,
      showroom: SHOWROOM,
    });
    expect(DEFAULT_LEVEL_KEY).toBe('m1');
    expect(LEVELS[DEFAULT_LEVEL_KEY]).toBe(M1_LOBBY);
  });

  it('titles every campaign floor for the loading card (the dev levels need none)', () => {
    for (const key of Object.keys(LEVELS)) {
      if (key.startsWith('m')) {
        expect(LEVEL_TITLES[key]).toBeTruthy();
      }
    }
    expect(Object.keys(LEVEL_TITLES)).toHaveLength(9);
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

  it('arms the fists-only start: every level with enemies places a RANGED weapon pickup (valid placements everywhere)', () => {
    // approved arsenal-pause floors: EVERY arrival carries the accumulated arsenal — graph airlocks
    // by ownership travel, death respawns by resetPlayer(keepArsenal) — so the floor seeds none
    // (m6 = the pause, m8 = complete since the M7 BFG)
    const ARSENAL_PAUSE_KEYS = ['m6', 'm8'];

    for (const [key, level] of Object.entries(LEVELS)) {
      for (const [x, y, id] of level.weapons ?? []) {
        expect(Number.isFinite(x), `level "${key}": weapon "${id}" x`).toBe(true);
        expect(Number.isFinite(y), `level "${key}": weapon "${id}" y`).toBe(true);
        expect(WEAPON_IDS, `level "${key}": unknown weapon id "${id}"`).toContain(id);
      }
      if (level.enemies.length === 0 || ARSENAL_PAUSE_KEYS.includes(key)) {
        continue;
      }
      const ranged = (level.weapons ?? []).some(([, , id]) => !MELEE_WEAPON_IDS.includes(id));

      expect(
        ranged,
        `level "${key}": no ranged weapon pickup for its ${level.enemies.length} foes`,
      ).toBe(true);
    }
  });

  it('stages the episode progression: pistol + chainsaw in M1, shotgun in M2, chaingun in M3, rocket in M4, plasma in M5, the BFG in M7 — M6 ships none (the arsenal pause), M8 none (arsenal complete), and the SECRET M9 pays the detour with an early plasma (the PX-1 prototype)', () => {
    expect(M1_LOBBY.weapons?.map(([, , id]) => id)).toEqual(['pistol', 'chainsaw']);
    expect(M2_OPENSPACE.weapons?.map(([, , id]) => id)).toEqual(['shotgun']);
    expect(M3_HR.weapons?.map(([, , id]) => id)).toEqual(['chaingun']);
    expect(M4_MEETINGS.weapons?.map(([, , id]) => id)).toEqual(['rocket']);
    expect(M5_CAFETERIA.weapons?.map(([, , id]) => id)).toEqual(['plasma']);
    expect(M6_DIRECTION.weapons).toBeUndefined();
    expect(M7_SERVEURS.weapons?.map(([, , id]) => id)).toEqual(['bfg']);
    expect(M8_DATACENTER.weapons).toEqual([]);
    // the secret floor hangs off M3, so its plasma can land two floors before M5's copy — that IS
    // the reward (a repeat pickup degrades to an ammo top-up for whoever already holds it)
    expect(M9_ARCHIVES.weapons?.map(([, , id]) => id)).toEqual(['plasma']);
  });

  it('gates M4 behind the DIRECTOR badge found on the floor itself (red), yellow demoted to thematic dressing', () => {
    expect(M4_MEETINGS.keycards.map(([, , color]) => color)).toEqual(['red']);
    expect(M4_MEETINGS.doors.filter((d) => d.requiresCard === 'red')).toHaveLength(1);
    // the Everest door opens on M3's yellow badge — a "manager doors no longer stop you" beat
    expect(M4_MEETINGS.doors.some((d) => d.requiresCard === 'yellow')).toBe(true);
  });

  it('owns the M1 ↔ M2 edge with the PASSABLE seam alone — M2’s only walk-into exit leads onward to M3', () => {
    expect(M1_LOBBY.exits).toBeUndefined();
    expect(M2_OPENSPACE.exits?.map((e) => e.to)).toEqual(['m3']);
    expect(M2_OPENSPACE.entries?.['from-m1']).toBeDefined();
    expect(M1_LOBBY.entries?.['from-above']).toBeDefined();
  });

  it('wires M2 ⇄ M3 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M2_OPENSPACE.exits).toEqual([{ x: 4, y: 119, to: 'm3', entry: 'from-m2' }]);
    expect(M3_HR.exits).toContainEqual({ x: 122.5, y: 17, to: 'm2', entry: 'from-m3' });
    // an arrival inside its own zone's exit pad would bounce straight back — keep a clear margin
    for (const level of [M2_OPENSPACE, M3_HR]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('wires M3 ⇄ M4 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M3_HR.exits).toContainEqual({ x: 55, y: 22, to: 'm4', entry: 'from-m3' });
    expect(M4_MEETINGS.exits).toContainEqual({ x: 94.5, y: 57, to: 'm3', entry: 'from-m4' });
    for (const level of [M3_HR, M4_MEETINGS]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('wires M4 ⇄ M5 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M4_MEETINGS.exits).toContainEqual({ x: 92, y: 17.5, to: 'm5', entry: 'from-m4' });
    expect(M5_CAFETERIA.exits).toHaveLength(2);
    expect(M5_CAFETERIA.exits).toContainEqual({ x: 118.5, y: 39, to: 'm4', entry: 'from-m5' });
    expect(M4_MEETINGS.exit).toBeUndefined(); // onward is the real m5 graph edge now
    for (const level of [M4_MEETINGS, M5_CAFETERIA]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('wires M5 ⇄ M6 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M5_CAFETERIA.exits).toContainEqual({ x: 60, y: 58, to: 'm6', entry: 'from-m5' });
    expect(M6_DIRECTION.exits).toContainEqual({ x: 122.3, y: 58, to: 'm5', entry: 'from-m6' });
    expect(M5_CAFETERIA.exit).toBeUndefined(); // onward is the real m6 graph edge now
    for (const level of [M5_CAFETERIA, M6_DIRECTION]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('wires M6 ⇄ M7 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M6_DIRECTION.exits).toHaveLength(2);
    expect(M6_DIRECTION.exits).toContainEqual({ x: 11, y: 42, to: 'm7', entry: 'from-m6' });
    expect(M7_SERVEURS.exits).toContainEqual({ x: 110.8, y: 21, to: 'm6', entry: 'from-m7' });
    expect(M6_DIRECTION.exit).toBeUndefined(); // onward is the real m7 graph edge now
    for (const level of [M6_DIRECTION, M7_SERVEURS]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('wires M7 ⇄ M8 as reciprocal walk-into graph edges whose arrivals land clear of the exit re-trigger', () => {
    expect(M7_SERVEURS.exits).toHaveLength(2);
    expect(M7_SERVEURS.exits).toContainEqual({ x: 69, y: 105.8, to: 'm8', entry: 'from-m7' });
    expect(M8_DATACENTER.exits).toEqual([{ x: 56, y: 5, to: 'm7', entry: 'from-m8' }]);
    expect(M7_SERVEURS.exit).toBeUndefined(); // onward is the real m8 graph edge now
    for (const level of [M7_SERVEURS, M8_DATACENTER]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('ends the episode in M8: the only campaign floor carrying the WIN exit, badge-free, arsenal complete', () => {
    for (const level of [
      M1_LOBBY,
      M2_OPENSPACE,
      M3_HR,
      M4_MEETINGS,
      M5_CAFETERIA,
      M6_DIRECTION,
      M7_SERVEURS,
      M9_ARCHIVES,
    ]) {
      expect(level.exit).toBeUndefined();
    }
    expect(M8_DATACENTER.exit).toEqual([77, 81]);
    expect(M8_DATACENTER.keycards).toEqual([]);
    // one unmarked secret door only — no badge gate of any colour
    expect(M8_DATACENTER.doors).toHaveLength(1);
    expect(M8_DATACENTER.doors.every((d) => d.requiresCard === null)).toBe(true);
  });

  it('keeps M5 badge-free: no keycard objective, its one yellow door is thematic dressing on held clearance', () => {
    expect(M5_CAFETERIA.keycards).toEqual([]);
    expect(M5_CAFETERIA.doors.filter((d) => d.requiresCard === 'yellow')).toHaveLength(1);
    expect(
      M5_CAFETERIA.doors.some((d) => d.requiresCard === 'red' || d.requiresCard === 'blue'),
    ).toBe(false);
  });

  it('keeps M6 badge-free: no keycard objective, its one red door is thematic dressing on held clearance', () => {
    expect(M6_DIRECTION.keycards).toEqual([]);
    expect(M6_DIRECTION.doors.filter((d) => d.requiresCard === 'red')).toHaveLength(1);
    expect(
      M6_DIRECTION.doors.some((d) => d.requiresCard === 'blue' || d.requiresCard === 'yellow'),
    ).toBe(false);
  });

  it('keeps M7 badge-free: no keycard objective, its one red door is the thematic M8 blast door', () => {
    expect(M7_SERVEURS.keycards).toEqual([]);
    expect(M7_SERVEURS.doors.filter((d) => d.requiresCard === 'red')).toHaveLength(1);
    expect(
      M7_SERVEURS.doors.some((d) => d.requiresCard === 'blue' || d.requiresCard === 'yellow'),
    ).toBe(false);
  });

  it('wires M3 ⇄ M9 as reciprocal graph edges: the freight lift behind the archives secret', () => {
    expect(M3_HR.exits).toHaveLength(3);
    expect(M3_HR.exits).toContainEqual({ x: 15.5, y: 77, to: 'm9', entry: 'from-m3' });
    expect(M9_ARCHIVES.exits).toEqual([{ x: 26, y: 5.2, to: 'm3', entry: 'from-m9' }]);
    expect(M3_HR.entries?.['from-m9']).toBeDefined();
    expect(M9_ARCHIVES.entries?.['from-m3']).toBeDefined();
    expect(M3_HR.exit).toBeUndefined(); // onward is the real m4 graph edge now
    for (const level of [M3_HR, M9_ARCHIVES]) {
      for (const exit of level.exits ?? []) {
        for (const entry of Object.values(level.entries ?? {})) {
          expect(Math.hypot(exit.x - entry.x, exit.y - entry.y)).toBeGreaterThan(EXIT_RADIUS * 2);
        }
      }
    }
  });

  it('keeps M9 badge-free: the secret floor gates by geometry and light, never by clearance', () => {
    expect(M9_ARCHIVES.keycards).toEqual([]);
    expect(M9_ARCHIVES.doors.every((d) => d.requiresCard === null)).toBe(true);
  });

  it('keeps the hangar self-contained since M2 took the seam slot (no seam, no graph edges, own exit)', () => {
    expect(HANGAR.map.linedefs.every((l) => l.zonePortal === undefined)).toBe(true);
    expect(HANGAR.exits).toBeUndefined();
    expect(HANGAR.entries).toBeUndefined();
    expect(HANGAR.exit).toBeDefined();
  });

  it('makes the M1 ↔ M2 edge a LIVE + PASSABLE window: each side carries the reciprocal zonePortal seam', () => {
    const m1Seam = M1_LOBBY.map.linedefs.find((l) => l.zonePortal !== undefined);
    const m2Seam = M2_OPENSPACE.map.linedefs.find((l) => l.zonePortal !== undefined);

    expect(m1Seam?.zonePortal).toEqual({ zone: 'm2', dx: 0, dy: -100, passable: true });
    expect(m1Seam?.back).toBeNull();
    expect(m2Seam?.zonePortal).toEqual({ zone: 'm1', dx: 0, dy: 100, passable: true });
    expect(m2Seam?.back).toBeNull();
    if (m1Seam === undefined || m2Seam === undefined) {
      return;
    }
    const at = (level: typeof M1_LOBBY, line: typeof m1Seam): number[][] => [
      [level.map.vertices[line.v1].x, level.map.vertices[line.v1].y],
      [level.map.vertices[line.v2].x, level.map.vertices[line.v2].y],
    ];
    const { dx, dy } = m1Seam.zonePortal ?? { dx: 0, dy: 0 };

    expect(at(M2_OPENSPACE, m2Seam).map(([x, y]) => [x + dx, y + dy])).toEqual(
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
    expect(parseLevelParams('?renderer=webgpu').renderer).toBe('gpu');
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
    const zone = resolveZone('m2', 'from-m1', NO_PARAMS);

    expect(zone.at).toEqual(M2_OPENSPACE.entries?.['from-m1']);
  });

  it('falls back to the level spawn for an unknown entry name', () => {
    expect(resolveZone('m2', 'no-such-door', NO_PARAMS).at).toEqual(M2_OPENSPACE.spawn);
  });

  it("applies the dev spawn override only to the URL's own level, on entry-less loads", () => {
    const spawn = { x: 17, y: 108, angle: 4.71 };
    const params: LevelParams = { ...NO_PARAMS, levelKey: 'm2', spawn };

    expect(resolveZone('m2', undefined, params).at).toEqual(spawn);
    expect(resolveZone('m1', undefined, params).at).toEqual(M1_LOBBY.spawn);
    expect(resolveZone('m2', 'from-m1', params).at).toEqual(M2_OPENSPACE.entries?.['from-m1']);
  });

  it('honors the dev spawn on a junk URL level key — both the key AND urlKey fall back to the default', () => {
    const spawn = { x: 5, y: 6, angle: 1 };
    const params: LevelParams = { ...NO_PARAMS, levelKey: 'bogus', spawn };
    const zone = resolveZone('bogus', undefined, params);

    expect(zone.key).toBe(DEFAULT_LEVEL_KEY);
    expect(zone.at).toEqual(spawn);
  });

  it('empties the enemy roster of EVERY zone with noenemies', () => {
    const params: LevelParams = { ...NO_PARAMS, noEnemies: true };

    expect(resolveZone('hangar', undefined, params).level.enemies).toEqual([]);
    expect(resolveZone('m1', 'from-above', params).level.enemies).toEqual([]);
    expect(HANGAR.enemies.length).toBeGreaterThan(0);
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
