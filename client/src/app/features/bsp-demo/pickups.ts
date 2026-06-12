import type { KeycardColor } from '../../core/lib';
import { AMMO_MAX } from '../../shared/game/weapons';

/**
 * Pickup + objective registry for the BSP demo — VITALS (health / armour), spinning AMMO boxes, the level
 * KEYCARD, and the EXIT marker — kept LOCAL to the feature, mirroring the grid's `pickup.ts` /
 * `ammo-pickups.ts` amounts (the grid versions are feature-coupled to its raycaster; a shared move comes if
 * this grows, exactly like {@link ./enemies.ts `enemies.ts`}).
 *
 * The single sources of truth still hold: each ammo box's reserve CAP is read from {@link AMMO_MAX}
 * (`weapons.json` `ammo_types`), and the ammo strip art + grant amounts mirror the shared `ammo-pickups.json`.
 * Vitals + the keycard/exit carry their own procedural sprites (`/game/pickups/*.webp`).
 */

export type VitalKind = 'health' | 'armor';

/** Walk this close (world units) to collect any pickup — mirrors the grid's `PICKUP_RADIUS`. */
export const PICKUP_RADIUS = 0.6;
/** A coffee restores +25 health; a RAM stick grants +50 armour; both cap at 100 (the grid's vitals tuning). */
export const HEALTH_PICKUP = 25;
export const ARMOR_PICKUP = 50;
export const VITAL_MAX = 100;

/** A vitals pickup kind's billboard art + grant. Health = coffee (energy), armour = a RAM stick (buffer). */
export interface VitalSpec {
  readonly kind: VitalKind;
  readonly texName: string;
  readonly url: string;
  readonly worldHeight: number; // billboard height in world units
  readonly aspect: number; // sprite width : height
  readonly amount: number; // hp/armour granted on collect
}

export const HEALTH_SPEC: VitalSpec = {
  kind: 'health',
  texName: 'PICKUP_HEALTH',
  url: '/game/pickups/coffee.webp',
  worldHeight: 0.85,
  aspect: 200 / 260,
  amount: HEALTH_PICKUP,
};

export const ARMOR_SPEC: VitalSpec = {
  kind: 'armor',
  texName: 'PICKUP_ARMOR',
  url: '/game/pickups/ram.webp',
  worldHeight: 0.55,
  aspect: 260 / 180,
  amount: ARMOR_PICKUP,
};

/** A rotating ammo box: its turntable strip (`frames` cells advanced over `frameMs`) + which reserve it refills.
 *  `max` is single-sourced from {@link AMMO_MAX}; `amount`/`frameMs`/art mirror the shared `ammo-pickups.json`. */
export interface AmmoBoxSpec {
  readonly id: string;
  readonly texName: string;
  readonly url: string; // served turn strip (a `frames`×1 horizontal strip)
  readonly frames: number;
  readonly frameMs: number; // ms each spin frame holds
  readonly worldHeight: number;
  readonly aspect: number; // source cell width : height
  readonly ammoType: string; // which reserve it refills (an `ammo_types` key)
  readonly amount: number; // rounds granted on collect
  readonly max: number; // reserve cap for this type — a full type never consumes the box
}

/** Ammo boxes read as the smallest floor items (well under an enemy or a vitals pickup). */
const AMMO_WORLD_HEIGHT = 0.5;

/** Build one ammo-box spec; `aspect` follows the source cell, `max` is sourced from {@link AMMO_MAX}. */
function box(
  id: string,
  ammoType: string,
  amount: number,
  url: string,
  frames: number,
  frameMs: number,
  cellW: number,
  cellH: number,
): AmmoBoxSpec {
  return {
    id,
    texName: `AMMO_${id.toUpperCase()}`, // keyed by the unique box id (two boxes can share an ammoType — cells)
    url,
    frames,
    frameMs,
    worldHeight: AMMO_WORLD_HEIGHT,
    aspect: cellW / cellH,
    ammoType,
    amount,
    max: AMMO_MAX[ammoType] ?? 0,
  };
}

/** Every ammo-box kind the demo places (one per ammo type), mirroring `ammo-pickups.json` grants + strips. */
export const AMMO_BOX_SPECS: readonly AmmoBoxSpec[] = [
  box('box_staples', 'bullets', 20, '/game/weapons/ammo/staples/staples_turn_strip.webp', 7, 180, 150, 168),
  box('box_nails', 'bullets', 20, '/game/weapons/ammo/nails/nails_turn_strip.webp', 7, 180, 157, 148),
  // The shotgun is the Hilti DX 460 now, so its ammo box (ammoType 'shells') is the Hilti .22 cal box: a
  // 7-frame turntable (the metal-back duplicates trimmed so the label/cartridges always show), landscape cell,
  // baseline-aligned to seat flush like the other boxes.
  box(
    'gas_canister',
    'shells',
    5,
    '/game/weapons/ammo/canisters/canister_turn_strip.webp',
    7,
    180,
    144,
    140,
  ),
  box('energy_cell', 'cells', 40, '/game/weapons/ammo/cells/cell_turn_strip.webp', 7, 180, 138, 211),
  box(
    'battery_pack',
    'rockets',
    2,
    '/game/weapons/ammo/batteries/battery_turn_strip.webp',
    7,
    180,
    149,
    256,
  ),
  // The big "server cell" — a richer cells box (the BFG-datacenter flavour): grants more rounds than the
  // standard energy cell.
  box('server_cell', 'cells', 80, '/game/weapons/ammo/cells/cell_large_turn_strip.webp', 6, 180, 156, 232),
];

/** A placed vitals pickup on the floor. */
export interface Vital {
  x: number;
  y: number;
  z: number;
  spec: VitalSpec;
}

/** A placed, spinning ammo box on the floor (`age` is its spin clock). */
export interface AmmoBox {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: AmmoBoxSpec;
}

/** A single-sprite floor billboard (the keycard, the exit sign): art + world sizing, no animation. */
export interface MarkerSpec {
  readonly texName: string;
  readonly url: string;
  readonly worldHeight: number;
  readonly aspect: number;
}

/** The level KEYCARD — the red corporate access badge that unlocks the exit; shows in the HUD card bay on
 *  collect. Its HUD card colour is the {@link KeycardColor} `red`. */
export const KEYCARD_COLOR: KeycardColor = 'red';
export const KEYCARD_SPEC: MarkerSpec = {
  texName: 'PICKUP_KEYCARD',
  url: '/game/pickups/keycard.webp',
  worldHeight: 0.55,
  aspect: 180 / 260,
};

/** The EXIT sign — the level goal; reaching it WITH the keycard completes the level. */
export const EXIT_SPEC: MarkerSpec = {
  texName: 'EXIT_SIGN',
  url: '/game/pickups/exit.webp',
  worldHeight: 1.6,
  aspect: 240 / 320,
};
/** Walk this close to the exit sign to trigger the finish (it sits flush against the hall's far wall). */
export const EXIT_RADIUS = 1.5;

/** Every pickup/marker texture to decode (vitals + ammo strips + keycard + exit) — each a single-row sheet. */
export const PICKUP_TEXTURE_JOBS: readonly { name: string; url: string }[] = [
  { name: HEALTH_SPEC.texName, url: HEALTH_SPEC.url },
  { name: ARMOR_SPEC.texName, url: ARMOR_SPEC.url },
  ...AMMO_BOX_SPECS.map((spec) => ({ name: spec.texName, url: spec.url })),
  { name: KEYCARD_SPEC.texName, url: KEYCARD_SPEC.url },
  { name: EXIT_SPEC.texName, url: EXIT_SPEC.url },
];

// (Per-level pickup/objective PLACEMENTS live on the level — see `level-accueil.ts` `Level` — so a level owns
// where its entities sit; this file owns only the level-agnostic specs/art above.)
