// Presentation-timing durations for the full-screen washes. Kept here with the painters that consume them; the
// component imports the ones it also arms on its own timers (e.g. `this.shotFx = SHOT_FX_DURATION`).
export const SHOT_FX_DURATION = 0.09; // seconds the muzzle flash + impact spark linger after a shot
export const HURT_FX_DURATION = 0.35; // seconds the player's red damage flash lingers after taking a hit
export const PICKUP_FX_DURATION = 0.3; // seconds the player's green pickup flash lingers after collecting an item
const CHARGE_FLASH_PEAK = 0.92; // peak green discharge flash opacity (near-blinding ultimate)

/** The centre reticle (always on) + a muzzle flash / impact spark while a shot is fresh. `shotFx` is the seconds
 *  left on the shot feedback (0 when idle). */
export function drawCrosshair(ctx: CanvasRenderingContext2D, shotFx: number): void {
  const cx = ctx.canvas.width / 2;
  const cy = ctx.canvas.height / 2;
  const fx = shotFx / SHOT_FX_DURATION; // 1 → 0 over the flash (0 when idle)
  const gap = 10; // clear centre so a distant target stays visible between the arms
  const len = 22; // arm length

  ctx.save();

  // Muzzle flash at the gun + an expanding impact spark at the reticle the instant a shot lands.
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
  ctx.fillRect(cx - 2, cy - 2, 4, 4); // centre dot

  ctx.restore();
}

/** A red full-screen wash when the player just took a hit, fading over HURT_FX_DURATION (the grid's hurt flash). */
export function drawHurtFx(ctx: CanvasRenderingContext2D, hurtFx: number): void {
  if (hurtFx <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(190, 0, 0, ${0.45 * (hurtFx / HURT_FX_DURATION)})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** A brief faint-green wash when the player collects a pickup (the inverse of the red hurt flash). */
export function drawPickupFx(ctx: CanvasRenderingContext2D, pickupFx: number): void {
  if (pickupFx <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(70, 230, 120, ${0.22 * (pickupFx / PICKUP_FX_DURATION)})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** The BFG's green screen tint: the live charge-buildup while it spins up, and a decaying flash on the
 *  discharge — a full-frame green wash (mirrors the grid's `chargeGlow` + green discharge flash). */
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

/** A transient objective hint near the centre (e.g. "BADGE REQUIS" at a locked exit), fading over its life.
 *  `hint` is the seconds left on the hint (drawn only while positive). */
export function drawHint(ctx: CanvasRenderingContext2D, hint: number): void {
  if (hint <= 0) {
    return;
  }
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.globalAlpha = Math.min(1, hint / 0.4); // hold, then fade out over the last 0.4s
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffcf4d';
  ctx.font = `800 ${Math.round(height * 0.045)}px system-ui, sans-serif`;
  ctx.fillText('BADGE REQUIS', width / 2, height * 0.7);
  ctx.restore();
}

/** The zone-swap wash: black at the floor swap, ramping in/out over `zoneFade` on either side — the brief
 *  blackout that sells moving through the building (the HUD bar stays, DOOM-style). No-op when not transitioning. */
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

/** The game-over screen: a dark wash that fades in over the frozen scene + the satirical "you're fired" title,
 *  then a pulsing restart prompt once a click can restart (`canRestart`). No-op until the player is `dead`. */
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
    // a slow blink so the prompt reads as interactive
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(deadClock * 3));
    ctx.fillStyle = '#e8e2d2';
    ctx.font = `600 ${Math.round(height * 0.038)}px system-ui, sans-serif`;
    ctx.fillText('Cliquez pour repointer', width / 2, height * 0.56);
  }
  ctx.restore();
}

/** The level-complete screen: a dark-green wash fading in over the frozen scene + the "mission accomplished"
 *  title, then a pulsing restart prompt once a click can restart (`canRestart`). The win twin of
 *  {@link drawGameOver}. No-op until the player has `won`. */
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
