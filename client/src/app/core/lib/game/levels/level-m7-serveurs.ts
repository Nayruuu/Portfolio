import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M7 "Salle des serveurs" — the machine floor, last full level before the M8 core. No badge objective
// (colours spent by M4): the goal is LE PUITS — the glass cable shaft met at three depths (Nef glass z0,
// cable-gallery glass −1.4, walked at −2.8) — with the thermal split as legibility (bright cold aisles =
// path, dark NEON hot aisles = danger). The BFG is the climax: visible in its lit cell across the
// generator hall, its return leg ambushed by the UPS cast staged behind glass. y increases DOWN (arrival
// at the NE service landing from M6).

const HALL = { floorZ: 0, floorTex: 'GRATING', ceilTex: 'TECHNICAL' };
const HOT = { floorZ: 0, floorTex: 'GRATING', ceilTex: 'NEON' };
const BASIN = {
  floorZ: -1.4,
  ceilZ: 3.2,
  floorTex: 'SLAB',
  ceilTex: 'CONCRETE',
  light: 95,
  wallTex: 'METAL',
};

function buildMap(): {
  map: MapSource;
  redDoorSector: number;
  s1DoorSector: number;
  s2DoorSector: number;
} {
  const b = new RoomBuilder();

  const PALIER = b.room(poly([98, 16, 110, 16, 112, 18, 112, 26, 104, 28, 98, 24]), {
    floorZ: 2.8,
    ceilZ: 6.0,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 120,
    wallTex: 'METAL',
    walls: { 2: 'ELEVATOR' },
  });

  const NOC = b.room(poly([74, 10, 94, 10, 98, 16, 98, 24, 94, 26, 78, 26, 72, 20, 72, 14]), {
    floorZ: 2.8,
    ceilZ: 6.2,
    floorTex: 'CARPET',
    ceilTex: 'TECHNICAL',
    light: 125,
    wallTex: 'SCREEN',
  });

  b.connect(NOC, PALIER, { at: [98, 18, 98, 22], tex: 'METAL' });
  const desk = { floorZ: 4.1, ceilZ: 6.2, floorTex: 'COUNTER_TOP', ceilTex: 'TECHNICAL' };

  b.island(NOC, rect(78, 14, 86, 16), { ...desk, light: 125, wallTex: 'METAL' });
  b.island(NOC, rect(78, 20, 86, 22), { ...desk, light: 125, wallTex: 'METAL' });

  const SERV = b.stairs([65, 14], [65, 20], {
    depth: 1,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.4,
    light: 130,
    wallTex: 'METAL',
    ceilTex: 'TECHNICAL',
  });

  b.connect(SERV[6], NOC, { tex: 'METAL' });
  // NW corner stays square: an axis wall ending on a shallow outward diagonal leaves a knife-edge gap
  // at player radius (the flood leaked through (46,14) when this was chamfered).
  const VEST = b.room(poly([46, 10, 62, 10, 65, 14, 65, 20, 62, 26, 52, 26, 46, 26]), {
    ...HALL,
    ceilZ: 3.6,
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(VEST, SERV[0], { tex: 'METAL' });

  const NEF = b.room(
    poly([52, 26, 88, 26, 96, 34, 96, 58, 88, 64, 64, 64, 52, 58, 46, 50, 46, 34]),
    {
      ...HALL,
      ceilZ: 6.2,
      light: 110,
      wallTex: 'RACKS',
      walls: { 0: 'METAL', 1: 'PILLAR', 8: 'PILLAR' },
    },
  );

  b.connect(NEF, VEST, { at: [54, 26, 58, 26], tex: 'METAL' });
  // NOC overlook: rails + the shattered span = a one-way 2.8 drop into the hall
  b.connect(NEF, NOC, { kind: 'fence', at: [78, 26, 82, 26], tex: 'METAL' });
  b.connect(NEF, NOC, { at: [82, 26, 85, 26], tex: 'METAL' });
  b.connect(NEF, NOC, { kind: 'fence', at: [85, 26, 88, 26], tex: 'METAL' });

  b.hole(NEF, rect(56, 32, 59, 52), 'RACKS');
  b.hole(NEF, rect(66, 32, 69, 52), 'RACKS');
  b.hole(NEF, rect(76, 32, 79, 52), 'RACKS');
  b.hole(NEF, rect(84, 34, 86, 36), 'PILLAR');
  b.hole(NEF, rect(84, 54, 86, 56), 'PILLAR');

  const FROID = b.room(poly([38, 22, 46, 22, 46, 52, 40, 58, 34, 58, 32, 52, 32, 30]), {
    ...HALL,
    ceilZ: 3.4,
    light: 152,
    wallTex: 'METAL',
  });

  b.connect(FROID, VEST, { at: [46, 23, 46, 25.5], tex: 'METAL' });
  b.connect(NEF, FROID, { kind: 'glassPane', at: [46, 36, 46, 44] });
  b.connect(NEF, FROID, { at: [46, 46, 46, 49], tex: 'METAL' });

  const HAN = b.room(poly([96, 36, 104, 34, 104, 41, 96, 41]), {
    ...HOT,
    ceilZ: 3.2,
    light: 85,
    wallTex: 'RACKS',
  });
  const HAS = b.room(poly([96, 50, 104, 50, 104, 57, 96, 55]), {
    ...HOT,
    ceilZ: 3.2,
    light: 85,
    wallTex: 'RACKS',
  });

  b.connect(NEF, HAN, { at: [96, 36.5, 96, 40.5], tex: 'RACKS' });
  b.connect(NEF, HAS, { at: [96, 50.5, 96, 54.5], tex: 'RACKS' });

  // Secret 1 — the ghost bay: one DAMAGED rack front in a clean RACKS row + the threshold light leak.
  const S1DOOR = b.room(rect(97.5, 41, 100.5, 42.2), {
    ...HOT,
    ceilZ: 2.4,
    light: 210,
    wallTex: 'DAMAGED',
  });

  b.connect(HAN, S1DOOR, { tex: 'DAMAGED' });
  b.island(HAN, rect(97.5, 40.5, 100.5, 40.9), {
    floorZ: 0.05,
    ceilZ: 3.2,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 235,
    wallTex: 'DAMAGED',
  });
  const S1 = b.room(rect(96.5, 42.2, 101.5, 47), {
    ...HOT,
    ceilZ: 2.8,
    light: 130,
    wallTex: 'DAMAGED',
  });

  b.connect(S1DOOR, S1, { tex: 'DAMAGED' });

  const GEN = b.room(poly([104, 34, 120, 38, 124, 44, 124, 64, 114, 70, 104, 70]), {
    ...HALL,
    ceilZ: 5.4,
    light: 115,
    wallTex: 'METAL',
    walls: { 3: 'RACKS' },
  });

  b.connect(HAN, GEN, { at: [104, 35, 104, 40.5], tex: 'RACKS' });
  b.connect(HAS, GEN, { at: [104, 50.5, 104, 56.5], tex: 'RACKS' });
  b.hole(GEN, rect(108, 44, 112, 50), 'METAL');
  b.hole(GEN, rect(108, 56, 112, 62), 'METAL');
  b.hole(GEN, rect(116, 48, 120, 54), 'METAL');

  // UPS gallery (+0.8): the E7 ambush cast is staged behind this glass, read on the way in
  const UPS = b.room(poly([104, 28, 122, 32, 120, 38, 104, 34]), {
    floorZ: 0.8,
    ceilZ: 4.6,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 135,
    wallTex: 'METAL',
  });

  b.connect(GEN, UPS, { at: [104, 34, 110, 35.5], tex: 'METAL' });
  b.connect(GEN, UPS, { kind: 'glassPane', at: [111, 35.75, 119, 37.75] });
  b.hole(UPS, rect(108, 30.5, 112, 32.5), 'METAL');
  b.hole(UPS, rect(114, 32, 118, 34), 'METAL');

  const CELL = b.room(rect(124, 48, 130, 58), {
    ...HALL,
    ceilZ: 3.6,
    light: 210,
    wallTex: 'METAL',
  });

  b.connect(GEN, CELL, { kind: 'glassPane', at: [124, 49, 124, 54.5] });
  b.connect(GEN, CELL, { kind: 'slidingDoor', at: [124, 55, 124, 57.5] });
  b.island(CELL, rect(126, 51, 129, 55), {
    floorZ: 0.5,
    ceilZ: 3.6,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 210,
    wallTex: 'METAL',
  });

  // Cooling plant: a z0 grating causeway over −1.4 basins; the mangled-rail gaps are the only ways down
  // (enemies can't mantle back up — the basins gate THEM, not the player).
  const walk = { ...HALL, ceilZ: 3.2, light: 125, wallTex: 'METAL' };
  const STEM = b.room(rect(36, 58, 40, 66), walk);
  const CATW = b.room(rect(22, 66, 50, 70), walk);

  b.connect(FROID, STEM, { tex: 'METAL' });
  b.connect(STEM, CATW, { tex: 'METAL' });
  const BNW = b.room(poly([24, 58, 36, 58, 36, 66, 20, 66, 20, 60]), BASIN);
  // BNE is sealed decor: every connect is fence — seen through the rails, never entered
  const BNE = b.room(poly([40, 58, 44, 58, 50, 62, 50, 66, 40, 66]), BASIN);
  const BS = b.room(poly([22, 70, 50, 70, 50, 78, 42, 84, 26, 84, 20, 74]), {
    ...BASIN,
    wallTex: 'DAMAGED',
  });

  b.connect(STEM, BNW, { kind: 'fence', tex: 'METAL' });
  b.connect(STEM, BNE, { kind: 'fence', tex: 'METAL' });
  b.connect(CATW, BNW, { kind: 'fence', at: [22, 66, 26, 66], tex: 'METAL' });
  b.connect(CATW, BNW, { at: [26, 66, 29, 66], tex: 'METAL' });
  b.connect(CATW, BNW, { kind: 'fence', at: [29, 66, 36, 66], tex: 'METAL' });
  b.connect(CATW, BNE, { kind: 'fence', at: [40, 66, 50, 66], tex: 'METAL' });
  b.connect(CATW, BS, { kind: 'fence', at: [22, 70, 28, 70], tex: 'METAL' });
  b.connect(CATW, BS, { at: [28, 70, 31, 70], tex: 'METAL' });
  b.connect(CATW, BS, { kind: 'fence', at: [31, 70, 50, 70], tex: 'METAL' });
  b.hole(BS, rect(28, 74, 32, 78), 'METAL');
  b.hole(BNE, rect(43, 60, 46, 63), 'METAL');

  // Secret 2 — the maintenance bypass: DAMAGED panel in the basin's west wall + the NEON threshold leak
  // (committing to the lostsoul dip is the price of the read).
  const S2DOOR = b.room(rect(18.8, 61, 20, 64.5), {
    floorZ: -1.4,
    ceilZ: 0.8,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 200,
    wallTex: 'DAMAGED',
  });

  b.connect(BNW, S2DOOR, { tex: 'DAMAGED' });
  b.island(BNW, rect(20.1, 61, 20.6, 64.5), {
    floorZ: -1.35,
    ceilZ: 3.2,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 235,
    wallTex: 'DAMAGED',
  });
  const S2 = b.room(rect(13.5, 60, 18.8, 66), {
    floorZ: -1.4,
    ceilZ: 1.0,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 130,
    wallTex: 'DAMAGED',
  });

  b.connect(S2DOOR, S2, { tex: 'DAMAGED' });

  // The cable gallery under the hall: the trunk's run to the core, lit only by the shaft's spill.
  const GALE = b.room(rect(50, 74, 110, 80), {
    floorZ: -1.4,
    ceilZ: 2.2,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 90,
    wallTex: 'DAMAGED',
  });

  b.connect(BS, GALE, { at: [50, 74.5, 50, 77.5], tex: 'DAMAGED' });
  const SGEN = b.stairs([104, 74], [110, 74], {
    depth: 1,
    count: 4,
    zBase: -1.4,
    dz: 0.35,
    ceilZ: 3.2,
    light: 100,
    wallTex: 'DAMAGED',
    ceilTex: 'TECHNICAL',
  });

  b.connect(SGEN[3], GEN, { tex: 'METAL' });
  b.connect(GALE, SGEN[0], { tex: 'DAMAGED' });

  // LE PUITS: the full-height light column. Glass at z0 (Nef) and −1.4 (gallery); the shattered south
  // pane is a 1.4 drop onto its floor — stand in the light, mantle out.
  const SHAFT = b.room(rect(66, 64, 78, 74), {
    floorZ: -2.8,
    ceilZ: 6.2,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 235,
    wallTex: 'DAMAGED',
  });

  b.connect(NEF, SHAFT, { kind: 'glassPane', at: [67, 64, 77, 64] });
  b.connect(GALE, SHAFT, { kind: 'glassPane', at: [67, 74, 72, 74] });
  b.connect(GALE, SHAFT, { at: [72, 74, 77, 74], tex: 'DAMAGED' });

  const SSEU = b.stairs([68, 84], [74, 84], {
    depth: 1,
    count: 4,
    zBase: -2.8,
    dz: 0.35,
    ceilZ: 1.6,
    light: 100,
    wallTex: 'DAMAGED',
    ceilTex: 'NEON',
  });

  b.connect(GALE, SSEU[3], { tex: 'DAMAGED' });
  const SEUIL = b.room(poly([58, 84, 92, 84, 96, 88, 92, 94, 76, 98, 62, 98, 56, 92]), {
    floorZ: -2.8,
    ceilZ: 2.0,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 105,
    wallTex: 'METAL',
    walls: { 1: 'RACKS', 6: 'RACKS' },
  });

  b.connect(SEUIL, SSEU[0], { tex: 'DAMAGED' });

  // The M8 blast door — executive clearance held since M4 blinks it open: the threshold of the thing.
  const RDOOR = b.room(rect(66, 98, 72, 100.5), {
    floorZ: -2.8,
    ceilZ: 1.6,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 170,
    wallTex: 'METAL',
  });

  b.connect(SEUIL, RDOOR, { tex: 'DOOR_RED' });
  const SAS = b.room(rect(64, 100.5, 74, 104), {
    floorZ: -2.8,
    ceilZ: 1.2,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 160,
    wallTex: 'RACKS',
  });

  b.connect(RDOOR, SAS, { tex: 'DOOR_RED' });

  b.thing(105, 21, Math.PI, 'player_start');
  b.thing(54, 30, 0, 'barrel');
  b.thing(55.5, 31.2, 0, 'barrel');
  b.thing(90, 60, 0, 'barrel');
  b.thing(88.5, 61.5, 0, 'barrel');
  b.thing(94, 40, 0, 'barrel');
  b.thing(95.2, 41.4, 0, 'barrel');
  b.thing(94.5, 49.6, 0, 'barrel');
  b.thing(106, 42, 0, 'barrel');
  b.thing(107.2, 43.4, 0, 'barrel');
  b.thing(45, 67.5, 0, 'barrel');
  b.thing(46.6, 68.4, 0, 'barrel');
  b.thing(98, 77, 0, 'barrel');
  b.thing(56, 77, 0, 'barrel');
  b.thing(60, 88, 0, 'barrel');
  b.thing(61.6, 89.4, 0, 'barrel');

  // Directional props carry a MEANINGFUL facing. The NOC is frozen mid-outage — screens still up on the
  // desks, chairs shoved back; a lone chair down in the hall faces the shaft glass.
  b.thing(109.5, 17.5, Math.PI, 'prop_totem');
  b.thing(99, 17, 0, 'prop');
  b.thing(80, 15, Math.PI / 2, 'prop_screen');
  b.thing(84, 21, 4.71, 'prop_screen');
  b.thing(92, 13, 0.8, 'prop_board');
  b.thing(81, 17.5, 1.6, 'prop_chair');
  b.thing(83, 19, 4.7, 'prop_chair');
  b.thing(82, 37, 2.5, 'prop_chair');
  b.thing(50, 40, 1.2, 'prop_board');
  b.thing(44, 48, 0, 'prop_cooler');
  b.thing(34, 34, 0, 'prop_cooler');
  b.thing(33, 31, 0, 'prop');
  b.thing(99, 55, 3.9, 'prop_chair');
  b.thing(105, 64.5, 0, 'prop_cooler');
  b.thing(121, 42, 0.9, 'prop_board');
  b.thing(119, 60, 2.4, 'prop_chair');
  b.thing(22.8, 68, 0, 'prop_cooler');
  b.thing(88, 86.5, Math.PI, 'prop_totem');

  return { map: b.build(), redDoorSector: RDOOR, s1DoorSector: S1DOOR, s2DoorSector: S2DOOR };
}

const built = buildMap();

export const M7_SERVEURS: Level = {
  map: built.map,
  spawn: { x: 105, y: 21, angle: Math.PI },
  enemies: [
    { spec: PINKY_SPEC, x: 80, y: 23 },
    { spec: PINKY_SPEC, x: 88, y: 12 },
    { spec: SHOTGUNGUY_SPEC, x: 94, y: 20 },
    { spec: IMP_SPEC, x: 62.5, y: 55 },
    { spec: IMP_SPEC, x: 72.5, y: 55 },
    { spec: IMP_SPEC, x: 51, y: 54 },
    { spec: IMP_SPEC, x: 86, y: 44 },
    { spec: SHOTGUNGUY_SPEC, x: 58, y: 29 },
    { spec: SHOTGUNGUY_SPEC, x: 48, y: 47 },
    { spec: PINKY_SPEC, x: 62, y: 38 },
    { spec: PINKY_SPEC, x: 73, y: 46 },
    { spec: SHOTGUNGUY_SPEC, x: 44.5, y: 45 },
    { spec: IMP_SPEC, x: 36, y: 50 },
    { spec: KNIGHT_SPEC, x: 38, y: 68 },
    { spec: IMP_SPEC, x: 26, y: 68 },
    { spec: LOSTSOUL_SPEC, x: 30, y: 80 },
    { spec: LOSTSOUL_SPEC, x: 40, y: 79 },
    { spec: LOSTSOUL_SPEC, x: 26, y: 62 },
    { spec: LOSTSOUL_SPEC, x: 99, y: 37.5 },
    { spec: LOSTSOUL_SPEC, x: 101, y: 39 },
    { spec: IMP_SPEC, x: 103, y: 37 },
    { spec: LOSTSOUL_SPEC, x: 99, y: 52 },
    { spec: LOSTSOUL_SPEC, x: 101, y: 53.5 },
    { spec: IMP_SPEC, x: 103, y: 55 },
    { spec: KNIGHT_SPEC, x: 107, y: 47 },
    { spec: KNIGHT_SPEC, x: 114, y: 66 },
    { spec: KNIGHT_SPEC, x: 120, y: 42 },
    { spec: SHOTGUNGUY_SPEC, x: 122, y: 57 },
    { spec: SHOTGUNGUY_SPEC, x: 105, y: 60 },
    { spec: PINKY_SPEC, x: 110, y: 53 },
    { spec: PINKY_SPEC, x: 114, y: 61 },
    { spec: KNIGHT_SPEC, x: 113, y: 34.8 },
    { spec: KNIGHT_SPEC, x: 116.5, y: 35.3 },
    { spec: LOSTSOUL_SPEC, x: 107, y: 30.5 },
    { spec: LOSTSOUL_SPEC, x: 119, y: 34 },
    { spec: SHOTGUNGUY_SPEC, x: 107, y: 33.4 },
    { spec: KNIGHT_SPEC, x: 66, y: 90 },
    { spec: KNIGHT_SPEC, x: 76, y: 91 },
    { spec: LOSTSOUL_SPEC, x: 61, y: 88 },
    { spec: LOSTSOUL_SPEC, x: 86, y: 88 },
    { spec: IMP_SPEC, x: 76, y: 77 },
    { spec: IMP_SPEC, x: 88, y: 77 },
  ],
  health: [
    [38, 50, 'small'],
    [16, 63],
  ],
  armor: [
    [99, 45],
    [100, 52.8, 'small'],
  ],
  ammo: [
    [90, 20], // staples
    [36, 40], // nails
    [94, 53], // canisters — staged at the east-wing mouth
    [120, 35.5], // cells
    [34, 76], // batteries — the basin risk/reward dip
    [72, 69], // server-cell — collected standing in the shaft's light, banked for M8
  ],
  weapons: [[127.5, 53, 'bfg']], // "Surcharge du datacenter" — earned across the generator-hall climax
  keycards: [], // no badge objective — the descent to the shaft's light IS the objective
  entries: {
    main: { x: 105, y: 21, angle: Math.PI },
    'from-m6': { x: 105, y: 21, angle: Math.PI },
  },
  exits: [{ x: 110.8, y: 21, to: 'm6', entry: 'from-m7' }],
  // onward is the TEMP win exit in the sas beyond the blast door (→ M8 when it ships)
  exit: [69, 102.5],
  doors: [
    { sector: built.redDoorSector, triggerX: 69, triggerY: 99.25, requiresCard: 'red' },
    { sector: built.s1DoorSector, triggerX: 99, triggerY: 41.6, requiresCard: null },
    { sector: built.s2DoorSector, triggerX: 19.4, triggerY: 62.75, requiresCard: null },
  ],
};
