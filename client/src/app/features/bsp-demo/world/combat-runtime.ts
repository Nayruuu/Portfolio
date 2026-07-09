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
} from '../../../core/lib/game/presentation/weapons';
import { WeaponView } from '../../../core/lib/game/presentation/weapon-view';
import { ClimbView } from '../../../core/lib/game/presentation/climb-view';
import { DoomHud } from '../../../core/lib/game/presentation/doom-hud';
import { projectileWidth } from '../render/load-textures';
import type { ViewState } from '../render/view-state';
import type { FxPools } from './fx-pools';
import type { WarmZone } from './zone-world';

// DEBUG stress harness (toggle G): dev-only load-test dials, kept here rather than in the player-facing
// balance sheet. The gameplay-feel knobs it reuses (ENEMY_SPEED / ENEMY_FIRE_INTERVAL) live centrally.
const STRESS_MAX = 64;
const STRESS_RAMP_STEP = 8;
const STRESS_RAMP_INTERVAL = 2;
const STRESS_SHOT_CAP = 150; // ceiling on synthetic shots in flight, so a runaway flux can't lock the loop

export interface StressEnemy {
  x: number;
  y: number;
  z: number;
  cooldown: number;
}

export interface CombatRuntimeHooks {
  readonly view: ViewState;
  readonly fx: FxPools;
  readonly hud: DoomHud;
  world(): WarmZone;
}

export class CombatRuntime {
  private health = PLAYER_MAX_HEALTH;
  private armorValue = 0;
  private isDead = false;
  private deadTimer = 0;
  private hasWon = false;
  private wonTimer = 0;
  private readonly magazine = ARSENAL.map((weapon) => weapon.magSize ?? 0);
  private readonly reservePool = new Map<string, number>();
  private activeWeapon = 0;
  private readonly owned = new Set<string>(STARTING_WEAPON_IDS);
  private held = false;
  private edge = false;
  private reloadRequest = false;
  private fireCooldown = 0;
  private reloadClock = 0;
  private shot = 0;
  private hurt = 0;
  private charge = 0; // 0..1
  private discharge = 0; // 0..1
  private view = new WeaponView(
    ARSENAL[0],
    weaponViewConfig(ARSENAL[0]),
    reloadViewConfig(ARSENAL[0]),
  );
  private readonly climb = new ClimbView();
  private stressOn = false;
  private stressRoster: StressEnemy[] = [];
  private stressClock = 0;
  private stressAiMs = 0;

  constructor(private readonly hooks: CombatRuntimeHooks) {}

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

  public beginFire(): void {
    this.held = true;
    this.edge = true;
  }

  public endFire(): void {
    this.held = false;
  }

  public reload(): void {
    this.reloadRequest = true;
  }

  public toggleStress(): void {
    this.stressOn = !this.stressOn;
    if (!this.stressOn) {
      this.stressRoster = [];
      this.stressClock = 0;
      this.stressAiMs = 0;
    }
  }

  public heal(amount: number): void {
    this.health = Math.min(PLAYER_MAX_HEALTH, this.health + amount);
  }

  public addArmor(amount: number): void {
    this.armorValue = Math.min(PLAYER_MAX_HEALTH, this.armorValue + amount);
  }

  public addAmmo(ammoType: string, amount: number, max: number): void {
    this.reservePool.set(ammoType, Math.min(max, (this.reservePool.get(ammoType) ?? 0) + amount));
  }

  public reserveOf(ammoType: string): number {
    return this.reservePool.get(ammoType) ?? 0;
  }

  public owns(id: string): boolean {
    return this.owned.has(id);
  }

  public grantWeapon(id: string): void {
    this.owned.add(id);
  }

  public refillMag(): void {
    ARSENAL.forEach((weapon, index) => (this.magazine[index] = weapon.magSize ?? 0));
  }

  public tickDeadClock(dt: number): void {
    this.deadTimer += dt;
  }

  public tickWonClock(dt: number): void {
    this.wonTimer += dt;
  }

  public win(): void {
    this.hasWon = true;
    this.wonTimer = 0;
    this.held = false;
  }

  // Runs every frame — including while dead / won.
  public decayFx(dt: number): void {
    this.shot = Math.max(0, this.shot - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.discharge = Math.max(0, this.discharge - CHARGE_FLASH_DECAY_PER_S * dt);
  }

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

  public hurtEnemy(enemy: CombatEnemy, dmg: number): void {
    enemy.hp -= dmg;
    enemy.hitFlash = HIT_FLASH_DURATION;
    if (enemy.hp <= 0) {
      enemy.dying = true;
      enemy.deathTime = 0;
    }
  }

  public spawnImpact(kind: string, x: number, y: number, z: number): void {
    if (kind !== '') {
      this.hooks.fx.impacts.push({ kind, x, y, z, age: 0 });
    }
  }

  public ownedFlags(): boolean[] {
    return ARSENAL.map((weapon) => this.owned.has(weapon.id));
  }

  public cycleWeapon(dir: number): void {
    this.selectWeapon(nextOwnedIndex(this.ownedFlags(), this.activeWeapon, dir));
  }

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

  // On the blit's `drawDt` (NOT the advance dt). Mid-mantle the climb pull replaces the weapon → drop any
  // queued fire/reload edge and step nothing.
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

  public resetPlayer(): void {
    this.isDead = false;
    this.deadTimer = 0;
    this.hasWon = false;
    this.wonTimer = 0;
    this.health = PLAYER_MAX_HEALTH;
    this.armorValue = 0;
    this.hurt = 0;
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

  public seedReserves(): void {
    for (const [type, max] of Object.entries(AMMO_MAX)) {
      this.reservePool.set(type, Math.min(max, RESERVE_START));
    }
  }

  private die(): void {
    this.isDead = true;
    this.deadTimer = 0;
    this.held = false;
  }

  // Aim-line vertical slope from camera pitch (a screen y-shear): a hitscan lands at camera.z + slope·depth.
  private aimVerticalSlope(): number {
    const config = this.hooks.view.config;
    const focal = config.width / 2 / Math.tan(config.fov / 2);

    return ((this.hooks.view.camera.pitch ?? 0) * (config.height / 2)) / focal;
  }

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
        this.view.dryFire();
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
      this.shot = SHOT_FX_DURATION;
      fireWeapon(this.playerCombatFrame(), combat);
    }

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
