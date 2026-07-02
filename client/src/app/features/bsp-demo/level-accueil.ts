import type { EnemySpec } from './enemies';
import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from './enemies';
import { MapBuilder } from './level-builder';
import type { KeycardColor } from '../../core/lib';
import type { MapSource } from '../../core/lib/bsp-engine';

/**
 * L1 "Accueil" — the first HAND-AUTHORED campaign level (office-satire reception → climax), replacing the
 * engine-showcase `demo-map.ts` as a worked example. Flow follows the classic techbase beats: start small → open up → branch
 * for the key → locked door → octagonal climax.
 *
 *   réception [spawn] ──corridor── LOBBY (open-space, first fight)
 *                                    │ corridor (north)
 *                                    ▼
 *                                  CUBICLES — the access BADGE sits on a raised DAIS (auto-mantle up), guarded
 *                                    │
 *                       (badge) ─────┘
 *   LOBBY ══ locked DOOR (badge) ══▶ ATRIUM — octagonal sunken hall (45° walls, a step down), the EXIT inside.
 *
 * Heights lean into the BSP engine: the badge dais is a +1.6 mantle ledge, the atrium a −0.8 sunken step.
 * Authored via {@link MapBuilder} (coordinates, not vertex indices); winding rule: `front` = sector to the
 * RIGHT of `v1 → v2`. Shared edges are emitted ONCE as portals.
 */

/** A self-contained playable level: geometry + every entity placement the demo component stamps. */
export interface Level {
  readonly map: MapSource;
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number };
  readonly enemies: readonly { readonly spec: EnemySpec; readonly x: number; readonly y: number }[];
  // health / mental(armor) pickups — `[x, y]` (large by default) or `[x, y, 'small']` for the small variant.
  readonly health: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly armor: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly ammo: readonly (readonly [number, number])[]; // one coordinate per AMMO_BOX_SPECS entry, in order
  // access badges — `[x, y, color]`; each z is resolved from the floor it sits on (e.g. the dais, +1.6).
  readonly keycards: readonly (readonly [number, number, KeycardColor])[];
  readonly exit: readonly [number, number]; // z resolved from the floor (the atrium, −0.8)
  // animated doors — open on approach (a null `requiresCard` = an automatic/unlocked door; a colour = badge-gated).
  readonly doors: readonly {
    readonly sector: number;
    readonly triggerX: number;
    readonly triggerY: number;
    readonly requiresCard: KeycardColor | null; // the badge colour the door needs (null = automatic, no badge)
  }[];
}

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new MapBuilder();

  // --- sectors (indices are the order of declaration) ---------------------------------------------
  const R = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 }); // 0 reception
  const LOBBY = b.sector({ floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 212 }); // 1 hub
  const CRL = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 180 }); // 2 réception→lobby
  const CLC = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 180 }); // 3 lobby→cubicles
  const CUB = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 198 }); // 4 cubicles
  const KD = b.sector({ floorZ: 1.6, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 228 }); // 5 badge dais (mantle)
  const DOOR = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 190 }); // 6 locked door (animated ceil)
  const ATR = b.sector({ floorZ: -0.8, ceilZ: 6, floorTex: 'METAL', ceilTex: 'CEIL', light: 232 }); // 7 octagonal atrium

  // --- shared edges (each emitted ONCE as a portal; front = sector on the right of v1→v2) ---------
  b.portal(14, 9, 14, 6, R, CRL); // réception ↔ corridor
  b.portal(18, 9, 18, 6, CRL, LOBBY); // corridor ↔ lobby
  b.portal(22, 16, 26, 16, LOBBY, CLC); // lobby ↔ north corridor
  b.portal(22, 20, 26, 20, CLC, CUB); // north corridor ↔ cubicles
  b.portal(32, 11, 32, 8, LOBBY, DOOR); // lobby ↔ door (west face)
  b.portal(34, 8, 34, 11, ATR, DOOR); // door ↔ atrium (east face)
  // badge dais — a raised island in the cubicles (4 edges, DAIS higher, wound so the dais is on the right)
  b.portal(23, 25, 23, 29, KD, CUB);
  b.portal(23, 29, 27, 29, KD, CUB);
  b.portal(27, 29, 27, 25, KD, CUB);
  b.portal(27, 25, 23, 25, KD, CUB);

  // --- one-sided walls (interior on the right) ----------------------------------------------------
  // RÉCEPTION (x2..14, y2..12)
  b.solid(2, 2, 2, 12, R);
  b.solid(2, 12, 14, 12, R);
  b.solid(14, 12, 14, 9, R);
  b.solid(14, 6, 14, 2, R);
  b.solid(14, 2, 2, 2, R);
  // CORRIDOR réception→lobby (x14..18, y6..9)
  b.solid(14, 9, 18, 9, CRL);
  b.solid(18, 6, 14, 6, CRL);
  // LOBBY (x18..32, y2..16)
  b.solid(18, 2, 18, 6, LOBBY);
  b.solid(18, 9, 18, 16, LOBBY);
  b.solid(18, 16, 22, 16, LOBBY);
  b.solid(26, 16, 32, 16, LOBBY);
  b.solid(32, 16, 32, 11, LOBBY);
  b.solid(32, 8, 32, 2, LOBBY);
  b.solid(32, 2, 18, 2, LOBBY);
  // CORRIDOR lobby→cubicles (x22..26, y16..20)
  b.solid(22, 16, 22, 20, CLC);
  b.solid(26, 20, 26, 16, CLC);
  // CUBICLES (x18..32, y20..32)
  b.solid(32, 20, 26, 20, CUB);
  b.solid(22, 20, 18, 20, CUB);
  b.solid(18, 20, 18, 32, CUB);
  b.solid(18, 32, 32, 32, CUB);
  b.solid(32, 32, 32, 20, CUB);
  // DOOR slab (x32..34, y8..11)
  b.solid(32, 11, 34, 11, DOOR);
  b.solid(34, 8, 32, 8, DOOR);
  // ATRIUM — an axis-aligned octagon (the west edge carries the door portal)
  b.solid(34, 6, 34, 8, ATR);
  b.solid(34, 11, 34, 12, ATR);
  b.solid(34, 12, 39, 17, ATR);
  b.solid(39, 17, 49, 17, ATR);
  b.solid(49, 17, 54, 12, ATR);
  b.solid(54, 12, 54, 6, ATR);
  b.solid(54, 6, 49, 1, ATR);
  b.solid(49, 1, 39, 1, ATR);
  b.solid(39, 1, 34, 6, ATR);

  // --- things -------------------------------------------------------------------------------------
  b.thing(5, 7, 0, 'player_start');
  b.thing(28, 4, 0, 'barrel'); // lobby cover
  b.thing(20, 14, 0, 'barrel');

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

/** "Accueil" — a worked example level (HANGAR is the wired one). */
export const ACCUEIL: Level = {
  map: built.map,
  spawn: { x: 5, y: 7, angle: 0 },
  enemies: [
    { spec: IMP_SPEC, x: 24, y: 6 }, // lobby
    { spec: IMP_SPEC, x: 28, y: 12 }, // lobby
    { spec: PINKY_SPEC, x: 24, y: 18 }, // north-corridor ambush
    { spec: SHOTGUNGUY_SPEC, x: 25, y: 23 }, // guarding the badge dais
    { spec: LOSTSOUL_SPEC, x: 44, y: 9 }, // atrium
  ],
  health: [
    [8, 10], // réception
    [44, 13], // atrium
  ],
  armor: [[20, 30]], // cubicles corner
  ammo: [
    [22, 4], // staples — lobby
    [30, 30], // nails — cubicles
    [40, 5], // canisters (Hilti box) — atrium
    [12, 5], // cells — réception
    [50, 9], // batteries — atrium
    [44, 5], // server cell (BFG) — atrium
  ],
  keycards: [[25, 27, 'red']], // on the dais top (+1.6)
  exit: [49, 9], // deep in the atrium (−0.8)
  doors: [{ sector: built.doorSector, triggerX: 31, triggerY: 9.5, requiresCard: 'red' }],
};
