import type { Camera } from '../../../core/lib/bsp-engine';
import type { WeaponView } from '../../../shared/game/weapon-view';
import type { ClimbView } from '../../../shared/game/climb-view';

const CLIMB_LEDGE_DEPTH = 0.3; // arm's-reach depth the ledge top is projected at, to pin the grip line
const CLIMB_LEDGE_MIN = 0.22; // hold the grip line within this band (fractions of screen height)
const CLIMB_LEDGE_MAX = 0.72;

export interface MantlePose {
  readonly progress: number;
  readonly targetZ: number;
}

/** `mantle` non-null swaps the weapon for the climb pull; `weaponView` / `climbView` are live instances (never copied). */
export interface WeaponPaintInputs {
  readonly ctx: CanvasRenderingContext2D;
  readonly weaponView: WeaponView;
  readonly climbView: ClimbView;
  readonly mantle: MantlePose | null;
  readonly camera: Camera;
  readonly fov: number;
  readonly bob: number;
}

/** Stateless: the fire/reload/charge STEP that decides what to draw runs in {@link CombatRuntime.stepWeapon},
 *  just before this on the same blit `drawDt` (step-before-draw). */
export class WeaponPainter {
  public draw(inputs: WeaponPaintInputs): void {
    if (inputs.mantle !== null) {
      this.drawClimb(inputs, inputs.mantle);

      return;
    }
    const { ctx } = inputs;

    inputs.weaponView.draw(ctx, ctx.canvas.width, ctx.canvas.height, inputs.bob);
  }

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
