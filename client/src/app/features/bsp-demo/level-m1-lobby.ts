import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC } from './enemies';
import { MapBuilder } from './level-builder';
import type { MapSource } from '../../core/lib/bsp-engine';
import type { Level } from './level-accueil';

/**
 * M1 "Lobby / Accueil" — the OPEN SPACE.EXE episode opener: the UAC tower lobby wing, marble grandeur gone
 * WRONG (straight horror), KEYLESS (like DOOM E1M1). Design principle: **tight, DENSE rooms** (interior cover
 * islands + columns + packed fights) — the "big" feeling comes from the NUMBER of connected rooms, never from
 * huge empty ones. Authored via {@link MapBuilder} (world coords); winding rule: a linedef's `front` is the
 * sector to the RIGHT of `v1 → v2` — each room wound so its interior stays on the right. Shared edges ONCE.
 *
 * Built INCREMENTALLY (this is the dense core; more rooms land in later passes):
 *
 *   VESTIBULE [spawn, z0, octagon] ──GRAND STAIRCASE (5 steps, z0 → +2.0)──▶ THRESHOLD DOOR (unlocked)
 *      ──▶ RECEPTION HALL (HUB, z+2.0, tight octagon: raised DESK island +2.6 + 2 columns) [temp exit here]
 *
 * y increases DOWN. Organic geometry throughout (octagons + chamfers + a real stair run); NO boxy rooms.
 */

/** A straight flight of `n` steps climbing NORTH (−y) in the corridor x∈[xW,xE], from its south edge at
 *  `ySouth` upward, each step `depth` deep and rising `dz` (floor `zBase + (i+1)·dz`) under a flat `ceilZ`.
 *  Emits the inter-step portals + the two side walls per step; the CALLER portals the flight's south end
 *  (to the room below) and north end (to the room above). Returns the step sector indices, south→north. */
function stairNorth(
  b: MapBuilder,
  xW: number,
  xE: number,
  ySouth: number,
  depth: number,
  n: number,
  zBase: number,
  dz: number,
  ceilZ: number,
  light: number,
  wallTex: string,
): number[] {
  const secs: number[] = [];

  for (let i = 0; i < n; i++) {
    const yS = ySouth - i * depth; // this step's south edge
    const yN = ySouth - (i + 1) * depth; // its north edge
    const s = b.sector({
      floorZ: +(zBase + (i + 1) * dz).toFixed(2),
      ceilZ,
      floorTex: 'STEP',
      ceilTex: 'CONCRETE',
      light,
    });

    secs.push(s);
    b.solid(xW, yN, xW, yS, s, wallTex); // west edge (+y): interior east
    b.solid(xE, yS, xE, yN, s, wallTex); // east edge (−y): interior west
    if (i > 0) {
      b.portal(xE, yS, xW, yS, secs[i - 1], s, wallTex); // shared step edge (front = the lower step, to the south)
    }
  }

  return secs;
}

/** A floor-to-ceiling COLUMN — a small rectangular solid pillar (a hole in `room`, walls fronting the room
 *  on the OUTSIDE). Cover + sightline-breaker. `(x1,y1)` is the NW corner, `(x2,y2)` the SE. */
function column(
  b: MapBuilder,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  room: number,
  tex: string,
): void {
  b.solid(x1, y1, x2, y1, room, tex); // north (room to the north)
  b.solid(x2, y1, x2, y2, room, tex); // east
  b.solid(x2, y2, x1, y2, room, tex); // south
  b.solid(x1, y2, x1, y1, room, tex); // west
}

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new MapBuilder();

  // --- sectors ------------------------------------------------------------------------------------
  const VEST = b.sector({
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'LOBBY_FLOOR',
    ceilTex: 'CONCRETE',
    light: 202,
  }); // octagon spawn
  const STEP = stairNorth(b, 20, 28, 100, 6, 5, 0, 0.4, 5.6, 216, 'LOBBY'); // grand staircase z0.4..2.0, y100→70
  const DOOR = b.sector({
    floorZ: 2.0,
    ceilZ: 5.0,
    floorTex: 'LOBBY_FLOOR',
    ceilTex: 'CEIL',
    light: 230,
  }); // unlocked threshold
  const HALL = b.sector({
    floorZ: 2.0,
    ceilZ: 7,
    floorTex: 'LOBBY_FLOOR',
    ceilTex: 'CEIL',
    light: 244,
  }); // reception hub (tight octagon)
  const DESK = b.sector({ floorZ: 2.6, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 244 }); // raised desk island (mantle cover)
  const PORCH = b.sector({
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'LOBBY_FLOOR',
    ceilTex: 'CEIL',
    light: 236,
  }); // glass-fronted entry ATRIUM (spawn), 8 tall — matches the exterior so the full city backdrop shows
  const ENTR = b.sector({
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'LOBBY_FLOOR',
    ceilTex: 'CEIL',
    light: 236,
  }); // automatic sliding glass entrance door
  const EXT = b.sector({
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
  }); // shallow exterior box (0..8, aligned to TEX_ANCHOR 64); its far wall carries the CITY backdrop, shown once

  // --- VESTIBULE octagon (interior on the right, clockwise from the west-top vertex) ---------------
  b.solid(14, 106, 14, 114, VEST, 'LOBBY'); // west
  b.solid(14, 114, 20, 120, VEST, 'GLASS_INT'); // SW chamfer — window
  b.portal(20, 120, 28, 120, VEST, ENTR, 'GLASS_INT'); // vestibule ↔ automatic glass entrance door
  b.solid(28, 120, 34, 114, VEST, 'GLASS_INT'); // SE chamfer — window
  b.solid(34, 114, 34, 106, VEST, 'LOBBY'); // east
  b.solid(34, 106, 28, 100, VEST, 'LOBBY'); // NE chamfer
  b.solid(20, 100, 14, 106, VEST, 'LOBBY'); // NW chamfer
  b.portal(28, 100, 20, 100, VEST, STEP[0], 'LOBBY'); // vestibule ↔ step 0 (the staircase mouth)

  // --- automatic glass ENTRANCE door (ENTR, x20..28 y120..124) -------------------------------------
  b.solid(20, 120, 20, 124, ENTR, 'GLASS_INT'); // west
  b.solid(28, 124, 28, 120, ENTR, 'GLASS_INT'); // east
  b.slidingDoor(20, 124, 28, 124, ENTR, PORCH, 'GLASS_INT'); // automatic SLIDING GLASS entrance (porch → interior)

  // --- glass-fronted PORCH octagon (spawn, x16..32 y124..138) — the frontage windows ---------------
  b.solid(16, 130, 16, 134, PORCH, 'GLASS_INT'); // west window
  b.solid(16, 134, 20, 138, PORCH, 'GLASS_INT'); // SW window
  b.glass(20, 138, 28, 138, PORCH, EXT, 'GLASS_INT'); // south — SEE-THROUGH window onto the courtyard
  b.solid(28, 138, 32, 134, PORCH, 'GLASS_INT'); // SE window
  b.solid(32, 134, 32, 130, PORCH, 'GLASS_INT'); // east window
  b.solid(32, 130, 28, 124, PORCH, 'GLASS_INT'); // NE window
  b.solid(20, 124, 16, 130, PORCH, 'GLASS_INT'); // NW window

  // --- EXTERIOR (EXT) — window-width box (x20..28, y138..142) behind the frontage glass -------------------
  b.solid(20, 138, 20, 142, EXT, 'GLASS_INT'); // west reveal
  b.solid(20, 142, 28, 142, EXT, 'CITY'); // FAR WALL — cityscape, ONE clean copy (8 wide × 8 tall, worldSize 8, aligned)
  b.solid(28, 142, 28, 138, EXT, 'GLASS_INT'); // east reveal

  // --- staircase → threshold door (flight north end at y70) ----------------------------------------
  b.portal(20, 70, 28, 70, DOOR, STEP[4]); // door ↔ top step (front = door, north)

  // --- THRESHOLD DOOR slab (x20..28, y68..70) -----------------------------------------------------
  b.solid(20, 68, 20, 70, DOOR, 'GLASS_INT'); // west
  b.solid(28, 70, 28, 68, DOOR, 'GLASS_INT'); // east
  b.portal(28, 68, 20, 68, DOOR, HALL, 'GLASS_INT'); // door ↔ hall (front = door, south)

  // --- RECEPTION HALL — tight chamfered octagon (x10..42, y34..68), interior on the right ----------
  b.solid(10, 42, 10, 60, HALL, 'LOBBY'); // west
  b.solid(10, 60, 18, 68, HALL, 'LOBBY'); // SW chamfer
  b.solid(18, 68, 20, 68, HALL, 'LOBBY'); // south-left (to the door mouth)
  b.solid(28, 68, 34, 68, HALL, 'LOBBY'); // south-right (past the door mouth)
  b.solid(34, 68, 42, 60, HALL, 'LOBBY'); // SE chamfer
  b.solid(42, 60, 42, 42, HALL, 'GLASS_INT'); // east — interior glass wall
  b.solid(42, 42, 34, 34, HALL, 'BRICK'); // NE chamfer
  b.solid(34, 34, 18, 34, HALL, 'BRICK'); // north
  b.solid(18, 34, 10, 42, HALL, 'BRICK'); // NW chamfer

  // --- DESK island (raised +2.6, mantle cover) — 4 portal edges to the hall ------------------------
  b.portal(22, 47, 22, 55, DESK, HALL); // west
  b.portal(22, 55, 30, 55, DESK, HALL); // south
  b.portal(30, 55, 30, 47, DESK, HALL); // east
  b.portal(30, 47, 22, 47, DESK, HALL); // north

  // --- 2 COLUMNS (cover + sightline-breakers) -----------------------------------------------------
  column(b, 15, 42, 18, 45, HALL, 'PILLAR');
  column(b, 33, 57, 36, 60, HALL, 'PILLAR');

  // --- things -------------------------------------------------------------------------------------
  b.thing(24, 131, Math.PI * 1.5, 'player_start'); // porch, facing north through the glass doors into the lobby
  b.thing(26, 44, 0, 'barrel'); // hall — behind the desk
  b.thing(14, 55, 0, 'barrel'); // hall — west cover
  b.thing(38, 48, 0, 'barrel'); // hall — east cover

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

/** "M1 — Lobby / Accueil" (episode opener). INCREMENT 1 = a tight, dense vertical spine; more rooms to come. */
export const M1_LOBBY: Level = {
  map: built.map,
  spawn: { x: 24, y: 131, angle: Math.PI * 1.5 },
  enemies: [
    { spec: PINKY_SPEC, x: 24, y: 104 }, // vestibule ambush
    { spec: PINKY_SPEC, x: 16, y: 40 }, // hall — west rush
    { spec: PINKY_SPEC, x: 36, y: 52 }, // hall — east rush
    { spec: IMP_SPEC, x: 26, y: 38 }, // hall — lobbing from behind the desk/north
    { spec: SHOTGUNGUY_SPEC, x: 38, y: 40 }, // hall — holding the NE corner
  ],
  health: [
    [24, 116, 'small'], // vestibule
    [12, 45], // hall — west
  ],
  armor: [[40, 58, 'small']], // hall — SE corner
  ammo: [
    [24, 108], // staples — vestibule
    [22, 88], // nails — staircase
    [26, 51], // canisters — on the desk island
    [14, 62], // cells — hall SW
    [40, 44], // batteries — hall NE
    [24, 118], // server-cell — vestibule (temp)
  ],
  keycards: [], // keyless floor (like E1M1)
  exit: [26, 40], // TEMP: north of the desk, until the atrium/elevator exist
  doors: [
    { sector: built.doorSector, triggerX: 24, triggerY: 69, requiresCard: null }, // glass threshold into the hall
    // (the porch entrance is now an automatic SLIDING GLASS door — proximity-driven, not a doors[] entry)
  ],
};
