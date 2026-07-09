import { DoomHud } from '../../../shared/game/doom-hud';
import { gazeForTurn, smoothTurnRate } from '../../../shared/game/gaze';
import { ARSENAL } from '../../../shared/game/weapons';
import type { WeaponView } from '../../../shared/game/weapon-view';

/** Every field is the component's LIVE value/instance (references — never copied) so the bar stays in sync. */
export interface HudFrameInputs {
  readonly hud: DoomHud;
  readonly canvas: HTMLCanvasElement;
  readonly dt: number;
  readonly weaponIndex: number;
  readonly reserve: ReadonlyMap<string, number>;
  readonly hp: number;
  readonly armor: number;
  readonly mag: readonly number[];
  readonly ownedWeapons: ReadonlySet<string>;
  readonly weaponView: WeaponView;
  readonly cameraAngle: number;
}

export class HudPainter {
  private prevAngle = 0;
  private turnEMA = 0;

  public draw(inputs: HudFrameInputs): void {
    const { hud, weaponView } = inputs;
    const weapon = ARSENAL[inputs.weaponIndex];
    const ammoType = weapon.ammoType;
    const reserve = ammoType !== null ? (inputs.reserve.get(ammoType) ?? 0) : 0;

    hud.setHealth(inputs.hp);
    hud.setMental(inputs.armor);
    if (weapon.magSize) {
      hud.setAmmo(inputs.mag[inputs.weaponIndex], reserve);
    } else if (ammoType !== null) {
      hud.setAmmo(reserve);
    } else {
      hud.setAmmo(null);
    }
    // Light the arms row by ARSENAL POSITION (index+1 = the number key), NOT the DOOM `slot` — fist+chainsaw
    // share slot 1, so a slot-based row would misalign the numbers with the keys.
    hud.setArms(
      ARSENAL.flatMap((entry, index) => (inputs.ownedWeapons.has(entry.id) ? [index + 1] : [])),
    );
    hud.setWeapon(weaponView.icon() ?? null);

    const turnRate = inputs.dt > 0 ? -(inputs.cameraAngle - this.prevAngle) / inputs.dt : 0; // + = turning right

    this.prevAngle = inputs.cameraAngle;
    this.turnEMA = smoothTurnRate(this.turnEMA, turnRate, inputs.dt);
    hud.lookAt(gazeForTurn(this.turnEMA));
    hud.render(inputs.canvas, inputs.dt);
  }
}
