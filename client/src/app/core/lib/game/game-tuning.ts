// Central gameplay balance / feel sheet — feel knobs only. Engine invariants (player radius / step / eye
// height) stay in bsp-engine, a lower layer; structural sizes (buffers, HUD/pixel dims, geometry) stay with
// the code that owns them.

// ───────────────────────────── Movement ─────────────────────────────

export const MOVE_SPEED = 4;

// ─────────────────────────────── Look ───────────────────────────────

export const MOUSE_SENS = 0.0035;
export const PITCH_UP_MAX = 0.85;
// exceeds 1.0 on purpose — walls stay vertical (sheared-frustum tilt), not a bug.
export const PITCH_DOWN_MAX = 2.0;

// ───────────────────────────── Climb / Mantle ───────────────────────────

// A ledge whose rise is in (STEP_MAX, CLIMB_MAX] is too tall to step but climbable — walking into it hoists
// the player up over MANTLE_DURATION while gliding CLIMB_VAULT_ADVANCE forward over the lip.
export const CLIMB_MAX = 2.4;
export const CLIMB_PROBE_REACH = 0.45;
export const MANTLE_DURATION = 0.4;
export const CLIMB_VAULT_ADVANCE = 0.5;

// ─────────────────────────────── Combat ──────────────────────────────

export const PLAYER_MAX_HEALTH = 100;
export const ARMOR_ABSORB = 1 / 3;

// per-type seed: each type starts at min(this, its max) — see startingAmmo() in weapons.ts.
export const AMMO_START = 50;
// starting reserve per ammo type, then clamped to each type's cap.
export const RESERVE_START = 50;

export const MELEE_RANGE = 1.4; // cells
export const MELEE_CONE = 0.5; // radians
export const AIM_CONE = 0.13; // radians

export const MAX_SHOT_RANGE = 40;

// grace before a shot's floor/ceiling hit counts; the projectile stepper subtracts the distance already flown.
export const MUZZLE_CLEAR = 1.5;

// the barrel art fills only the middle 50% of the 0.8 billboard.
export const BARREL_HIT_RADIUS = 0.2;

export const PLAYER_HIT_RADIUS = 0.45;

export const PROJECTILE_SPAWN_AHEAD = 0.25;

// ─────────────────────────────── Enemy ───────────────────────────────

export const ENEMY_SPEED = 2;
export const ENEMY_FIRE_INTERVAL = 1.5;
export const ENEMY_RECOIL = 0.18;

// hysteresis so grazing the standoff doesn't jitter it advance/retreat.
export const STANDOFF_BAND = 0.25;

export const ENEMY_SEP_DIST = 0.85;

// ─────────────────────────────── Pickup ──────────────────────────────

export const PICKUP_RADIUS = 0.6;
export const VITAL_SMALL = 25;
export const VITAL_LARGE = 50;
export const VITAL_MAX = 100;
export const EXIT_RADIUS = 1.5;
export const PICKUP_SPIN_MS = 400;

// ───────────────────────────── Doors ─────────────────────────────

export const DOOR_OPEN_SPEED = 2.2;
export const DOOR_TRIGGER_RADIUS = 2.4;
export const SLIDE_OPEN_SPEED = 4;
export const SLIDE_TRIGGER_RADIUS = 4;

// ───────────────────────────── Timing / FX ───────────────────────────

export const SHOT_FX_DURATION = 0.09;
export const HURT_FX_DURATION = 0.35;
export const PICKUP_FX_DURATION = 0.3;
export const HIT_FLASH_DURATION = 0.12;

// deterministic (no wall-clock) so it stays unit-testable + SSR-safe.
export const ARC_DURATION = 0.35;

export const CHARGE_FLASH_PEAK = 0.92;
export const CHARGE_GLOW_PEAK = 0.7;
export const CHARGE_FLASH_DECAY_PER_S = 3;

export const ZONE_FADE = 0.35;

export const RESTART_DELAY = 1.2;

export const HINT_DURATION = 1.8;
