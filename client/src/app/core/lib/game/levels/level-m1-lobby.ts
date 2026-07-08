import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

/**
 * M1 "Lobby / Accueil" — the OPEN SPACE.EXE episode opener: the UAC tower's PREMIUM ground-floor lobby,
 * pristine and bright (the calm before the horror), KEYLESS (like DOOM E1M1). Look: polished marble
 * (`LOBBY_FLOOR`) + warm WOOD veneer feature walls + luminous white `CEIL_LUX` cornice ceilings +
 * black-frame glass. Authored via {@link RoomBuilder} (room polygons + declared connections) — winding,
 * shared-edge splitting, and the solid-vs-opening bookkeeping are the builder's job, not the author's.
 *
 *   STREET (CITY_STREET backdrop, 0.1-deep box — zero gap behind the frontage glass)
 *     ═glassPane═ PORCH [spawn, glazed entry, ceil 6.4] ══ OUTER sliding glass door ══▶ SAS (glass
 *     vestibule PROJECTING into the concourse — glassPane sides, one continuous glass axis to the street)
 *     ══ INNER sliding glass door ══▶ CONCOURSE (z0, chamfered ring ceil 4.4 + raised central ceiling
 *     FIELD 5.6 with a WOOD cornice fascia + 4 columns): RECEPTION desk (in front of the WOOD feature
 *     wall, west) ─▶ TURNSTILE row (3 lanes, the badge line) ─▶ 3 dead ELEVATORS (recess in the north
 *     wall, WOOD piers) — the lifts are DEAD, so:
 *       ├─ LOUNGE alcove east (glassPane partition + opening; carpet rug + sofa + low table + plants)
 *       └─ LATERAL STAIRCASE (5 steps, z0 → +2.0) ──▶ THRESHOLD DOOR (unlocked)
 *          ──▶ RECEPTION HALL (z+2.0, tight octagon: raised DESK island +2.6 + 2 columns)
 *              ──▶ SEAM STUB north (5 service steps back down to z0) ──▶ LIVE PASSABLE zone portal →
 *                  M2 open-space (the cubicle floor is VISIBLE through the seam opening and WALKING
 *                  through it crosses zones seamlessly)
 *
 * y increases DOWN (the entrance is at the SOUTH). Organic geometry (chamfers everywhere); NO side
 * skylines — the ONLY exterior view is the street through the sas glass axis.
 */

/** The two floor looks: LUX = ground-floor marble under the luminous cornice ceiling; UPPER = the
 *  upstairs marble (z+2.0) under a plain white ceiling. */
const LUX = { floorZ: 0, floorTex: 'LOBBY_FLOOR', ceilTex: 'CEIL_LUX' };
const UPPER = { floorZ: 2.0, floorTex: 'LOBBY_FLOOR', ceilTex: 'CEIL' };

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new RoomBuilder();

  // --- CONCOURSE — chamfered marble ring x6..46 y100..128, with the sas notch in its south wall;
  //     edge 1 (x6, y110..122) is the WOOD veneer feature wall behind the reception desk ------------
  const CONC = b.room(
    poly([
      6, 104, 6, 110, 6, 122, 6, 124, 10, 128, 22, 128, 22, 122, 30, 122, 30, 128, 42, 128, 46, 124,
      46, 104, 42, 100, 10, 100,
    ]),
    { ...LUX, ceilZ: 4.4, light: 238, wallTex: 'LOBBY', walls: { 1: 'WOOD' } },
  );

  // --- raised central ceiling FIELD (x18..36 y108..120) — flat floor, ceiling 4.4 → 5.6; its portal
  //     upper bands wear WOOD = the warm cornice fascia — and its 4 corner COLUMNS (cover) ----------
  const cornice = { ...LUX, ceilZ: 5.6, light: 246, wallTex: 'WOOD' };
  const FIELD = b.island(CONC, rect(18, 108, 36, 120), cornice);

  b.hole(FIELD, rect(19, 109, 20.5, 110.5), 'PILLAR_LOBBY'); // NW
  b.hole(FIELD, rect(33.5, 109, 35, 110.5), 'PILLAR_LOBBY'); // NE
  b.hole(FIELD, rect(19, 117.5, 20.5, 119), 'PILLAR_LOBBY'); // SW
  b.hole(FIELD, rect(33.5, 117.5, 35, 119), 'PILLAR_LOBBY'); // SE

  // --- ELEVATOR bank — a recess on the concourse's back (north) wall with 3 dead cars (4-wide bays,
  //     one door copy each) split by WOOD piers -----------------------------------------------------
  const ELEV = b.room(poly([10, 96, 10, 100, 24, 100, 24, 96, 20, 96, 19, 96, 15, 96, 14, 96]), {
    ...LUX,
    ceilZ: 3.4,
    light: 210,
    wallTex: 'WOOD',
    walls: { 3: 'ELEVATOR', 5: 'ELEVATOR', 7: 'ELEVATOR' }, // the car-door bays between the piers
  });

  b.connect(CONC, ELEV, { tex: 'LOBBY' });

  // --- LATERAL staircase (east) — 5 steps z0.4..2.0 climbing NORTH from the concourse's y100 wall --
  const run = { depth: 6, count: 5, zBase: 0, dz: 0.4, ceilZ: 5.6, light: 216, wallTex: 'LOBBY' };
  const STEP = b.stairs([26, 100], [34, 100], run);

  b.connect(CONC, STEP[0], { tex: 'LOBBY' }); // the staircase mouth

  // --- RECEPTION desk (accueil) + TURNSTILE row (portiques) — raised furniture at MANTLE height (1.3:
  //     too tall to silently step onto at STEP_MAX 1.1, but vaultable with the two-handed climb — hopping
  //     the turnstile is a deliberate move, and ENEMIES can't mantle so the rails still gate them); the 3
  //     turnstile lanes are the gaps x17..20 | x22..30 (central, on axis) | x32..35 --------------------
  const counter = {
    floorZ: 1.3,
    ceilZ: 4.4,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CEIL_LUX',
    light: 238,
  };

  b.island(CONC, rect(8, 113, 16, 116), { ...counter, wallTex: 'RECEPTION' }); // desk, at the WOOD wall
  b.island(CONC, rect(8, 103, 17, 105), { ...counter, wallTex: 'TURNSTILE' }); // west rail
  b.island(CONC, rect(20, 103, 22, 105), { ...counter, wallTex: 'TURNSTILE' }); // gate post (lane 1 | lane 2)
  b.island(CONC, rect(30, 103, 32, 105), { ...counter, wallTex: 'TURNSTILE' }); // gate post (lane 2 | lane 3)
  b.island(CONC, rect(35, 103, 44, 105), { ...counter, wallTex: 'TURNSTILE' }); // east rail

  // --- LOUNGE alcove (x46..56 y108..124, chamfered) — the sofa corner: a glassPane partition + a
  //     6-wide walk-in opening carved out of the concourse's east wall; WOOD wall behind the sofa ---
  const LOUNGE = b.room(
    poly([54, 108, 48, 108, 46, 110, 46, 122, 48, 124, 54, 124, 56, 122, 56, 110]),
    { ...LUX, ceilZ: 3.6, light: 228, wallTex: 'LOBBY', walls: { 6: 'WOOD' } },
  );

  b.connect(CONC, LOUNGE, { kind: 'glassPane', at: [46, 122, 46, 119] }); // south glass panel
  b.connect(CONC, LOUNGE, { at: [46, 119, 46, 113], tex: 'LOBBY' }); // the lounge OPENING
  b.connect(CONC, LOUNGE, { kind: 'glassPane', at: [46, 113, 46, 110] }); // north glass panel

  // --- lounge furniture: flat carpet RUG inset + sofa plinth (sit-on) + low table on the rug -------
  const wood = { ceilZ: 3.6, ceilTex: 'CEIL_LUX', light: 228, floorTex: 'STEP', wallTex: 'WOOD' };
  const carpet = { ...LUX, ceilZ: 3.6, light: 228, floorTex: 'CARPET', wallTex: 'METAL' };
  const RUG = b.island(LOUNGE, rect(48, 113, 54, 121), carpet); // flat — reads as the rug's border

  b.island(LOUNGE, rect(54.5, 112, 55.7, 120), { ...wood, floorZ: 0.9 }); // sofa plinth (east wall)
  b.island(RUG, rect(50, 116, 52, 118), { ...wood, floorZ: 0.5 }); // low table, on the rug

  // --- entrance SAS (x22..30 y122..128) — a glass vestibule projecting into the concourse; all four
  //     edges are connections (two glassPane sides + the two automatic sliding doors) ---------------
  const glazed = { ...LUX, light: 236 };
  const SAS = b.room(rect(22, 122, 30, 128), { ...glazed, ceilZ: 4.0, wallTex: 'GLASS_PANE' });

  b.connect(CONC, SAS, { kind: 'glassPane', at: [22, 128, 22, 122] }); // sas WEST side — see-through
  b.connect(CONC, SAS, { kind: 'slidingDoor', at: [22, 122, 30, 122] }); // INNER sliding door (sas → concourse)
  b.connect(CONC, SAS, { kind: 'glassPane', at: [30, 122, 30, 128] }); // sas EAST side

  // --- glazed entry PORCH (spawn, x22..30 y128..134) + the 0.1-deep EXTERIOR street box (the street
  //     backdrop sits IN the glass plane, seen through the frontage pane) ---------------------------
  const PORCH = b.room(rect(22, 128, 30, 134), { ...glazed, ceilZ: 6.4, wallTex: 'GLASS_INT' });

  b.connect(SAS, PORCH, { kind: 'slidingDoor' }); // OUTER automatic sliding door (porch → sas)
  const EXT = b.room(rect(22, 134, 30, 134.1), {
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
    walls: { 1: 'CITY_STREET' }, // far wall — deserted STREET, ONE clean copy (8 wide)
  });

  b.connect(PORCH, EXT, { kind: 'glassPane' }); // south frontage — SEE-THROUGH pane onto the street

  // --- THRESHOLD DOOR slab (x26..34 y68..70) at the flight's top, then the RECEPTION HALL — a tight
  //     chamfered octagon (x10..42 y34..68): east interior glass, raw BRICK north end ---------------
  const slab = { ...UPPER, ceilZ: 5.0, light: 230, wallTex: 'GLASS_INT' };
  const DOOR = b.room(rect(26, 68, 34, 70), slab);

  b.connect(DOOR, STEP[4]); // door ↔ top step
  const hall = { ...UPPER, ceilZ: 7, light: 244, wallTex: 'LOBBY' };
  const HALL = b.room(poly([10, 42, 10, 60, 18, 68, 34, 68, 42, 60, 42, 42, 34, 34, 18, 34]), {
    ...hall,
    walls: { 4: 'GLASS_INT', 5: 'BRICK', 6: 'BRICK', 7: 'BRICK' },
  });

  b.connect(DOOR, HALL, { tex: 'GLASS_INT' }); // door ↔ hall

  // --- SEAM STUB to M2 (the M1 ⇄ M2 open-space zone edge, a LIVE + PASSABLE PORTAL): five service
  //     steps descend north out of the hall (z2.0 → 0) to a 4-wide seam whose opening renders M2's own
  //     seam stub LIVE — and WALKING THROUGH it crosses zones seamlessly (no fade; the walk-into exits
  //     mechanism stays for non-seam edges). Width/heights match the M2 side exactly (floor 0,
  //     ceil 4.6, x-span 4); the stub keeps the LOBBY dressing so the palette flips at the seam. The
  //     translation (dx,dy) = (0, −100) maps M2's seam line (24..28, 130) onto ours (24..28, 30).
  //     TRANSLATION only — both stubs run north–south. ---------------------------------------------------
  const SEAM = b.stairs([28, 30], [24, 30], {
    depth: 0.8,
    count: 5,
    zBase: -0.4,
    dz: 0.4,
    ceilZ: 4.6,
    light: 224,
    wallTex: 'LOBBY',
  });

  b.connect(HALL, SEAM[4], { tex: 'LOBBY' }); // carve the stub mouth out of the hall's north wall
  b.zonePortal(SEAM[0], [28, 30, 24, 30], { zone: 'm2', dx: 0, dy: -100, passable: true });

  // --- DESK island (raised +2.6, mantle cover) + 2 COLUMNS + planters and a low seating plinth -----
  const marble = { ...hall, floorTex: 'STEP' };

  b.island(HALL, rect(22, 47, 30, 55), { ...marble, floorZ: 2.6, wallTex: 'METAL' }); // the desk island
  b.hole(HALL, rect(15, 42, 18, 45), 'PILLAR_LOBBY');
  b.hole(HALL, rect(33, 57, 36, 60), 'PILLAR_LOBBY');
  b.island(HALL, rect(11, 49, 14, 54), { ...marble, floorZ: 3.0 }); // west planter (waist-high)
  b.island(HALL, rect(38, 49, 41, 54), { ...marble, floorZ: 3.0 }); // east planter
  b.island(HALL, rect(11, 56, 15, 59), { ...marble, floorZ: 2.4 }); // SW seating plinth (low, sit-on)

  // --- things --------------------------------------------------------------------------------------
  b.thing(26, 131, Math.PI * 1.5, 'player_start'); // porch, facing north through the sas into the lobby
  b.thing(22, 118, 0, 'barrel'); // concourse — cover by the SW field column
  b.thing(32, 117, 0, 'barrel'); // concourse — cover by the SE field column
  b.thing(26, 44, 0, 'barrel'); // hall — behind the desk
  b.thing(14, 55, 0, 'barrel'); // hall — west cover
  b.thing(38, 48, 0, 'barrel'); // hall — east cover

  // --- DECOR props (real green-screen art: plant / crashed monitor / directory totem). Directional
  //     props (screen / totem / chair) carry a MEANINGFUL facing — their 4-rotation billboards turn
  //     with the viewer; symmetric plants keep angle 0. ---------------------------------------------
  b.thing(12, 114.5, 0, 'prop'); // plant on the reception counter
  b.thing(14, 114.5, 0.9, 'prop_screen'); // crashed check-in monitor beside it, angled at the visitors
  b.thing(11, 101.5, 1.57, 'prop_totem'); // directory totem before the dead lifts, facing the concourse
  b.thing(7, 114.5, 0, 'prop_chair'); // the receptionist's chair, behind the counter at the WOOD wall
  b.thing(49, 119.5, 5.4, 'prop_chair'); // lounge — pulled from the low table, on the rug
  b.thing(24, 49, 1.26, 'prop_screen'); // dead monitor on the hall's desk island (z2.6)
  b.thing(54.5, 110.5, 0, 'prop'); // plant in the lounge, north of the sofa
  b.thing(50, 122.5, 0, 'prop'); // plant in the lounge, south side
  b.thing(12.5, 51, 0, 'prop'); // plant on the west hall planter
  b.thing(39.5, 51, 0, 'prop'); // plant on the east hall planter

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

/** "M1 — Lobby / Accueil" (episode opener) — the redesigned PREMIUM ground floor + the upstairs hall. */
export const M1_LOBBY: Level = {
  map: built.map,
  spawn: { x: 26, y: 131, angle: Math.PI * 1.5 },
  enemies: [
    { spec: PINKY_SPEC, x: 12, y: 111 }, // concourse — the receptionist husk, behind the counter
    { spec: PINKY_SPEC, x: 33, y: 102 }, // concourse — lurking past the turnstile east lane
    { spec: SHOTGUNGUY_SPEC, x: 17, y: 98 }, // elevator recess — security guard at the dead lifts, holds the axis
    { spec: IMP_SPEC, x: 51, y: 114.5 }, // lounge — lobbing over the low table through the glass opening
    { spec: PINKY_SPEC, x: 16, y: 40 }, // hall — west rush
    { spec: IMP_SPEC, x: 26, y: 38 }, // hall — lobbing from behind the desk/north
    { spec: SHOTGUNGUY_SPEC, x: 38, y: 40 }, // hall — holding the NE corner
  ],
  health: [
    [26, 118, 'small'], // concourse — on the axis, under the raised ceiling field
    [12, 45], // hall — west
  ],
  armor: [[53, 113, 'small']], // lounge — on the rug, by the sofa
  ammo: [
    [18, 101], // staples — past the turnstile west lane
    [30, 86], // nails — on the staircase
    [26, 51], // canisters — on the desk island
    [14, 62], // cells — hall SW
    [50, 120], // batteries — lounge, by the low table
    [12, 98], // server-cell — elevator recess
  ],
  weapons: [
    // The PISTOL (keyboard) — the episode's first ranged unlock, on the reception approach: the walk axis
    // from the sas toward the counter, in plain sight BEFORE the receptionist husk behind it.
    [12, 119, 'pistol'],
    // The CHAINSAW — the semi-hidden melee bonus: on the lounge rug between the low table and the sofa,
    // off the critical path and guarded by the lounge imp (a reward for clearing the alcove).
    [53, 117, 'chainsaw'],
  ],
  keycards: [], // keyless floor (like E1M1)
  entries: {
    main: { x: 26, y: 131, angle: Math.PI * 1.5 }, // the street porch (the level spawn)
    'from-above': { x: 26, y: 32, angle: Math.PI / 2 }, // on the seam steps, walking down into the hall
  },
  // NO graph `exits`: the M1 ⇄ M2 edge is the PASSABLE live seam in the hall's stub — walking through
  // the window IS the crossing (seamless, no fade).
  // (`entries` stay: named arrival points for the fade mechanism / dev loads.)
  doors: [
    { sector: built.doorSector, triggerX: 30, triggerY: 69, requiresCard: null }, // glass threshold into the hall
    // (the entrance sas is TWO automatic SLIDING GLASS doors — proximity-driven, not doors[] entries)
  ],
};
