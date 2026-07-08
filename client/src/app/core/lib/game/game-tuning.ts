// core/lib/game/game-tuning — the ONE central gameplay balance / feel sheet for the BSP game (the
// DOOM-DEHACKED / Unity-ScriptableObject pattern): every numeric knob a game DESIGNER turns to change how
// the game PLAYS or FEELS, gathered here so the whole feel is tuned in one place. Bare named consts, zero
// imports (nothing to depend on) — 100 % covered by the code that reads them. This is a LOWER layer than the
// feature shell, so both core and the feature import it (feature → core is legal); it deliberately holds NO
// engine invariants (player radius / step height / eye height stay in bsp-engine, a lower layer still), no
// buffer capacities, no HUD/render/pixel dimensions, and no per-level geometry — those are structural, not
// feel, and live with the code that owns them.

// ───────────────────────────── Movement ─────────────────────────────

/** Player walk speed (world units / second). */
export const MOVE_SPEED = 4;

// ─────────────────────────────── Look ───────────────────────────────

/** Radians of turn per pixel of mouse motion (turning is mouse-only). */
export const MOUSE_SENS = 0.0035;
/** Look-up limit (the camera pitch is a vertical y-shear, not a true rotation). */
export const PITCH_UP_MAX = 0.85;
/** Look-DOWN limit — much deeper than up (aim down at enemies below a platform); the renderer handles the
 *  off-screen horizon, so this can exceed 1.0 (walls stay vertical, as in any sheared-frustum tilt). */
export const PITCH_DOWN_MAX = 2.0;

// ───────────────────────────── Climb / Mantle ───────────────────────────

// Auto-mantle: a ledge whose rise is in (STEP_MAX, CLIMB_MAX] is too tall to step but climbable — walking
// into it hoists the player up over MANTLE_DURATION while gliding CLIMB_VAULT_ADVANCE forward over the lip.
/** Tallest ledge you can vault (above this it stays a solid wall). */
export const CLIMB_MAX = 2.4;
/** Cells ahead the climb probe samples — just past the radius, into the ledge cell. */
export const CLIMB_PROBE_REACH = 0.45;
/** Seconds the hoist takes. */
export const MANTLE_DURATION = 0.4;
/** Cells the hoist glides the player forward, so it clears the lip and stands on top. */
export const CLIMB_VAULT_ADVANCE = 0.5;

// ─────────────────────────────── Combat ──────────────────────────────

/** The player's full-health ceiling (the new-game / debug-heal cap). */
export const PLAYER_MAX_HEALTH = 100;
/** Fraction of an incoming hit armour soaks (the rest hits health) — DOOM green armour. */
export const ARMOR_ABSORB = 1 / 3;

/** Per-type reserve seed: each ammo type starts at min(AMMO_START, its max) — see `startingAmmo()` in weapons.ts. */
export const AMMO_START = 50;
/** Starting reserve per ammo type at spawn (then clamped to each type's cap) — pickups top up. */
export const RESERVE_START = 50;

/** Shared aim geometry the shell folds into each weapon's `WeaponCombat`: a melee swing's reach + wide
 *  cone, and the narrow cone a ranged weapon aims through. (Per-weapon damage / cooldown / reach for a
 *  ranged weapon all live in the JSON arsenal.) */
export const MELEE_RANGE = 1.4; // melee reach (cells)
export const MELEE_CONE = 0.5; // melee swing half-angle (radians)
export const AIM_CONE = 0.13; // ranged aim half-angle (radians)

/** Cells a launched projectile flies before it despawns (a hitscan uses the weapon's own `range` instead). */
export const MAX_SHOT_RANGE = 40;

/** Cells a shot clears before its floor/ceiling collision counts — lets a steep shot off a raised platform
 *  clear its own lip instead of bursting at the shooter's feet (wider than a pedestal half-width). Shared by
 *  the hitscan resolution and the projectile stepper (the latter subtracts the distance already flown). */
export const MUZZLE_CLEAR = 1.5;

/** The barrel's SOLID half-width (its art fills only the middle 50% of the 0.8 billboard) — the collision
 *  radius a hitscan / projectile tests against, before any per-shot inflation. */
export const BARREL_HIT_RADIUS = 0.2;

/** A thrown enemy projectile within this distance of the camera counts as a hit on the player (the shot's
 *  landing radius). */
export const PLAYER_HIT_RADIUS = 0.45;

/** Cells ahead of the camera a launched projectile spawns — close, so the shot reads as leaving the gun. */
export const PROJECTILE_SPAWN_AHEAD = 0.25;

// ─────────────────────────────── Enemy ───────────────────────────────

/** Chase speed (world units / second). */
export const ENEMY_SPEED = 2;
/** Seconds between an enemy's shots while it can see the player. */
export const ENEMY_FIRE_INTERVAL = 1.5;
/** World units an enemy flinches UP at full hit-flash (the grid's recoil, in world z). */
export const ENEMY_RECOIL = 0.18;

/** Hysteresis around an enemy's `standoff` distance: it holds within ±this of the standoff, and only
 *  advances (outside the far edge) or retreats (inside the near edge) — so grazing the standoff does not
 *  jitter it back and forth. */
export const STANDOFF_BAND = 0.25;

/** Minimum centre-to-centre distance kept between two living enemies — closer than this, `separateEnemies`
 *  pushes the overlapping pair apart so foes never stack into one billboard. */
export const ENEMY_SEP_DIST = 0.85;

// ─────────────────────────────── Pickup ──────────────────────────────

/** Walk this close (world units) to collect any pickup — mirrors the grid's `PICKUP_RADIUS`. */
export const PICKUP_RADIUS = 0.6;
/** Grants: a SMALL vital tops up +25, a LARGE one +50; both cap at VITAL_MAX (the grid's vitals tuning). */
export const VITAL_SMALL = 25;
export const VITAL_LARGE = 50;
export const VITAL_MAX = 100;
/** Approach within this radius (world units) of the level exit marker to complete the zone. */
export const EXIT_RADIUS = 1.5;
/** Shared spin cadence for EVERY rotating floor pickup — vitals AND ammo boxes — so they turn coherently
 *  (400 ms/frame ≈ 2.4–2.8 s per full turn depending on the strip's frame count). Single source of truth. */
export const PICKUP_SPIN_MS = 400;

// ───────────────────────────── Doors ─────────────────────────────

/** Openness units/second an animated door raises (≈0.45s for a door to fully open). */
export const DOOR_OPEN_SPEED = 2.2;
/** Approach this close (world units) to a door's trigger point to start it opening. */
export const DOOR_TRIGGER_RADIUS = 2.4;
/** Sliding-glass panel openness units/second (a snappy automatic door). */
export const SLIDE_OPEN_SPEED = 4;
/** An automatic sliding door senses the player within this radius (world units) — then it stays open. */
export const SLIDE_TRIGGER_RADIUS = 4;

// ───────────────────────────── Timing / FX ───────────────────────────

/** Seconds the muzzle flash + impact spark linger after a shot. */
export const SHOT_FX_DURATION = 0.09;
/** Seconds the player's red damage flash lingers after taking a hit. */
export const HURT_FX_DURATION = 0.35;
/** Seconds the player's green pickup flash lingers after collecting an item. */
export const PICKUP_FX_DURATION = 0.3;
/** Seconds an enemy flashes white after a hit (mirrors the grid). */
export const HIT_FLASH_DURATION = 0.12;

/** Seconds a chain-lightning arc lives before the step drops it — shared with the renderer, which fades
 *  it across `age / ARC_DURATION`. Purely visual, but deterministic (no wall-clock) so it stays
 *  unit-testable + SSR-safe. */
export const ARC_DURATION = 0.35;

/** Peak green discharge flash opacity (near-blinding ultimate). */
export const CHARGE_FLASH_PEAK = 0.92;
/** Peak green charge-buildup tint at full BFG spin-up (mirrors the grid). */
export const CHARGE_GLOW_PEAK = 0.7;
/** How fast the green discharge flash fades (opacity units / second). */
export const CHARGE_FLASH_DECAY_PER_S = 3;

/** Seconds each side of a FADE zone swap (fade to black, load the new floor at black, fade back in). The
 *  runtime drives the clock; the component's overlay painter reads it to draw the wash. */
export const ZONE_FADE = 0.35;

/** Seconds after death/win before a click restarts (lets the end feedback settle). The game-over / win
 *  overlays gate their "click to restart" prompt on the same threshold. */
export const RESTART_DELAY = 1.2;

/** Seconds a transient objective hint lingers (e.g. "badge requis" flashed at a locked door). */
export const HINT_DURATION = 1.8;
