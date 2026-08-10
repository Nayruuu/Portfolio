import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from '../enemy';
import { MapBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';

// L1 "Hangar" — a large original techbase with an ORIGINAL SPIRAL STAIRCASE. Winding: `front` = the sector
// to the RIGHT of v1→v2 (right of `(dx,dy)` is `(dy,-dx)`); shared edges emitted ONCE as portals. The
// spiral is a stack of 7 wedge sectors on two concentric rings around a solid column; the ring is left
// OPEN ~38° (a "spine" gap) so the top step (z2.7) and bottom step (z0) never touch — a portal there would
// let the player fall straight down.

const TWR = {
  cx: 82,
  cy: 38,
  ri: 1.7,
  ro: 5.0,
  steps: 7,
  a0: (243 * Math.PI) / 180,
  dA: ((322 / 7) * Math.PI) / 180,
  rise: 0.45,
} as const;

/** A point on ring `r` at radial index `i`, rounded so shared endpoints coincide exactly (the builder
 *  matches vertices by value). */
function ring(r: number, i: number): readonly [number, number] {
  const a = TWR.a0 + i * TWR.dA;
  const round = (n: number): number => Math.round(n * 100) / 100;

  return [round(TWR.cx + r * Math.cos(a)), round(TWR.cy + r * Math.sin(a))];
}

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new MapBuilder();

  const SAS = b.sector({ floorZ: 0, ceilZ: 3.4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 176 });
  const COR1 = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 158 });
  const HUB = b.sector({ floorZ: 0, ceilZ: 6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 214 });
  const CORN = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 168 });
  const CAFE = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 198 });
  const CORS = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 150 });
  const SRV = b.sector({ floorZ: 0.3, ceilZ: 4.5, floorTex: 'STEP', ceilTex: 'CEIL', light: 124 });
  const LAND = b.sector({ floorZ: 0, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 150 });
  const BALC = b.sector({ floorZ: 3.15, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 236 });
  const SLIME = b.sector({
    floorZ: -1.4,
    ceilZ: 5,
    floorTex: 'METAL',
    ceilTex: 'CEIL',
    light: 110,
  });
  const WALK = b.sector({ floorZ: 0, ceilZ: 5, floorTex: 'STEP', ceilTex: 'CEIL', light: 184 });
  const STORE = b.sector({ floorZ: 0, ceilZ: 3.6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 142 });
  const DOOR = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 188 });
  const OUT = b.sector({
    floorZ: -1.0,
    ceilZ: 4.6,
    floorTex: 'METAL',
    ceilTex: 'CEIL',
    light: 205,
  });
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

  // shared edges (each emitted ONCE as a portal; front = sector on the right of v1→v2)
  b.portal(22, 47, 22, 51, COR1, SAS);
  b.portal(30, 47, 30, 51, HUB, COR1);
  b.portal(40, 32, 46, 32, CORN, HUB);
  b.portal(40, 28, 46, 28, CAFE, CORN);
  b.portal(50, 22, 50, 16, CAFE, CORS);
  b.portal(54, 16, 54, 22, SRV, CORS);
  b.portal(58, 48, 58, 36, HUB, BALC); // the OVERLOOK ledge (3.15 drop, unclimbable from below)
  b.portal(54, 64, 58, 64, HUB, WALK);
  b.portal(40, 64, 46, 64, HUB, DOOR);
  b.portal(46, 68, 40, 68, OUT, DOOR);

  // SPIRAL — inner edges front the central column (solid); radials between wedges are walkable +rise
  // portals; outer edges are the tower wall except the entry (bottom wedge) and exit (top wedge).
  for (let i = 0; i < TWR.steps; i++) {
    const inA = ring(TWR.ri, i);
    const inB = ring(TWR.ri, i + 1);

    b.solid(inA[0], inA[1], inB[0], inB[1], W[i]);
    if (i < TWR.steps - 1) {
      const inNext = ring(TWR.ri, i + 1);
      const outNext = ring(TWR.ro, i + 1);

      b.portal(inNext[0], inNext[1], outNext[0], outNext[1], W[i], W[i + 1]);
    }
  }
  for (let i = 1; i < TWR.steps - 1; i++) {
    const outA = ring(TWR.ro, i);
    const outB = ring(TWR.ro, i + 1);

    b.solid(outB[0], outB[1], outA[0], outA[1], W[i]);
  }
  const out0 = ring(TWR.ro, 0);
  const out1 = ring(TWR.ro, 1);
  const outN1 = ring(TWR.ro, TWR.steps - 1);
  const outN = ring(TWR.ro, TWR.steps);
  const in0 = ring(TWR.ri, 0);
  const inN = ring(TWR.ri, TWR.steps);

  b.solid(out0[0], out0[1], in0[0], in0[1], W[0]); // spine walls cap the OPEN ring gap (else a fall-through)
  b.solid(inN[0], inN[1], outN[0], outN[1], W[TWR.steps - 1]);
  b.portal(out1[0], out1[1], out0[0], out0[1], W[0], LAND);
  b.portal(outN[0], outN[1], outN1[0], outN1[1], W[TWR.steps - 1], BALC);

  // ZIGZAG CATWALK — a raised island (z0, front = WALK) threading the sunken SLIME (−1.4); neck edges to
  // hub/storage are solid, the rest portal onto the slime (dip for the armour, mantle back up).
  b.solid(54, 64, 54, 66, WALK);
  b.portal(54, 66, 54, 74, WALK, SLIME);
  b.portal(54, 74, 70, 74, WALK, SLIME);
  b.portal(70, 74, 70, 82, WALK, SLIME);
  b.solid(70, 82, 70, 84, WALK);
  b.portal(70, 84, 74, 84, WALK, STORE);
  b.solid(74, 84, 74, 82, WALK);
  b.portal(74, 82, 74, 70, WALK, SLIME);
  b.portal(74, 70, 58, 70, WALK, SLIME);
  b.portal(58, 70, 58, 66, WALK, SLIME);
  b.solid(58, 66, 58, 64, WALK);

  // one-sided walls (interior on the right)
  b.solid(10, 40, 6, 44, SAS);
  b.solid(6, 44, 6, 52, SAS);
  b.solid(6, 52, 10, 56, SAS);
  b.solid(10, 56, 22, 56, SAS);
  b.solid(22, 56, 22, 51, SAS);
  b.solid(22, 47, 22, 40, SAS);
  b.solid(22, 40, 10, 40, SAS);
  b.solid(30, 47, 22, 47, COR1);
  b.solid(22, 51, 30, 51, COR1);
  b.solid(36, 32, 30, 38, HUB);
  b.solid(30, 38, 30, 47, HUB);
  b.solid(30, 51, 30, 58, HUB);
  b.solid(30, 58, 36, 64, HUB);
  b.solid(36, 64, 40, 64, HUB);
  b.solid(46, 64, 54, 64, HUB);
  b.solid(58, 64, 58, 48, HUB);
  b.solid(58, 36, 52, 32, HUB);
  b.solid(52, 32, 46, 32, HUB);
  b.solid(40, 32, 36, 32, HUB);
  b.solid(46, 32, 46, 28, CORN);
  b.solid(40, 28, 40, 32, CORN);
  b.solid(26, 8, 26, 28, CAFE);
  b.solid(26, 28, 40, 28, CAFE);
  b.solid(46, 28, 50, 28, CAFE);
  b.solid(50, 28, 50, 22, CAFE);
  b.solid(50, 16, 50, 8, CAFE);
  b.solid(50, 8, 26, 8, CAFE);
  b.solid(54, 16, 50, 16, CORS);
  b.solid(50, 22, 54, 22, CORS);
  b.solid(54, 8, 54, 16, SRV);
  b.solid(54, 22, 54, 32, SRV);
  b.solid(54, 32, out0[0], 32, SRV);
  b.solid(out1[0], 32, 92, 32, SRV);
  b.solid(92, 32, 92, 8, SRV);
  b.solid(92, 8, 54, 8, SRV);
  b.solid(out0[0], 32, out0[0], out0[1], LAND);
  b.solid(out1[0], out1[1], out1[0], 32, LAND);
  b.portal(out1[0], 32, out0[0], 32, LAND, SRV);
  b.solid(58, 34, 58, 36, BALC);
  b.solid(58, 48, 72, 50, BALC);
  b.solid(72, 50, outN1[0], outN1[1], BALC);
  b.solid(outN[0], outN[1], 70, 32, BALC);
  b.solid(70, 32, 58, 34, BALC);
  b.solid(52, 66, 52, 82, SLIME);
  b.solid(52, 82, 70, 82, SLIME);
  b.solid(74, 82, 82, 82, SLIME);
  b.solid(82, 82, 82, 66, SLIME);
  b.solid(82, 66, 58, 66, SLIME);
  b.solid(54, 66, 52, 66, SLIME);
  b.solid(70, 84, 60, 86, STORE);
  b.solid(60, 86, 60, 94, STORE);
  b.solid(60, 94, 66, 96, STORE);
  b.solid(66, 96, 76, 96, STORE);
  b.solid(76, 96, 82, 94, STORE);
  b.solid(82, 94, 82, 86, STORE);
  b.solid(82, 86, 74, 84, STORE);
  b.solid(40, 64, 40, 68, DOOR);
  b.solid(46, 68, 46, 64, DOOR);
  b.solid(40, 68, 28, 68, OUT);
  b.solid(28, 68, 28, 80, OUT);
  b.solid(28, 80, 34, 84, OUT);
  b.solid(34, 84, 44, 84, OUT);
  b.solid(44, 84, 48, 80, OUT);
  b.solid(48, 80, 48, 68, OUT);
  b.solid(48, 68, 46, 68, OUT);

  b.thing(12, 48, 0, 'player_start');
  b.thing(44, 48, 0, 'barrel');
  b.thing(40, 20, 0, 'barrel');
  b.thing(72, 18, 0, 'barrel');
  b.thing(56, 72, 0, 'barrel');
  b.thing(71, 90, 0, 'barrel');
  b.thing(36, 82, 0, 'barrel');

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

export const HANGAR: Level = {
  map: built.map,
  spawn: { x: 12, y: 48, angle: 0 },
  enemies: [
    { spec: IMP_SPEC, x: 42, y: 46 },
    { spec: IMP_SPEC, x: 36, y: 22 },
    { spec: SHOTGUNGUY_SPEC, x: 74, y: 16 },
    { spec: PINKY_SPEC, x: 57, y: 71 },
    { spec: LOSTSOUL_SPEC, x: 64, y: 76 },
    { spec: SHOTGUNGUY_SPEC, x: 64, y: 44 },
    { spec: LOSTSOUL_SPEC, x: 72, y: 38 },
    { spec: IMP_SPEC, x: 36, y: 78 },
  ],
  health: [
    [12, 52],
    [34, 18, 'small'],
    [40, 78],
  ],
  armor: [
    [60, 76],
    [44, 50, 'small'],
  ],
  ammo: [
    [44, 52], // staples
    [34, 26], // nails
    [74, 22], // canisters
    [56, 68], // cells
    [68, 42], // batteries
    [70, 90], // server cell (BFG)
  ],
  weapons: [
    [12, 50, 'pistol'],
    [13, 52, 'shotgun'],
  ],
  keycards: [[70, 42, 'red']], // on the balcony (+3.15)
  exit: [38, 80],
  doors: [{ sector: built.doorSector, triggerX: 43, triggerY: 62, requiresCard: 'red' }],
};
