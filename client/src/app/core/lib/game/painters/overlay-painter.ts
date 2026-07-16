import {
  CHARGE_FLASH_PEAK,
  HURT_FX_DURATION,
  PICKUP_FX_DURATION,
  SHOT_FX_DURATION,
} from '../game-tuning';

export function drawCrosshair(ctx: CanvasRenderingContext2D, shotFx: number): void {
  const cx = ctx.canvas.width / 2;
  const cy = ctx.canvas.height / 2;
  const fx = shotFx / SHOT_FX_DURATION;
  const gap = 10;
  const len = 22;

  ctx.save();

  if (fx > 0) {
    const muzzleY = ctx.canvas.height * 0.72;
    const glowR = 170 - 60 * fx;
    const glow = ctx.createRadialGradient(cx, muzzleY, 0, cx, muzzleY, glowR);

    glow.addColorStop(0, `rgba(255, 226, 130, ${0.55 * fx})`);
    glow.addColorStop(1, 'rgba(255, 226, 130, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - glowR, muzzleY - glowR, glowR * 2, glowR * 2);

    ctx.strokeStyle = `rgba(255, 240, 150, ${fx})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + 34 * (1 - fx), 0, Math.PI * 2);
    ctx.stroke();
  }

  // a dark casing pass, then a bright pass on top → readable over any wall colour
  for (const [stroke, lineWidth] of [
    ['rgba(0, 0, 0, 0.55)', 6],
    ['rgba(120, 255, 140, 0.95)', 2.5],
  ] as const) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(cx, cy - gap - len);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + gap + len);
    ctx.moveTo(cx - gap - len, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + gap + len, cy);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120, 255, 140, 0.95)';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);

  ctx.restore();
}

export function drawHurtFx(ctx: CanvasRenderingContext2D, hurtFx: number): void {
  if (hurtFx <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(190, 0, 0, ${0.45 * (hurtFx / HURT_FX_DURATION)})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function drawPickupFx(ctx: CanvasRenderingContext2D, pickupFx: number): void {
  if (pickupFx <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(70, 230, 120, ${0.22 * (pickupFx / PICKUP_FX_DURATION)})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function drawChargeFx(
  ctx: CanvasRenderingContext2D,
  chargeGlow: number,
  dischargeFlash: number,
): void {
  const alpha = Math.max(chargeGlow, dischargeFlash * CHARGE_FLASH_PEAK);

  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(60, 255, 90, ${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function drawHint(ctx: CanvasRenderingContext2D, hint: number): void {
  if (hint <= 0) {
    return;
  }
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.globalAlpha = Math.min(1, hint / 0.4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffcf4d';
  ctx.font = `800 ${Math.round(height * 0.045)}px system-ui, sans-serif`;
  ctx.fillText('BADGE REQUIS', width / 2, height * 0.7);
  ctx.restore();
}

export function drawZoneFade(
  ctx: CanvasRenderingContext2D,
  transition: { readonly swapped: boolean; readonly clock: number } | null,
  zoneFade: number,
): void {
  if (transition === null) {
    return;
  }
  const alpha = transition.swapped
    ? Math.max(0, 1 - (transition.clock - zoneFade) / zoneFade)
    : Math.min(1, transition.clock / zoneFade);

  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  dead: boolean,
  deadClock: number,
  canRestart: boolean,
): void {
  if (!dead) {
    return;
  }
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.fillStyle = `rgba(8, 0, 0, ${Math.min(0.72, deadClock * 0.9)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d23b2e';
  ctx.font = `900 ${Math.round(height * 0.12)}px system-ui, sans-serif`;
  ctx.fillText('VOUS ÊTES VIRÉ', width / 2, height * 0.42);
  if (canRestart) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(deadClock * 3));
    ctx.fillStyle = '#e8e2d2';
    ctx.font = `600 ${Math.round(height * 0.038)}px system-ui, sans-serif`;
    ctx.fillText('Cliquez pour repointer', width / 2, height * 0.56);
  }
  ctx.restore();
}

export function drawWinScreen(
  ctx: CanvasRenderingContext2D,
  won: boolean,
  wonClock: number,
  canRestart: boolean,
): void {
  if (!won) {
    return;
  }
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.fillStyle = `rgba(0, 14, 6, ${Math.min(0.72, wonClock * 0.9)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#39d27a';
  ctx.font = `900 ${Math.round(height * 0.1)}px system-ui, sans-serif`;
  ctx.fillText('SORTIE ATTEINTE', width / 2, height * 0.42);
  if (canRestart) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(wonClock * 3));
    ctx.fillStyle = '#e8e2d2';
    ctx.font = `600 ${Math.round(height * 0.038)}px system-ui, sans-serif`;
    ctx.fillText('Cliquez pour rejouer', width / 2, height * 0.56);
  }
  ctx.restore();
}

/** The loading card: the floor is not playable until its world + objects land, so hold the player on a
 *  terminal boot screen rather than let him walk an empty tower. The bestiary streams in afterwards. */
export function drawLoadingScreen(
  ctx: CanvasRenderingContext2D,
  progress: number,
  title: string,
): void {
  const { width, height } = ctx.canvas;
  const done = Math.max(0, Math.min(1, progress));

  ctx.save();
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#5a5a62';
  ctx.font = `600 ${Math.round(height * 0.045)}px ui-monospace, monospace`;
  ctx.fillText('OPEN SPACE.EXE', width / 2, height * 0.34);

  ctx.fillStyle = '#e8e6e0';
  ctx.font = `800 ${Math.round(height * 0.08)}px ui-monospace, monospace`;
  ctx.fillText(title, width / 2, height * 0.45);

  const barW = width * 0.5;
  const barH = Math.max(4, Math.round(height * 0.022));
  const barX = (width - barW) / 2;
  const barY = height * 0.58;

  ctx.fillStyle = '#26262c';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = '#d23b2e';
  ctx.fillRect(barX, barY, barW * done, barH);

  ctx.fillStyle = '#8a8a92';
  ctx.font = `600 ${Math.round(height * 0.035)}px ui-monospace, monospace`;
  ctx.fillText(`${Math.round(done * 100)}%`, width / 2, barY + barH + height * 0.055);
  ctx.restore();
}
