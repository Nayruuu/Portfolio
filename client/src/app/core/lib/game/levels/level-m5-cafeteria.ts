import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M5 "Cafétéria / Cuisine" — the grimy breather after M4's peak. No badge objective: the way down is a
// ROUTING problem — the grand stair collapsed, the monte-charge lobby is visible behind its fence from
// the hall and reachable only the long way through the kitchens. y increases DOWN (arrival at the EAST).

const TILE = { floorZ: 0, floorTex: 'TILE', ceilTex: 'CONCRETE' };

function buildMap(): {
  map: MapSource;
  ltDoorSector: number;
  freezerDoorSector: number;
  s1DoorSector: number;
  s2DoorSector: number;
} {
  const b = new RoomBuilder();

  const QUAI = b.room(poly([100, 32, 112, 32, 114, 34, 114, 44, 112, 46, 100, 46]), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 150,
    wallTex: 'METAL',
  });

  // The stepped alcove dressing the M4 return pad as "the service stair back up" (the fade covers it).
  const STUB = b.stairs([114, 36], [114, 42], {
    depth: 1.5,
    count: 2,
    zBase: 0,
    dz: 0.4,
    ceilZ: 3.4,
    light: 160,
    wallTex: 'METAL',
    ceilTex: 'CONCRETE',
  });

  b.connect(QUAI, STUB[0], { tex: 'METAL' });
  const PAD = b.room(rect(117, 36, 120, 42), {
    floorZ: 0.8,
    ceilZ: 3.4,
    floorTex: 'STEP',
    ceilTex: 'CONCRETE',
    light: 170,
    wallTex: 'METAL',
  });

  b.connect(PAD, STUB[1], { tex: 'METAL' });

  const VEST = b.room(poly([86, 30, 100, 34, 100, 44, 90, 46, 86, 46]), {
    ...TILE,
    ceilZ: 3.2,
    light: 130,
    wallTex: 'DAMAGED',
  });

  b.connect(QUAI, VEST, { at: [100, 37, 100, 41], tex: 'METAL' });

  const HALL = b.room(
    poly([48, 10, 78, 10, 86, 18, 86, 46, 78, 52, 62, 52, 56, 46, 48, 46, 42, 40, 42, 18]),
    {
      ...TILE,
      ceilZ: 6.8,
      light: 160,
      wallTex: 'KITCHEN',
      walls: { 4: 'WOOD', 5: 'DAMAGED', 6: 'DAMAGED' },
    },
  );

  b.connect(VEST, HALL, { at: [86, 34, 86, 42], tex: 'DAMAGED' });
  const table = {
    floorZ: 0.5,
    ceilZ: 6.8,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CONCRETE',
    light: 160,
    wallTex: 'WOOD',
  };

  b.island(HALL, rect(52, 20, 58, 24), table);
  b.island(HALL, poly([64, 26, 70, 26, 72, 28, 70, 30, 64, 30, 62, 28]), table);
  b.island(HALL, rect(52, 32, 58, 36), table);
  b.hole(HALL, rect(50, 15, 52, 17), 'PILLAR');
  b.hole(HALL, rect(74, 15, 76, 17), 'PILLAR');

  // 0.1-deep exterior boxes — the deserted plaza sits IN the glass plane (8-wide = one clean copy)
  const ext = {
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
    walls: { 3: 'CITY_PLAZA' },
  };
  const EXT1 = b.room(rect(52, 9.9, 60, 10), ext);

  b.connect(HALL, EXT1, { kind: 'glassPane', at: [52, 10, 60, 10] });
  const EXT2 = b.room(rect(66, 9.9, 74, 10), ext);

  b.connect(HALL, EXT2, { kind: 'glassPane', at: [66, 10, 74, 10] });

  const CAGE = b.room(rect(87, 46, 91, 50), {
    floorZ: 0,
    ceilZ: 6.0,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 145,
    wallTex: 'DAMAGED',
  });

  b.connect(VEST, CAGE, { at: [87, 46, 90, 46], tex: 'DAMAGED' });
  const CSTAIR = b.stairs([91, 50], [87, 50], {
    depth: 1,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 6.0,
    light: 140,
    wallTex: 'DAMAGED',
    ceilTex: 'CONCRETE',
  });

  b.connect(CAGE, CSTAIR[0], { tex: 'DAMAGED' });

  const MEZZ = b.room(poly([64, 52, 78, 52, 84, 57, 90, 57, 90, 64, 66, 64, 62, 58]), {
    floorZ: 2.8,
    ceilZ: 6.0,
    floorTex: 'CARPET',
    ceilTex: 'CONCRETE',
    light: 135,
    wallTex: 'WOOD',
  });

  b.connect(CSTAIR[6], MEZZ, { at: [87, 57, 90, 57], tex: 'DAMAGED' });
  b.connect(MEZZ, HALL, { kind: 'fence', at: [64, 52, 70, 52], tex: 'METAL' });
  b.connect(MEZZ, HALL, { at: [72, 52, 78, 52], tex: 'WOOD' }); // one-way DROP: 2.8 > the 2.4 mantle ceiling
  b.island(MEZZ, rect(68, 56, 76, 60), {
    floorZ: 3.3,
    ceilZ: 6.0,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CONCRETE',
    light: 135,
    wallTex: 'WOOD',
  });

  // Secret 2 — the dumbwaiter nook. Unmarked WOOD panel; tells: the toppled-chair pile aimed at it and
  // the bright threshold light-leak strip.
  const S2DOOR = b.room(rect(74, 64, 78, 65.5), {
    floorZ: 2.8,
    ceilZ: 5.4,
    floorTex: 'CARPET',
    ceilTex: 'CONCRETE',
    light: 200,
    wallTex: 'WOOD',
  });

  b.connect(MEZZ, S2DOOR, { tex: 'WOOD' });
  b.island(MEZZ, rect(74.2, 63.4, 77.8, 63.9), {
    floorZ: 2.85,
    ceilZ: 6.0,
    floorTex: 'CARPET',
    ceilTex: 'CONCRETE',
    light: 235,
    wallTex: 'WOOD',
  });
  const S2 = b.room(rect(72, 65.5, 80, 69), {
    floorZ: 2.8,
    ceilZ: 5.4,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'DAMAGED',
  });

  b.connect(S2DOOR, S2, { tex: 'WOOD' });

  const SELF = b.room(rect(30, 18, 42, 40), {
    ...TILE,
    ceilZ: 3.4,
    light: 140,
    wallTex: 'KITCHEN',
  });

  b.connect(HALL, SELF, { at: [42, 20, 42, 24], tex: 'KITCHEN' });
  b.connect(HALL, SELF, { at: [42, 34, 42, 38], tex: 'KITCHEN' });
  const counter = {
    floorZ: 1.3,
    ceilZ: 3.4,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CONCRETE',
    light: 140,
    wallTex: 'RECEPTION',
  };

  b.island(SELF, rect(32.5, 21, 40, 23.5), counter);
  b.island(SELF, rect(32.5, 27, 40, 29.5), counter);

  const CUIS = b.room(poly([10, 18, 30, 18, 30, 40, 26, 42, 12, 42, 10, 38]), {
    ...TILE,
    ceilZ: 3.6,
    ceilTex: 'TECHNICAL',
    light: 125,
    wallTex: 'KITCHEN',
    walls: { 5: 'METAL' },
  });

  b.connect(SELF, CUIS, { at: [30, 20, 30, 24], tex: 'KITCHEN' });
  b.connect(SELF, CUIS, { at: [30, 34, 30, 38], tex: 'KITCHEN' });
  const range = {
    floorZ: 1.3,
    ceilZ: 3.6,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 125,
    wallTex: 'METAL',
  };

  b.island(CUIS, rect(16, 22, 26, 25), range);
  b.island(CUIS, rect(16, 30, 26, 33), range);

  const RES = b.room(poly([26, 2, 46, 2, 48, 6, 48, 10, 42, 18, 26, 18]), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 120,
    wallTex: 'DAMAGED',
  });

  b.connect(RES, HALL, { at: [46.5, 12, 44.1, 15.2], tex: 'DAMAGED' });
  b.connect(RES, CUIS, { at: [26.5, 18, 29.5, 18], tex: 'KITCHEN' });

  // The dish pit: a 1.2 walk-off drop from the kitchen rim; the stair out is on the far side.
  const PIT = b.room(poly([10, 42, 26, 42, 28, 46, 28, 54, 14, 58, 8, 54, 8, 46]), {
    floorZ: -1.2,
    ceilZ: 2.6,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 105,
    wallTex: 'DAMAGED',
  });

  b.connect(CUIS, PIT, { at: [14, 42, 24, 42], tex: 'DAMAGED' });
  const PSTAIR = b.stairs([28, 47], [28, 53], {
    depth: 1,
    count: 3,
    zBase: -1.2,
    dz: 0.4,
    ceilZ: 2.6,
    light: 110,
    wallTex: 'DAMAGED',
    ceilTex: 'CONCRETE',
  });

  b.connect(PIT, PSTAIR[0], { tex: 'DAMAGED' });

  // Thematic yellow door — held since M3, so it OPENS: maintenance clearance as world-building.
  const LTDOOR = b.room(rect(6, 48, 8, 52), {
    floorZ: -1.2,
    ceilZ: 2.2,
    floorTex: 'GRATING',
    ceilTex: 'CONCRETE',
    light: 120,
    wallTex: 'METAL',
  });

  b.connect(PIT, LTDOOR, { tex: 'DOOR_YELLOW' });
  const LTECH = b.room(poly([-3, 43, 6, 45, 6, 55, -3, 57]), {
    floorZ: -1.2,
    ceilZ: 2.2,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 105,
    wallTex: 'METAL',
    walls: { 3: 'DAMAGED' },
  });

  b.connect(LTDOOR, LTECH, { tex: 'DOOR_YELLOW' });
  b.island(LTECH, rect(-1, 47, 2, 50), {
    floorZ: 0.1,
    ceilZ: 2.2,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'NEON',
    light: 110,
    wallTex: 'METAL',
  });
  // the pallet the plasma cable is coiled on — 0.5 above the pit floor, a plain walk-up
  b.island(LTECH, rect(-1.5, 51.5, 1, 53.5), {
    floorZ: -0.7,
    ceilZ: 2.2,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 115,
    wallTex: 'WOOD',
  });

  const FDOOR = b.room(rect(34, 40, 40, 42), { ...TILE, ceilZ: 3.0, light: 110, wallTex: 'METAL' });

  b.connect(SELF, FDOOR, { tex: 'METAL' });
  const FROID = b.room(poly([31, 42, 44, 42, 44, 56, 42, 58, 32, 58, 31, 56]), {
    ...TILE,
    ceilZ: 3.0,
    ceilTex: 'TECHNICAL',
    light: 90,
    wallTex: 'METAL',
  });

  b.connect(FDOOR, FROID, { tex: 'METAL' });
  b.connect(PSTAIR[2], FROID, { tex: 'DAMAGED' });
  const shelf = {
    floorZ: 1.3,
    ceilZ: 3.0,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 90,
    wallTex: 'METAL',
  };

  b.island(FROID, rect(34, 46, 42, 48), shelf);
  b.island(FROID, rect(34, 52, 42, 54), shelf);

  // Secret 1 — the chef's cache. Unmarked METAL door in the freezer's east wall; tells: the interrupted
  // shelf line and the frost-bright light-leak threshold strip.
  const S1DOOR = b.room(rect(44, 48, 45.5, 52), {
    ...TILE,
    ceilZ: 2.6,
    light: 200,
    wallTex: 'METAL',
  });

  b.connect(FROID, S1DOOR, { tex: 'METAL' });
  b.island(FROID, rect(43.4, 48, 43.9, 52), {
    floorZ: 0.05,
    ceilZ: 3.0,
    floorTex: 'TILE',
    ceilTex: 'TECHNICAL',
    light: 235,
    wallTex: 'METAL',
  });
  const S1 = b.room(rect(45.5, 47, 48, 53), {
    floorZ: 0,
    ceilZ: 2.6,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 130,
    wallTex: 'METAL',
  });

  b.connect(S1DOOR, S1, { tex: 'METAL' });

  const CSUD = b.room(poly([32, 58, 42, 58, 46, 60, 46, 64, 32, 64]), {
    ...TILE,
    ceilZ: 3.0,
    light: 115,
    wallTex: 'DAMAGED',
  });

  b.connect(FROID, CSUD, { at: [34, 58, 40, 58], tex: 'DAMAGED' });
  const SSTAIR = b.stairs([52, 64], [52, 58], {
    depth: 1,
    count: 6,
    zBase: -2.4,
    dz: 0.4,
    ceilZ: 3.2,
    light: 125,
    wallTex: 'METAL',
    ceilTex: 'CONCRETE',
  });

  b.connect(CSUD, SSTAIR[5], { tex: 'METAL' });

  // The collapsed grand stair: the hall rim is a FENCE over the monte-charge lobby 2.4 below — the
  // goal is visible from the first minute, reachable only the long way through the kitchens.
  const PALIER = b.room(poly([48, 46, 56, 46, 62, 52, 62, 64, 52, 64, 52, 58, 48, 54]), {
    floorZ: -2.4,
    ceilZ: 4.4,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 150,
    wallTex: 'METAL',
    walls: { 1: 'DAMAGED', 2: 'ELEVATOR', 6: 'DAMAGED' },
  });

  b.connect(HALL, PALIER, { kind: 'fence', at: [48, 46, 56, 46], tex: 'METAL' });
  b.connect(PALIER, SSTAIR[0], { tex: 'METAL' });
  b.island(PALIER, rect(49.5, 47.5, 53, 50), {
    floorZ: -1.0,
    ceilZ: 4.4,
    floorTex: 'STEP',
    ceilTex: 'CONCRETE',
    light: 150,
    wallTex: 'DAMAGED',
  });
  b.hole(PALIER, rect(55, 49.5, 57, 51.5), 'DAMAGED');

  b.thing(106, 39, Math.PI, 'player_start');
  b.thing(32, 5, 0, 'barrel');
  b.thing(34, 4, 0, 'barrel');
  b.thing(33, 7, 0, 'barrel');
  b.thing(34, 60, 0, 'barrel');
  b.thing(35.5, 61.5, 0, 'barrel');
  b.thing(33, 62.5, 0, 'barrel');
  b.thing(84, 43, 0, 'barrel');
  b.thing(12, 20, 0, 'barrel');
  b.thing(50.5, 51, 0, 'barrel');
  b.thing(73.2, 66.5, 0, 'barrel');
  b.thing(78.8, 68, 0, 'barrel');

  // Directional props carry a MEANINGFUL facing; symmetric plants/coolers keep angle 0. The toppled
  // chairs of the abandoned last service scatter the hall at odd angles.
  b.thing(84, 33, Math.PI, 'prop_totem');
  b.thing(92, 36, 0.3, 'prop_board');
  b.thing(97.5, 42.5, 0, 'prop_cooler');
  b.thing(102, 44, 0, 'prop');
  b.thing(49, 44, 0, 'prop');
  b.thing(84, 20, 0, 'prop');
  b.thing(59, 25.5, 2.1, 'prop_chair');
  b.thing(63, 31.5, 5.0, 'prop_chair');
  b.thing(55, 37.5, 0.7, 'prop_chair');
  b.thing(68, 36, 3.6, 'prop_chair');
  b.thing(72, 33, 4.4, 'prop_chair');
  b.thing(44, 26, 5.0, 'prop_board');
  b.thing(36, 22.2, 1.57, 'prop_screen');
  b.thing(21, 23.5, 4.71, 'prop_screen');
  b.thing(73, 62.8, 2.4, 'prop_chair');
  b.thing(74.6, 62.3, 5.2, 'prop_chair');
  b.thing(71, 61, 3.4, 'prop_chair');
  b.thing(80, 61, 1.2, 'prop_chair');
  b.thing(60.5, 62, Math.PI, 'prop_totem');

  return {
    map: b.build(),
    ltDoorSector: LTDOOR,
    freezerDoorSector: FDOOR,
    s1DoorSector: S1DOOR,
    s2DoorSector: S2DOOR,
  };
}

const built = buildMap();

export const M5_CAFETERIA: Level = {
  map: built.map,
  spawn: { x: 106, y: 39, angle: Math.PI },
  enemies: [
    { spec: PINKY_SPEC, x: 61, y: 27 },
    { spec: PINKY_SPEC, x: 60, y: 34 },
    { spec: SHOTGUNGUY_SPEC, x: 44.5, y: 22 },
    { spec: SHOTGUNGUY_SPEC, x: 36, y: 25.2 },
    { spec: IMP_SPEC, x: 31.5, y: 36.5 },
    { spec: KNIGHT_SPEC, x: 21, y: 27.5 },
    { spec: PINKY_SPEC, x: 14, y: 21 },
    { spec: PINKY_SPEC, x: 27, y: 35 },
    { spec: LOSTSOUL_SPEC, x: 12, y: 51 },
    { spec: LOSTSOUL_SPEC, x: 23, y: 54 },
    { spec: LOSTSOUL_SPEC, x: 37, y: 50 },
    { spec: LOSTSOUL_SPEC, x: 34, y: 56.5 },
    { spec: KNIGHT_SPEC, x: 3.5, y: 52.5 },
    { spec: SHOTGUNGUY_SPEC, x: 4, y: 46.2 },
    { spec: KNIGHT_SPEC, x: 58, y: 55 },
  ],
  health: [
    [14, 40.5],
    [76, 67.3, 'small'],
  ],
  armor: [
    [17, 50],
    [46.7, 48.5, 'small'],
  ],
  ammo: [
    [95, 39], // staples
    [61, 22.5], // nails
    [24, 38.5], // canisters
    [1.5, 45.8], // cells — beside the plasma
    [37, 7], // batteries
    [46.7, 51.5], // server-cell
  ],
  weapons: [[-0.25, 52.5, 'plasma']],
  keycards: [], // no badge objective — the routing IS the objective (see the collapsed-stair fence)
  entries: {
    main: { x: 106, y: 39, angle: Math.PI },
    'from-m4': { x: 106, y: 39, angle: Math.PI },
  },
  exits: [{ x: 118.5, y: 39, to: 'm4', entry: 'from-m5' }],
  // onward is the TEMP win exit at the monte-charge doors (→ M6 when it ships)
  exit: [60, 58],
  doors: [
    { sector: built.ltDoorSector, triggerX: 7, triggerY: 50, requiresCard: 'yellow' },
    { sector: built.freezerDoorSector, triggerX: 37, triggerY: 41, requiresCard: null },
    { sector: built.s1DoorSector, triggerX: 44.75, triggerY: 50, requiresCard: null },
    { sector: built.s2DoorSector, triggerX: 76, triggerY: 64.75, requiresCard: null },
  ],
};
