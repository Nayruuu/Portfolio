import { LoadedImage } from './loaded-image';
import type { ReloadViewConfig, Weapon, WeaponViewConfig } from './weapons';

/** The fraction of game height the weapon viewmodel reserves for the bottom HUD status bar — it anchors its
 *  content base this far up so the whole weapon stays visible above the bar. Tracks the HUD bar
 *  (`.bsp-demo__hud`, `height: 22%` in `bsp-demo.component.scss`); kept a touch shorter so the weapon base
 *  overlaps the bar's top edge rather than floating above it. */
const HUD_BAR_HEIGHT_FRAC = 0.2;
/** The fraction of transparent padding every weapon strip carries BELOW the hands (measured across the
 *  arsenal: ~4–7 %, consistent frame-to-frame since the hands never drop). The draw sinks the box by this
 *  much so the visible base touches the bar instead of floating a gap above it. */
const WEAPON_BASE_PAD = 0.06;
/** How far the weapon's base sinks INTO the top of the HUD bar, as a fraction of the screen height (NOT the
 *  weapon's — so every weapon drops by the same amount regardless of its `view_scale`d box). The bar art's
 *  centre (the face panel) rises above its side sections; this overlap drops the base onto the bar's main
 *  body so it doesn't float over the lower sides, the raised centre tucking behind the grip. */
const WEAPON_BAR_OVERLAP = 0.04;
/** Peak per-shot recoil dip, as a fraction of the drawn weapon height — a held-auto weapon (the chaingun)
 *  bumps it each nail, and it decays back to rest (a positive `dy` nudge → the gun jolts down into the grip). */
const WEAPON_KICK_FRACTION = 0.06;
/** Seconds the per-shot recoil kick fades from full back to rest. */
const WEAPON_KICK_DECAY_S = 0.08;
/** A melee swing's horizontal travel as a fraction of its vertical travel — the club arcs DOWN more than it
 *  sweeps across, so the sideways amplitude is the smaller of the two (`swing_travel` sets the vertical). */
const SWING_SWEEP_RATIO = 0.5;
/** DOOM walk-bob: while the player moves, the weapon sways side-to-side (a full sine) and dips down (a
 *  rectified sine, so twice per sway), as fractions of the SCREEN HEIGHT. Driven by the engine's `bobPhase`
 *  (advances while moving, 0 at rest), so the bob is identical for every weapon and stops when you stand still. */
const WEAPON_BOB_X = 0.03; // horizontal sway amplitude
const WEAPON_BOB_Y = 0.025; // vertical dip amplitude
/** Seconds an empty-mag "dry click" gesture plays (the reload strip's down→up, no insert frame). */
const DRY_FIRE_DURATION_S = 0.18;
/** Seconds each frame of a LOOPING cold-idle strip holds (the chainsaw's idling-chain shimmer). A gentle
 *  cadence so the at-rest idle reads as alive without distracting; a single-frame idle ignores it. */
const IDLE_FRAME_DURATION_S = 0.13;
/** IDLE BREATHING: the weapon rises and falls slowly even standing still (the hands are alive, never a
 *  freeze-frame) — a full sine of this screen-height fraction per period. Additive with the walk-bob. */
const WEAPON_BREATH_Y = 0.007; // vertical amplitude (≈5 px at 720p)
const WEAPON_BREATH_PERIOD_S = 2.2; // one breath cycle — brisk enough to read at a glance

/**
 * `WeaponView` — the first-person weapon viewmodel: owns one weapon's FPS sprite-strip + animation state.
 * Three fire modes, set from the weapon's `fireMode` (default `semi`):
 *  • SEMI (melee, the pistol, the shotgun): a raw fire input only TRIGGERS a swing (`tryTrigger`);
 *    the loop ticks it every frame (`tick`), and the single frame the animation REACHES its strike index
 *    returns `true` so the component fires the core hit exactly at the damage moment — decoupling the
 *    button press from the hit.
 *  • AUTO (the chaingun): a HELD trigger (`setFiring(true)`) loops every strip frame at the
 *    weapon's faster `fireFrameDuration_s`, snapping back to idle when released. At rest it blits a
 *    separate flash-free `sprite_idle` (cold barrel) so the muzzle-flash frames only show while firing.
 *    The core auto-fires off the held intent, so `tick` returns no strike edge here; the shell punches a
 *    per-shot recoil (`recoilKick`) it sees via the mag delta, decayed in `tick` and added to the drawn `dy`.
 *  • CHARGE (the datacenter BFG): `tryTrigger` starts a spin-up that HOLDS the charge frame for the
 *    weapon's `chargeTime_s`, then snaps to the discharge (the strike frame) and returns `true` there — so
 *    the shell fires the core shot on the discharge exactly like the semi strike. Once started it is
 *    engaged (a release mid-charge does not cancel — the shell simply stops feeding fire edges). `charging()`
 *    + `chargeProgress()` expose the 0..1 spin-up so the shell can drive the green charge-buildup punch.
 * The strip layout (frame count, timing, fire sequence, on-screen height) comes from the shared
 * `WeaponViewConfig`; the per-frame PIXEL size is derived from the LOADED strip (`naturalWidth /
 * frameCount` × `naturalHeight`, like `DoomHud` derives its cells), so nothing is hardcoded. A magazine
 * weapon (the pistol, the shotgun, the chaingun) also carries a RELOAD strip: while
 * `setReloadProgress(0..1)` is live the view blits the matching reload frame instead of the fire/idle
 * frame (the shell drives the fraction off the engine's `reloadClock`). Browser-only + SSR-safe via
 * `LoadedImage`: it draws nothing until the art decodes — an un-arted weapon (empty `sprite_fps`) never
 * draws, and a weapon with no reload strip (or one mid-decode) simply falls back to the fire draw.
 * A melee weapon may also carry a RUN strip (`sprite_run`): a hand-drawn walk cycle that, while idle (not
 * mid-swing), replaces the static idle frame as the resting/moving base — its cell driven by the engine's
 * `bobPhase` (cell 0 at rest) and the procedural positional sway suppressed, since the cycle carries the
 * bob (the fist's two-fist guard). It renders at the run strip's own pixel scale so the fists match the
 * attack strip despite the shorter cell; absent → the static idle frame + the shared procedural sway.
 * Co-located plain class (no Angular).
 */
export class WeaponView {
  private readonly auto: boolean; // AUTO (held-trigger burst loop) vs SEMI (one swing per press)
  private readonly charge: boolean; // CHARGE (spin-up then a discharge strike) — the datacenter BFG
  private readonly chargeTime: number; // seconds the charge frame is held before the discharge (CHARGE only)
  private readonly fireRate: number; // seconds between swings
  private readonly frameCount: number; // equal cells across the strip
  private readonly sequence: readonly number[]; // the fire frames, in order, ending on idle (SEMI)
  private readonly frameDuration: number; // seconds each SEMI fire frame holds
  private readonly autoFrameDuration: number; // seconds each AUTO burst-loop frame holds (faster)
  private readonly strikeIndex: number; // index INTO `sequence` of the damage frame
  private readonly idleFrame: number; // the resting frame
  private readonly heightRatio: number; // on-screen height as a fraction of the screen height
  private readonly baseOffset: number; // per-weapon vertical nudge (fraction of screen height, +up), over the shared bar anchor
  private readonly swingTravel: number; // melee: how far the sprite arcs through a swing (0 = stays put)
  private readonly anchorX: number; // horizontal centre of the sprite's content (0..1) — aligned to the crosshair
  private bobX = 0; // current walk-bob offset (px), refreshed each draw from the engine's bobPhase
  private bobY = 0;
  private dryClock = 0; // seconds remaining on an empty-mag dry-click gesture (0 = none)
  private readonly sheet: LoadedImage; // the FPS sprite-strip
  private readonly iconImage: LoadedImage; // the HUD bay icon
  private readonly reloadSheet: LoadedImage | null; // the reload sprite-strip (magazine weapon only)
  private readonly reloadFrameCount: number; // equal cells across the reload strip (0 = no reload strip)
  private readonly reloadScale: number; // height multiplier for the reload draw (1 = same scale as the fire frame)
  private readonly idleSheet: LoadedImage | null; // AUTO cold-idle sprite (flash-free), or null → fire strip's idle frame
  private readonly idleFrameCount: number; // cells in the cold-idle strip — 1 = a static frame (chaingun), >1 = a loop (chainsaw)
  private readonly runSheet: LoadedImage | null; // hand-drawn walk-cycle strip (the resting/moving base), or null → static idle + procedural sway
  private readonly runFrameCount: number; // equal cells across the run strip (0 = no run strip)
  private readonly runScale: number; // size multiplier for the RUN strip only, over the height-normalised base (1 = match the fire cell)

  private playing = false; // a SEMI fire sequence is running (false = idle)
  private seqIndex = 0; // position within `sequence`
  private frameClock = 0; // seconds accumulated on the current frame
  private cooldown = 0; // seconds until another swing may trigger
  private struck = false; // this swing has already reported its strike frame
  private reloadProgress: number | null = null; // null = not reloading; 0..1 = fraction of the reload elapsed
  private firing = false; // AUTO: the trigger is held → loop the burst frames (false = snap to idle)
  private loopClock = 0; // AUTO: seconds accumulated into the burst loop (resets when released)
  private idleClock = 0; // AUTO: seconds accumulated into the cold-idle loop while NOT firing (resets when firing)
  private breathClock = 0; // seconds into the idle-breathing sine (advances always — the hands never freeze)
  private chargeActive = false; // CHARGE: currently spinning up (holding the charge frame before the discharge)
  private chargeElapsed = 0; // CHARGE: seconds accumulated into the current spin-up
  private kick = 0; // 0..1 recoil-kick intensity (per shot), decays to 0; added to the drawn `dy`

  constructor(weapon: Weapon, config: WeaponViewConfig, reloadConfig?: ReloadViewConfig) {
    this.auto = (weapon.fireMode ?? 'semi') === 'auto';
    this.charge = (weapon.fireMode ?? 'semi') === 'charge';
    this.chargeTime = weapon.chargeTime_s ?? 0;
    this.fireRate = weapon.fireRate_s ?? 0;
    this.frameCount = config.frameCount;
    this.sequence = config.fireSequence;
    this.frameDuration = config.frameDuration_s;
    this.autoFrameDuration = weapon.fireFrameDuration_s ?? config.frameDuration_s;
    this.strikeIndex = config.strikeIndex;
    this.idleFrame = config.idleFrame;
    this.heightRatio = config.heightRatio;
    this.baseOffset = config.baseOffset;
    this.swingTravel = config.swingTravel;
    this.anchorX = config.anchorX;
    this.sheet = new LoadedImage(weapon.sprite_fps);
    this.iconImage = new LoadedImage(weapon.icon);
    this.reloadSheet =
      weapon.sprite_reload && reloadConfig ? new LoadedImage(weapon.sprite_reload) : null;
    this.reloadFrameCount = reloadConfig?.frameCount ?? 0;
    this.reloadScale = reloadConfig?.scale ?? 1;
    this.idleSheet = weapon.sprite_idle ? new LoadedImage(weapon.sprite_idle) : null;
    this.idleFrameCount = weapon.idle_frames ?? 1;
    this.runSheet = weapon.sprite_run ? new LoadedImage(weapon.sprite_run) : null;
    this.runFrameCount = weapon.run_frames ?? 0;
    this.runScale = weapon.run_scale ?? 1;
  }

  /** Start a swing if idle AND off cooldown; arms the cooldown. A CHARGE weapon enters its spin-up here
   *  (holding the charge frame for `chargeTime` before the discharge strike in `tick`). Returns whether one
   *  actually started, so the caller plays the swing SFX only on a real swing (a tap during cooldown / a
   *  press mid-charge returns `false`). */
  public tryTrigger(): boolean {
    if (this.playing || this.cooldown > 0) {
      return false;
    }
    this.playing = true;
    this.seqIndex = 0;
    this.frameClock = 0;
    this.struck = false;
    this.cooldown = this.fireRate;
    this.chargeActive = this.charge; // a CHARGE weapon spins up before its discharge; others fire straight
    this.chargeElapsed = 0;

    return true;
  }

  /** Play a brief EMPTY-mag dry-click gesture instead of a fire: the reload strip's down→up frames, skipping
   *  the insert (nothing to load). No-op without a reload strip, mid-swing, mid-reload, or while one is
   *  already playing — so a held empty trigger clicks once per gesture, not every frame. */
  public dryFire(): void {
    if (this.playing || this.reloadProgress !== null || this.dryClock > 0 || !this.reloadSheet) {
      return;
    }
    this.dryClock = DRY_FIRE_DURATION_S;
  }

  /** AUTO: hold the trigger (`true`) to loop the burst frames, or release (`false`) to snap to idle. A
   *  no-op-feeling call on a SEMI weapon — only `draw`'s AUTO branch reads `firing`, so semi keeps its
   *  swing/strike path untouched. */
  public setFiring(firing: boolean): void {
    this.firing = firing;
  }

  /** AUTO: punch a full per-shot recoil kick — the shell calls this each fired nail (seen via the mag
   *  delta). `tick` decays it back to rest, and `draw` adds it to the weapon's `dy` (a downward jolt). */
  public recoilKick(): void {
    this.kick = 1;
  }

  /** Advance the frame clocks + cooldown by `dt`, decaying the per-shot recoil kick (every mode). SEMI:
   *  returns `true` on the single frame the swing REACHES its strike index (the damage moment) and ends
   *  the run at idle. AUTO: advances the held burst loop (or holds idle when released) and never returns a
   *  strike edge — the core auto-fires off the held intent, not the animation. CHARGE: holds the charge
   *  frame for `chargeTime`, returns `true` on the frame the spin-up completes (snapping to the discharge
   *  strike frame, where the shell fires the core shot), then plays out recoil → idle. */
  public tick(dt: number): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt / WEAPON_KICK_DECAY_S);
    this.dryClock = Math.max(0, this.dryClock - dt);
    this.breathClock = (this.breathClock + dt) % WEAPON_BREATH_PERIOD_S; // idle breathing, always alive
    if (this.auto) {
      this.loopClock = this.firing ? this.loopClock + dt : 0;
      this.idleClock = this.firing ? 0 : this.idleClock + dt; // advance the cold-idle loop while at rest

      return false;
    }
    if (!this.playing) {
      return false;
    }
    if (this.chargeActive) {
      this.chargeElapsed += dt;
      if (this.chargeElapsed < this.chargeTime) {
        return false; // still spinning up — `seqIndex` stays 0, so `draw` holds the charge frame
      }
      // Spin-up complete → snap to the discharge (the strike frame) and fire the core shot this tick. The
      // recoil → idle tail plays out on the following ticks via the standard advance below.
      this.chargeActive = false;
      this.seqIndex = this.strikeIndex;
      this.frameClock = 0;
      this.struck = true; // already discharged — the advance below never re-strikes

      return true;
    }
    this.frameClock += dt;
    let struckThisTick = false;

    while (this.playing && this.frameClock >= this.frameDuration) {
      this.frameClock -= this.frameDuration;
      this.seqIndex += 1;
      if (this.seqIndex >= this.sequence.length) {
        this.playing = false; // run finished → back to the idle frame
        this.seqIndex = 0;
        break;
      }
      if (this.seqIndex === this.strikeIndex && !this.struck) {
        this.struck = true; // never re-strike within one swing
        struckThisTick = true;
      }
    }

    return struckThisTick;
  }

  /** Drive the reload animation: `null` = not reloading (draw the fire/idle frame); `0..1` = the fraction
   *  of the reload elapsed (draw the matching reload-strip frame). The shell sets this every frame from
   *  the engine's `reloadClock` (a magazine weapon only; melee/flat weapons always pass `null`). */
  public setReloadProgress(progress: number | null): void {
    this.reloadProgress = progress;
  }

  /** Blit the current frame bottom-centre, NEAREST, at `heightRatio × screenH` (width by the strip's own
   *  aspect). While a reload is in progress AND its strip has decoded, draws the reload frame for the
   *  elapsed fraction; otherwise the fire/idle frame. Draws nothing until the relevant strip decodes (the
   *  SSR / un-arted path), and a reload with no/undecoded strip transparently falls back to the fire draw. */
  /** The gun's procedural walk-bob offset in px for a `bobPhase` — its muzzle sways by this: `x` side-to-side,
   *  `y` a downward dip, zero standing still. A weapon whose run cycle bakes the bob into its own frames
   *  reports 0. The shell reads it to launch a projectile from the swaying muzzle, not the screen centre. */
  public bobOffset(screenH: number, bobPhase: number): { readonly x: number; readonly y: number } {
    // Idle breathing rides EVERY path (even a baked run-cycle): the weapon slowly rises and falls at rest.
    const breath =
      WEAPON_BREATH_Y *
      screenH *
      Math.sin((this.breathClock / WEAPON_BREATH_PERIOD_S) * 2 * Math.PI);

    if (this.runSheet?.ready()) {
      return { x: 0, y: breath };
    }

    return {
      x: WEAPON_BOB_X * screenH * Math.sin(bobPhase),
      y: WEAPON_BOB_Y * screenH * Math.abs(Math.sin(bobPhase)) + breath,
    };
  }

  public draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, bobPhase = 0): void {
    const runSheet = this.runSheet?.ready();

    // DOOM walk-bob, refreshed each frame for every blit path below (fire/idle/reload all sway while moving).
    const sway = this.bobOffset(screenH, bobPhase);

    this.bobX = sway.x;
    this.bobY = sway.y;
    if (this.reloadProgress !== null) {
      const reloadSheet = this.reloadSheet?.ready();

      if (reloadSheet) {
        const frame = Math.min(
          Math.floor(this.reloadProgress * this.reloadFrameCount),
          this.reloadFrameCount - 1,
        );

        this.blit(
          ctx,
          reloadSheet,
          frame,
          this.reloadFrameCount,
          screenW,
          screenH,
          this.reloadScale,
        );

        return;
      }
    }
    // EMPTY-mag dry gesture: the reload strip's down→up frames (skipping the middle INSERT cell — nothing to
    // load), so an out-of-ammo fire reads as a dry "click", not a phantom shot. An actual reload (above) wins.
    if (this.dryClock > 0) {
      const reloadSheet = this.reloadSheet?.ready();

      if (reloadSheet) {
        const frame = this.dryClock > DRY_FIRE_DURATION_S / 2 ? 0 : this.reloadFrameCount - 1;

        this.blit(
          ctx,
          reloadSheet,
          frame,
          this.reloadFrameCount,
          screenW,
          screenH,
          this.reloadScale,
        );

        return;
      }
    }
    // AUTO cold-idle: a separate flash-free idle sprite while a held-trigger weapon isn't firing (the fire
    // strip's frame 0 carries a muzzle flash, so reusing it would flicker at rest). A single-frame idle holds
    // it (the chaingun's cold barrel); a multi-frame idle LOOPS at the gentle idle cadence (the chainsaw's
    // idling chain). Falls back to the fire strip until the idle sprite decodes / for an auto weapon that ships none.
    if (this.auto && !this.firing) {
      const idleSheet = this.idleSheet?.ready();

      if (idleSheet) {
        this.blit(ctx, idleSheet, this.autoIdleFrame(), this.idleFrameCount, screenW, screenH);

        return;
      }
    }
    const sheet = this.sheet.ready();

    // Run-cycle base: when idle (not mid-swing) a weapon with a decoded run strip plays its walk cycle — the
    // cell chosen from the bob phase (cell 0 at rest). It's drawn at the run strip's OWN pixel scale (its
    // shorter cell scaled by `runCellH / fireCellH`), then nudged by `run_scale` when the two strips frame the
    // hands at different sizes, so the resting fists match the attack strip; the attack strip still owns the
    // swing frames (drawn below while `playing`).
    if (runSheet && !this.playing && !this.auto) {
      const heightFactor =
        (sheet ? runSheet.naturalHeight / sheet.naturalHeight : 1) * this.runScale;

      this.blit(
        ctx,
        runSheet,
        this.runFrame(bobPhase),
        this.runFrameCount,
        screenW,
        screenH,
        heightFactor,
      );

      return;
    }

    if (!sheet) {
      return; // transparent until the strip decodes (SSR-safe; an un-arted weapon never decodes)
    }
    const frame = this.auto
      ? this.autoFrame()
      : this.playing
        ? this.sequence[this.seqIndex]
        : this.idleFrame;

    this.blit(ctx, sheet, frame, this.frameCount, screenW, screenH);
  }

  /** Whether a swing is mid-animation — the shell refuses a weapon-switch while this is `true`, so the
   *  active weapon never changes mid-attack (a swing always plays out on the weapon that started it). A
   *  CHARGE weapon counts as swinging through its whole spin-up + discharge, so it can't be swapped away
   *  mid-charge either. */
  public swinging(): boolean {
    return this.playing;
  }

  /** Whether a CHARGE weapon is mid spin-up (holding the charge frame) — the shell drives the green
   *  charge-buildup tint off this. `false` for every non-charge weapon and once the discharge fires. */
  public charging(): boolean {
    return this.chargeActive;
  }

  /** The CHARGE spin-up progress, 0..1, while charging (0 otherwise) — drives the rising charge-buildup
   *  tint opacity. Clamped, and guarded against a zero `chargeTime`. */
  public chargeProgress(): number {
    if (!this.chargeActive || this.chargeTime <= 0) {
      return 0;
    }

    return Math.min(1, this.chargeElapsed / this.chargeTime);
  }

  /** The loaded HUD bay icon (a separate async load), or `undefined` until it decodes. */
  public icon(): HTMLImageElement | undefined {
    return this.iconImage.ready();
  }

  /** The run-cycle cell for the current bob phase: a full 2π sway steps through every run cell, wrapping. The
   *  engine freezes `bobPhase` at 0 when standing still, so a stationary player holds cell 0 (the neutral
   *  two-fist guard). No-op (0) without a run strip. */
  private runFrame(bobPhase: number): number {
    if (this.runFrameCount <= 0) {
      return 0;
    }
    const cell = Math.floor((bobPhase / (Math.PI * 2)) * this.runFrameCount);

    return ((cell % this.runFrameCount) + this.runFrameCount) % this.runFrameCount;
  }

  /** Blit `frame` of a `count`-cell horizontal strip bottom-centre, NEAREST, at `heightRatio × screenH`
   *  (width by the strip's own aspect). The per-frame pixel size is derived from the loaded strip
   *  (`naturalWidth / count` × `naturalHeight`), so nothing is hardcoded — shared by the fire + reload strips.
   *  `heightFactor` (default 1) scales the draw height for a strip whose cell is a different height than the
   *  fire strip's (the shorter run cell), so both render at the SAME pixel scale and their content matches. */
  private blit(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLImageElement,
    frame: number,
    count: number,
    screenW: number,
    screenH: number,
    heightFactor = 1,
  ): void {
    const frameWidth = sheet.naturalWidth / count;
    const frameHeight = sheet.naturalHeight;
    const drawH = this.heightRatio * screenH * heightFactor;
    const drawW = drawH * (frameWidth / frameHeight);
    // Align the sprite's CONTENT centre (`anchorX`) to the crosshair, not the frame centre — a weapon drawn
    // off-centre in its frame (most sit right of centre) then reads centred under the viser. (0.5 = frame-centred.)
    const dx = screenW / 2 - drawW * this.anchorX;
    // Anchor the weapon's CONTENT base (not the sprite's transparent bottom edge) just inside the HUD bar's
    // top, so the visible base meets the bar with no float. The base line sits `WEAPON_BAR_OVERLAP` of the
    // screen below the bar's box top (dropping onto the bar's main body, under its raised centre); every strip
    // carries ~`WEAPON_BASE_PAD` of transparent padding below the hands, so the box sinks that fraction more
    // (only the padding tucks under — never visible art). Plus the current recoil-kick dip (0 unless an auto shot bumped it).
    const dy =
      screenH * (1 - HUD_BAR_HEIGHT_FRAC + WEAPON_BAR_OVERLAP - this.baseOffset) -
      drawH * (1 - WEAPON_BASE_PAD) +
      this.kick * WEAPON_KICK_FRACTION * drawH;

    // Melee swing-travel: arc the whole sprite through the swing (a club blow doesn't rotate in place). The
    // `cos·sin` shape is +early → −late, fading to 0 at both ends of the run (so the resting frame stays put):
    // up-and-right on the wind-up, slamming down-and-left through the strike. Only a SEMI weapon with a
    // `swingTravel` mid-swing moves (the guns and the idle/reload frames pass straight through at 0).
    const [swingDx, swingDy] = this.swingShift(drawW, drawH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      frame * frameWidth,
      0,
      frameWidth,
      frameHeight,
      dx + swingDx + this.bobX,
      dy + swingDy + this.bobY,
      drawW,
      drawH,
    );
  }

  /** The melee swing-travel offset (px) for the current swing frame — see `blit`. Zero unless this is a
   *  `swingTravel` weapon mid-swing. */
  private swingShift(drawW: number, drawH: number): [number, number] {
    if (this.swingTravel <= 0 || !this.playing || this.auto || this.frameCount < 2) {
      return [0, 0];
    }
    const p = this.seqIndex / (this.frameCount - 1); // 0..1 across the fire run (ends on the idle cell)
    const arc = Math.cos(Math.PI * p) * Math.sin(Math.PI * p); // +early, −late, 0 at both ends

    return [this.swingTravel * SWING_SWEEP_RATIO * drawW * arc, -this.swingTravel * drawH * arc];
  }

  /** AUTO frame source: while the trigger is held, loop every strip cell (0..frameCount-1) at the burst
   *  duration; while released, hold the idle frame. */
  private autoFrame(): number {
    if (!this.firing) {
      return this.idleFrame;
    }

    return Math.floor(this.loopClock / this.autoFrameDuration) % this.frameCount;
  }

  /** AUTO cold-idle frame: a single-frame idle holds cell 0; a multi-frame idle strip loops at the gentle
   *  idle cadence (the chainsaw's idling chain), driven by `idleClock` (advanced in `tick` while at rest). */
  private autoIdleFrame(): number {
    if (this.idleFrameCount <= 1) {
      return 0;
    }

    return Math.floor(this.idleClock / IDLE_FRAME_DURATION_S) % this.idleFrameCount;
  }
}
