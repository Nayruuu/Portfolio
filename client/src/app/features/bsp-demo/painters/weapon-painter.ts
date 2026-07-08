import type { Camera } from '../../../core/lib/bsp-engine';
import type { WeaponView } from '../../../shared/game/weapon-view';
import type { ClimbView } from '../../../shared/game/climb-view';

const CLIMB_LEDGE_DEPTH = 0.3; // arm's-reach depth the ledge top is projected at, to pin the hands' grip line
const CLIMB_LEDGE_MIN = 0.22; // hold the grip line within this band (fractions of screen height): the hands grip
const CLIMB_LEDGE_MAX = 0.72; // the lip near the top, then slide down it as the hoist raises the camera past it

/** The mantle pose the climb overlay needs — the hoist `progress` (0→1) + the ledge-top world height it
 *  projects the grip line at. The component's mantle object satisfies it structurally. */
export interface MantlePose {
  readonly progress: number;
  readonly targetZ: number;
}

/** Everything one weapon-overlay repaint reads. `mantle` non-null swaps the weapon for the two-handed climb
 *  pull; the `weaponView` / `climbView` are the {@link CombatRuntime}'s live instances (never copied). */
export interface WeaponPaintInputs {
  readonly ctx: CanvasRenderingContext2D;
  readonly weaponView: WeaponView;
  readonly climbView: ClimbView;
  readonly mantle: MantlePose | null;
  readonly camera: Camera;
  readonly fov: number;
  readonly bob: number;
}

/**
 * The weapon VIEWMODEL painter: the screen-space overlay half of the old `drawWeapon`. It paints the held
 * weapon (bobbing with the walk) — or, mid auto-mantle, the two-handed climb pull that REPLACES it — over the
 * 3D frame. It is stateless: the fire/reload/charge STEP that decides what to draw lives in
 * {@link CombatRuntime.stepWeapon}, called just before this on the same blit `drawDt` (step-before-draw).
 */
export class WeaponPainter {
  /** Paint the weapon overlay: the climb pull mid-mantle, otherwise the bobbing weapon viewmodel. */
  public draw(inputs: WeaponPaintInputs): void {
    if (inputs.mantle !== null) {
      this.drawClimb(inputs, inputs.mantle);

      return;
    }
    const { ctx } = inputs;

    inputs.weaponView.draw(ctx, ctx.canvas.width, ctx.canvas.height, inputs.bob);
  }

  /** Draw the two-handed mantle pull mid-vault: project the ledge's top edge (world height `targetZ`) at
   *  arm's-reach depth to get its screen-Y, hold it in a visible band, and feed it + the hoist `progress` to
   *  {@link ClimbView}. As the camera rises past the lip the grip slides down it — the pull-up traction. */
  private drawClimb(inputs: WeaponPaintInputs, mantle: MantlePose): void {
    const { ctx, camera } = inputs;
    const { width, height } = ctx.canvas;
    const focal = width / 2 / Math.tan(inputs.fov / 2);
    const horizon = height / 2 + (camera.pitch ?? 0) * (height / 2);
    const rawLedgeY = horizon + ((camera.z - mantle.targetZ) * focal) / CLIMB_LEDGE_DEPTH;
    const ledgeY = Math.max(
      height * CLIMB_LEDGE_MIN,
      Math.min(height * CLIMB_LEDGE_MAX, rawLedgeY),
    );

    inputs.climbView.draw(ctx, width, height, mantle.progress, ledgeY);
  }
}
