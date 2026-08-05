import type { Camera, MutableSector } from '../../bsp-engine';
import {
  DOOR_TRIGGER_RADIUS,
  EXIT_RADIUS,
  HINT_DURATION,
  PICKUP_FX_DURATION,
  PICKUP_RADIUS,
  WEAPON_PICKUP_RADIUS,
  SLIDE_TRIGGER_RADIUS,
} from '../game-tuning';
import { shouldAutoEquip } from '../weapons';
import { stepDoorOpenness, stepSlideOpenness } from '../doors';
import type { KeycardColor } from '../types';
import { weaponAmmoDose, type WeaponPickupSpec } from './pickups';
import { ARSENAL, ammoTypeMax } from '../presentation/weapons';
import type { DoomHud } from '../presentation/doom-hud';
import type { Door, SlidingDoor, WarmZone, ZoneExit } from './zone-world';

export interface PickupGrant {
  heal(amount: number): void;
  addArmor(amount: number): void;
  addAmmo(ammoType: string, amount: number, max: number): void;
  reserveOf(ammoType: string): number;
  owns(id: string): boolean;
  grantWeapon(id: string): void;
  selectWeapon(index: number): void;
  endFire(): void;
  win(): void;
}

export interface PickupZone {
  readonly world: WarmZone;
  readonly exits: readonly ZoneExit[];
  readonly slidingDoors: readonly SlidingDoor[];
  readonly transition: object | null;
  exitsLocked: boolean;
  beginTransition(to: string, entry: string): void;
  applyDoors(doors: readonly Door[], sectors: MutableSector[]): void;
}

export interface PickupRuntimeHooks {
  readonly camera: Camera;
  readonly hud: DoomHud;
  readonly combat: PickupGrant;
  readonly zone: PickupZone;
}

export class PickupRuntime {
  private readonly badges = new Set<KeycardColor>();
  private flash = 0;
  private hintClock = 0;
  private inspectPickups = false; // true = ammo boxes spin but are never collected (art-inspection mode)

  constructor(private readonly hooks: PickupRuntimeHooks) {}

  public get pickupFx(): number {
    return this.flash;
  }

  public setInspectMode(on: boolean): void {
    this.inspectPickups = on;
  }

  public get hint(): number {
    return this.hintClock;
  }

  // Runs every frame — including while dead / won / mid-transition.
  public decayFx(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
  }

  public stepPickups(dt: number): void {
    this.collectVitals(dt);
    this.collectAmmoBoxes(dt);
    this.collectWeaponPickups(dt);
  }

  public stepObjective(dt: number): void {
    const zone = this.hooks.zone;
    const world = zone.world;
    const camera = this.hooks.camera;

    this.hintClock = Math.max(0, this.hintClock - dt);
    world.keycards = world.keycards.filter((k) => {
      k.age += dt;
      if (Math.hypot(k.x - camera.x, k.y - camera.y) >= PICKUP_RADIUS) {
        return true;
      }
      this.badges.add(k.spec.color);
      this.hooks.hud.addCard(k.spec.color);
      this.flash = PICKUP_FX_DURATION;

      return false;
    });
    if (zone.transition === null) {
      const inside = zone.exits.find(
        (e) => Math.hypot(e.x - camera.x, e.y - camera.y) < EXIT_RADIUS,
      );

      if (zone.exitsLocked) {
        zone.exitsLocked = inside !== undefined;
      } else if (inside !== undefined) {
        zone.beginTransition(inside.to, inside.entry);
        this.hooks.combat.endFire();
      }
    }
    if (
      world.exit !== null &&
      Math.hypot(world.exit.x - camera.x, world.exit.y - camera.y) < EXIT_RADIUS
    ) {
      this.hooks.combat.win();
    }
  }

  public stepDoors(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    for (const door of world.doors) {
      const near =
        Math.hypot(door.triggerX - camera.x, door.triggerY - camera.y) < DOOR_TRIGGER_RADIUS;
      const mayOpen = door.requiresCard === null || this.badges.has(door.requiresCard);

      door.openness = stepDoorOpenness(door.openness, dt, near, mayOpen);
      if (near && !mayOpen && door.openness === 0) {
        this.hintClock = HINT_DURATION;
      }
    }
    this.hooks.zone.applyDoors(world.doors, world.sectors);
  }

  public stepSliding(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    for (const s of this.hooks.zone.slidingDoors) {
      const near = Math.hypot(s.mx - camera.x, s.my - camera.y) < SLIDE_TRIGGER_RADIUS;

      world.slides[s.line] = stepSlideOpenness(world.slides[s.line], dt, near);
    }
  }

  // clearBadges=false is the death respawn: colours gate exactly once, so stripping a spent badge
  // can seal the player behind its own door with no way to re-earn it (M6 CEO pocket ⇄ M7 red door).
  public reset(clearBadges: boolean): void {
    if (clearBadges) {
      this.badges.clear();
      this.hooks.hud.clearCards();
    }
    this.hintClock = 0;
    this.flash = 0;
  }

  private collectVitals(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.vitals = world.vitals.filter((v) => {
      v.age += dt;
      if (Math.hypot(v.x - camera.x, v.y - camera.y) >= PICKUP_RADIUS) {
        return true;
      }
      if (v.spec.kind === 'health') {
        this.hooks.combat.heal(v.spec.amount);
      } else {
        this.hooks.combat.addArmor(v.spec.amount);
      }
      this.flash = PICKUP_FX_DURATION;

      return false;
    });
  }

  private collectAmmoBoxes(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.ammoBoxes = world.ammoBoxes.filter((b) => {
      b.age += dt;

      if (this.inspectPickups) {
        return true;
      }
      const reserve = this.hooks.combat.reserveOf(b.spec.ammoType);

      if (Math.hypot(b.x - camera.x, b.y - camera.y) >= PICKUP_RADIUS || reserve >= b.spec.max) {
        return true;
      }
      this.hooks.combat.addAmmo(b.spec.ammoType, b.spec.amount, b.spec.max);
      this.flash = PICKUP_FX_DURATION;

      return false;
    });
  }

  private collectWeaponPickups(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.weaponPickups = world.weaponPickups.filter((p) => {
      p.age += dt;
      if (Math.hypot(p.x - camera.x, p.y - camera.y) >= WEAPON_PICKUP_RADIUS) {
        return true;
      }
      this.collectWeapon(p.spec);

      return false;
    });
  }

  private collectWeapon(spec: WeaponPickupSpec): void {
    const index = ARSENAL.findIndex((weapon) => weapon.id === spec.id);
    const alreadyOwned = this.hooks.combat.owns(spec.id);

    this.hooks.combat.grantWeapon(spec.id);
    const dose = weaponAmmoDose(spec.ammoType);

    if (spec.ammoType !== null && dose > 0) {
      this.hooks.combat.addAmmo(spec.ammoType, dose, ammoTypeMax(spec.ammoType));
    }
    if (shouldAutoEquip(alreadyOwned)) {
      this.hooks.combat.selectWeapon(index);
    }
    this.flash = PICKUP_FX_DURATION;
  }
}
