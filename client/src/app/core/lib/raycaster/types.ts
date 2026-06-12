/** Player position + facing, in map cells / radians. `z` is the OPTIONAL floor altitude under the player
 *  (world units; 0 = base level) — the camera renders from `z + eye height`, and movement keeps it on the
 *  floor. Optional (like `GameMap.diagonals`/`sectors`) so every existing flat pose stays valid; `move()`
 *  sets it, and consumers read `pose.z ?? 0`. All sectors are flat today, so it stays 0 until A2b/A2c. */
export interface Pose {
  x: number;
  y: number;
  z?: number;
  dir: number;
}

/** Lifecycle of a wandering enemy. */
export type EnemyState = 'alive' | 'dying' | 'dead';

/** Office antagonist kinds (drive the per-kind AI + sprite + projectile). */
export type EnemyKind =
  | 'manager'
  | 'printer'
  | 'hr'
  | 'middle_manager'
  | 'junior_office_drone'
  | 'security_guard';

/** One enemy: a wandering position + facing, plus its death animation timer. */
export interface Enemy {
  x: number;
  y: number;
  dir: number; // facing, radians (wander heading / aim)
  state: EnemyState;
  deathTime: number; // seconds elapsed since entering 'dying'
  hp: number; // hitscan hits remaining
  fireCooldown: number; // seconds until it can throw again
  hitFlash: number; // seconds remaining on the white hit-flash (0 = not flashing)
  windup: number; // seconds remaining before the telegraphed throw releases (0 = not winding up)
  kind: EnemyKind;
}

/** One frame of normalized input — same shape from fist, mouse, or touch. */
export interface MoveIntent {
  forward: number; // -1 (back) .. 1 (forward)
  strafe: number; // -1 (left) .. 1 (right)
  look: number; // turn delta this frame, radians (pre-sensitivity)
  fire: boolean; // edge-triggered: true for exactly one frame per shot
  reload: boolean; // edge-triggered: true for exactly one frame when a reload is requested (mirrors `fire`)
}

/** The chain-lightning rider on a projectile spec (the plasma cable): on impact the projectile hops
 *  between nearby enemies, each hop dealing `falloff^hop` of the base damage and drawing a visual `Arc`.
 *  `null` on a spec marks an AOE-only projectile (the rocket); the plasma sets it AND zeroes the splash,
 *  so the chain wholly replaces the splash. */
export interface ChainSpec {
  targets: number; // maximum hops beyond the directly-hit enemy
  range: number; // cells a hop reaches from the last-hit enemy
  falloff: number; // damage multiplier per hop (hop 1 = the first jump → `falloff^1`)
}

/** The blast a projectile weapon spawns instead of a hitscan ray — the splash half of a rocket / AOE
 *  weapon. `null` on a `WeaponCombat` marks the existing hitscan/melee path; non-null makes the fire step
 *  launch a travelling `PlayerProjectile` that detonates this spec on impact. (The direct-hit damage is
 *  `WeaponCombat.damage`; the blast knockback is `WeaponCombat.knockback` — both stay on the weapon.) */
export interface ProjectileSpec {
  speed: number; // cells/second the launched projectile travels
  splashDamage: number; // base blast damage, scaled by distance falloff over `splashRadius`
  splashRadius: number; // cells the blast reaches
  selfDamage: boolean; // whether the blast can hurt + rocket-jump the firing player
  chain: ChainSpec | null; // null = AOE-only (the rocket); non-null = the plasma chains between enemies on impact
  kind: string; // the projectile sprite name (a `projectiles` key in effects.json) the renderer billboards
}

/** A weapon reduced to the numbers the pure combat step needs — the shell derives one from the JSON
 *  arsenal (per-weapon `range`/`cone`/`fireCooldown`/`knockback`) so adding a weapon never touches core. */
export interface WeaponCombat {
  damage: number; // hp removed per landed hit (a projectile weapon's DIRECT-hit damage)
  range: number; // reach in cells
  cone: number; // aim half-angle, radians (wide for a melee swing, narrow for a ranged shot)
  fireCooldown: number; // seconds between hits
  knockback: number; // cells the hit enemy is shoved straight back (wall-clamped); also the blast shove for a projectile weapon
  costsAmmo: boolean; // whether a hit decrements `playerAmmo` (false for an ammo-less melee weapon)
  ammoType: string | null; // which `playerAmmo` reserve a reload / flat-pool shot draws from (null = ammo-less melee); non-null whenever `costsAmmo` or `magSize > 0`
  ammoPerShot: number; // rounds a single shot drains from the magazine (1 for every weapon but the BFG, which spends its whole 40-round mag at once)
  magSize: number; // rounds the active magazine holds (0 = no magazine — melee + any flat-pool weapon)
  reloadTime: number; // seconds a full reload takes (0 when the weapon has no magazine)
  pellets: number; // rays fired per shot: 1 = a single hitscan (the unchanged path); > 1 = a shotgun spread, fanned across `cone`, each ray landing on the nearest enemy it crosses
  selfKnockback: number; // cells the player recoils straight back on firing (the CO2 blast's self-recoil); 0 = none
  projectile: ProjectileSpec | null; // null = a hitscan / melee weapon (the existing path); non-null = launch a travelling projectile + AOE blast instead of a hitscan ray
  impactKind: string; // the hit-effect name (an `impacts` key in effects.json) the renderer plays at every hit (projectile detonation, hitscan, or melee)
}

/** One surface a ray crosses for a screen column: the perpendicular distance, the hit side (shading), the
 *  cell id (texture), and the per-cell + continuous wall coordinate (texturing). Shared by the OPAQUE wall
 *  hit (`ColumnProfile.terminal`) and each see-through glass pane in front of it (`ColumnProfile.glass`). */
export interface SurfaceHit {
  dist: number; // perpendicular distance (fish-eye corrected)
  side: 0 | 1; // 0 = x-facing wall, 1 = y-facing wall (for shading)
  cell: number; // cell id (> 0) — the texture index (an opaque wall id, or a glass id for a pane)
  texX: number; // 0..1 position WITHIN the hit cell's face (per-cell U)
  wallU: number; // continuous world coordinate along the wall (tangential) — lets a texture tile across many cells (square-pixel horizontal tiling); `texX` is its per-cell fraction
}

/** A vertical riser FACE between two open sectors whose floor or ceiling heights differ — a partial-height
 *  wall the sector raycaster emits. Projected + texture-mapped in the pure core; the renderer only blits it.
 *  (Sub-project A2b: the column profile below carries these; a globally-flat level emits none.) */
export interface StepSpan {
  kind: 'stepFloor' | 'stepCeil';
  depth: number; // perpendicular distance of the cell boundary the face stands on (fish-eye corrected)
  yTop: number; // screen-Y of the face's top edge
  yBottom: number; // screen-Y of the face's bottom edge
  vTop: number; // texture V at yTop (worldZ / WALL_HEIGHT) — so step textures align across risers
  vBottom: number; // texture V at yBottom
  side: 0 | 1; // boundary axis (for the same side-shade walls use)
  cell: number; // material id for the riser texture
  texX: number; // 0..1 position within the riser's face (per-cell U)
  wallU: number; // continuous tangential coordinate (square-pixel horizontal tiling, like a wall)
}

/** A visible FLOOR or CEILING strip at one sector's height, clamped to the column's occlusion window — the
 *  renderer fills rows `yTop..yBottom`, sampling the flat per row at `surfaceZ = camZ − worldZ`. */
export interface FlatSpan {
  kind: 'floor' | 'ceil';
  yTop: number; // screen-Y top edge (inclusive)
  yBottom: number; // screen-Y bottom edge
  worldZ: number; // the surface's world height — the renderer derives the sampling height from it
  material: number; // floor/ceil flat id (today's floorFlats / ceilFlats ids)
  nearDepth: number; // distance at the strip's near (lower-on-screen) edge — fog/shade
}

/** One draw command in a column profile: a partial-height riser or a floor/ceiling strip. */
export type ColumnSpan = StepSpan | FlatSpan;

/** Everything one screen column draws, NEAR→FAR. `terminal` + `glass` are byte-for-byte the old `RayHit`
 *  (the opaque wall + its see-through panes); `spans` is the NEW height geometry — empty on a flat column,
 *  so a flat level renders through the unchanged legacy path. The sector raycaster emits one per column. */
export interface ColumnProfile {
  terminal: SurfaceHit; // the opaque wall the ray stops at (same fields/values as the old RayHit)
  glass: SurfaceHit[]; // see-through panes crossed before it, near→far (unchanged semantics)
  spans: ColumnSpan[]; // inter-sector floor/ceil strips + risers, near→far, non-overlapping in screen-Y
  terminalTop: number; // screen-Y of the terminal wall's VISIBLE top — the residual occlusion window at the wall
  terminalBottom: number; // screen-Y of its visible bottom. The height-aware renderer draws the wall into this
  // band so it meets the floor/ceiling spans; the flat renderer keeps its own legacy projection.
  terminalVTop: number; // texture V (0=ceiling .. 1=floor) at `terminalTop` — the VISIBLE slice of the wall's
  terminalVBottom: number; // texture, so the renderer blits only that sub-range at true scale (no stretch when
  // the window is clipped by the screen edge or a nearer step). 0 / 1 on a flat, fully-visible wall.
}

/** Which thrown office item a projectile renders as. `'memo'` (HR) also slows the player on hit;
 *  `'clip'` is the junior office drone's spinning binder clip; `'spread'` is the security guard's
 *  spinning staple spray. */
export type ProjectileSkin = 'invite' | 'paper' | 'memo' | 'tps' | 'clip' | 'spread';

/** A travelling thrown item: position + velocity (cells/second) + which office item it is. */
export interface Projectile {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  skin: ProjectileSkin;
}

/** A travelling PLAYER projectile (the rocket — the first projectile the player fires, vs the enemies'
 *  thrown items above). It carries everything its detonation needs so the AOE step is self-contained:
 *  on impact (a wall or an enemy) it spawns an `Impact` animation and applies splash damage + knockback +
 *  the optional rocket-jump. The projectile-AOE subsystem the plasma (chain), BFG (charge), and the
 *  staple / nail (splash-less travellers) all reuse. */
export interface PlayerProjectile {
  x: number;
  y: number;
  vx: number; // cells/second
  vy: number; // cells/second
  directDamage: number; // hp removed from a directly-struck enemy (on top of its splash share)
  splashDamage: number; // base blast damage, scaled by distance falloff over `splashRadius`
  splashRadius: number; // cells the blast reaches
  knockback: number; // cells every blast-caught enemy (and the player, on a rocket-jump) is shoved from the blast
  selfDamage: boolean; // whether the blast can hurt + rocket-jump the firing player
  chain: ChainSpec | null; // carried from the launching spec — null = AOE-only (the rocket); non-null = chain on impact
  kind: string; // the projectile sprite name (a `projectiles` key in effects.json) the renderer billboards
  impactKind: string; // the impact effect played at detonation — carried from the FIRING weapon, so switching the active weapon mid-flight (an auto weapon never blocks the swap) keeps its own impact
}

/** A short-lived purely-visual hit IMPACT the renderer plays once at every hit — a projectile detonation,
 *  a hitscan ray, or a melee swing. `kind` selects the impact sprite-strip + timing from the effects
 *  config; `age` (seconds since the hit) picks the strip frame. Deterministic (no wall-clock) so it stays
 *  test- and SSR-safe; the step ages it out past a fixed `IMPACT_DURATION`. */
export interface Impact {
  x: number;
  y: number;
  kind: string; // the impact effect name (an `impacts` key in effects.json)
  age: number; // seconds elapsed since the hit
}

/** A short-lived purely-visual electric arc the renderer draws between two chained enemies (the plasma's
 *  chain-lightning). World cells; `age` is seconds since the hop, faded against the shared `ARC_DURATION`.
 *  Deterministic (no wall-clock) so it stays test- and SSR-safe. */
export interface Arc {
  ax: number; // world cell x of the hop's start enemy
  ay: number; // world cell y of the hop's start enemy
  bx: number; // world cell x of the hop's end enemy
  by: number; // world cell y of the hop's end enemy
  age: number; // seconds elapsed since the hop
}

/** What a floor pickup grants (the vitals — ammo is its own descriptor-driven `AmmoPickup`). */
export type PickupKind = 'health' | 'armor';

/** A floor item collected by walking over it. */
export interface Pickup {
  x: number;
  y: number;
  kind: PickupKind;
}

/** A rotating ammo box on the floor: a generic, descriptor-driven pickup that refills ONE ammo type's
 *  per-type reserve. Everything the pure collect step needs rides on the entity — `amount` granted and the
 *  `max` cap both come from the descriptor (sourced from `weapons.json` `ammo_types`), never hardcoded in
 *  the core — so the SAME code serves every ammo type by swapping the descriptor. `kind` is the descriptor
 *  id (e.g. `'box_staples'`, the same string-tag pattern as `PlayerProjectile.kind`) the renderer maps to
 *  the sprite strip; `age` is seconds since spawn — the spin clock the renderer reads to pick the frame. */
export interface AmmoPickup {
  x: number;
  y: number;
  kind: string; // descriptor id (maps to the sprite strip)
  ammoType: string; // which `playerAmmo` reserve it refills
  amount: number; // rounds granted on collect (from the descriptor)
  max: number; // reserve cap for this ammo type (from weapons.json `ammo_types`) — full → not consumed
  age: number; // seconds since spawn (the billboard's spin clock)
}

/** The three keycard colours, in bit order: red = bit 0, blue = bit 1, yellow = bit 2. The index in
 *  this tuple is BOTH the `heldKeys` bit and the door cell offset (`DOOR_BASE + index`). */
export const KEYCARD_COLORS = ['red', 'blue', 'yellow'] as const;

/** One keycard colour (derived from the tuple — no enum). */
export type KeycardColor = (typeof KEYCARD_COLORS)[number];

/** A keycard lying on the floor: walk over it to add its colour bit to `heldKeys`. */
export interface Keycard {
  x: number;
  y: number;
  color: KeycardColor;
}

/** The full mutable game state stepped each frame. */
export interface GameState {
  pose: Pose;
  enemies: Enemy[];
  kills: number;
  hits: number; // cumulative enemy-hits the player landed (drives the hit SFX)
  fireCooldown: number; // seconds until the weapon can fire again
  bobPhase: number; // weapon-bob accumulator, radians
  playerHp: number;
  playerArmor: number;
  playerAmmo: Readonly<Record<string, number>>; // per-ammo-type reserve (key = ammo type) a magazine reload draws from (and the ammo pickups feed)
  mag: number; // rounds loaded in the ACTIVE magazine weapon (ignored by melee/flat weapons; the shell stashes/restores a per-weapon mag on switch)
  reloadClock: number; // seconds remaining in the current reload (0 = not reloading)
  projectiles: Projectile[]; // enemy thrown items in flight
  playerProjectiles: PlayerProjectile[]; // the player's launched projectiles in flight
  impacts: Impact[]; // short-lived hit-impact animations (aged out by the step)
  arcs: Arc[]; // short-lived chain-lightning visuals (aged out by the step, like impacts)
  pickups: Pickup[];
  ammoPickups: AmmoPickup[]; // rotating ammo boxes on the floor (aged + collected by the step)
  keys: Keycard[]; // keycards still lying on the floor
  heldKeys: number; // bitmask of collected colours (bit = KEYCARD_COLORS index)
  hurtFlash: number; // seconds remaining on the red damage flash
  playerSlow: number; // seconds remaining on the HR "stuck in a meeting" slow
  mantle?: { progress: number; startZ: number; targetZ: number } | null; // non-null = mid auto-climb (horizontal movement frozen while the player is hoisted over a too-tall-but-climbable ledge)
}
