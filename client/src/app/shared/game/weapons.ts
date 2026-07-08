import { AIM_CONE, AMMO_START, MELEE_CONE, MELEE_RANGE, type WeaponCombat } from '../../core/lib';
import { WEAPON_IDS, type WeaponId } from '../../domain';
import { weaponEffects } from './effects';
import registry from './weapons.json';

/**
 * The data-driven weapon arsenal: a typed bridge over `weapons.json` (the full eight-weapon design), plus
 * the reductions the rest of the game consumes — `weaponCombat` (the numbers the pure engine `step` folds
 * in, now including the magazine `magSize`/`reloadTime`) and the shared `WEAPON_VIEW_CONFIG` /
 * `RELOAD_VIEW_CONFIG` (the FPS + reload sprite-strip animations the shell `WeaponView` plays). Wiring/
 * arting a weapon is JSON-only. Today slot 1 is the arted, switchable melee pair — the mechanical fist
 * (`CURRENT_WEAPON`, the default) ⇄ its chainsaw alt — slot 2 is the arted pistol (the first RANGED
 * weapon: a magazine + reload), slot 3 is the arted shotgun (the first shotgun: a magazine PLUS
 * multi-pellet spread + self-knockback), slot 4 is the arted chaingun (the first FULL-AUTO weapon, a
 * chaingun: `fireMode: 'auto'` so a held trigger bursts continuously), slot 5 is the arted lithium launcher
 * (the first PROJECTILE-AOE weapon: a travelling rocket + splash blast), slot 6 is the arted plasma cable
 * (the first CHAIN weapon: an auto bolt that arcs between nearby enemies on impact), and slot 7 is the arted
 * datacenter BFG (the ULTIMATE weapon: `fireMode: 'charge'` — a spin-up before a slow, huge-AOE projectile
 * that drains its whole 40-round mag in one shot); those EIGHT make up `ARSENAL` — every slot is now arted.
 * `fireMode` lives only in the shell: the pure engine already auto-fires whenever `intent.fire` stays true
 * (and the shell holds the charge), so the data is consumed by the component loop + `WeaponView`, never by
 * `weaponCombat`.
 */

/** The weapon kinds the registry declares — every kind is now consumed by an arted weapon. `melee*` reuse
 *  the engine's wide swing cone; every other kind aims through the narrow ranged cone. */
const WEAPON_TYPES = [
  'melee',
  'melee_alt',
  'hitscan',
  'hitscan_spread',
  'projectile_aoe',
  'beam_chain',
] as const;

export type WeaponType = (typeof WEAPON_TYPES)[number];

/** The named reach buckets a weapon's `range` selects from `RANGE_CELLS`. */
const RANGE_NAMES = ['contact', 'melee', 'short', 'medium', 'long', 'screen'] as const;

export type RangeName = (typeof RANGE_NAMES)[number];

/** How a weapon's trigger fires: `semi` = one shot per press (the default — melee, the pistol, the
 *  shotgun), `auto` = a continuous burst while the trigger is held (the chaingun), `charge` =
 *  a spin-up that holds before releasing a single shot on the discharge frame (the datacenter BFG). A
 *  shell-only concept — the pure engine fires whenever `intent.fire` stays true, so `auto` keeps it raised
 *  while the trigger is down and `charge` raises it for one frame on the discharge (see the component loop). */
const FIRE_MODES = ['semi', 'auto', 'charge'] as const;

export type FireMode = (typeof FIRE_MODES)[number];

/** Reach in map cells per range bucket — a sensible first pass per tier (the BSP demo's hitscan fires
 *  through all of them), to be re-tuned as each weapon is balanced. */
export const RANGE_CELLS: Record<RangeName, number> = {
  contact: 1.3, // tight melee — the fist barely out-reaches its own swing
  melee: MELEE_RANGE, // 1.4 — the engine's shared swing reach (a longer melee, e.g. the chainsaw alt)
  short: 5,
  medium: 10,
  long: 14,
  screen: 24, // a whole-room nuke
};

/** One weapon as declared in the registry: the base combat fields every weapon carries, the optional
 *  per-kind combat extras (typed-but-unconsumed until their weapon is wired), and the served art paths
 *  (`sprite_fps` strip + HUD `icon` — both empty for the un-arted weapons). */
export interface Weapon {
  slot: number;
  id: string;
  name: string;
  type: WeaponType;
  fireMode?: FireMode; // absent = `semi` (one shot per press); `auto` = held-trigger burst (the chaingun)
  damage: number;
  fireRate_s?: number; // optional: the beam (`tick_s`) and nuke (`chargeTime_s`) kinds set no per-shot rate
  fireFrameDuration_s?: number; // seconds per FPS frame in `auto` mode (the burst loop runs faster than the shared `_animation.frame_ms`); absent = the shared duration
  range: RangeName;
  ammoType: string | null; // null = ammo-less (the fist); otherwise an `ammo_types` key
  ammoPerShot?: number; // rounds a shot drains from the magazine (absent → 1; the BFG spends its full 40-round mag at once)
  magSize?: number; // rounds the magazine holds (the pistol); absent = no magazine (melee / flat pool)
  reloadTime_s?: number; // seconds a full reload takes (a magazine weapon only)
  knockback?: number;
  selfKnockback?: number; // cells the player recoils straight back on firing (the CO2 shotgun's blast)
  spread?: number;
  spread_deg?: number; // shotgun fan half-angle in degrees — becomes the `cone` (the shotgun)
  pellets?: number;
  dot?: boolean;
  stun?: number;
  splashDamage?: number;
  splashRadius?: number;
  selfDamage?: boolean;
  projectileSpeed?: number;
  tick_s?: number;
  chainTargets?: number; // max chain hops beyond the directly-hit enemy (the plasma cable)
  chainRange?: number; // cells a chain hop reaches from the last-hit enemy
  chainFalloff?: number; // damage multiplier per chain hop (absent → 1, no falloff)
  chargeTime_s?: number;
  alt?: string; // id of the slot's alternate weapon (slot 1: fist ⇄ chainsaw)
  sprite_fps: string; // served FPS strip URL (empty until arted)
  sprite_run?: string; // served walk-cycle strip URL (a hand-drawn run bob shown as the resting/moving base — the fist's two-fist guard); absent = a static idle frame + the procedural sway
  run_frames?: number; // cells in the `sprite_run` strip (required when `sprite_run` is set); absent = 0
  run_scale?: number; // on-screen size multiplier for the RUN (resting-guard) strip only, over the weapon's `view_scale` — the run cell is normalised to the FIRE cell by height (`runH/fpsH`), but when the two strips frame the hands at different sizes the resting guard reads wrong next to the jab; trim or grow it here without disturbing the attack; absent = 1
  sprite_reload?: string; // served reload strip URL (a magazine weapon only; absent = no reload animation)
  reload_frames?: number; // cells in the `sprite_reload` strip when it differs from the global down→insert→up 3 (the Hilti's 4-frame reload); absent = the shared count
  reload_scale?: number; // on-screen size multiplier for the RELOAD strip only, over the weapon's `view_scale` — a reload whose composition zooms out (both hands + the magazine insert) reads small next to the fire frame; bump this to grow the gun through the reload (forearms run off-screen, as a viewmodel should); absent = 1
  sprite_idle?: string; // served cold-idle sprite for an `auto` weapon, shown while not firing (the chaingun's single flash-free frame, or a multi-frame LOOP strip — the chainsaw's idling chain); absent = use the fire strip's idle frame
  idle_frames?: number; // cells in the `sprite_idle` strip when it LOOPS (the chainsaw's 4-frame exhaust shimmer); absent / 1 = a single static cold-idle frame (the chaingun)
  icon: string; // served HUD bay icon URL (empty until arted)
  anim?: WeaponFpsAnim; // a per-weapon FPS-strip override (e.g. the fist's 6-frame jab); absent = the shared 4-frame `WEAPON_VIEW_CONFIG`
  view_scale?: number; // on-screen size multiplier over the global `fps_sprite_height_frac`, normalising every weapon's DRAWN BODY to a shared target despite differing sprite padding (smaller for a tightly-framed sprite that fills its box); absent = 1
  view_offset?: number; // per-weapon vertical nudge over the shared bar anchor, as a fraction of screen height (+up); absent = 0
  swing_travel?: number; // melee only: how far the sprite ARCS through space during a swing (amplitude as a fraction of the drawn size) — up-and-out on the wind-up, slamming down through the strike, like a club; absent = 0 (no travel, the gun stays put)
  view_anchor_x?: number; // horizontal centre of the sprite's CONTENT (0..1) — the draw aligns this point to the crosshair, so a weapon drawn off-centre in its frame (most sit right of centre, the shotgun at 0.62) reads centred; absent = 0.5 (frame-centred)
}

/** A per-weapon FPS-strip animation override: its own frame count / timing / fire run, so a weapon can ship
 *  a richer attack (the fist's 6-frame jab [0,1,2,3,4,5], contact on cell 3) than the shared 4-frame
 *  layout, JSON-only. The last `fire_sequence` cell is the resting/idle frame (the fallback before a
 *  `sprite_run` base decodes); `damage_frame` is the strip cell the hit lands on. */
export interface WeaponFpsAnim {
  frames: number; // cells in this weapon's own strip
  frame_ms: number; // ms each fire frame holds
  fire_sequence: number[]; // the fire run (strip-cell indices, in order), ending on the idle cell
  damage_frame: number; // the strip cell the hit lands on (its position in `fire_sequence` is the strike index)
}

/** The raw shape of a `weapons.json` entry before narrowing: `type` / `range` / `fireMode` arrive as
 *  widened `string` (JSON inference) and are narrowed below; the per-kind extras are optional. */
interface RawWeapon extends Omit<Weapon, 'type' | 'range' | 'fireMode'> {
  type: string;
  range: string;
  fireMode?: string;
}

const RAW_WEAPONS: readonly RawWeapon[] = registry.weapons;

/** The parsed registry. `asWeaponType` / `asRangeName` recover the literal `type` / `range` unions from
 *  the JSON's widened `string` via equality — the typed bridge, no unsafe cast. */
export const WEAPONS: readonly Weapon[] = RAW_WEAPONS.map((raw) => ({
  slot: raw.slot,
  id: raw.id,
  name: raw.name,
  type: asWeaponType(raw.type),
  fireMode: asFireMode(raw.fireMode),
  damage: raw.damage,
  fireRate_s: raw.fireRate_s,
  fireFrameDuration_s: raw.fireFrameDuration_s,
  range: asRangeName(raw.range),
  ammoType: raw.ammoType,
  ammoPerShot: raw.ammoPerShot,
  magSize: raw.magSize,
  reloadTime_s: raw.reloadTime_s,
  reload_frames: raw.reload_frames,
  reload_scale: raw.reload_scale,
  knockback: raw.knockback,
  selfKnockback: raw.selfKnockback,
  spread: raw.spread,
  spread_deg: raw.spread_deg,
  pellets: raw.pellets,
  dot: raw.dot,
  stun: raw.stun,
  splashDamage: raw.splashDamage,
  splashRadius: raw.splashRadius,
  selfDamage: raw.selfDamage,
  projectileSpeed: raw.projectileSpeed,
  tick_s: raw.tick_s,
  chainTargets: raw.chainTargets,
  chainRange: raw.chainRange,
  chainFalloff: raw.chainFalloff,
  chargeTime_s: raw.chargeTime_s,
  alt: raw.alt,
  sprite_fps: raw.sprite_fps,
  sprite_run: raw.sprite_run,
  run_frames: raw.run_frames,
  run_scale: raw.run_scale,
  sprite_reload: raw.sprite_reload,
  sprite_idle: raw.sprite_idle,
  idle_frames: raw.idle_frames,
  icon: raw.icon,
  anim: raw.anim,
  view_scale: raw.view_scale,
  view_offset: raw.view_offset,
  swing_travel: raw.swing_travel,
  view_anchor_x: raw.view_anchor_x,
}));

/** The FPS sprite-strip animation config — derived ONCE from the GLOBAL `_animation` / `_responsive`
 *  metadata every weapon shares (per-weapon frame pixel sizes are gone from the JSON; `WeaponView`
 *  derives them from the loaded strip). `fireSequence` plays every non-idle frame in strip order then
 *  returns to idle; `strikeIndex` is the position of the `fire_peak` frame within that sequence. */
export interface WeaponViewConfig {
  frameCount: number;
  frameDuration_s: number;
  heightRatio: number;
  baseOffset: number;
  swingTravel: number;
  anchorX: number;
  idleFrame: number;
  fireSequence: readonly number[];
  strikeIndex: number;
}

const FRAME_NAMES = registry._animation.frames_per_weapon;
const IDLE_FRAME = FRAME_NAMES.indexOf('idle');
/** The fire run: every non-idle frame in strip order, then back to the idle frame. */
const FIRE_SEQUENCE: readonly number[] = [
  ...FRAME_NAMES.flatMap((name, index) => (name === 'idle' ? [] : [index])),
  IDLE_FRAME,
];

/** The shared view config (one strip layout for every weapon). */
export const WEAPON_VIEW_CONFIG: WeaponViewConfig = {
  frameCount: FRAME_NAMES.length,
  frameDuration_s: registry._animation.frame_ms / 1000,
  heightRatio: registry._responsive.fps_sprite_height_frac,
  baseOffset: 0,
  swingTravel: 0,
  anchorX: 0.5,
  idleFrame: IDLE_FRAME,
  fireSequence: FIRE_SEQUENCE,
  strikeIndex: FIRE_SEQUENCE.indexOf(FRAME_NAMES.indexOf('fire_peak')),
};

/** The FPS view config the shell hands a weapon's `WeaponView`: the weapon's OWN `anim` override when the
 *  registry declares one (e.g. the fist's 6-frame swing), else the shared 4-frame `WEAPON_VIEW_CONFIG`.
 *  The fire run ends on the idle cell, so `idleFrame` is its last entry; `strikeIndex` is where the
 *  `damage_frame` cell sits in that run. `heightRatio` is the global responsive sizing scaled by the
 *  weapon's `view_scale`, so every weapon's drawn body matches the fist's despite differing sprite padding. */
export function weaponViewConfig(weapon: Weapon): WeaponViewConfig {
  const heightRatio = registry._responsive.fps_sprite_height_frac * (weapon.view_scale ?? 1);
  const baseOffset = weapon.view_offset ?? 0;
  const swingTravel = weapon.swing_travel ?? 0;
  const anchorX = weapon.view_anchor_x ?? 0.5;
  const anim = weapon.anim;

  if (!anim) {
    return { ...WEAPON_VIEW_CONFIG, heightRatio, baseOffset, swingTravel, anchorX };
  }

  return {
    frameCount: anim.frames,
    frameDuration_s: anim.frame_ms / 1000,
    heightRatio,
    baseOffset,
    swingTravel,
    anchorX,
    idleFrame: anim.fire_sequence[anim.fire_sequence.length - 1],
    fireSequence: anim.fire_sequence,
    strikeIndex: anim.fire_sequence.indexOf(anim.damage_frame),
  };
}

/** The reload sprite-strip layout — just the strip's frame count, derived ONCE from the GLOBAL
 *  `_reload_animation` metadata (parallels `WEAPON_VIEW_CONFIG`). The reload strip plays down → insert →
 *  up; `WeaponView` stretches those frames across the active weapon's `reloadTime`, deriving each frame's
 *  pixel size from the loaded reload strip (`naturalWidth / frameCount` × `naturalHeight`, nothing hardcoded). */
export interface ReloadViewConfig {
  frameCount: number;
  scale: number; // height multiplier for the reload strip over the weapon's `view_scale` (1 = same as the fire frame)
}

export const RELOAD_VIEW_CONFIG: ReloadViewConfig = {
  frameCount: registry._reload_animation.frames,
  scale: 1,
};

/** The reload-strip view config for a specific weapon: its own `reload_frames` when it ships a richer reload
 *  strip (the Hilti's 4 cells), else the shared down→insert→up count, plus a `reload_scale` that grows the
 *  reload draw on its own (a zoomed-out reload composition reads small next to the fire frame). Pass this to
 *  {@link WeaponView} so the strip is sliced into the right number of cells and drawn at the right size. */
export function reloadViewConfig(weapon: Weapon): ReloadViewConfig {
  return {
    frameCount: weapon.reload_frames ?? registry._reload_animation.frames,
    scale: weapon.reload_scale ?? 1,
  };
}

/** Reduce a `Weapon` to the numbers the pure combat step needs. A melee kind reuses the engine's wide
 *  swing cone; a shotgun spread (`spread_deg`, the shotgun) fans its pellets across that many degrees
 *  of half-angle; any other ranged kind aims through the narrow cone. Reach comes from the `RANGE_CELLS`
 *  bucket, and an ammo-less weapon (`ammoType === null`, the fist) never spends ammo. A magazine
 *  weapon (the pistol, the shotgun) carries `magSize`/`reloadTime` so the engine draws each shot
 *  from the loaded mag and reloads the reserve over `reloadTime`; a magazine-less weapon leaves both 0
 *  (melee + the flat-pool kinds). `pellets` (1 = single hitscan, > 1 = a shotgun blast) and `selfKnockback`
 *  (the CO2 recoil, 0 = none) drive the spread + self-recoil engine paths. */
export function weaponCombat(weapon: Weapon): WeaponCombat {
  const chains = (weapon.chainTargets ?? 0) > 0;
  // The world-effects mapping (`effects.json`) decides whether the weapon LAUNCHES a travelling projectile
  // (and which sprite), the impact effect it plays at every hit, and whether that projectile detonates an
  // AOE splash (`aoe`) or a point impact — so converting a hitscan weapon to a traveller (the staple /
  // nail) is data-only, never a code change here.
  const effects = weaponEffects(weapon.id);
  const launches = effects?.projectile != null;
  const aoe = effects?.aoe ?? false;

  return {
    damage: weapon.damage,
    range: RANGE_CELLS[weapon.range],
    cone: weapon.type.startsWith('melee')
      ? MELEE_CONE
      : weapon.spread_deg !== undefined
        ? (weapon.spread_deg * Math.PI) / 180
        : AIM_CONE,
    // The fist (and the hitscan kinds) carry `fireRate_s`; the beam/nuke kinds will wire their
    // cadence from `tick_s` / `chargeTime_s` when they ship — until then they fall back to 0.
    fireCooldown: weapon.fireRate_s ?? 0,
    knockback: weapon.knockback ?? 0,
    costsAmmo: weapon.ammoType !== null,
    ammoType: weapon.ammoType, // which per-type reserve a reload / flat-pool shot draws from (null = melee)
    ammoPerShot: weapon.ammoPerShot ?? 1, // rounds a shot drains from the mag (40 for the BFG, 1 otherwise)
    magSize: weapon.magSize ?? 0,
    reloadTime: weapon.reloadTime_s ?? 0,
    pellets: weapon.pellets ?? 1,
    selfKnockback: weapon.selfKnockback ?? 0,
    // A weapon whose effects-mapping carries a `projectile` fires a travelling sprite that detonates on
    // impact instead of a hitscan ray: an AOE weapon (`aoe` — the lithium rocket, the datacenter BFG)
    // carries the splash; a chain weapon (the plasma cable) rides a chain spec (and the JSON zeroes its
    // splash, so the chain replaces it); a splash-less traveller (the staple, the nail) zeroes both and
    // just lands its direct hit + a metal-spark impact. Every other kind stays hitscan / melee (`null`).
    // The BFG's `fireMode: 'charge'` spin-up lives in the shell, not here.
    projectile: launches
      ? {
          speed: weapon.projectileSpeed ?? 0,
          splashDamage: aoe ? (weapon.splashDamage ?? 0) : 0,
          splashRadius: aoe ? (weapon.splashRadius ?? 0) : 0,
          selfDamage: weapon.selfDamage ?? false,
          chain: chains
            ? {
                targets: weapon.chainTargets ?? 0,
                range: weapon.chainRange ?? 0,
                falloff: weapon.chainFalloff ?? 1,
              }
            : null,
          kind: effects?.projectile ?? '',
        }
      : null,
    // The hit effect played at every landed hit (a projectile detonation, a hitscan ray, or a melee swing).
    impactKind: effects?.impact ?? '',
  };
}

/** The weapon with the given id, or `undefined` if the registry declares none. */
export function weaponById(id: string): Weapon | undefined {
  return WEAPONS.find((weapon) => weapon.id === id);
}

/** The per-type ammo reserve caps — the SINGLE SOURCE OF TRUTH for every ammo type's `max`, read from
 *  `weapons.json` `ammo_types` (also where each type's ammo box id lives). The ammo pickups read their cap
 *  from here (via the resolved entity), so a type's cap is declared exactly once. */
export const AMMO_MAX: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(registry.ammo_types).map(([type, spec]) => [type, spec.max]),
);

/** The reserve cap for an ammo type (`ammo_types[type].max`), or 0 for an unknown type. */
export function ammoTypeMax(type: string): number {
  return AMMO_MAX[type] ?? 0;
}

/** The per-type reserve the player spawns / respawns with: each declared ammo type starts at
 *  `min(AMMO_START, its max)`, so a small-capacity type (the batteries' 30) is never seeded over its cap. */
export function startingAmmo(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(AMMO_MAX).map(([type, max]) => [type, Math.min(AMMO_START, max)]),
  );
}

/** The weapon-id value set + derived union live in `domain/game/weapon-id` (a core-bound value set with no
 *  UI/runtime deps); re-exported here so every existing consumer keeps resolving through the weapons barrel.
 *  `WEAPONS` is kept in lockstep with `WEAPON_IDS` (the spec asserts it), so the union and the JSON can
 *  never drift silently. */
export { WEAPON_IDS, type WeaponId };

/** The DOOM progression's starting loadout: FISTS ONLY. Every other weapon — the chainsaw included — is a
 *  level pickup (`Level.weapons`), unlocked when collected; ownership is player INVENTORY (it travels
 *  across zones) and resets here on a new game. */
export const STARTING_WEAPON_IDS: readonly WeaponId[] = ['fist'];

/** The default weapon, active on spawn — slot 1's mechanical fist. Slot 1 also holds its
 *  `chainsaw` alt, so the selection is by id, not slot. */
export const CURRENT_WEAPON: Weapon = requireWeapon('fist');

/** The switchable arsenal: every ARTED weapon — one with a non-empty `sprite_fps` strip it can actually
 *  draw first-person — in registry order. The whole roster is now arted: the fist (index 0, the
 *  default), its chainsaw alt, the pistol (the first ranged weapon), the shotgun (the CO2
 *  shotgun), the chaingun (the full-auto chaingun), the lithium launcher (the rocket), the plasma cable (the
 *  chain bolt) and the datacenter BFG (the charged ultimate) — eight weapons, HUD keys 1..8 (each lights
 *  once OWNED: the run starts fists-only and the rest are level pickups, see `STARTING_WEAPON_IDS`). The
 *  `sprite_fps` filter still guards the cycle so it only ever lands on a weapon that renders. `ARSENAL[0]`
 *  is `CURRENT_WEAPON`. */
export const ARSENAL: readonly Weapon[] = WEAPONS.filter((weapon) => weapon.sprite_fps !== '');

/** Recover the literal `WeaponType` from a widened JSON `string` via equality — fail loud on an unknown
 *  kind (an authoring error) so a typo never silently degrades to a default. */
function asWeaponType(value: string): WeaponType {
  const match = WEAPON_TYPES.find((name) => name === value);

  if (match === undefined) {
    throw new Error(`weapons.json: unknown weapon type "${value}"`);
  }

  return match;
}

/** Recover the literal `RangeName` from a widened JSON `string` via equality — fail loud on an unknown
 *  bucket (an authoring error). */
function asRangeName(value: string): RangeName {
  const match = RANGE_NAMES.find((name) => name === value);

  if (match === undefined) {
    throw new Error(`weapons.json: unknown range "${value}"`);
  }

  return match;
}

/** Recover the optional literal `FireMode` from a widened JSON `string` via equality — `undefined`
 *  (absent) stays `undefined` (the default `semi`), and an unknown mode fails loud (an authoring error). */
function asFireMode(value: string | undefined): FireMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = FIRE_MODES.find((name) => name === value);

  if (match === undefined) {
    throw new Error(`weapons.json: unknown fireMode "${value}"`);
  }

  return match;
}

/** Resolve a required weapon by id, failing loud if the registry is missing it (a build/authoring error). */
export function requireWeapon(id: string): Weapon {
  const weapon = weaponById(id);

  if (!weapon) {
    throw new Error(`weapons.json must declare a weapon with id "${id}"`);
  }

  return weapon;
}
