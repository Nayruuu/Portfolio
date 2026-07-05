import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from './enemies';
import { MapBuilder } from './level-builder';
import type { MapSource } from '../../core/lib/bsp-engine';
import type { Level } from './level-accueil';

/**
 * L1 "Hangar" — a LARGE original techbase for OPEN SPACE.EXE: a multi-room open-space the player explores for
 * several minutes. The geometry is my own; it evokes the classic techbase BEATS (small start → branching hub →
 * hazard crossing → key gate → gated exit) plus a verticality showcase — an ORIGINAL SPIRAL STAIRCASE — without
 * reproducing any real map. The flow is a big LOOP with side branches:
 *
 *   SAS [spawn] ──cor── HUB (open-space, organic octagon — the heart, ground tier z0)
 *      ├─ N  → CAFÉ (break area, health)  ─E→ SERVER ROOM (raised, cold, ambush)
 *      │                                       └─S→ STAIR LANDING ─▶ ESCALIER EN COLIMAÇON
 *      │                                          (7 wedge steps winding ~322° up a central column, +0.45/step,
 *      │                                           z0 → z3.15) ─▶ BALCONY (upper tier, overlooks the hub)
 *      │                                                              the access BADGE sits here, sniper-guarded;
 *      │                                                              its WEST edge is an OVERLOOK over the hub — a
 *      │                                                              3.15 drop: hop down, never climb back up.
 *      ├─ SE → SLIME PIT (sunken −1.4 hazard) crossed by a ZIGZAG CATWALK (z0) ─▶ STORAGE (ammo, barrels)
 *      └─ S  → badge-locked DOOR ══▶ SORTIE (sunken −1.0 hall, the EXIT)
 *
 * Heights lean on the BSP engine throughout: the spiral's per-step rises, the −1.4 slime hazard (mantle back
 * out), the +3.15 balcony overlook (unclimbable from the hub), the raised server floor, the −1.0 sortie.
 * Authored via {@link MapBuilder} (world coordinates). Winding: `front` = the sector to the RIGHT of `v1 → v2`
 * (right of `(dx,dy)` is `(dy,-dx)`); each room is wound so its interior stays on the right. Shared edges are
 * emitted ONCE as portals.
 *
 * THE SPIRAL is the highest-value geometry: a stack of 7 small wedge sectors on two concentric rings around a
 * solid central column. Each wedge fronts its inner column edge (solid) and shares a radial PORTAL with the next
 * wedge (a +0.45 step — walkable). The ring is left OPEN ~38° (a "spine" gap) so the top step (z2.7) and the
 * bottom step (z0) never touch — a portal there would let the player fall straight down. The bottom wedge's
 * outer edge is the entry (from the stair landing); the top wedge's outer edge exits onto the balcony.
 */

// --- spiral tower parameters (the escalier en colimaçon) ----------------------------------------------
const TWR = {
  cx: 82, // tower centre
  cy: 38,
  ri: 1.7, // inner ring radius (the central column)
  ro: 5.0, // outer ring radius (the tower wall)
  steps: 7, // wedge steps
  a0: (243 * Math.PI) / 180, // first radial angle (entry faces north, exit faces west toward the hub)
  dA: ((322 / 7) * Math.PI) / 180, // angular span per wedge (322° total → ~38° open spine gap)
  rise: 0.45, // floor rise per step (walkable, ≤ STEP_MAX)
} as const;

/** A point on one of the tower's two rings at radial index `i`, rounded so shared endpoints coincide exactly. */
function ring(r: number, i: number): readonly [number, number] {
  const a = TWR.a0 + i * TWR.dA;
  const round = (n: number): number => Math.round(n * 100) / 100;

  return [round(TWR.cx + r * Math.cos(a)), round(TWR.cy + r * Math.sin(a))];
}

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new MapBuilder();

  // --- sectors (indices follow declaration order) -------------------------------------------------
  const SAS = b.sector({ floorZ: 0, ceilZ: 3.4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 176 }); // 0 start sas
  const COR1 = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 158 }); // 1 sas→hub
  const HUB = b.sector({ floorZ: 0, ceilZ: 6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 214 }); // 2 open-space hub
  const CORN = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 168 }); // 3 hub→café neck
  const CAFE = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 198 }); // 4 break area (health)
  const CORS = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 150 }); // 5 café→server neck
  const SRV = b.sector({ floorZ: 0.3, ceilZ: 4.5, floorTex: 'STEP', ceilTex: 'CEIL', light: 124 }); // 6 server (raised, cold)
  const LAND = b.sector({ floorZ: 0, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 150 }); // 7 stair landing
  const BALC = b.sector({ floorZ: 3.15, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 236 }); // 8 balcony (overlook)
  const SLIME = b.sector({
    floorZ: -1.4,
    ceilZ: 5,
    floorTex: 'METAL',
    ceilTex: 'CEIL',
    light: 110,
  }); // 9 sunken hazard
  const WALK = b.sector({ floorZ: 0, ceilZ: 5, floorTex: 'STEP', ceilTex: 'CEIL', light: 184 }); // 10 zigzag catwalk
  const STORE = b.sector({ floorZ: 0, ceilZ: 3.6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 142 }); // 11 storage (ammo)
  const DOOR = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 188 }); // 12 badge-locked door
  const OUT = b.sector({
    floorZ: -1.0,
    ceilZ: 4.6,
    floorTex: 'METAL',
    ceilTex: 'CEIL',
    light: 205,
  }); // 13 sortie (exit)
  // Spiral wedge steps (indices 15..21): floorZ climbs +rise per step under a flat open ceiling (so the radial
  // portals always clear HEADROOM); the light brightens as you climb toward the balcony.
  const W: number[] = [];

  for (let i = 0; i < TWR.steps; i++) {
    W.push(
      b.sector({
        floorZ: +(i * TWR.rise).toFixed(2),
        ceilZ: 7,
        floorTex: 'STEP',
        ceilTex: 'CEIL',
        light: 168 + i * 10,
      }),
    );
  }

  // --- shared edges (each emitted ONCE as a portal; front = sector on the right of v1→v2) ---------
  b.portal(22, 47, 22, 51, COR1, SAS); // sas ↔ corridor
  b.portal(30, 47, 30, 51, HUB, COR1); // corridor ↔ hub
  b.portal(40, 32, 46, 32, CORN, HUB); // hub ↔ café-neck (north)
  b.portal(40, 28, 46, 28, CAFE, CORN); // café-neck ↔ café
  b.portal(50, 22, 50, 16, CAFE, CORS); // café ↔ server-neck (west)
  b.portal(54, 16, 54, 22, SRV, CORS); // server-neck ↔ server
  b.portal(58, 48, 58, 36, HUB, BALC); // hub ↔ balcony — the OVERLOOK ledge (3.15 drop, unclimbable from below)
  b.portal(54, 64, 58, 64, HUB, WALK); // hub ↔ catwalk (south doorway at the SE corner, both z0)
  b.portal(40, 64, 46, 64, HUB, DOOR); // hub ↔ badge-locked door (south)
  b.portal(46, 68, 40, 68, OUT, DOOR); // door ↔ sortie

  // SPIRAL — emit the wedge geometry. Inner edges face the central column (solid); radial edges between
  // consecutive wedges are walkable +rise PORTALS; outer edges are the tower wall (solid) except the entry
  // (bottom wedge → landing) and the exit (top wedge → balcony). The two "spine" radials cap the open gap.
  for (let i = 0; i < TWR.steps; i++) {
    const inA = ring(TWR.ri, i);
    const inB = ring(TWR.ri, i + 1);

    b.solid(inA[0], inA[1], inB[0], inB[1], W[i]); // inner column wall
    if (i < TWR.steps - 1) {
      const inNext = ring(TWR.ri, i + 1);
      const outNext = ring(TWR.ro, i + 1);

      b.portal(inNext[0], inNext[1], outNext[0], outNext[1], W[i], W[i + 1]); // radial step to the next wedge
    }
  }
  for (let i = 1; i < TWR.steps - 1; i++) {
    const outA = ring(TWR.ro, i);
    const outB = ring(TWR.ro, i + 1);

    b.solid(outB[0], outB[1], outA[0], outA[1], W[i]); // outer tower wall (middle wedges)
  }
  const out0 = ring(TWR.ro, 0);
  const out1 = ring(TWR.ro, 1);
  const outN1 = ring(TWR.ro, TWR.steps - 1);
  const outN = ring(TWR.ro, TWR.steps);
  const in0 = ring(TWR.ri, 0);
  const inN = ring(TWR.ri, TWR.steps);

  b.solid(out0[0], out0[1], in0[0], in0[1], W[0]); // bottom spine wall (caps the open ring)
  b.solid(inN[0], inN[1], outN[0], outN[1], W[TWR.steps - 1]); // top spine wall
  b.portal(out1[0], out1[1], out0[0], out0[1], W[0], LAND); // entry: landing → bottom wedge (both z0)
  b.portal(outN[0], outN[1], outN1[0], outN1[1], W[TWR.steps - 1], BALC); // exit: top wedge → balcony (+0.45)

  // ZIGZAG CATWALK — a raised island (z0) threading the sunken SLIME (−1.4), wound so the hazard flanks the
  // bridge (front = WALK). It is a Z: a short NECK down from the hub doorway, then a dogleg east, then a NECK
  // down to the storage doorway. The neck edges (between hub/storage and the slime) are solid; the rest portal
  // onto the slime so you can dip down for the armour and mantle back up.
  b.solid(54, 64, 54, 66, WALK); // hub-side neck (west)
  b.portal(54, 66, 54, 74, WALK, SLIME); // west flank
  b.portal(54, 74, 70, 74, WALK, SLIME); // dogleg underside
  b.portal(70, 74, 70, 82, WALK, SLIME); // east-arm flank (west)
  b.solid(70, 82, 70, 84, WALK); // storage-side neck (west)
  b.portal(70, 84, 74, 84, WALK, STORE); // storage doorway
  b.solid(74, 84, 74, 82, WALK); // storage-side neck (east)
  b.portal(74, 82, 74, 70, WALK, SLIME); // east-arm flank (east)
  b.portal(74, 70, 58, 70, WALK, SLIME); // dogleg topside
  b.portal(58, 70, 58, 66, WALK, SLIME); // east flank
  b.solid(58, 66, 58, 64, WALK); // hub-side neck (east)

  // --- one-sided walls (interior on the right) ----------------------------------------------------
  // SAS — a small chamfered start room (x6..22, y40..56), door east at y47..51
  b.solid(10, 40, 6, 44, SAS); // NW chamfer
  b.solid(6, 44, 6, 52, SAS);
  b.solid(6, 52, 10, 56, SAS); // SW chamfer
  b.solid(10, 56, 22, 56, SAS); // south wall
  b.solid(22, 56, 22, 51, SAS);
  b.solid(22, 47, 22, 40, SAS);
  b.solid(22, 40, 10, 40, SAS);
  // CORRIDOR sas→hub (x22..30, y47..51)
  b.solid(30, 47, 22, 47, COR1);
  b.solid(22, 51, 30, 51, COR1);
  // HUB — an organic octagon (x30..58, y32..64) with chamfers on three corners + a square SE; openings:
  // west(COR1), north(CAFÉ), east(BALCONY overlook), south(DOOR + catwalk).
  b.solid(36, 32, 30, 38, HUB); // NW chamfer
  b.solid(30, 38, 30, 47, HUB);
  b.solid(30, 51, 30, 58, HUB);
  b.solid(30, 58, 36, 64, HUB); // SW chamfer
  b.solid(36, 64, 40, 64, HUB); // south wall west of the door
  b.solid(46, 64, 54, 64, HUB); // south wall between the door and the catwalk doorway
  b.solid(58, 64, 58, 48, HUB); // east wall below the overlook ledge
  b.solid(58, 36, 52, 32, HUB); // NE chamfer
  b.solid(52, 32, 46, 32, HUB); // north wall east of the café-neck opening
  b.solid(40, 32, 36, 32, HUB); // north wall west of the café-neck opening
  // CAFÉ-NECK (hub→café, x40..46, y28..32) — a short doorway so the rooms only touch at the opening
  b.solid(46, 32, 46, 28, CORN); // east
  b.solid(40, 28, 40, 32, CORN); // west
  // CAFÉ break area (x26..50, y8..28) — break room with health; doorways south (hub-neck) and east (server-neck)
  b.solid(26, 8, 26, 28, CAFE); // west
  b.solid(26, 28, 40, 28, CAFE); // south wall west of the café-neck
  b.solid(46, 28, 50, 28, CAFE); // south wall east of the café-neck
  b.solid(50, 28, 50, 22, CAFE); // east wall below the server-neck
  b.solid(50, 16, 50, 8, CAFE); // east wall above the server-neck
  b.solid(50, 8, 26, 8, CAFE); // north
  // SERVER-NECK (café→server, x50..54, y16..22)
  b.solid(54, 16, 50, 16, CORS); // north
  b.solid(50, 22, 54, 22, CORS); // south
  // SERVER ROOM (x54..92, y8..32) — raised cold machine hall; west opens to the café-neck, south to the landing
  b.solid(54, 8, 54, 16, SRV); // west wall above the server-neck
  b.solid(54, 22, 54, 32, SRV); // west wall below the server-neck
  b.solid(54, 32, out0[0], 32, SRV); // south wall west of the landing
  b.solid(out1[0], 32, 92, 32, SRV); // south wall east of the landing
  b.solid(92, 32, 92, 8, SRV); // east
  b.solid(92, 8, 54, 8, SRV); // north
  // STAIR LANDING (the spiral entry — a small step box from the server south wall down to wedge 0's outer edge)
  b.solid(out0[0], 32, out0[0], out0[1], LAND); // west
  b.solid(out1[0], out1[1], out1[0], 32, LAND); // east
  b.portal(out1[0], 32, out0[0], 32, LAND, SRV); // north → server
  // BALCONY (upper z3.15) — a gallery west of the tower; its west edge overlooks the hub, its east edge is the
  // spiral exit. Wound so the interior stays on the right.
  b.solid(58, 34, 58, 36, BALC); // west wall above the overlook ledge
  b.solid(58, 48, 72, 50, BALC); // south wall (diagonal)
  b.solid(72, 50, outN1[0], outN1[1], BALC); // south-east toward the exit
  b.solid(outN[0], outN[1], 70, 32, BALC); // north-east from the exit
  b.solid(70, 32, 58, 34, BALC); // north wall (diagonal)
  // SLIME PIT — outer walls of the sunken hazard (x52..82, y66..82); the catwalk crosses it via two necks.
  b.solid(52, 66, 52, 82, SLIME); // west
  b.solid(52, 82, 70, 82, SLIME); // south wall west of the storage neck
  b.solid(74, 82, 82, 82, SLIME); // south wall east of the storage neck
  b.solid(82, 82, 82, 66, SLIME); // east
  b.solid(82, 66, 58, 66, SLIME); // north wall east of the hub neck
  b.solid(54, 66, 52, 66, SLIME); // north wall west of the hub neck
  // STORAGE (x60..82, y84..96) — across the catwalk; chamfered corners, barrels + the BFG-ammo nearby
  b.solid(70, 84, 60, 86, STORE); // NW back to the doorway
  b.solid(60, 86, 60, 94, STORE); // west
  b.solid(60, 94, 66, 96, STORE); // SW chamfer
  b.solid(66, 96, 76, 96, STORE); // south
  b.solid(76, 96, 82, 94, STORE); // SE chamfer
  b.solid(82, 94, 82, 86, STORE); // east
  b.solid(82, 86, 74, 84, STORE); // NE beside the catwalk doorway
  // DOOR slab (x40..46, y64..68)
  b.solid(40, 64, 40, 68, DOOR);
  b.solid(46, 68, 46, 64, DOOR);
  // SORTIE (x28..48, y68..84) — a sunken hall with chamfered south corners; the exit deep inside
  b.solid(40, 68, 28, 68, OUT); // north wall west of the door
  b.solid(28, 68, 28, 80, OUT); // west
  b.solid(28, 80, 34, 84, OUT); // SW chamfer
  b.solid(34, 84, 44, 84, OUT); // south
  b.solid(44, 84, 48, 80, OUT); // SE chamfer
  b.solid(48, 80, 48, 68, OUT); // east
  b.solid(48, 68, 46, 68, OUT); // north wall east of the door

  // --- things -------------------------------------------------------------------------------------
  b.thing(12, 48, 0, 'player_start');
  b.thing(44, 48, 0, 'barrel'); // hub cover
  b.thing(40, 20, 0, 'barrel'); // café cover
  b.thing(72, 18, 0, 'barrel'); // server cover
  b.thing(56, 72, 0, 'barrel'); // catwalk cover
  b.thing(71, 90, 0, 'barrel'); // storage cover
  b.thing(36, 82, 0, 'barrel'); // sortie cover

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

/** L1 "Hangar" — the played level (original techbase). */
export const HANGAR: Level = {
  map: built.map,
  spawn: { x: 12, y: 48, angle: 0 },
  enemies: [
    { spec: IMP_SPEC, x: 42, y: 46 }, // hub — first contact, a thrower in the open space
    { spec: IMP_SPEC, x: 36, y: 22 }, // café ambush
    { spec: SHOTGUNGUY_SPEC, x: 74, y: 16 }, // server room — guards the way to the stairs
    { spec: PINKY_SPEC, x: 57, y: 71 }, // catwalk — rushes you on the bridge
    { spec: LOSTSOUL_SPEC, x: 64, y: 76 }, // slime — fast ambush down in the hazard
    { spec: SHOTGUNGUY_SPEC, x: 64, y: 44 }, // balcony sniper — guards the badge
    { spec: LOSTSOUL_SPEC, x: 72, y: 38 }, // balcony — second guard near the stair head
    { spec: IMP_SPEC, x: 36, y: 78 }, // sortie
  ],
  health: [
    [12, 52], // sas — near spawn (medkit, large)
    [34, 18, 'small'], // café break area (desk plant, small)
    [40, 78], // sortie (medkit, large)
  ],
  armor: [
    [60, 76], // down in the slime pit — risk/reward dip off the catwalk (figurine, large)
    [44, 50, 'small'], // hub — a quick mental top-up (morale card, small)
  ],
  ammo: [
    [44, 52], // staples — hub
    [34, 26], // nails — café
    [74, 22], // canisters (Hilti box) — server
    [56, 68], // cells — catwalk
    [68, 42], // batteries — balcony (badge area)
    [70, 90], // server cell (BFG) — storage, the deep reward
  ],
  weapons: [
    // Standalone dev level (fists-only start): the base ranged pair sits right on the spawn corridor.
    [12, 50, 'pistol'],
    [13, 52, 'shotgun'], // beside the sas medkit
  ],
  keycards: [[70, 42, 'red']], // on the balcony (+3.15), sniper-guarded
  // Self-contained since M2 took the M1 seam slot: no graph edges, just the classic win flow.
  exit: [38, 80], // deep in the sunken sortie (−1.0)
  doors: [{ sector: built.doorSector, triggerX: 43, triggerY: 62, requiresCard: 'red' }],
};
