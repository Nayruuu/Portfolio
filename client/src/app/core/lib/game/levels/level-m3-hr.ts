import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M3 "RH / Ressources Humaines" — introduces the YELLOW (manager) badge; hides the condemned-archives stub that will
// carry the secret M9 exit. Authored via RoomBuilder. y increases DOWN (arrival from M2 is at the EAST).

const GROUND = { floorZ: 0, floorTex: 'CARPET', ceilTex: 'TECHNICAL' };
const UPPER = { floorZ: 2.8, floorTex: 'CARPET', ceilTex: 'TECHNICAL' };

function buildMap(): {
  map: MapSource;
  gateSector: number;
  archDoorSector: number;
  pauseDoorSector: number;
} {
  const b = new RoomBuilder();

  const PALIER = b.room(poly([104, 10, 116, 10, 118, 12, 118, 22, 116, 24, 104, 24]), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'CUBICLE',
  });

  // The stepped alcove dressing the M2 return pad as "stairs back up" (the fade covers the flight).
  const STUB = b.stairs([118, 14], [118, 20], {
    depth: 1.5,
    count: 2,
    zBase: 0,
    dz: 0.4,
    ceilZ: 3.4,
    light: 160,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(PALIER, STUB[0], { tex: 'CUBICLE' });
  const PAD = b.room(rect(121, 14, 124, 20), {
    floorZ: 0.8,
    ceilZ: 3.4,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(PAD, STUB[1], { tex: 'CUBICLE' });

  const ACCUEIL = b.room(poly([72, 6, 104, 6, 104, 28, 96, 36, 76, 36, 72, 32]), {
    ...GROUND,
    ceilZ: 4.6,
    light: 200,
    wallTex: 'CUBICLE',
    walls: { 0: 'WOOD' },
  });

  b.connect(ACCUEIL, PALIER, { at: [104, 12, 104, 20], tex: 'CUBICLE' });

  const counter = { floorZ: 1.3, ceilZ: 4.6, floorTex: 'COUNTER_TOP', ceilTex: 'TECHNICAL' };

  b.island(ACCUEIL, rect(88, 10, 100, 13), { ...counter, light: 200, wallTex: 'RECEPTION' });
  const bench = { floorZ: 0.5, ceilZ: 4.6, floorTex: 'STEP', ceilTex: 'TECHNICAL', light: 200 };

  b.island(ACCUEIL, rect(78, 15, 86, 16.5), { ...bench, wallTex: 'WOOD' });
  b.island(ACCUEIL, rect(78, 24, 86, 25.5), { ...bench, wallTex: 'WOOD' });

  const GALERIE = b.room(poly([44, 8, 72, 8, 72, 16, 48, 16, 44, 12]), {
    ...GROUND,
    ceilZ: 3.4,
    light: 180,
    wallTex: 'CUBICLE',
  });

  b.connect(ACCUEIL, GALERIE, { at: [72, 9, 72, 15], tex: 'CUBICLE' });

  const booth = { ...GROUND, ceilZ: 3.2, light: 190, wallTex: 'CUBICLE' };
  const booths = [b.room(rect(46, 2, 52, 8), booth), b.room(rect(54, 2, 60, 8), booth)];

  booths.push(b.room(rect(62, 2, 68, 8), booth));
  for (const [i, x] of [46, 54, 62].entries()) {
    b.connect(GALERIE, booths[i], { kind: 'glassPane', at: [x, 8, x + 2.2, 8] });
    b.connect(GALERIE, booths[i], { at: [x + 2.2, 8, x + 3.8, 8], tex: 'CUBICLE' });
    b.connect(GALERIE, booths[i], { kind: 'glassPane', at: [x + 3.8, 8, x + 6, 8] });
  }

  const GATE = b.room(rect(68, 20, 72, 24), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 210,
    wallTex: 'CUBICLE',
  });

  b.connect(ACCUEIL, GATE, { tex: 'DOOR_YELLOW' });
  const UDESC = b.room(rect(66, 18, 68, 26), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 160,
    wallTex: 'CUBICLE',
  });

  b.connect(GATE, UDESC, { tex: 'DOOR_YELLOW' });
  const DSTEP = b.stairs([60, 18], [60, 26], {
    depth: 1.5,
    count: 4,
    zBase: -1.6,
    dz: 0.4,
    ceilZ: 3.4,
    light: 140,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(UDESC, DSTEP[3], { tex: 'CUBICLE' });
  const LANDING = b.room(poly([52, 16, 60, 16, 60, 26, 56, 26, 52, 22]), {
    floorZ: -1.6,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 200,
    wallTex: 'CUBICLE',
  });

  b.connect(LANDING, DSTEP[0], { tex: 'CUBICLE' });

  const CONN = b.room(poly([46, 16, 50, 16, 48, 26, 44, 26]), {
    ...GROUND,
    ceilZ: 3.0,
    light: 160,
    wallTex: 'CUBICLE',
  });

  b.connect(GALERIE, CONN, { tex: 'CUBICLE' });

  const HALL = b.room(poly([24, 34, 32, 26, 56, 26, 64, 34, 64, 56, 56, 66, 28, 66, 24, 62]), {
    ...GROUND,
    ceilZ: 5.6,
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(CONN, HALL, { tex: 'CUBICLE' });
  b.hole(HALL, rect(34, 38, 37, 46), 'METAL');
  b.hole(HALL, rect(50, 38, 53, 46), 'METAL');
  b.hole(HALL, rect(42, 50, 45, 58), 'METAL');
  b.hole(HALL, rect(50, 50, 53, 58), 'METAL');
  // z1.3 = mantle height: enemies can't follow up, hopping a cabinet is a deliberate move
  const cabinet = { floorZ: 1.3, ceilZ: 5.6, floorTex: 'STEP', ceilTex: 'TECHNICAL', light: 170 };

  b.island(HALL, rect(42, 38, 45, 46), { ...cabinet, wallTex: 'CUBICLE' });
  b.island(HALL, rect(34, 50, 37, 58), { ...cabinet, wallTex: 'CUBICLE' });

  const GSTEP = b.stairs([16, 62], [24, 62], {
    depth: 2,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.6,
    light: 180,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(HALL, GSTEP[0], { tex: 'CUBICLE' });
  const MEZZ = b.room(poly([16, 18, 44, 18, 44, 26, 32, 26, 24, 34, 24, 48, 16, 48]), {
    ...UPPER,
    ceilZ: 5.6,
    light: 185,
    wallTex: 'CUBICLE',
  });

  b.connect(MEZZ, GSTEP[6], { tex: 'CUBICLE' });
  b.connect(MEZZ, HALL, { kind: 'fence', at: [44, 26, 40, 26], tex: 'METAL' });
  b.connect(MEZZ, HALL, { at: [40, 26, 36, 26], tex: 'CUBICLE' }); // one-way DROP: 2.8 > the 2.4 mantle ceiling
  b.connect(MEZZ, HALL, { kind: 'fence', at: [36, 26, 32, 26], tex: 'METAL' });
  b.connect(MEZZ, HALL, { kind: 'fence', at: [32, 26, 24, 34], tex: 'METAL' });
  b.connect(MEZZ, HALL, { kind: 'fence', at: [24, 34, 24, 48], tex: 'METAL' });

  const office = { ...UPPER, ceilZ: 5.2, light: 195, wallTex: 'CUBICLE' };
  const BUR1 = b.room(poly([4, 18, 14, 18, 16, 20, 16, 28, 4, 28]), office);

  b.connect(MEZZ, BUR1, { kind: 'glassPane', at: [16, 20, 16, 23] });
  b.connect(MEZZ, BUR1, { at: [16, 23, 16, 25], tex: 'CUBICLE' });
  b.connect(MEZZ, BUR1, { kind: 'glassPane', at: [16, 25, 16, 28] });
  const BUR2 = b.room(rect(4, 29, 16, 38), office);

  b.connect(MEZZ, BUR2, { kind: 'glassPane', at: [16, 29, 16, 32.5] });
  b.connect(MEZZ, BUR2, { at: [16, 32.5, 16, 34.5], tex: 'CUBICLE' });
  b.connect(MEZZ, BUR2, { kind: 'glassPane', at: [16, 34.5, 16, 38] });
  const DRH = b.room(poly([4, 39, 16, 39, 16, 48, 8, 48, 4, 44]), {
    ...office,
    walls: { 0: 'WOOD' },
  });

  b.connect(MEZZ, DRH, { kind: 'glassPane', at: [16, 39, 16, 42.5] });
  // The only slider: proximity is CAMERA-driven, so the stationary badge guard behind it still works.
  b.connect(MEZZ, DRH, { kind: 'slidingDoor', at: [16, 42.5, 16, 44.5] });
  b.connect(MEZZ, DRH, { kind: 'glassPane', at: [16, 44.5, 16, 48] });
  b.island(DRH, rect(6, 42, 12, 45), {
    floorZ: 4.1, // 1.3 above the office floor — the badge desk is a mantle move
    ceilZ: 5.2,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 195,
    wallTex: 'WOOD',
  });

  const rim = { ...GROUND, ceilZ: 4.6, light: 150, wallTex: 'CUBICLE' };
  const RIMN = b.room(poly([34, 66, 66, 66, 66, 74, 60, 74, 56, 70, 42, 70, 38, 74, 34, 74]), rim);
  const RIMW = b.room(poly([34, 74, 38, 74, 38, 82, 34, 86]), rim);
  const RIME = b.room(poly([60, 74, 66, 74, 66, 88, 56, 92, 56, 86, 60, 82]), rim);

  b.connect(HALL, RIMN, { at: [40, 66, 46, 66], tex: 'CUBICLE' });
  b.connect(RIMN, RIMW, { tex: 'CUBICLE' });
  b.connect(RIMN, RIME, { tex: 'CUBICLE' });
  // Stair notches carved out of the pit polygon (x38..41 W, x57..60 E) host the two escape flights.
  const PIT = b.room(
    poly([
      42, 70, 56, 70, 60, 74, 57, 74, 57, 78, 60, 78, 60, 82, 56, 86, 42, 86, 38, 82, 38, 78, 41,
      78, 41, 74, 38, 74,
    ]),
    { floorZ: -1.6, ceilZ: 4.6, floorTex: 'TILE', ceilTex: 'NEON', light: 130, wallTex: 'SCREEN' },
  );

  b.connect(PIT, RIMN, { tex: 'SCREEN' });
  b.connect(PIT, RIMW, { tex: 'SCREEN' });
  b.connect(PIT, RIME, { tex: 'SCREEN' });
  const pitRun = { depth: 1, count: 3, zBase: -1.6, dz: 0.4, ceilZ: 4.6, light: 140 };
  const WSTEP = b.stairs([41, 78], [41, 74], { ...pitRun, wallTex: 'METAL', ceilTex: 'NEON' });

  b.connect(PIT, WSTEP[0], { tex: 'METAL' });
  b.connect(RIMW, WSTEP[2], { tex: 'METAL' });
  const ESTEP = b.stairs([57, 74], [57, 78], { ...pitRun, wallTex: 'METAL', ceilTex: 'NEON' });

  b.connect(PIT, ESTEP[0], { tex: 'METAL' });
  b.connect(RIME, ESTEP[2], { tex: 'METAL' });
  b.island(PIT, rect(46, 76, 52, 80), {
    floorZ: -0.6,
    ceilZ: 4.6,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 150,
    wallTex: 'METAL',
  });
  const BALC = b.room(poly([42, 86, 56, 86, 56, 92, 40, 92, 34, 86]), {
    floorZ: 1.6, // imp lane over the pit: mantle-able from the rim, a 3.2 drop pit-side
    ceilZ: 4.6,
    floorTex: 'CARPET',
    ceilTex: 'TECHNICAL',
    light: 160,
    wallTex: 'CUBICLE',
  });

  b.connect(BALC, PIT, { tex: 'SCREEN' });
  b.connect(BALC, RIME, { tex: 'CUBICLE' });

  const CLSUD = b.room(poly([84, 36, 90, 36, 86, 52, 80, 52]), {
    ...GROUND,
    ceilZ: 3.0,
    light: 160,
    wallTex: 'CUBICLE',
  });

  b.connect(ACCUEIL, CLSUD, { tex: 'CUBICLE' });
  const REPRO = b.room(poly([70, 52, 94, 52, 100, 58, 100, 80, 92, 88, 72, 88, 66, 80, 66, 58]), {
    floorZ: 0,
    ceilZ: 4.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'SCREEN',
    walls: { 6: 'METAL' },
  });

  b.connect(CLSUD, REPRO, { tex: 'SCREEN' });
  b.connect(RIMN, REPRO, { at: [66, 69, 66, 73], tex: 'METAL' });
  b.hole(REPRO, rect(74, 60, 78, 66), 'METAL');
  b.hole(REPRO, rect(74, 70, 78, 76), 'METAL');
  b.hole(REPRO, rect(84, 60, 88, 64), 'METAL');
  b.island(REPRO, rect(84, 72, 90, 78), {
    floorZ: 1.3, // the chaingun dais — grabbing it is a committed mantle under fire
    ceilZ: 4.0,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 160,
    wallTex: 'METAL',
  });

  // Secret 1 — condemned archives (the M9 stub). Unmarked CUBICLE door; the tell is the dark scuffed
  // SLAB threshold strip in front of it.
  const SDOOR = b.room(rect(29, 66, 32, 68), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 110,
    wallTex: 'CUBICLE',
  });

  b.connect(HALL, SDOOR, { tex: 'CUBICLE' });
  b.island(HALL, rect(29, 65.3, 32, 65.9), {
    floorZ: 0.05,
    ceilZ: 5.6,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 90,
    wallTex: 'CUBICLE',
  });
  const ASTEP = b.room(rect(29, 68, 32, 70), {
    floorZ: -0.4,
    ceilZ: 3.0,
    floorTex: 'STEP',
    ceilTex: 'CEIL_DAMAGED',
    light: 100,
    wallTex: 'DAMAGED',
  });

  b.connect(SDOOR, ASTEP, { tex: 'DAMAGED' });
  const ARCH = b.room(poly([14, 70, 32, 70, 32, 72, 26, 78, 26, 86, 14, 86, 14, 80, 14, 74]), {
    floorZ: -0.8,
    ceilZ: 3.2,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 90,
    wallTex: 'DAMAGED',
    walls: { 6: 'ELEVATOR' },
  });

  b.connect(ASTEP, ARCH, { tex: 'DAMAGED' });
  // TODO(M9): the dead freight lift (wall 6) is the future secret seam — when M9 ships, add
  // `exits: [{ x: 15.5, y: 77, to: 'm9', entry: 'from-m3' }]` plus M9's return entry.

  // Secret 2 — the walled-off break room. Unmarked SCREEN door; tells: the bright TILE light-leak strip
  // and the cooler shoved against the wall beside it.
  const PDOOR = b.room(rect(100, 64, 102, 68), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'TILE',
    ceilTex: 'TECHNICAL',
    light: 200,
    wallTex: 'SCREEN',
  });

  b.connect(REPRO, PDOOR, { tex: 'SCREEN' });
  b.island(REPRO, rect(99.3, 64, 99.9, 68), {
    floorZ: 0.05,
    ceilZ: 4.0,
    floorTex: 'TILE',
    ceilTex: 'TECHNICAL',
    light: 235,
    wallTex: 'METAL',
  });
  const PAUSE = b.room(rect(102, 60, 110, 72), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 220,
    wallTex: 'KITCHEN',
  });

  b.connect(PDOOR, PAUSE, { tex: 'KITCHEN' });
  // 0.1-deep exterior box — the deserted plaza seen one floor below M2's break-room nook (8-wide copy).
  const EXT = b.room(rect(110, 62, 110.1, 70), {
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
    walls: { 2: 'CITY_PLAZA' },
  });

  b.connect(PAUSE, EXT, { kind: 'glassPane', at: [110, 62, 110, 70] });

  b.thing(114, 17, Math.PI, 'player_start');
  b.thing(58.5, 17.5, 0, 'barrel');
  b.thing(26, 63.5, 0, 'barrel');
  b.thing(63.5, 68, 0, 'barrel');
  b.thing(64.5, 69.5, 0, 'barrel');
  b.thing(68, 60.5, 0, 'barrel');
  b.thing(69.4, 59.3, 0, 'barrel');
  b.thing(24, 82, 0, 'barrel');
  b.thing(22.8, 80.6, 0, 'barrel');

  // Directional props carry a MEANINGFUL facing; symmetric plants/coolers keep angle 0.
  b.thing(106, 12, 0, 'prop_totem');
  b.thing(117, 22.5, 0, 'prop');
  b.thing(94, 11.5, 1.57, 'prop_screen');
  b.thing(75, 10, 0.3, 'prop_totem');
  b.thing(80, 18, 1.2, 'prop_chair');
  b.thing(83, 14, 4.5, 'prop_chair');
  b.thing(102, 7.5, 0, 'prop');
  b.thing(73.5, 29.5, 0, 'prop_cooler');
  b.thing(48, 4.7, 0.8, 'prop_chair');
  b.thing(50, 6.2, 3.9, 'prop_chair');
  b.thing(57, 3.2, 1.57, 'prop_board');
  b.thing(64.5, 5.5, 5.2, 'prop_chair');
  b.thing(70.5, 14.5, 0, 'prop');
  b.thing(52, 9.5, 1.57, 'prop_board');
  b.thing(62, 34.5, 0, 'prop_cooler');
  b.thing(33, 28.5, 0, 'prop');
  b.thing(48, 63, 4.71, 'prop_board');
  b.thing(39, 47, 2.4, 'prop_chair');
  b.thing(34, 19.5, 1.57, 'prop_board');
  b.thing(20, 20.5, 2.2, 'prop_screen');
  b.thing(5, 19.5, 0, 'prop');
  b.thing(7, 24, 1.0, 'prop_chair');
  b.thing(8, 34, 2.5, 'prop_chair');
  b.thing(12, 30.5, 3.5, 'prop_screen');
  b.thing(8, 43.5, 0.3, 'prop_screen');
  b.thing(13.5, 42, 3.5, 'prop_chair');
  b.thing(14.5, 39.8, 0, 'prop');
  b.thing(48, 77.5, 4.71, 'prop_board');
  b.thing(80, 58, 2.6, 'prop_screen');
  b.thing(94, 58, 3.8, 'prop_chair');
  b.thing(98.8, 69.8, 0, 'prop_cooler');
  b.thing(16, 76, 0, 'prop_totem');
  b.thing(103.5, 61.5, 0, 'prop_cooler');
  b.thing(106, 69, 2.1, 'prop_chair');
  b.thing(108, 64, 4.0, 'prop_chair');
  b.thing(109, 61, 0, 'prop');

  return { map: b.build(), gateSector: GATE, archDoorSector: SDOOR, pauseDoorSector: PDOOR };
}

const built = buildMap();

export const M3_HR: Level = {
  map: built.map,
  spawn: { x: 114, y: 17, angle: Math.PI },
  enemies: [
    { spec: PINKY_SPEC, x: 86, y: 18 },
    { spec: PINKY_SPEC, x: 94, y: 24 },
    { spec: LOSTSOUL_SPEC, x: 57, y: 5 },
    { spec: IMP_SPEC, x: 46, y: 12.5 },
    { spec: PINKY_SPEC, x: 40, y: 48 },
    { spec: KNIGHT_SPEC, x: 47, y: 43 },
    { spec: IMP_SPEC, x: 18, y: 38 },
    { spec: IMP_SPEC, x: 18, y: 44 },
    { spec: SHOTGUNGUY_SPEC, x: 13, y: 44 },
    { spec: KNIGHT_SPEC, x: 10, y: 33 },
    { spec: LOSTSOUL_SPEC, x: 8, y: 22 },
    { spec: LOSTSOUL_SPEC, x: 11, y: 25 },
    { spec: KNIGHT_SPEC, x: 87, y: 33.5 },
    { spec: PINKY_SPEC, x: 91, y: 34.5 },
    { spec: IMP_SPEC, x: 46, y: 89.5 },
    { spec: IMP_SPEC, x: 52, y: 89.5 },
    { spec: PINKY_SPEC, x: 36, y: 71 },
    { spec: KNIGHT_SPEC, x: 76, y: 68 },
    { spec: SHOTGUNGUY_SPEC, x: 85, y: 80.5 },
    { spec: PINKY_SPEC, x: 69, y: 62 },
    { spec: PINKY_SPEC, x: 69, y: 66 },
    { spec: SHOTGUNGUY_SPEC, x: 57, y: 25 },
    { spec: LOSTSOUL_SPEC, x: 20, y: 80 },
  ],
  health: [
    [58, 12, 'small'],
    [55.5, 24.5],
  ],
  armor: [
    [49, 78],
    [106, 66, 'small'],
  ],
  ammo: [
    [47, 48], // staples
    [98, 8], // nails
    [52, 83], // canisters
    [92, 76], // cells
    [28, 22], // batteries
    [17, 82], // server-cell
  ],
  weapons: [[87, 75, 'chaingun']],
  keycards: [[9, 43.5, 'yellow']], // on the DRH desk island (z4.1) — the DRH is management: yellow starts here
  entries: {
    main: { x: 114, y: 17, angle: Math.PI },
    'from-m2': { x: 114, y: 17, angle: Math.PI },
    'from-m4': { x: 58.5, y: 21, angle: 0 }, // on the landing, clear of the m4 exit's re-trigger radius
  },
  exits: [
    { x: 122.5, y: 17, to: 'm2', entry: 'from-m3' },
    { x: 55, y: 22, to: 'm4', entry: 'from-m3' },
  ],
  doors: [
    { sector: built.gateSector, triggerX: 73, triggerY: 22, requiresCard: 'yellow' },
    { sector: built.archDoorSector, triggerX: 30.5, triggerY: 65, requiresCard: null },
    { sector: built.pauseDoorSector, triggerX: 99, triggerY: 66, requiresCard: null },
  ],
};
