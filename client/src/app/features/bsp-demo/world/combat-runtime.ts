import {
  castRay,
  HEADROOM,
  movePlayer,
  PLAYER_RADIUS,
  STEP_MAX,
} from '../../../core/lib/bsp-engine';
import {
  ARMOR_ABSORB,
  CHARGE_FLASH_DECAY_PER_S,
  CHARGE_GLOW_PEAK,
  ENEMY_FIRE_INTERVAL,
  ENEMY_SPEED,
  fireWeapon,
  HIT_FLASH_DURATION,
  HURT_FX_DURATION,
  nextOwnedIndex,
  PLAYER_MAX_HEALTH,
  RESERVE_START,
  SHOT_FX_DURATION,
  stepArsenal,
  type CombatEnemy,
  type CombatFrame,
  type PlayerCombatFrame,
} from '../../../core/lib';
import {
  AMMO_MAX,
  ARSENAL,
  STARTING_WEAPON_IDS,
  reloadViewConfig,
  weaponCombat,
  weaponViewConfig,
} from '../../../shared/game/weapons';
import { WeaponView } from '../../../shared/game/weapon-view';
import { ClimbView } from '../../../shared/game/climb-view';
import { DoomHud } from '../../../shared/game/doom-hud';
import { projectileWidth } from '../render/load-textures';
import type { ViewState } from '../render/view-state';
import type { FxPools } from './fx-pools';
import type { WarmZone } from './zone-world';

// DEBUG stress mode (toggle G): a load test for the MAIN-THREAD budget under a real fight — synthetic enemies
// run a per-frame AI cost (line-of-sight castRay + collision chase) and fire projectiles, ramping in number.
// (The gameplay-feel knobs the synthetic fight reuses — ENEMY_SPEED / ENEMY_FIRE_INTERVAL — live in the
// central balance sheet; these STRESS_* dials are a dev harness, not player-facing feel, so they stay here.)
const STRESS_MAX = 64; // peak synthetic enemies the ramp climbs to
const STRESS_RAMP_STEP = 8; // enemies added per ramp tick
const STRESS_RAMP_INTERVAL = 2; // seconds between ramp ticks
const STRESS_SHOT_CAP = 150; // hard ceiling on synthetic shots in flight, so a runaway flux can't lock the loop

/** One synthetic stress-mode enemy: a world pose + its fire cooldown. Read by the renderer as a billboard. */
export interface StressEnemy {
  x: number;
  y: number;
  z: number;
  cooldown: number;
}

/** The between-subsystem seams the combat runtime needs but does NOT own: the render/aim {@link ViewState} (the
 *  shared camera's firing pose + the render config the aim-slope projection reads), the {@link DoomHud} (the
 *  hurt path makes the face react), the {@link FxPools} the shots feed (projectiles / impacts / arcs — pushed
 *  into by reference through the STABLE holder, so a zone reset / seam crossing clearing them stays visible
 *  here without a per-array thunk), and the ACTIVE zone world (enemies / barrels / slides it fights over). */
export interface CombatRuntimeHooks {
  /** The render/aim view — the shared camera's firing pose + the live resolution/fov the aim-slope reads. */
  readonly view: ViewState;
  /** The transient in-world FX pools the shots feed — pushed into by reference through the stable holder. */
  readonly fx: FxPools;
  /** The DOOM status bar — a landed hit makes its face react (`onHit`). Owned by the component. */
  readonly hud: DoomHud;
  /** The ACTIVE zone world (enemies / barrels / slides / obstacles) the player fights over, by reference. */
  world(): WarmZone;
}

/**
 * The PLAYER-COMBAT subsystem of the BSP game: it owns the player's combat + inventory state (health, armour,
 * the death / win latch, the magazine + reserve pools, the owned-weapon progression + active viewmodel, the
 * fire / reload edges + cooldowns, and every screen-feedback timer) and every method that mutates it — hurt /
 * die, the enemy + hitscan / projectile combat frames, the weapon fire step, the arsenal switch + reload, the
 * debug stress load, and the new-game reset. It operates on the {@link ZoneRuntime} world + the component's
 * transient FX BY REFERENCE (via {@link CombatRuntimeHooks}); it never owns geometry, the camera, or the FX
 * pools. The component stays the coordinator: it drives the frame order (advance → the pure steppers over the
 * frames this builds → the weapon step on the blit's drawDt) and grants pickups through the small grant API.
 */
export class CombatRuntime {
  private health = PLAYER_MAX_HEALTH; // player health — drained by enemy strikes/blasts/clips, refilled by coffee pickups
  private armorValue = 0; // player armour — soaks a fraction of each hit, refilled by RAM-stick pickups
  private isDead = false; // hp hit 0 → the world freezes under a game-over wash until a click restarts
  private deadTimer = 0; // seconds since death (gates the restart + fades the game-over wash in)
  private hasWon = false; // reached the exit → the level-complete wash, frozen until a click restarts
  private wonTimer = 0; // seconds since the win (gates the restart + fades the wash in)
  private readonly magazine = ARSENAL.map((weapon) => weapon.magSize ?? 0); // loaded rounds per weapon
  private readonly reservePool = new Map<string, number>(); // ammo-type → reserve pool (lazily seeded)
  private activeWeapon = 0; // the active arsenal position (the 1..8 key row)
  private readonly owned = new Set<string>(STARTING_WEAPON_IDS); // the unlocked-weapon inventory (fists-only at start)
  private held = false; // mouse held → automatic fire
  private edge = false; // mousedown landed this frame → one semi-auto shot
  private reloadRequest = false; // R pressed this frame → start a reload
  private fireCooldown = 0; // seconds until the active weapon can fire again
  private reloadClock = 0; // seconds left on the active weapon's reload
  private shot = 0; // seconds left on the muzzle-flash + impact-spark feedback
  private hurt = 0; // seconds left on the red damage flash (player took a hit)
  private charge = 0; // 0..1 live green charge-buildup tint while the BFG spins up
  private discharge = 0; // 0..1 green discharge flash on a BFG shot, decayed each frame
  private view = new WeaponView(
    ARSENAL[0],
    weaponViewConfig(ARSENAL[0]),
    reloadViewConfig(ARSENAL[0]),
  );
  private readonly climb = new ClimbView(); // the two-handed mantle pull, shown over the weapon mid-vault
  private stressOn = false; // DEBUG: synthetic-enemy stress load engaged
  private stressRoster: StressEnemy[] = []; // the live synthetic enemies
  private stressClock = 0; // ramp timer
  private stressAiMs = 0; // measured per-frame AI cost (LOS + chase) — logged to telemetry to isolate it from render

  constructor(private readonly hooks: CombatRuntimeHooks) {}

  // --- Read seams the HUD / overlays / pickups / coordinator need (LIVE references, never copies). --------

  public get hp(): number {
    return this.health;
  }

  public get armor(): number {
    return this.armorValue;
  }

  public get mag(): readonly number[] {
    return this.magazine;
  }

  public get reserve(): ReadonlyMap<string, number> {
    return this.reservePool;
  }

  public get weaponIndex(): number {
    return this.activeWeapon;
  }

  public get ownedWeapons(): ReadonlySet<string> {
    return this.owned;
  }

  public get weaponView(): WeaponView {
    return this.view;
  }

  public get climbView(): ClimbView {
    return this.climb;
  }

  public get dead(): boolean {
    return this.isDead;
  }

  public get deadClock(): number {
    return this.deadTimer;
  }

  public get won(): boolean {
    return this.hasWon;
  }

  public get wonClock(): number {
    return this.wonTimer;
  }

  public get shotFx(): number {
    return this.shot;
  }

  public get hurtFx(): number {
    return this.hurt;
  }

  public get chargeGlow(): number {
    return this.charge;
  }

  public get dischargeFlash(): number {
    return this.discharge;
  }

  public get stressEnemies(): readonly StressEnemy[] {
    return this.stressRoster;
  }

  public get stressEnemyCount(): number {
    return this.stressRoster.length;
  }

  public get aiMs(): number {
    return this.stressAiMs;
  }

  // --- Input edges the component's handlers drive. -------------------------------------------------------

  /** Primary (left) mouse down: hold the auto-fire trigger AND arm one semi-auto edge for this frame. */
  public beginFire(): void {
    this.held = true;
    this.edge = true;
  }

  /** Release the held auto-fire (mouse up, and whenever a transition / win freezes the fight). */
  public endFire(): void {
    this.held = false;
  }

  /** Request a reload — {@link stepArsenal} stages it (reserve → mag over the weapon's reloadTime) next frame. */
  public reload(): void {
    this.reloadRequest = true;
  }

  /** Toggle the DEBUG synthetic-enemy stress load; turning it off clears the roster + its measured AI cost. */
  public toggleStress(): void {
    this.stressOn = !this.stressOn;
    if (!this.stressOn) {
      this.stressRoster = [];
      this.stressClock = 0;
      this.stressAiMs = 0;
    }
  }

  // --- The grant API the PickupRuntime (and the debug keys) call to actuate a collected item. ------------

  /** Refill health by `amount`, capped at the player's ceiling (the coffee pickup + the debug heal). */
  public heal(amount: number): void {
    this.health = Math.min(PLAYER_MAX_HEALTH, this.health + amount);
  }

  /** Top the armour up by `amount`, capped at the player's ceiling (the RAM-stick pickup). */
  public addArmor(amount: number): void {
    this.armorValue = Math.min(PLAYER_MAX_HEALTH, this.armorValue + amount);
  }

  /** Add `amount` rounds to an ammo type's reserve, clamped to `max` (an ammo box / a weapon's starter dose). */
  public addAmmo(ammoType: string, amount: number, max: number): void {
    this.reservePool.set(ammoType, Math.min(max, (this.reservePool.get(ammoType) ?? 0) + amount));
  }

  /** The current reserve of an ammo type (0 if never seeded) — the pickup collision reads it to decide. */
  public reserveOf(ammoType: string): number {
    return this.reservePool.get(ammoType) ?? 0;
  }

  /** Whether the run already owns a weapon id (a repeat pickup only tops the reserve up, never auto-equips). */
  public owns(id: string): boolean {
    return this.owned.has(id);
  }

  /** Unlock a weapon id for the rest of the run (the DOOM progression — inventory survives zone swaps). */
  public grantWeapon(id: string): void {
    this.owned.add(id);
  }

  /** Refill every weapon's magazine to its full size (the new-game loadout). */
  public refillMag(): void {
    ARSENAL.forEach((weapon, index) => (this.magazine[index] = weapon.magSize ?? 0));
  }

  // --- End-state latches the component's coordinator drives. ---------------------------------------------

  /** The world is frozen under the game-over wash: age the restart clock while dead. */
  public tickDeadClock(dt: number): void {
    this.deadTimer += dt;
  }

  /** The world is frozen under the level-complete wash: age the restart clock while won. */
  public tickWonClock(dt: number): void {
    this.wonTimer += dt;
  }

  /** Reached the exit: latch the level-complete wash + drop the held trigger so nothing fires under it. */
  public win(): void {
    this.hasWon = true;
    this.wonTimer = 0;
    this.held = false;
  }

  // --- Per-frame combat. --------------------------------------------------------------------------------

  /** Fade the per-frame screen-feedback timers (muzzle flash, red hurt flash, the BFG discharge flash). Runs
   *  every frame — including while dead / won — exactly as the monolithic `advance` faded them at its top. */
  public decayFx(dt: number): void {
    this.shot = Math.max(0, this.shot - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.discharge = Math.max(0, this.discharge - CHARGE_FLASH_DECAY_PER_S * dt);
  }

  /** The ACTIVE zone's {@link CombatFrame}: the live map/foes, the real player, the real hurt. */
  public activeFrame(): CombatFrame {
    const world = this.hooks.world();

    return {
      map: world.map,
      slides: world.slides,
      obstacles: world.obstacles,
      enemies: world.enemies,
      shots: world.enemyShots,
      px: this.hooks.view.camera.x,
      py: this.hooks.view.camera.y,
      hurt: (dmg) => this.hurtPlayer(dmg),
    };
  }

  /** The active zone's {@link PlayerCombatFrame}: the live map/barrels/foes + shared projectile pool + the
   *  camera's firing pose, with the shell's side-effect callbacks (hurt a foe, queue an impact/arc, resolve a
   *  projectile kind's width). The pure hitscan / projectile steppers read + mutate the shared arrays. */
  public playerCombatFrame(): PlayerCombatFrame {
    const world = this.hooks.world();
    const camera = this.hooks.view.camera;

    return {
      map: world.map,
      slides: world.slides,
      targets: world.targets,
      enemies: world.enemies,
      projectiles: this.hooks.fx.projectiles,
      cameraX: camera.x,
      cameraY: camera.y,
      cameraZ: camera.z,
      angle: camera.angle,
      vSlope: this.aimVerticalSlope(),
      hurtEnemy: (enemy, dmg) => this.hurtEnemy(enemy, dmg),
      addImpact: (kind, x, y, z) => this.spawnImpact(kind, x, y, z),
      addArc: (arc) => this.hooks.fx.arcs.push(arc),
      projectileWidth,
    };
  }

  /** A landed enemy strike: armour soaks a fraction of the hit (the rest drains hp), fire the red damage flash,
   *  make the HUD face react, and on hp 0 enter the game-over state. */
  public hurtPlayer(dmg: number): void {
    if (this.isDead) {
      return;
    }
    const soak = Math.min(this.armorValue, Math.floor(dmg * ARMOR_ABSORB));

    this.armorValue -= soak;
    this.health = Math.max(0, this.health - (dmg - soak));
    this.hurt = HURT_FX_DURATION;
    this.hooks.hud.onHit();
    if (this.health === 0) {
      this.die();
    }
  }

  /** Apply `dmg` to a living enemy: flash it, and on hp ≤ 0 switch it to the death animation. The BSP-game's
   *  {@link PlayerCombatFrame} routes every foe hit (direct + splash) through here — the flash/kill timing
   *  stays in the shell, off the pure combat math. */
  public hurtEnemy(enemy: CombatEnemy, dmg: number): void {
    enemy.hp -= dmg;
    enemy.hitFlash = HIT_FLASH_DURATION;
    if (enemy.hp <= 0) {
      enemy.dying = true;
      enemy.deathTime = 0;
    }
  }

  /** Queue an impact burst (`kind` from `effects.json`) at a world point — drawn + aged out by the impact
   *  system. An empty kind (a weapon with no mapped impact) spawns nothing. */
  public spawnImpact(kind: string, x: number, y: number, z: number): void {
    if (kind !== '') {
      this.hooks.fx.impacts.push({ kind, x, y, z, age: 0 });
    }
  }

  // --- Weapon switching + progression. ------------------------------------------------------------------

  /** Per-arsenal-position owned flags (the 1..8 key row) — the shape the pure cycling/HUD logic reads. */
  public ownedFlags(): boolean[] {
    return ARSENAL.map((weapon) => this.owned.has(weapon.id));
  }

  /** Cycle across OWNED weapons only in `dir` (the mouse wheel) — with the fists-only start the wheel stays
   *  put until pickups light more of the arms row. */
  public cycleWeapon(dir: number): void {
    this.selectWeapon(nextOwnedIndex(this.ownedFlags(), this.activeWeapon, dir));
  }

  /** Switch to an arsenal slot (0-based) — rebuilds the viewmodel for the new weapon. An UNOWNED slot is
   *  inert (the DOOM progression: a number key does nothing until its weapon has been picked up). */
  public selectWeapon(index: number): void {
    if (
      index < 0 ||
      index >= ARSENAL.length ||
      index === this.activeWeapon ||
      !this.owned.has(ARSENAL[index].id)
    ) {
      return;
    }
    this.activeWeapon = index;
    this.fireCooldown = 0;
    this.reloadClock = 0;
    const weapon = ARSENAL[index];

    this.view = new WeaponView(weapon, weaponViewConfig(weapon), reloadViewConfig(weapon));
  }

  // --- The weapon fire step (the drawWeapon COMBAT half — the VISUAL half is the weapon painter). ---------

  /** Advance the held weapon's fire logic on the blit's `drawDt` (NOT the advance dt): drive the viewmodel,
   *  feed its fire edge to the shared core {@link stepArsenal} (which spends the mag), resolve any shot, and
   *  update the muzzle / charge feedback. Mid-mantle the two-handed climb pull REPLACES the weapon, so drop any
   *  queued fire/reload edge and step nothing (the painter draws the climb). Mirrors the monolithic split: the
   *  step runs BEFORE the weapon is painted, so its `shotFx` feeds the same frame's crosshair. */
  public stepWeapon(dt: number, mantleActive: boolean): void {
    if (mantleActive) {
      this.edge = false;
      this.reloadRequest = false;

      return;
    }
    const weapon = ARSENAL[this.activeWeapon];
    const combat = weaponCombat(weapon);
    const mode = weapon.fireMode ?? 'semi';
    const fireIntent = this.driveViewmodel(combat, mode, dt);

    this.resolveArsenal(combat, mode, dt, fireIntent);
  }

  // --- The DEBUG stress load (toggle G). ----------------------------------------------------------------

  /** DEBUG stress mode (toggle G): ramp synthetic enemies and run a realistic per-frame AI cost — a line-of-
   *  sight `castRay` for EVERY enemy + a collision-aware chase + a projectile flux — to load-test the MAIN
   *  thread (where AI + projectile stepping live, serial, while the workers render in parallel). `aiMs` is
   *  measured so the telemetry separates the AI cost from the render cost. No-op until toggled. */
  public stepStress(dt: number): void {
    if (!this.stressOn) {
      return;
    }
    this.stressClock += dt;
    const want = Math.min(
      STRESS_MAX,
      STRESS_RAMP_STEP * (1 + Math.floor(this.stressClock / STRESS_RAMP_INTERVAL)),
    );

    while (this.stressRoster.length < want) {
      this.stressRoster.push({
        x: 1 + Math.random() * 13,
        y: 1 + Math.random() * 10,
        z: 0,
        cooldown: Math.random() * ENEMY_FIRE_INTERVAL,
      });
    }

    const t0 = performance.now();
    const reach = ENEMY_SPEED * dt;
    const world = this.hooks.world();
    const camera = this.hooks.view.camera;

    for (const e of this.stressRoster) {
      const dx = camera.x - e.x;
      const dy = camera.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      // Line of sight = the per-enemy cost that scales the main thread. On LOS: chase (collision-aware) + fire.
      if (castRay(world.map, e.x, e.y, nx, ny, dist) === null) {
        const moved = movePlayer(
          world.map,
          e.x,
          e.y,
          nx * reach,
          ny * reach,
          PLAYER_RADIUS,
          STEP_MAX,
          HEADROOM,
          world.slides,
          false,
          world.obstacles,
        );

        e.x = moved.x;
        e.y = moved.y;
        e.z = moved.floorZ;
        e.cooldown -= dt;
        if (e.cooldown <= 0) {
          e.cooldown = ENEMY_FIRE_INTERVAL;
          this.fireEnemyShot(e.x, e.y, e.z, nx, ny);
        }
      }
    }
    this.stressAiMs = performance.now() - t0;
  }

  // --- The new-game reset (the player half; the component reloads the zone fresh). ----------------------

  /** Restore the player half of a NEW GAME: full vitals, the fists-only loadout + a full magazine, the seeded
   *  reserves, and the cleared end-state latch. The component pairs this with a fresh zone reload. */
  public resetPlayer(): void {
    this.isDead = false;
    this.deadTimer = 0;
    this.hasWon = false;
    this.wonTimer = 0;
    this.health = PLAYER_MAX_HEALTH;
    this.armorValue = 0;
    this.hurt = 0;
    // Back to the FISTS-ONLY loadout: every picked-up weapon is lost with the run. The fist is ARSENAL[0], so
    // the equip below stays owned.
    this.owned.clear();
    for (const id of STARTING_WEAPON_IDS) {
      this.owned.add(id);
    }
    this.activeWeapon = 0;
    this.view = new WeaponView(
      ARSENAL[0],
      weaponViewConfig(ARSENAL[0]),
      reloadViewConfig(ARSENAL[0]),
    );
    this.refillMag();
    this.seedReserves();
  }

  /** Seed every ammo type's reserve at spawn — RESERVE_START, clamped to each type's cap (so a low-cap type
   *  like batteries never starts over-full). The fight then runs on this + what the floor boxes top up. */
  public seedReserves(): void {
    for (const [type, max] of Object.entries(AMMO_MAX)) {
      this.reservePool.set(type, Math.min(max, RESERVE_START));
    }
  }

  // --- Private internals (kept below the public surface, per the member-ordering rule). ------------------

  /** hp hit 0: freeze the world under a game-over wash. A click after the settle delay runs {@link resetPlayer}. */
  private die(): void {
    this.isDead = true;
    this.deadTimer = 0;
    this.held = false;
  }

  /** Vertical climb of the aim line per cell of forward depth, from the camera pitch (a screen y-shear): the
   *  crosshair points at `camera.z + slope·depth`, so looking up raises where a hitscan lands downrange. */
  private aimVerticalSlope(): number {
    const config = this.hooks.view.config;
    const focal = config.width / 2 / Math.tan(config.fov / 2);

    return ((this.hooks.view.camera.pitch ?? 0) * (config.height / 2)) / focal;
  }

  /** Drive the active weapon's viewmodel for the tick and report its fire intent. AUTO fires off the held
   *  trigger; SEMI / CHARGE start the swing (or the BFG spin-up) on the press edge and fire on the strike /
   *  discharge edge `tick` reports (the BFG holds its charge frame for `chargeTime` first). */
  private driveViewmodel(
    combat: ReturnType<typeof weaponCombat>,
    mode: string,
    dt: number,
  ): boolean {
    const mag = this.magazine[this.activeWeapon];
    const ready = this.reloadClock <= 0;

    if (mode === 'auto') {
      const firing = this.held && (combat.magSize === 0 || (mag > 0 && ready));

      if (this.held && combat.magSize > 0 && !firing) {
        this.view.dryFire(); // held but empty / mid-reload → a dry click, no loop
      }
      this.view.setFiring(firing);
      this.view.tick(dt);

      return firing;
    }
    const loaded = combat.magSize === 0 || (mag >= combat.ammoPerShot && ready);

    if (this.edge && !(mode === 'charge' && this.view.swinging())) {
      if (loaded) {
        this.view.tryTrigger();
      } else if (combat.magSize > 0) {
        this.view.dryFire();
      }
    }

    return this.view.tick(dt);
  }

  /** Feed the tick's fire intent to the core magazine subsystem, spend the mag/reserve/cooldown, resolve the
   *  hit (a projectile launch or a hitscan) on a `fired` tick, and update the muzzle + BFG charge feedback. */
  private resolveArsenal(
    combat: ReturnType<typeof weaponCombat>,
    mode: string,
    dt: number,
    fireIntent: boolean,
  ): void {
    const ammoType = combat.ammoType;
    const reserve = ammoType !== null ? (this.reservePool.get(ammoType) ?? RESERVE_START) : 0;
    const result = stepArsenal(
      combat,
      {
        fireCooldown: this.fireCooldown,
        mag: this.magazine[this.activeWeapon],
        reserve,
        reloadClock: this.reloadClock,
      },
      { fire: fireIntent, reload: this.reloadRequest },
      dt,
    );

    this.fireCooldown = result.fireCooldown;
    this.magazine[this.activeWeapon] = result.mag;
    this.reloadClock = result.reloadClock;
    if (ammoType !== null) {
      this.reservePool.set(ammoType, result.reserve);
    }
    if (result.fired) {
      this.shot = SHOT_FX_DURATION; // muzzle flash either way
      fireWeapon(this.playerCombatFrame(), combat); // launch a projectile or resolve a hitscan
    }

    // The BFG's live green charge-buildup tint while spinning up, and a bright green flash on the discharge.
    this.charge = this.view.charging() ? this.view.chargeProgress() * CHARGE_GLOW_PEAK : 0;
    if (mode === 'charge' && result.fired) {
      this.discharge = 1;
    }
    this.edge = false;
    this.reloadRequest = false;

    this.view.setReloadProgress(
      combat.reloadTime > 0 && result.reloadClock > 0
        ? 1 - result.reloadClock / combat.reloadTime
        : null,
    );
  }

  /** A synthetic enemy shot toward the player — reuses the player projectile system (stepped + collided each
   *  frame), so it loads `stepProjectiles`. Capped so a runaway flux can't lock the loop. */
  private fireEnemyShot(x: number, y: number, z: number, nx: number, ny: number): void {
    const projectiles = this.hooks.fx.projectiles;

    if (projectiles.length > STRESS_SHOT_CAP) {
      return;
    }
    const width = projectileWidth('nail') ?? 0.45;

    projectiles.push({
      x,
      y,
      z: z + 1,
      dx: nx,
      dy: ny,
      vSlope: 0,
      speed: 7,
      kind: 'nail',
      impactKind: 'impact_metal',
      damage: 0, // debug stress shots don't damage the real enemies
      radius: width / 2,
      splashR: 0,
      chain: null,
      traveled: 0,
      alive: true,
    });
  }
}
