import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from './enemies';
import { RoomBuilder } from './room-builder';
import type { RoomPoint } from './room-builder';
import type { MapSource } from '../../core/lib/bsp-engine';
import type { Level } from './level-accueil';

/**
 * M2 "Open-space" — the employee floor above the lobby: an endless carpet-and-partition grind,
 * fluorescent and beige where M1 was marble and warm. First BADGE floor (blue = employee): the
 * DOOR_BLUE gate is visible within seconds of arriving, the badge sits in the manager's glass office
 * upstairs, and a one-way drop brings it back to the gate. Emotional arc: "the premium calm is gone —
 * the open-space is a maze that hunts you between the partitions."
 *
 *   M1 hall ⇄ LIVE SEAM (24..28, y130) ═ STUB z0 (calm zone)
 *     → VESTIBULE z0 (dead totem; the DOOR_BLUE gate VISIBLE west → exit stairwell, locked)
 *     → CUBICLE FARM z0 — the large chamfered hall: 8 partition islands (z1.3 mantle tops), a raised
 *       luminous AISLE ceiling field with 2 columns, an IMP perch plinth (first pack, E2)
 *         ├─ WEST STAIR z0→2.8 → MEZZANINE z2.8 (fenced overlook onto the farm; E5)
 *         │    → GLASS OFFICE ROW z2.8 (2 cells + the BADGE OFFICE east — WOOD wall, desk island;
 *         │      E6 climax: a guard at arm's length + two consultant husks seen through the glass)
 *         │    → back west along the mezz → one-way DROP (2.8 — beyond mantle) → farm SW, beside
 *         │      the gate approach (E7 return ambush)
 *         ├─ farm ⇄ PIT RING (2 connectors = the ground loop) → COLLAB PIT z−1.2 (octagon, NEON
 *         │      ceiling, 3 amphitheater steps out; E4 crossfire; armor dip; S2 duct cache)
 *         └─ (big loop) ring → N connector → PRINT ROOM z0 (E3 — the FIRST consultant husk; S1
 *              supply closet behind an unmarked METAL door) → LANDING → BREAK NOOK (health)
 *              → EAST DOWN-STAIR z2.8→0 ← the mezzanine's east end
 *     → badge → DOOR_BLUE → EXIT STAIRWELL (4 steps down to z−1.6) → the WIN exit (TEMP → M3)
 *
 * y increases DOWN (the seam to M1 is at the SOUTH). Identity: CUBICLE walls / CONCRETE ceilings /
 * CARPET floors, dimmer than M1 (140–210 vs 210–246); the print room goes SCREEN+METAL+TECHNICAL,
 * the nook KITCHEN+TILE, the pit a broken-NEON hazard bay.
 */

/** Pair a flat coordinate list into a polygon: `poly([x0,y0, x1,y1, …])`. */
function poly(coords: readonly number[]): readonly RoomPoint[] {
  if (coords.length % 2 !== 0) {
    throw new Error('poly: odd coordinate count');
  }

  return Array.from({ length: coords.length / 2 }, (_, i) => [coords[2 * i], coords[2 * i + 1]]);
}

/** The 4-corner polygon of an axis-aligned rectangle, `(x1,y1)` = NW corner, `(x2,y2)` = SE. */
const rect = (x1: number, y1: number, x2: number, y2: number): readonly RoomPoint[] =>
  poly([x1, y1, x1, y2, x2, y2, x2, y1]);

/** The two storey looks: GROUND = the z0 open-space carpet; UPPER = the z+2.8 mezzanine/offices. */
const GROUND = { floorZ: 0, floorTex: 'CARPET', ceilTex: 'CONCRETE' };
const UPPER = { floorZ: 2.8, floorTex: 'CARPET', ceilTex: 'CONCRETE' };

function buildMap(): { map: MapSource; gateSector: number; secretSector: number } {
  const b = new RoomBuilder();

  // --- SEAM STUB (x24..28, y124..130) — the reciprocal of M1's hall stub: same 4-wide north–south
  //     corridor, same heights (floor 0, ceil 4.6), but ALREADY in the M2 palette so the look flips
  //     exactly at the seam plane. The south edge is the LIVE + PASSABLE portal back down to M1:
  //     translation (0, +100) maps M1's seam line (24..28, 30) onto ours (24..28, 130). -------------
  const STUB = b.room(rect(24, 124, 28, 130), {
    ...GROUND,
    ceilZ: 4.6,
    light: 190,
    wallTex: 'CUBICLE',
  });

  b.zonePortal(STUB, [24, 130, 28, 130], { zone: 'm1', dx: 0, dy: 100, passable: true });

  // --- VESTIBULE (chamfered trapezoid, y112..124) — the arrival breather: a dead directory totem,
  //     and the DOOR_BLUE gate in plain sight on the west wall BEFORE anything else ----------------
  const VEST = b.room(poly([18, 112, 14, 116, 14, 124, 40, 124, 42, 120, 42, 112]), {
    ...GROUND,
    ceilZ: 3.4,
    light: 190,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, STUB, { tex: 'CUBICLE' }); // the stub mouth (full 4-wide span)

  // --- BLUE GATE wing (west): door slab + 3 descending steps + the exit stairwell landing (z−1.6).
  //     The animated DOOR_BLUE slab is badge-locked; the landing holds the TEMP win exit → M3. ------
  const GDOOR = b.room(rect(12, 117, 14, 121), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, GDOOR, { tex: 'DOOR_BLUE' }); // the gate leaf the player reads from the vestibule
  const SWELL = b.room(poly([0, 108, 0, 126, 9, 125, 9, 109]), {
    floorZ: -1.6,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'CUBICLE',
  });
  const GSTEP = b.stairs([9, 117], [9, 121], {
    depth: 1,
    count: 3,
    zBase: -1.6,
    dz: 0.4,
    ceilZ: 3.4,
    light: 210,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(SWELL, GSTEP[0], { tex: 'CUBICLE' }); // landing → bottom step
  b.connect(GDOOR, GSTEP[2], { tex: 'CUBICLE' }); // top step → door slab (z−0.4 → 0)

  // --- CUBICLE FARM — the floor's signature hall: an irregular chamfered polygon (x14..72, y70..112)
  //     under a low 4.8 ceiling, its north edge the mezzanine overlook (fence + the one-way drop) ---
  const FARM = b.room(poly([20, 70, 14, 76, 14, 112, 46, 112, 52, 106, 72, 106, 72, 84, 64, 70]), {
    ...GROUND,
    ceilZ: 4.8,
    light: 176,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, FARM, { at: [25, 112, 31, 112], tex: 'CUBICLE' }); // the 6-wide vestibule choke

  // --- raised AISLE ceiling field (x28..36, y76..110) — the readable north–south axis: brighter,
  //     taller, WOOD fascia band, two PILLAR columns as mid-hall cover -----------------------------
  const FIELD = b.island(FARM, rect(28, 76, 36, 110), {
    ...GROUND,
    ceilZ: 5.6,
    light: 204,
    wallTex: 'WOOD',
  });

  b.hole(FIELD, rect(29, 78, 30.5, 79.5), 'PILLAR'); // north column
  b.hole(FIELD, rect(33.5, 106, 35, 107.5), 'PILLAR'); // south column

  // --- cubicle partitions — 8 raised islands at MANTLE height (1.3: enemies can't follow you up;
  //     hopping one is a deliberate move) in two broken rows + an angled block + the IMP perch; every
  //     lane between them keeps ≥3 units of dodge room ---------------------------------------------
  const cubicle = { floorZ: 1.3, ceilZ: 4.8, floorTex: 'STEP', ceilTex: 'CONCRETE', light: 176 };
  const desk = { ...cubicle, wallTex: 'CUBICLE' };

  b.island(FARM, rect(16, 76, 24, 80), desk); // west row
  b.island(FARM, rect(16, 84, 24, 88), desk);
  b.island(FARM, rect(16, 92, 24, 96), desk);
  b.island(FARM, rect(16, 100, 24, 104), desk);
  b.island(FARM, rect(40, 76, 46, 80), desk); // east row
  b.island(FARM, rect(40, 84, 46, 88), desk);
  b.island(FARM, rect(40, 92, 46, 96), desk);
  b.island(FARM, poly([50, 92, 56, 88, 60, 92, 54, 96]), desk); // angled block, SE approach
  b.island(FARM, rect(40, 100, 46, 104), desk); // storage plinth — the E2 IMP perch

  // --- WEST STAIR (x6..14, climbing north y92→78) + stairhead landing → the mezzanine ------------
  const WSTEP = b.stairs([6, 92], [14, 92], {
    depth: 2,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.6,
    light: 186,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(FARM, WSTEP[0], { tex: 'CUBICLE' }); // the stair mouth in the farm's west wall
  const LANDW = b.room(rect(6, 74, 14, 78), {
    ...UPPER,
    ceilZ: 5.6,
    light: 186,
    wallTex: 'CUBICLE',
  });

  b.connect(LANDW, WSTEP[6], { tex: 'CUBICLE' }); // stairhead (z2.8 ↔ top step 2.8)

  // --- MEZZANINE (z2.8) — a walkway over the farm's north edge: METAL fence overlook + the ONE-WAY
  //     DROP gap (2.8 > the 2.4 mantle ceiling — down only), landing beside the gate approach; its
  //     north boundary zigzags to carry the angled glass office fronts -----------------------------
  const MEZZ = b.room(
    poly([6, 64, 6, 74, 14, 74, 14, 70, 60, 70, 60, 64, 54, 64, 46, 62, 34, 64, 20, 64]),
    { ...UPPER, ceilZ: 5.6, light: 186, wallTex: 'CUBICLE' },
  );

  b.connect(MEZZ, LANDW, { tex: 'CUBICLE' }); // stairhead ↔ walkway
  b.connect(FARM, MEZZ, { at: [20, 70, 24, 70], tex: 'CUBICLE' }); // the one-way DROP gap
  b.connect(FARM, MEZZ, { kind: 'fence', at: [24, 70, 60, 70], tex: 'METAL' }); // the overlook rail

  // --- GLASS OFFICE ROW (z2.8, y50..64) — three cells fronting the mezzanine through glassPane +
  //     a door opening each; the east one is the BADGE OFFICE (WOOD feature wall, desk island) -----
  const office = { ...UPPER, ceilZ: 5.6, light: 196, wallTex: 'CUBICLE' };
  const OFF1 = b.room(rect(20, 50, 34, 64), office);

  b.connect(OFF1, MEZZ, { kind: 'glassPane', at: [20, 64, 25, 64] });
  b.connect(OFF1, MEZZ, { at: [25, 64, 29, 64], tex: 'CUBICLE' }); // cell 1 doorway
  b.connect(OFF1, MEZZ, { kind: 'glassPane', at: [29, 64, 34, 64] });
  const OFF2 = b.room(poly([34, 50, 34, 64, 46, 62, 46, 50]), office);

  b.connect(OFF2, MEZZ, { kind: 'glassPane', at: [34, 64, 40, 63] }); // angled front
  b.connect(OFF2, MEZZ, { at: [40, 63, 43, 62.5], tex: 'CUBICLE' }); // cell 2 doorway
  b.connect(OFF2, MEZZ, { kind: 'glassPane', at: [43, 62.5, 46, 62] });
  const OFF3 = b.room(poly([46, 50, 46, 62, 54, 64, 60, 64, 60, 50]), {
    ...office,
    light: 210,
    walls: { 4: 'WOOD' }, // the manager's veneer wall behind the desk
  });

  b.connect(OFF3, MEZZ, { kind: 'glassPane', at: [46, 62, 54, 64] }); // angled glass
  b.connect(OFF3, MEZZ, { at: [54, 64, 57, 64], tex: 'CUBICLE' }); // the badge office doorway
  b.connect(OFF3, MEZZ, { kind: 'glassPane', at: [57, 64, 60, 64] });
  b.island(OFF3, rect(49, 53, 55, 56), {
    floorZ: 4.1, // 1.3 above the office floor — a mantle island mid-fight
    ceilZ: 5.6,
    floorTex: 'STEP',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'WOOD',
  });

  // --- EAST DOWN-STAIR (z2.8 → 0, descending east) + landing — closes the big loop: 8 steps whose
  //     ends land FLAT on the mezzanine (2.8) and the landing (0) ----------------------------------
  const ESTEP = b.stairs([68, 70], [68, 64], {
    depth: 1,
    count: 8,
    zBase: -0.4,
    dz: 0.4,
    ceilZ: 5.6,
    light: 170,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(MEZZ, ESTEP[7], { tex: 'CUBICLE' }); // mezz east end → top step (both 2.8 — flat)
  const LANDE = b.room(rect(68, 58, 78, 74), {
    ...GROUND,
    ceilZ: 3.4,
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(LANDE, ESTEP[0], { tex: 'CUBICLE' }); // bottom step (0) → landing

  // --- BREAK NOOK (KITCHEN + TILE) — the release beat off the landing: health, a plant ------------
  const NOOK = b.room(poly([62, 44, 62, 58, 74, 58, 74, 48, 70, 44]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 190,
    wallTex: 'KITCHEN',
  });

  b.connect(LANDE, NOOK, { at: [69, 58, 73, 58], tex: 'KITCHEN' });

  // --- PRINT ROOM (L-shaped, SCREEN + METAL + TECHNICAL, the darkest room) — the first consultant
  //     husk; a copier block as cover; the S1 SUPPLY CLOSET hides behind an unmarked METAL door in
  //     the north machine wall (tell: a glowing floor sliver + a barrel stack pointing at it) -------
  const PRINT = b.room(poly([78, 44, 78, 66, 92, 66, 92, 58, 100, 58, 100, 44]), {
    floorZ: 0,
    ceilZ: 4.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'SCREEN',
    walls: { 5: 'METAL' }, // the machine wall the secret door blends into
  });

  b.connect(LANDE, PRINT, { at: [78, 60, 78, 64], tex: 'CUBICLE' });
  b.hole(PRINT, rect(82, 50, 86, 54), 'METAL'); // the copier — cover for the E3 fight
  b.island(PRINT, rect(86, 44.1, 92, 44.7), {
    floorZ: 0.05, // the S1 tell: a bright sliver leaking under the closed panel
    ceilZ: 4.0,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 235,
    wallTex: 'METAL',
  });
  const SDOOR = b.room(rect(86, 42, 92, 44), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(PRINT, SDOOR, { tex: 'METAL' }); // the unmarked animated panel (no DOOR_* colour)
  const CLOS = b.room(rect(84, 36, 94, 42), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(SDOOR, CLOS, { tex: 'METAL' }); // closet side of the panel

  // --- COLLAB PIT complex (east) — an octagonal walkway RING (4 segment rooms looping around) over
  //     a sunken octagon PIT (z−1.2, TILE floor, broken-NEON ceiling): 3 amphitheater steps out on
  //     the west side, an HVAC plinth as in-pit cover, and the S2 duct ledge on the east wall -------
  const ring = { ...GROUND, ceilZ: 4.2, light: 170, wallTex: 'CUBICLE' };
  const RN = b.room(
    poly([80, 76, 76, 82, 82, 88, 86, 84, 100, 84, 104, 88, 110, 82, 104, 76]),
    ring,
  );
  const RW = b.room(poly([76, 82, 76, 110, 82, 116, 86, 110, 82, 104, 82, 88]), ring);
  const RS = b.room(poly([82, 116, 104, 116, 110, 110, 104, 106, 100, 110, 86, 110]), ring);
  const RE = b.room(poly([110, 82, 110, 110, 104, 106, 104, 88]), ring);

  b.connect(RN, RW, { tex: 'CUBICLE' }); // the four corner seams — the ring loops
  b.connect(RN, RE, { tex: 'CUBICLE' });
  b.connect(RW, RS, { tex: 'CUBICLE' });
  b.connect(RS, RE, { tex: 'CUBICLE' });
  const PIT = b.room(
    poly([
      86, 84, 82, 88, 82, 92, 85, 92, 85, 100, 82, 100, 82, 104, 86, 110, 100, 110, 104, 106, 104,
      88, 100, 84,
    ]),
    { floorZ: -1.2, ceilZ: 4.2, floorTex: 'TILE', ceilTex: 'NEON', light: 150, wallTex: 'METAL' },
  );

  b.connect(PIT, RN, { tex: 'METAL' }); // the rim — every side portals over the 1.2 drop
  b.connect(PIT, RW, { tex: 'METAL' });
  b.connect(PIT, RS, { tex: 'METAL' });
  b.connect(PIT, RE, { tex: 'METAL' });
  const PSTEP = b.stairs([85, 100], [85, 92], {
    depth: 1,
    count: 3,
    zBase: -1.2,
    dz: 0.4,
    ceilZ: 4.2,
    light: 160,
    wallTex: 'METAL',
    ceilTex: 'NEON',
  });

  b.connect(PIT, PSTEP[0], { tex: 'METAL' }); // pit floor → amphitheater steps
  b.connect(RW, PSTEP[2], { tex: 'CUBICLE' }); // top step (z0) → west walkway
  b.island(PIT, rect(90, 92, 96, 97), {
    floorZ: 0.1, // the HVAC plinth — mantle cover down in the pit
    ceilZ: 4.2,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 150,
    wallTex: 'METAL',
  });
  b.island(PIT, rect(102, 92, 103.6, 100), {
    floorZ: 1.0, // the S2 duct ledge — a 2.2 mantle from the pit floor, a fall-in from the rim
    ceilZ: 4.2,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 180,
    wallTex: 'METAL',
  });

  // --- ground-loop connectors: farm ⇄ ring (two short necks) + print ⇄ ring (north) ---------------
  const neck = { ...GROUND, ceilZ: 3.0, light: 160, wallTex: 'CUBICLE' };
  const CONNA = b.room(rect(72, 86, 76, 92), neck);
  const CONNB = b.room(rect(72, 98, 76, 104), neck);
  const CONNP = b.room(rect(80, 66, 86, 76), neck);

  b.connect(FARM, CONNA, { tex: 'CUBICLE' });
  b.connect(CONNA, RW, { tex: 'CUBICLE' });
  b.connect(FARM, CONNB, { tex: 'CUBICLE' });
  b.connect(CONNB, RW, { tex: 'CUBICLE' });
  b.connect(PRINT, CONNP, { tex: 'CUBICLE' });
  b.connect(CONNP, RN, { tex: 'CUBICLE' });

  // --- things --------------------------------------------------------------------------------------
  b.thing(26, 118, Math.PI * 1.5, 'player_start'); // vestibule, facing north into the farm

  b.thing(20, 120, 0, 'barrel'); // vestibule — cover by the gate approach
  b.thing(26, 84, 0, 'barrel'); // farm — west lane cover
  b.thing(38, 92, 0, 'barrel'); // farm — east lane cover
  b.thing(79, 86, 0, 'barrel'); // pit ring — west walkway cover
  b.thing(84.5, 45, 0, 'barrel'); // print — the S1 barrel stack…
  b.thing(85.2, 46.2, 0, 'barrel'); // …pointing at the unmarked panel

  // Directional props (4-rotation billboards) carry a MEANINGFUL facing — the angles vary on purpose,
  // that's what sells the rotation in-game. Symmetric props (plants, coolers) keep angle 0.
  b.thing(16, 114, 0.5, 'prop_totem'); // vestibule — the dead floor directory, angled at the arrivals
  b.thing(20, 86, 0.4, 'prop_screen'); // crashed monitor on a west cubicle top (z1.3), facing the aisle
  b.thing(42, 78, 2.8, 'prop_screen'); // crashed monitor on an east cubicle top, facing the aisle
  b.thing(18, 94.8, 0.6, 'prop_screen'); // monitor on the third west island, knocked askew
  b.thing(43.5, 85.2, 4.2, 'prop_screen'); // monitor on the second east island
  b.thing(55, 92, 2.6, 'prop_screen'); // monitor on the angled SE block
  b.thing(8, 66, 0, 'prop'); // mezzanine plant, by the stairhead
  b.thing(22, 52, 0, 'prop'); // office cell 1 plant
  b.thing(64, 46, 0, 'prop'); // break nook plant
  b.thing(90, 113, 0, 'prop'); // pit ring south plant

  // Office chairs — scattered as if abandoned mid-evacuation, every one at a different angle. They hug
  // the cubicle islands / walls so the farm's ≥3u dodge lanes stay clear (billboard decor, non-blocking).
  b.thing(24.9, 86.8, 0.9, 'prop_chair'); // farm — shoved out of west island 2
  b.thing(39.1, 94.6, 3.6, 'prop_chair'); // farm — against east island 3, facing away
  b.thing(25.2, 103.4, 5.5, 'prop_chair'); // farm — spun beside west island 4
  b.thing(48.6, 90.8, 2.2, 'prop_chair'); // farm — abandoned at the angled block's approach
  b.thing(23.5, 58.5, 0.7, 'prop_chair'); // office cell 1 — behind the glass
  b.thing(47.8, 57.6, 5.9, 'prop_chair'); // badge office — the manager's chair, pushed off the desk
  b.thing(65.5, 47.5, 2.4, 'prop_chair'); // break nook — pulled up to nothing
  b.thing(89, 56, 3.9, 'prop_chair'); // print room — beside the copier
  b.thing(91.5, 106.5, 1.8, 'prop_chair'); // collab pit — left down in the well (z−1.2)

  // Whiteboards — the collab pit's standups + the office row's planning wall.
  b.thing(92, 108.8, 4.71, 'prop_board'); // pit south wall, facing the amphitheater steps
  b.thing(102.8, 89.7, 3.14, 'prop_board'); // pit NE wall, below the duct ledge, facing west
  b.thing(30, 51.2, 1.57, 'prop_board'); // office cell 1 — sprint board against the north wall
  b.thing(10, 75.2, 1.57, 'prop_board'); // west stairhead landing, facing the mezzanine walkway

  // Water coolers (symmetric, single frame) — the break nook's + a farm-corner one.
  b.thing(72.8, 49.6, 0, 'prop_cooler'); // break nook east corner
  b.thing(15.2, 110.8, 0, 'prop_cooler'); // farm SW corner, by the vestibule choke

  return { map: b.build(), gateSector: GDOOR, secretSector: SDOOR };
}

const built = buildMap();

/** "M2 — Open-space" (the cubicle farm) — the first badge floor, seam-linked below to M1. */
export const M2_OPENSPACE: Level = {
  map: built.map,
  spawn: { x: 26, y: 118, angle: Math.PI * 1.5 },
  enemies: [
    { spec: PINKY_SPEC, x: 30, y: 108 }, // E1 — a husk shambling the first row, seen down the entry axis
    { spec: PINKY_SPEC, x: 26, y: 90 }, // E2 — the farm pack, west lane…
    { spec: PINKY_SPEC, x: 37.5, y: 90 }, // …east lane
    { spec: IMP_SPEC, x: 43, y: 102 }, // E2 — drone on the storage-plinth perch (z1.3)
    { spec: SHOTGUNGUY_SPEC, x: 86, y: 52 }, // E3 — guard by the copier, reads at the print-room door
    { spec: LOSTSOUL_SPEC, x: 96, y: 48 }, // E3 — the FIRST consultant husk, on the nails cache
    { spec: IMP_SPEC, x: 107, y: 90 }, // E4 — east-rim crossfire over the pit…
    { spec: IMP_SPEC, x: 107, y: 102 }, // …second lane
    { spec: PINKY_SPEC, x: 90, y: 103 }, // E4 — waiting down in the pit
    { spec: PINKY_SPEC, x: 18, y: 67 }, // E5 — flusher on the mezz west end, seen over the rail
    { spec: IMP_SPEC, x: 34, y: 67 }, // E5 — drone down the mezzanine lane
    { spec: SHOTGUNGUY_SPEC, x: 56, y: 58 }, // E6 — the badge guard, arm's length from the desk
    { spec: LOSTSOUL_SPEC, x: 27, y: 56 }, // E6 — consultant husk visible through cell 1's glass
    { spec: LOSTSOUL_SPEC, x: 40, y: 56 }, // E6 — and through cell 2's
    { spec: PINKY_SPEC, x: 17, y: 108 }, // E7 — the return-leg pair by the gate approach…
    { spec: PINKY_SPEC, x: 20, y: 110 }, // …seen from the overlook before dropping
  ],
  health: [
    [68, 51, 'small'], // break nook — the release beat
    [10, 68], // mezzanine west — post-climax, before the drop
  ],
  armor: [
    [95, 104, 'small'], // pit floor — the risk/reward dip under the E4 crossfire
    [89, 39], // S1 supply closet — the secret's payoff
  ],
  ammo: [
    [26, 120], // staples — vestibule, on arrival
    [96, 52], // nails — print room east arm (grabbing it wakes the consultant husk)
    [32, 96], // canisters — the farm aisle, before the pack
    [102.8, 96], // cells — the S2 duct ledge (visible from the rim, mantled from the pit)
    [30, 67], // batteries — the mezzanine, before the badge office
    [5, 122], // server-cell — the exit stairwell landing, the post-gate send-off
  ],
  weapons: [
    // The SHOTGUN (stapler) — mid-path, in the print-room approach connector (ring → print), collected
    // right BEFORE E3 (the copier guard + the first consultant husk): the floor's shell boxes assume it.
    [83, 71, 'shotgun'],
  ],
  keycards: [[52, 54.5, 'blue']], // on the manager's desk island (z4.1), guarded at arm's length
  entries: {
    main: { x: 26, y: 118, angle: Math.PI * 1.5 }, // the vestibule (the level spawn)
    'from-m1': { x: 26, y: 128, angle: Math.PI * 1.5 }, // in the seam stub, walking north off the seam
  },
  // NO graph `exits` yet: onward is the WIN exit on the stairwell landing (TEMP — when M3 ships this
  // becomes `exits: [{ x: 4, y: 119, to: 'm3', entry: 'from-m2' }]`); the M1 edge is the PASSABLE live
  // seam in the stub — walking through the window IS the crossing (seamless, no fade).
  exit: [4, 119],
  doors: [
    { sector: built.gateSector, triggerX: 13, triggerY: 119, requiresCard: 'blue' }, // the employee gate
    { sector: built.secretSector, triggerX: 89, triggerY: 43, requiresCard: null }, // S1 — unmarked panel
  ],
};
