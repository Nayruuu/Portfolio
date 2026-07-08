import { describe, expect, it } from 'vitest';
import {
  drawChargeFx,
  drawGameOver,
  drawHurtFx,
  drawPickupFx,
  drawWinScreen,
  drawZoneFade,
  HURT_FX_DURATION,
  PICKUP_FX_DURATION,
} from './overlay-painter';

interface FillCall {
  readonly fillStyle: string;
  readonly rect: readonly number[];
}

/** A minimal 2D-context stub that records the `fillStyle` in force at each `fillRect` — enough to assert the
 *  overlay guards (nothing drawn) and the exact alpha math of each full-screen wash. */
function fakeCtx(width = 100, height = 80): { ctx: CanvasRenderingContext2D; fills: FillCall[] } {
  const fills: FillCall[] = [];
  const ctx = {
    canvas: { width, height },
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    arc(): void {},
    stroke(): void {},
    fillText(): void {},
    createRadialGradient() {
      return { addColorStop(): void {} };
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      fills.push({ fillStyle: this.fillStyle as string, rect: [x, y, w, h] });
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe('overlay-painter washes', () => {
  it('drawHurtFx is a no-op when the flash has expired', () => {
    const { ctx, fills } = fakeCtx();

    drawHurtFx(ctx, 0);

    expect(fills).toHaveLength(0);
  });

  it('drawHurtFx paints a full-screen red wash at 0.45×ratio alpha', () => {
    const { ctx, fills } = fakeCtx(120, 90);

    drawHurtFx(ctx, HURT_FX_DURATION); // ratio 1 → peak alpha

    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('rgba(190, 0, 0, 0.45)');
    expect(fills[0].rect).toEqual([0, 0, 120, 90]);
  });

  it('drawPickupFx paints a green wash at 0.22×ratio alpha', () => {
    const { ctx, fills } = fakeCtx();

    drawPickupFx(ctx, PICKUP_FX_DURATION / 2); // ratio 0.5 → 0.11

    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('rgba(70, 230, 120, 0.11)');
  });

  it('drawChargeFx is a no-op with no glow and no discharge', () => {
    const { ctx, fills } = fakeCtx();

    drawChargeFx(ctx, 0, 0);

    expect(fills).toHaveLength(0);
  });

  it('drawChargeFx uses the stronger of the live glow and the peak-scaled discharge flash', () => {
    const { ctx, fills } = fakeCtx();

    drawChargeFx(ctx, 0.3, 1); // max(0.3, 1 * 0.92) → 0.92

    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('rgba(60, 255, 90, 0.92)');
  });

  it('drawZoneFade does nothing when there is no transition', () => {
    const { ctx, fills } = fakeCtx();

    drawZoneFade(ctx, null, 0.35);

    expect(fills).toHaveLength(0);
  });

  it('drawZoneFade ramps to opaque black at the floor swap', () => {
    const { ctx, fills } = fakeCtx();

    drawZoneFade(ctx, { swapped: false, clock: 0.35 }, 0.35); // clock/fade = 1

    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('rgba(0, 0, 0, 1)');
  });

  it('drawGameOver / drawWinScreen stay blank until the player is dead / has won', () => {
    const { ctx, fills } = fakeCtx();

    drawGameOver(ctx, false, 5, true);
    drawWinScreen(ctx, false, 5, true);

    expect(fills).toHaveLength(0);
  });

  it('drawGameOver washes the frozen scene once the player is dead', () => {
    const { ctx, fills } = fakeCtx();

    drawGameOver(ctx, true, 0.5, false); // min(0.72, 0.5*0.9) → 0.45

    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('rgba(8, 0, 0, 0.45)');
  });
});
