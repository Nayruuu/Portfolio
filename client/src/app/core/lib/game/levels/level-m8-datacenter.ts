import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M8 "Datacenter" — the AI core, boss floor + episode finale. No badge (colours spent by M4): the
// device is L'ORBITE — the core rotunda glows behind glass on three quadrants and the horseshoe
// N → E → S → W wraps around it, the iris (west slot) the only way in. Radial feeder conduits point
// inward; the one server_cell box sits ON the dais, visible all orbit long. The boss slot is EMPTY
// (the Overseer's spider ships later) — two aggro-staged placeholder waves hold the arena, and the
// WIN exit climbs out of the SE slot behind the dais. y increases DOWN (arrival from M7 at the north).

const ORBIT = { floorZ: 0, floorTex: 'GRATING', ceilTex: 'NEON' };
const COLD = { floorZ: 0, floorTex: 'GRATING', ceilTex: 'TECHNICAL' };

function buildMap(): { map: MapSource; s1DoorSector: number } {
  const b = new RoomBuilder();

  const SAS = b.room(rect(52, 3, 60, 10), {
    floorZ: 2.4,
    ceilZ: 5.2,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'RACKS',
  });
  const DESC = b.stairs([52, 14], [60, 14], {
    depth: 0.8,
    count: 5,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.2,
    light: 135,
    wallTex: 'RACKS',
    ceilTex: 'TECHNICAL',
  });

  b.connect(SAS, DESC[4], { tex: 'RACKS' });

  const VEST = b.room(poly([36, 14, 74, 14, 80, 20, 80, 29, 70, 35, 46, 35, 30, 28, 30, 20]), {
    ...ORBIT,
    ceilZ: 6.4,
    light: 120,
    wallTex: 'DAMAGED',
    walls: { 0: 'RACKS' },
  });

  b.connect(VEST, DESC[0], { tex: 'RACKS' });
  b.hole(VEST, rect(47, 17, 50, 20), 'RACKS');
  b.hole(VEST, rect(60, 16, 63, 19), 'RACKS');
  // Radial feeder conduit (+0.4, NEON-lit): the first arrow pointing at the core.
  b.island(VEST, rect(53, 26, 57, 33.5), {
    floorZ: 0.4,
    ceilZ: 6.4,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 160,
    wallTex: 'METAL',
  });

  const GAL = b.room(poly([38, 35, 76, 35, 80, 41, 76, 48, 34, 48, 34, 41]), {
    ...COLD,
    ceilZ: 5.2,
    light: 110,
    wallTex: 'METAL',
  });

  b.connect(VEST, GAL, { at: [50, 35, 56, 35], tex: 'DAMAGED' });
  b.connect(VEST, GAL, { at: [60, 35, 66, 35], tex: 'DAMAGED' });

  const ROT = b.room(poly([48, 48, 68, 48, 76, 54, 76, 68, 68, 78, 50, 78, 42, 71, 42, 55]), {
    ...ORBIT,
    ceilZ: 6.0,
    light: 140,
    wallTex: 'RACKS',
    walls: { 1: 'DAMAGED', 3: 'DAMAGED', 5: 'DAMAGED', 7: 'DAMAGED' },
  });

  // First core view — glass only: the north quadrant never opens into the arena.
  b.connect(GAL, ROT, { kind: 'glassPane', at: [50, 48, 58, 48] });
  b.connect(GAL, ROT, { kind: 'glassPane', at: [60, 48, 66, 48] });

  // The dais — the empty boss slot (the Overseer's spider assembles here when it ships).
  b.island(ROT, poly([55, 58, 61, 58, 64, 60.5, 64, 63.5, 61, 66, 55, 66, 52, 63.5, 52, 60.5]), {
    floorZ: 0.5,
    ceilZ: 6.0,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 245,
    wallTex: 'METAL',
  });

  // Dodge trench (−0.8): a stride-through dip breaking straight-line fire around the dais
  // (≤ STEP_MAX, so it costs no mantle — the DEAMB cable trench is the committal one).
  b.island(ROT, rect(52, 72.5, 66, 76.5), {
    floorZ: -0.8,
    ceilZ: 6.0,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 110,
    wallTex: 'METAL',
  });
  b.hole(ROT, rect(50.5, 53, 52.5, 55), 'RACKS');
  b.hole(ROT, rect(64, 53, 66, 55), 'RACKS');
  b.hole(ROT, rect(47.5, 66, 49.5, 68), 'RACKS');
  b.hole(ROT, rect(67, 66, 69, 68), 'RACKS');

  const CHAUD = b.room(
    poly([80, 41, 96, 37, 104, 45, 104, 71, 96, 81, 84, 81, 80, 75, 80, 63, 76, 63, 76, 48]),
    { ...ORBIT, ceilZ: 3.4, light: 95, wallTex: 'RACKS' },
  );

  b.connect(GAL, CHAUD, { at: [79, 42.75, 77, 46.25], tex: 'RACKS' });
  b.connect(ROT, CHAUD, { kind: 'glassPane', at: [76, 55.5, 76, 61.5] });
  b.hole(CHAUD, rect(84, 46, 86, 60), 'RACKS');
  b.hole(CHAUD, rect(90, 46, 92, 60), 'RACKS');
  b.hole(CHAUD, rect(96, 46, 98, 62), 'RACKS');
  b.island(CHAUD, rect(78, 57.5, 83, 60.5), {
    floorZ: 0.4,
    ceilZ: 3.4,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 160,
    wallTex: 'METAL',
  });

  // Secret 1 — la baie fantôme: one DAMAGED rack front in the clean row + the threshold light leak.
  const S1DOOR = b.room(rect(104, 52, 106, 55), {
    ...ORBIT,
    ceilZ: 2.4,
    light: 210,
    wallTex: 'DAMAGED',
  });

  b.connect(CHAUD, S1DOOR, { tex: 'DAMAGED' });
  b.island(CHAUD, rect(103.4, 52, 103.8, 55), {
    floorZ: 0.05,
    ceilZ: 3.4,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 235,
    wallTex: 'DAMAGED',
  });
  const S1 = b.room(rect(106, 49, 112, 59), {
    ...ORBIT,
    ceilZ: 2.8,
    light: 130,
    wallTex: 'DAMAGED',
  });

  b.connect(S1DOOR, S1, { tex: 'DAMAGED' });

  const CHENAL = b.room(
    poly([86, 81, 96, 81, 102, 87, 94, 97, 74, 97, 70, 94, 70, 90, 81, 89, 84, 81]),
    { ...ORBIT, ceilZ: 3.6, light: 100, wallTex: 'DAMAGED' },
  );

  b.connect(CHAUD, CHENAL, { at: [88, 81, 94, 81], tex: 'DAMAGED' });
  b.hole(CHENAL, rect(88, 88, 91, 91), 'DAMAGED');

  const DEAMB = b.room(poly([40, 78, 70, 78, 70, 94, 52, 97, 38, 90, 34, 86, 34, 80]), {
    ...ORBIT,
    ceilZ: 3.6,
    light: 90,
    wallTex: 'DAMAGED',
  });

  b.connect(CHENAL, DEAMB, { at: [70, 90.5, 70, 93.5], tex: 'DAMAGED' });
  b.connect(ROT, DEAMB, { kind: 'glassPane', at: [51, 78, 57, 78] });
  b.connect(ROT, DEAMB, { kind: 'glassPane', at: [61, 78, 67, 78] });
  // Cable trench (−1.2): drop in freely, mantle out. Chasers DO fall in and can't climb back
  // (enemy stepMax 1.1, no mantle) — the pit is a deliberate trap for whoever follows you down.
  b.island(DEAMB, rect(44, 82, 66, 88), {
    floorZ: -1.2,
    ceilZ: 3.6,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 80,
    wallTex: 'DAMAGED',
  });

  // West nave — its east edge is notched around the mezzanine flight (x24..28, y48.4..54).
  const NEF = b.room(
    poly([
      14, 46, 28, 44, 28, 48.4, 24, 48.4, 24, 54, 28, 54, 28, 80, 34, 80, 34, 86, 30, 92, 16, 90,
      12, 78, 12, 56,
    ]),
    { ...COLD, ceilZ: 4.6, light: 125, wallTex: 'METAL', walls: { 11: 'RACKS' } },
  );

  b.connect(DEAMB, NEF, { at: [34, 81, 34, 85], tex: 'METAL' });
  b.hole(NEF, rect(16, 60, 20, 66), 'METAL');
  b.hole(NEF, rect(16, 72, 20, 78), 'METAL');

  const MS = b.stairs([24, 54], [28, 54], {
    depth: 0.8,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 6.0,
    light: 125,
    wallTex: 'METAL',
    ceilTex: 'TECHNICAL',
  });

  b.connect(NEF, MS[0], { tex: 'METAL' });
  const MEZZ = b.room(rect(28, 41, 34, 54), {
    floorZ: 2.8,
    ceilZ: 6.0,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 130,
    wallTex: 'METAL',
  });

  b.connect(MS[6], MEZZ, { tex: 'METAL' });
  // Rail over the flight void, then the ONE-WAY 2.8 drop into the gallery (above CLIMB_MAX 2.4):
  // the doctrine return-shortcut that also seals the W arm off the arrival side.
  b.connect(MEZZ, NEF, { kind: 'fence', at: [28, 44.5, 28, 48], tex: 'METAL' });
  b.connect(MEZZ, GAL, { at: [34, 42, 34, 47], tex: 'METAL' });

  // Secret 2 — la bouche du conduit: a NEON spill from a chest-height duct mouth on the mezz
  // (sill Δ1.3 = mantle, no silent step-up).
  const VENT = b.room(rect(27, 35, 33, 41), {
    floorZ: 4.1,
    ceilZ: 6.4,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 190,
    wallTex: 'DAMAGED',
  });

  b.connect(MEZZ, VENT, { at: [28.5, 41, 31.5, 41], tex: 'DAMAGED' });

  const ANTE = b.room(rect(28, 58, 42, 66), {
    ...COLD,
    ceilZ: 3.4,
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(NEF, ANTE, { at: [28, 60, 28, 64], tex: 'METAL' });
  // L'IRIS — the orbit's only way in, glass both flanks.
  b.connect(ANTE, ROT, { kind: 'glassPane', at: [42, 58, 42, 60] });
  b.connect(ANTE, ROT, { at: [42, 60.5, 42, 63.5], tex: 'RACKS' });
  b.connect(ANTE, ROT, { kind: 'glassPane', at: [42, 64, 42, 66] });

  // Epilogue — the SE slot behind the dais (discovered after the fight, not hidden from it):
  // stairs climb OUT of the machine into the episode's WIN exit.
  const EPIA = b.room(rect(76, 64, 80, 67), {
    ...COLD,
    ceilZ: 3.0,
    light: 170,
    wallTex: 'METAL',
  });

  b.connect(ROT, EPIA, { tex: 'METAL' });
  const ES = b.stairs([80, 67], [76, 67], {
    depth: 0.8,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.6,
    light: 190,
    wallTex: 'DAMAGED',
    ceilTex: 'TECHNICAL',
  });

  b.connect(EPIA, ES[0], { tex: 'METAL' });
  const FIN = b.room(poly([76, 72.6, 80, 72.6, 80, 75, 84, 81, 81, 89, 72, 89, 72, 76]), {
    floorZ: 2.8,
    ceilZ: 6.8,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 255,
    wallTex: 'METAL',
  });

  b.connect(ES[6], FIN, { tex: 'DAMAGED' });

  b.thing(56, 8.6, Math.PI / 2, 'player_start');
  b.thing(44, 24, 0, 'barrel');
  b.thing(45.4, 25.2, 0, 'barrel');
  b.thing(99, 42, 0, 'barrel');
  b.thing(100.3, 43.2, 0, 'barrel');
  b.thing(92, 90, 0, 'barrel');
  b.thing(93.4, 91.3, 0, 'barrel');
  b.thing(24, 72, 0, 'barrel');
  b.thing(64, 90.5, 0, 'barrel');
  b.thing(65.4, 91.8, 0, 'barrel');
  // The iris barricade — someone tried to keep the arena shut.
  b.thing(45, 60, 0, 'barrel');
  b.thing(46.3, 61.4, 0, 'barrel');
  b.thing(45.4, 63, 0, 'barrel');

  // Dressing: the dead totem beside the trunks, the chair graveyard facing the first core view,
  // crashed screens on the feeders, a lone chair turned toward the dais.
  b.thing(58.5, 21, Math.PI * 1.5, 'prop_totem');
  b.thing(55, 28, Math.PI / 2, 'prop_screen');
  b.thing(37, 22, 1.0, 'prop_board');
  b.thing(53, 45.5, Math.PI / 2, 'prop_chair');
  b.thing(57, 46, 1.2, 'prop_chair');
  b.thing(63, 45.2, 1.8, 'prop_chair');
  b.thing(46, 40, 0.8, 'prop_board');
  b.thing(79, 58.2, Math.PI, 'prop_screen');
  b.thing(97, 88, 0.9, 'prop_board');
  b.thing(15, 52, 0, 'prop_cooler');
  b.thing(22, 62, 2.4, 'prop_chair');
  b.thing(67, 80, 0, 'prop_cooler');
  b.thing(71, 59, Math.PI, 'prop_chair');
  b.thing(29.5, 64.5, 0, 'prop');
  b.thing(74, 87, Math.PI * 1.5, 'prop_totem');

  return { map: b.build(), s1DoorSector: S1DOOR };
}

const built = buildMap();

export const M8_DATACENTER: Level = {
  map: built.map,
  spawn: { x: 56, y: 8.6, angle: Math.PI / 2 },
  enemies: [
    // E1 — vestibule: silhouettes against the south glow
    { spec: SHOTGUNGUY_SPEC, x: 56, y: 22 },
    { spec: IMP_SPEC, x: 55, y: 30 },
    { spec: IMP_SPEC, x: 66, y: 29 },
    // E2 — gallery patrol crossing the first core view
    { spec: PINKY_SPEC, x: 52, y: 42 },
    // E3 — hot aisles: the feeder lane + rack-row flushers
    { spec: IMP_SPEC, x: 80, y: 59.5 },
    { spec: IMP_SPEC, x: 82, y: 58.5 },
    { spec: IMP_SPEC, x: 87, y: 63 },
    { spec: PINKY_SPEC, x: 88, y: 52 },
    { spec: PINKY_SPEC, x: 94, y: 55 },
    // E4 — the canisters bait: lungers from the dark east strip
    { spec: LOSTSOUL_SPEC, x: 100, y: 48 },
    { spec: LOSTSOUL_SPEC, x: 101, y: 44 },
    // E5 — trench crossing: anchors on the far lip, flankers in the chenal
    { spec: KNIGHT_SPEC, x: 56, y: 92 },
    { spec: KNIGHT_SPEC, x: 64, y: 93 },
    { spec: IMP_SPEC, x: 75, y: 93 },
    { spec: IMP_SPEC, x: 78, y: 94 },
    // E6 — the dark west stretch (the light drop is the telegraph)
    { spec: LOSTSOUL_SPEC, x: 40, y: 84 },
    { spec: LOSTSOUL_SPEC, x: 44, y: 91 },
    { spec: LOSTSOUL_SPEC, x: 40, y: 88 },
    // E7 — the nave: UPS chokes + the mezz anchor firing over the rail
    { spec: SHOTGUNGUY_SPEC, x: 18, y: 68 },
    { spec: SHOTGUNGUY_SPEC, x: 24, y: 58 },
    { spec: KNIGHT_SPEC, x: 31, y: 50 },
    { spec: IMP_SPEC, x: 22, y: 80 },
    { spec: IMP_SPEC, x: 31, y: 83 },
    // E8 — the iris guard, read through the glass flanks
    { spec: KNIGHT_SPEC, x: 35, y: 62 },
    { spec: PINKY_SPEC, x: 38, y: 60 },
    { spec: PINKY_SPEC, x: 38, y: 64 },
    // W1 — arena near pulse, staged in the pillar shadows: every spawn is ray-checked occluded
    // from the full 3u iris span, so peeking wakes nothing; this wave's HP budget returns to the
    // Overseer's spider when it ships on the dais.
    { spec: KNIGHT_SPEC, x: 53.4, y: 51.2 },
    { spec: KNIGHT_SPEC, x: 67.5, y: 52.5 },
    { spec: LOSTSOUL_SPEC, x: 71, y: 52 },
    { spec: LOSTSOUL_SPEC, x: 71, y: 68.5 },
    { spec: IMP_SPEC, x: 55, y: 50.5 },
    { spec: IMP_SPEC, x: 67, y: 53.5 },
    // W2 — arena far pulse (S alcoves + the dodge trench)
    { spec: KNIGHT_SPEC, x: 47, y: 72.6 },
    { spec: KNIGHT_SPEC, x: 70, y: 71 },
    { spec: LOSTSOUL_SPEC, x: 56, y: 74.5 },
    { spec: LOSTSOUL_SPEC, x: 62, y: 74.5 },
    { spec: SHOTGUNGUY_SPEC, x: 54, y: 70 },
    { spec: SHOTGUNGUY_SPEC, x: 63, y: 70 },
  ],
  health: [
    [44, 43, 'small'],
    [40, 86],
  ],
  armor: [
    [109, 54],
    [55, 85, 'small'], // the trench dip, grabbed under the lip anchors' fire
  ],
  ammo: [
    [50, 31], // staples
    [82, 45], // nails
    [101, 64], // canisters — the E4 bait
    [20, 84], // cells
    [30, 38], // batteries — secret 2 reward
    [58, 62], // server-cell — ON the dais, the carrot seen through every pane
  ],
  weapons: [], // arsenal complete since the M7 BFG — repeats would only be top-ups
  keycards: [], // no badge objective — the orbit around the visible core IS the objective
  entries: {
    main: { x: 56, y: 8.6, angle: Math.PI / 2 },
    'from-m7': { x: 56, y: 8.6, angle: Math.PI / 2 },
  },
  exits: [{ x: 56, y: 5, to: 'm7', entry: 'from-m8' }],
  // The episode WIN: up the epilogue stairs, out of the machine, into the light.
  exit: [77, 81],
  doors: [{ sector: built.s1DoorSector, triggerX: 105, triggerY: 53.5, requiresCard: null }],
};
