import { DoomHud } from '../../../shared/game/doom-hud';
import { gazeForTurn, smoothTurnRate } from '../../../shared/game/gaze';
import { ARSENAL } from '../../../shared/game/weapons';
import type { WeaponView } from '../../../shared/game/weapon-view';

/** Everything the status bar reads for one repaint. Every field is the component's LIVE value/instance (the
 *  `hud`, `weaponView`, `mag`, `reserve`, `ownedWeapons` are references — never copied) so the bar stays in
 *  sync with the frame it sits over. */
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

/**
 * The DOOM status-bar sync: pushes the player state into the {@link DoomHud} and repaints it onto its own canvas
 * over the 3D frame. Owns the turn-rate EMA (the smoothed heading delta that aims the HUD face's gaze) as its
 * only state — the {@link DoomHud} instance itself stays owned by the component (it also fields hit/card events).
 */
export class HudPainter {
  private prevAngle = 0; // last frame's camera angle → the turn rate that aims the HUD face's gaze
  private turnEMA = 0; // smoothed turn rate → a steady gaze through a turn (no per-frame repaint flicker)

  /** Push the player state into the DOOM status bar + repaint it onto its own canvas over the 3D frame:
   *  health, armour (the "mental" bay), the active weapon's ammo + icon, and the owned-weapon arms row. */
  public draw(inputs: HudFrameInputs): void {
    const { hud, weaponView } = inputs;
    const weapon = ARSENAL[inputs.weaponIndex];
    // Ammo readout: a magazine weapon shows "loaded / reserve" (e.g. 1/50); a flat-pool weapon shows that
    // reserve; a melee weapon passes `null` so the bay draws the icon only (mirrors the grid's `syncHud`).
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
    // Light the arms row by ARSENAL POSITION (1..8 = the number key that selects it), not the DOOM `slot`:
    // the fist + chainsaw share slot 1, so a slot-based row left "8" permanently grey and misaligned the
    // numbers with the keys (key 2 = chainsaw, not the slot-2 weapon). Only OWNED weapons light up — the
    // run starts fists-only ("1") and each weapon pickup lights its number.
    hud.setArms(
      ARSENAL.flatMap((entry, index) => (inputs.ownedWeapons.has(entry.id) ? [index + 1] : [])),
    );
    hud.setWeapon(weaponView.icon() ?? null);

    const turnRate = inputs.dt > 0 ? -(inputs.cameraAngle - this.prevAngle) / inputs.dt : 0; // + = turning right

    this.prevAngle = inputs.cameraAngle;
    this.turnEMA = smoothTurnRate(this.turnEMA, turnRate, inputs.dt); // smooth → the gaze holds steady mid-turn
    hud.lookAt(gazeForTurn(this.turnEMA));
    hud.render(inputs.canvas, inputs.dt);
  }
}
