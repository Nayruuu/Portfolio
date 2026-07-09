import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M1 "Lobby / Accueil" — the episode opener, keyless (like DOOM E1M1). Authored via RoomBuilder (room
// polygons + declared connections). y increases DOWN (the entrance is at the SOUTH).

const LUX = { floorZ: 0, floorTex: 'LOBBY_FLOOR', ceilTex: 'CEIL_LUX' };
const UPPER = { floorZ: 2.0, floorTex: 'LOBBY_FLOOR', ceilTex: 'CEIL' };

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new RoomBuilder();

  const CONC = b.room(
    poly([
      6, 104, 6, 110, 6, 122, 6, 124, 10, 128, 22, 128, 22, 122, 30, 122, 30, 128, 42, 128, 46, 124,
      46, 104, 42, 100, 10, 100,
    ]),
    { ...LUX, ceilZ: 4.4, light: 238, wallTex: 'LOBBY', walls: { 1: 'WOOD' } },
  );

  const cornice = { ...LUX, ceilZ: 5.6, light: 246, wallTex: 'WOOD' };
  const FIELD = b.island(CONC, rect(18, 108, 36, 120), cornice);

  b.hole(FIELD, rect(19, 109, 20.5, 110.5), 'PILLAR_LOBBY');
  b.hole(FIELD, rect(33.5, 109, 35, 110.5), 'PILLAR_LOBBY');
  b.hole(FIELD, rect(19, 117.5, 20.5, 119), 'PILLAR_LOBBY');
  b.hole(FIELD, rect(33.5, 117.5, 35, 119), 'PILLAR_LOBBY');

  const ELEV = b.room(poly([10, 96, 10, 100, 24, 100, 24, 96, 20, 96, 19, 96, 15, 96, 14, 96]), {
    ...LUX,
    ceilZ: 3.4,
    light: 210,
    wallTex: 'WOOD',
    walls: { 3: 'ELEVATOR', 5: 'ELEVATOR', 7: 'ELEVATOR' },
  });

  b.connect(CONC, ELEV, { tex: 'LOBBY' });

  const run = { depth: 6, count: 5, zBase: 0, dz: 0.4, ceilZ: 5.6, light: 216, wallTex: 'LOBBY' };
  const STEP = b.stairs([26, 100], [34, 100], run);

  b.connect(CONC, STEP[0], { tex: 'LOBBY' });

  // z1.3 = mantle height: above STEP_MAX 1.1 (no silent step-on), vaultable by the player, un-mantleable
  // by enemies (the turnstile rails still gate them).
  const counter = {
    floorZ: 1.3,
    ceilZ: 4.4,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CEIL_LUX',
    light: 238,
  };

  b.island(CONC, rect(8, 113, 16, 116), { ...counter, wallTex: 'RECEPTION' });
  b.island(CONC, rect(8, 103, 17, 105), { ...counter, wallTex: 'TURNSTILE' });
  b.island(CONC, rect(20, 103, 22, 105), { ...counter, wallTex: 'TURNSTILE' });
  b.island(CONC, rect(30, 103, 32, 105), { ...counter, wallTex: 'TURNSTILE' });
  b.island(CONC, rect(35, 103, 44, 105), { ...counter, wallTex: 'TURNSTILE' });

  const LOUNGE = b.room(
    poly([54, 108, 48, 108, 46, 110, 46, 122, 48, 124, 54, 124, 56, 122, 56, 110]),
    { ...LUX, ceilZ: 3.6, light: 228, wallTex: 'LOBBY', walls: { 6: 'WOOD' } },
  );

  b.connect(CONC, LOUNGE, { kind: 'glassPane', at: [46, 122, 46, 119] });
  b.connect(CONC, LOUNGE, { at: [46, 119, 46, 113], tex: 'LOBBY' });
  b.connect(CONC, LOUNGE, { kind: 'glassPane', at: [46, 113, 46, 110] });

  const wood = { ceilZ: 3.6, ceilTex: 'CEIL_LUX', light: 228, floorTex: 'STEP', wallTex: 'WOOD' };
  const carpet = { ...LUX, ceilZ: 3.6, light: 228, floorTex: 'CARPET', wallTex: 'METAL' };
  const RUG = b.island(LOUNGE, rect(48, 113, 54, 121), carpet);

  b.island(LOUNGE, rect(54.5, 112, 55.7, 120), { ...wood, floorZ: 0.9 });
  b.island(RUG, rect(50, 116, 52, 118), { ...wood, floorZ: 0.5 });

  const glazed = { ...LUX, light: 236 };
  const SAS = b.room(rect(22, 122, 30, 128), { ...glazed, ceilZ: 4.0, wallTex: 'GLASS_PANE' });

  b.connect(CONC, SAS, { kind: 'glassPane', at: [22, 128, 22, 122] });
  b.connect(CONC, SAS, { kind: 'slidingDoor', at: [22, 122, 30, 122] });
  b.connect(CONC, SAS, { kind: 'glassPane', at: [30, 122, 30, 128] });

  const PORCH = b.room(rect(22, 128, 30, 134), { ...glazed, ceilZ: 6.4, wallTex: 'GLASS_INT' });

  b.connect(SAS, PORCH, { kind: 'slidingDoor' });
  // 0.1-deep exterior box — the street backdrop sits IN the glass plane (8-wide = one clean copy)
  const EXT = b.room(rect(22, 134, 30, 134.1), {
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
    walls: { 1: 'CITY_STREET' },
  });

  b.connect(PORCH, EXT, { kind: 'glassPane' });

  const slab = { ...UPPER, ceilZ: 5.0, light: 230, wallTex: 'GLASS_INT' };
  const DOOR = b.room(rect(26, 68, 34, 70), slab);

  b.connect(DOOR, STEP[4]);
  const hall = { ...UPPER, ceilZ: 7, light: 244, wallTex: 'LOBBY' };
  const HALL = b.room(poly([10, 42, 10, 60, 18, 68, 34, 68, 42, 60, 42, 42, 34, 34, 18, 34]), {
    ...hall,
    walls: { 4: 'GLASS_INT', 5: 'BRICK', 6: 'BRICK', 7: 'BRICK' },
  });

  b.connect(DOOR, HALL, { tex: 'GLASS_INT' });

  // M1⇄M2 live passable seam: translation (dx,dy)=(0,−100) maps M2's seam line (24..28,130) onto ours
  // (24..28,30). TRANSLATION only (both stubs run N–S); widths/heights MUST match the M2 side exactly.
  const SEAM = b.stairs([28, 30], [24, 30], {
    depth: 0.8,
    count: 5,
    zBase: -0.4,
    dz: 0.4,
    ceilZ: 4.6,
    light: 224,
    wallTex: 'LOBBY',
  });

  b.connect(HALL, SEAM[4], { tex: 'LOBBY' });
  b.zonePortal(SEAM[0], [28, 30, 24, 30], { zone: 'm2', dx: 0, dy: -100, passable: true });

  const marble = { ...hall, floorTex: 'STEP' };

  b.island(HALL, rect(22, 47, 30, 55), { ...marble, floorZ: 2.6, wallTex: 'METAL' });
  b.hole(HALL, rect(15, 42, 18, 45), 'PILLAR_LOBBY');
  b.hole(HALL, rect(33, 57, 36, 60), 'PILLAR_LOBBY');
  b.island(HALL, rect(11, 49, 14, 54), { ...marble, floorZ: 3.0 });
  b.island(HALL, rect(38, 49, 41, 54), { ...marble, floorZ: 3.0 });
  b.island(HALL, rect(11, 56, 15, 59), { ...marble, floorZ: 2.4 });

  b.thing(26, 131, Math.PI * 1.5, 'player_start');
  b.thing(22, 118, 0, 'barrel');
  b.thing(32, 117, 0, 'barrel');
  b.thing(26, 44, 0, 'barrel');
  b.thing(14, 55, 0, 'barrel');
  b.thing(38, 48, 0, 'barrel');

  // Directional props (screen/totem/chair) carry a MEANINGFUL facing (4-rotation billboards turn with the
  // viewer); symmetric plants keep angle 0.
  b.thing(12, 114.5, 0, 'prop');
  b.thing(14, 114.5, 0.9, 'prop_screen');
  b.thing(11, 101.5, 1.57, 'prop_totem');
  b.thing(7, 114.5, 0, 'prop_chair');
  b.thing(49, 119.5, 5.4, 'prop_chair');
  b.thing(24, 49, 1.26, 'prop_screen');
  b.thing(54.5, 110.5, 0, 'prop');
  b.thing(50, 122.5, 0, 'prop');
  b.thing(12.5, 51, 0, 'prop');
  b.thing(39.5, 51, 0, 'prop');

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

export const M1_LOBBY: Level = {
  map: built.map,
  spawn: { x: 26, y: 131, angle: Math.PI * 1.5 },
  enemies: [
    { spec: PINKY_SPEC, x: 12, y: 111 },
    { spec: PINKY_SPEC, x: 33, y: 102 },
    { spec: SHOTGUNGUY_SPEC, x: 17, y: 98 },
    { spec: IMP_SPEC, x: 51, y: 114.5 },
    { spec: PINKY_SPEC, x: 16, y: 40 },
    { spec: IMP_SPEC, x: 26, y: 38 },
    { spec: SHOTGUNGUY_SPEC, x: 38, y: 40 },
  ],
  health: [
    [26, 118, 'small'],
    [12, 45],
  ],
  armor: [[53, 113, 'small']],
  ammo: [
    [18, 101], // staples
    [30, 86], // nails
    [26, 51], // canisters
    [14, 62], // cells
    [50, 120], // batteries
    [12, 98], // server-cell
  ],
  weapons: [
    [12, 119, 'pistol'],
    [53, 117, 'chainsaw'],
  ],
  keycards: [], // keyless floor (like E1M1)
  entries: {
    main: { x: 26, y: 131, angle: Math.PI * 1.5 },
    'from-above': { x: 26, y: 32, angle: Math.PI / 2 },
  },
  // no graph exits: the M1⇄M2 edge is the passable live seam in the hall stub (walking through = the crossing)
  doors: [{ sector: built.doorSector, triggerX: 30, triggerY: 69, requiresCard: null }],
};
