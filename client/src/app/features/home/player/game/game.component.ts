import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../../../core/services/i18n/i18n.service';
import { GameService } from '../../../../core/services/game/game.service';
import {
  doorColorIndex,
  doorGroup,
  facingDoorIndex,
  hasKey,
  isFacingExit,
  KEYCARD_COLORS,
  step,
  type AmmoPickup,
  type AmmoSpawn,
  type GameMap,
  type GameState,
  type Level,
  type MoveIntent,
} from '../../../../core/lib';
import { IconComponent } from '../../../../shared/icon/icon.component';
import { criticalAssetUrls, deferredAssetUrls } from './game-assets';
import { warmEnemyViews } from './enemy-sprite';
import { preloadImages } from './preload';
import { ammoPickupById } from './ammo-pickups';
import { GameAudio } from './game-audio';
import { GameInput } from './game-input';
import { GameRenderer } from './game-renderer';
import { DoomHud, type Gaze } from '../../../../shared/game/doom-hud';
import { WeaponView } from '../../../../shared/game/weapon-view';
import { ClimbView } from '../../../../shared/game/climb-view';
import {
  ammoTypeMax,
  ARSENAL,
  reloadViewConfig,
  startingAmmo,
  weaponCombat,
  weaponViewConfig,
} from '../../../../shared/game/weapons';

const GAMEOVER_DURATION = 2000; // ms the game-over overlay shows before the run resets
/** A keycard door's open animation: the split-slide strip's frame count + how long the whole open plays.
 *  While it runs the player is FROZEN (the world still ticks); on completion the seam clears → passable. */
const DOOR_ANIM_FRAMES = 5;
const DOOR_ANIM_DURATION_S = 0.3;
/** The zone-EXIT airlock transition: the player is frozen while the door opens + the screen fades to black
 *  (`out`), the next level loads at full black, then it fades back in on the new zone (`in`). */
const EXIT_FADE_OUT_S = 0.55;
const EXIT_FADE_IN_S = 0.45;
const GAZE_TURN_RATE = 0.6; // rad/s of turning before the HUD face glances aside
const GAZE_FAR_TURN_RATE = 2.5; // rad/s of turning for the extreme-glance columns
const HUD_NATIVE_WIDTH = 2117; // x1.0 bar-art width — cap the HUD backing store here (the biggest tier)
const HUD_NATIVE_HEIGHT = 404; // …and its height, so the backing store keeps the bar's 5.24:1 aspect
/** Auto-fire screen-shake (the chaingun): a subtle, deterministic (no `Math.random`) canvas
 *  jitter bumped per nail and decayed each frame, applied as a CSS transform with a slight overscan scale
 *  so the translate never reveals an edge gap. Kept to a couple of pixels — punchy, not nauseating. */
const SHAKE_BUMP_PX = 1; // per-nail shake bump
const SHAKE_MAX_PX = 2.2; // amplitude cap
const SHAKE_SETTLE_PX = 0.05; // below this the shake is settled → the transform is cleared
const SHAKE_DECAY_PER_S = 16; // px/s the shake fades once firing stops
const SHAKE_FREQ_X = 0.09; // jitter frequencies (rad/ms of timestamp) for the two axes
const SHAKE_FREQ_Y = 0.073;
/** Sustained shake the chainsaw holds the canvas at WHILE sawing — a low, steady motor rumble (well under
 *  the per-nail cap), re-pinned each frame so it stays level until the trigger releases and `applyShake` decays it. */
const SAW_SHAKE_PX = 0.9;
/** Chain-detonation blue flash (the plasma cable): a magnitude (0..1) bumped to full on a fresh chain hop
 *  and decayed each frame, written straight to the flash overlay's opacity (no signal churn, like the
 *  shake). Subtle — a brief blue glow that punches the chain, then fades. */
const FLASH_PEAK = 0.4; // peak overlay opacity at a fresh chain detonation
const FLASH_DECAY_PER_S = 5; // opacity/s the flash fades (≈0.2 s from full to clear)
const FLASH_SETTLE = 0.02; // below this the flash is cleared (the inline opacity is dropped)
/** Datacenter BFG charge punch: a GREEN overlay tint that intensifies as the weapon spins up, then a bright
 *  green discharge flash + a big screen-shake. The buildup opacity tracks `chargeProgress` live (peaking at
 *  `CHARGE_GLOW_PEAK`); the discharge reuses the decaying `flash` channel marked green (`CHARGE_FLASH_PEAK`,
 *  brighter than the blue chain flash). The `--charge` SCSS modifier swaps the overlay gradient to green. */
const CHARGE_GLOW_PEAK = 0.7; // peak charge-buildup tint opacity at full spin-up
const CHARGE_FLASH_PEAK = 0.92; // peak discharge flash opacity (the ultimate weapon — near-blinding green)
const CHARGE_FLASH_DECAY_PER_S = 3; // the GREEN discharge fades slower than the blue chain (`FLASH_DECAY_PER_S`) → a heavier afterglow
const DISCHARGE_SHAKE_PX = 8; // the discharge screen-shake bump (a big one, beyond the per-nail cap)
/** The HUD arms-grid numbers, all lit yellow — one per ARTED weapon in arsenal order (1..N), decoupled
 *  from the registry `slot` (the fist + chainsaw share registry slot 1). The player sees one
 *  number per weapon they hold — fist 1, chainsaw 2, pistol 3, shotgun 4, chaingun 5,
 *  rocket 6, plasma 7, bfg 8 — and the matching number key selects it directly. The full
 *  eight-weapon roster now lights HUD 1..8. */
const OWNED_SLOTS = [...ARSENAL.keys()].map((index) => index + 1);

/**
 * `sd-game` — the imperative shell: a `<canvas>`, the `requestAnimationFrame` loop, and the DOM
 * boundary that forwards events to the collaborators (`GameInput`, `GameRenderer`, `GameAudio`). All
 * math is delegated to the pure `core/lib/raycaster` engine. Mounted by the player only while
 * `GameService.running()`, so it never exists on the server.
 */
@Component({
  selector: 'sd-game',
  styleUrl: './game.component.scss',
  templateUrl: './game.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class GameComponent {
  /** Asked to leave the game — the player owns the full exit (mode + any fullscreen it entered). */
  public readonly exited = output<void>();
  /** Current fullscreen state + whether native fullscreen is available (both driven by the player, which
   *  owns the Fullscreen API). When available, the in-game button toggles it via `fullscreenToggle`. */
  public readonly fullscreen = input(false);
  public readonly fullscreenAvailable = input(false);
  public readonly fullscreenToggle = output<void>();

  protected readonly i18n = inject(I18nService);
  protected readonly input = new GameInput();
  protected readonly musicMuted = signal(true); // start MUTED — no auto-playing music until the player opts in
  protected readonly dead = signal(false);
  /** True until every served game asset has been preloaded — gates the loading overlay + the loop start, so
   *  the world/weapon art is fully decoded before the first frame (no pop-in). `loadProgress` is 0..1. */
  protected readonly loading = signal(true);
  protected readonly loadProgress = signal(0);
  /** The preload progress as a whole-number percentage (0..100) — a language-neutral readout for the loading
   *  overlay (so it needs no translated string), doubling as its accessible label. */
  protected readonly loadPct = computed(() => Math.round(this.loadProgress() * 100));
  /** Whether the active weapon has a magazine — drives the HUD ammo mode + the mobile reload button. */
  protected readonly weaponUsesMag = signal((ARSENAL[0].magSize ?? 0) > 0);

  private readonly game = inject(GameService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly hudCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('hud');
  private readonly flashEl = viewChild.required<ElementRef<HTMLDivElement>>('flash');
  private readonly fadeEl = viewChild.required<ElementRef<HTMLDivElement>>('fade');
  private readonly destroyRef = inject(DestroyRef);
  private readonly renderer = new GameRenderer();
  private readonly audio = new GameAudio();
  private readonly hud = new DoomHud();
  // The ACTIVE arsenal weapon, selected by the number keys (direct) or cycled by the wheel / switch
  // button (fist ⇄ chainsaw ⇄ pistol ⇄ shotgun ⇄ chaingun ⇄ rocket ⇄ plasma ⇄ bfg):
  // its index into `ARSENAL`, the first-person viewmodel (owns the FPS + reload sprites + swing animation;
  // its HUD bay icon feeds `hud.setWeapon`, the renderer blits it, the loop drives its timing), and the
  // combat numbers the pure engine `step` folds in. Spawns on index 0 — the mechanical fist. `combat`
  // is named to avoid clashing with the imported `weaponCombat` reducer; `weaponUsesMag` tracks whether the
  // active weapon has a magazine (the HUD ammo mode + the mobile reload button read it); `autoFire` /
  // `chargeFire` route the loop to the held-trigger burst path (the chaingun / plasma) or the spin-up-then-
  // discharge path (the datacenter BFG) instead of the semi swing/strike one.
  private activeWeapon = 0;
  private weaponView = new WeaponView(
    ARSENAL[0],
    weaponViewConfig(ARSENAL[0]),
    reloadViewConfig(ARSENAL[0]),
  );
  private readonly climbView = new ClimbView();
  private combat = weaponCombat(ARSENAL[0]);
  private autoFire = ARSENAL[0].fireMode === 'auto';
  private chargeFire = ARSENAL[0].fireMode === 'charge';
  // A mag-less AUTO melee (the chainsaw) has no per-round mag delta to drive its SFX/recoil, so the shell
  // paces them off this clock: every `fireCooldown` of held sawing emits one grind tick + a recoil bump.
  private sawClock = 0;
  // Auto-fire screen-shake: a magnitude (px) bumped per nail (`bumpShake`) and decayed each frame
  // (`applyShake`), written to the canvas as a CSS transform. `shakeApplied` gates the reset, so a
  // non-auto weapon (shake stays 0) never touches the canvas transform.
  private shake = 0;
  private shakeApplied = false;
  // Chain-detonation blue flash: a magnitude (0..1) set on a fresh plasma chain (`punchOnChain`) and decayed
  // each frame (`applyFlash`), written to the flash overlay's opacity. `flashApplied` gates the reset, so a
  // frame with no chain never touches the overlay style. The datacenter BFG reuses this channel for its
  // GREEN discharge flash (`flashGreen` marks it green vs the plasma's blue) and drives `chargeGlow` (0..1)
  // for the LIVE green charge-buildup tint that rises as it spins up — both rendered by `applyFlash`.
  private flash = 0;
  private flashApplied = false;
  private flashGreen = false; // the decaying `flash` is the BFG's green discharge (vs the plasma's blue chain)
  private chargeGlow = 0; // 0..1 live green charge-buildup tint while the BFG spins up (0 otherwise)
  // Per-weapon loaded magazine (weapon id → rounds): the core keeps ONE active `state.mag`, so the shell
  // stashes the outgoing weapon's mag on every switch and restores the incoming one — each magazine weapon
  // (the pistol, the shotgun) keeps its own loaded count across switches. A weapon's first selection
  // defaults to a full magazine; `respawnRun` clears the map so every weapon reloads full after a death.
  private readonly mags = new Map<string, number>();

  // The live, mutable grid the player actually moves/raycasts through: a copy of the level's cells so
  // opening a door (clearing its seam to 0) is a local edit. Re-cloned on EVERY reseed (placeholders
  // here are overwritten by `seedState`'s `cloneLiveMap`, which runs last in the field init order).
  private liveCells: number[] = [];
  private liveMap: GameMap = this.game.level().map;
  // A keycard door mid-opening: the seam cells, the elapsed 0..1 progress, and the lock colour (for the
  // renderer's animation). Non-null FREEZES the player (the world keeps ticking); cleared on completion.
  private doorAnim: { cells: number[]; progress: number; colorIndex: number } | null = null;
  // The zone-EXIT airlock transition: `out` plays the open anim + fades to black (then loads the next level
  // at full black), `in` fades back in on the new zone. Non-null FREEZES the player; cleared when `in` ends.
  private exitFade: { phase: 'out' | 'in'; progress: number } | null = null;
  private fadeApplied = false; // gates clearing the black-fade overlay's inline opacity (like `flashApplied`)
  private liveLevel: Level = this.game.level();
  // Cumulative kills carried across levels (the HUD no longer shows it, but `seedState` keeps the count
  // running so the per-frame kill-SFX delta stays consistent on a floor swap). Declared before `state`
  // so the field-init `seedState()` reads its seed (0).
  private carriedKills = 0;

  /** Live, per-frame state — a plain mutable (no 60 fps signal churn). Seeded from the current level. */
  private state: GameState = this.seedState();
  private rafId = 0;
  private lastTimestamp = 0;
  private deadSince = 0; // timestamp (ms) the player died, for the game-over freeze
  // Previous-frame snapshots, so the SFX fire off the *deltas* (a hit / kill / damage / pickup event).
  private prevKills = 0;
  private prevHits = 0;
  private prevHp = 100;
  private prevPickups = 0;
  private prevAmmoPickups = 0; // last frame's ammo-box count, to fire the pickup SFX when one is collected
  private prevDir = this.state.pose.dir; // last frame's facing, to read the turn rate for the HUD gaze
  private prevHeldKeys = 0; // last frame's keycard bitmask, to light a card the frame its bit rises

  constructor() {
    this.resetCombatBaseline();
    afterNextRender(() => {
      this.renderer.prepare(this.game.level());
      this.resizeCanvas();
      // PROGRESSIVE preload. Stage 1 (the overlay): decode only what is on screen the instant the loop starts —
      // world textures, foes, HUD, the starting weapon — then drop the overlay and start the loop, so the first
      // frame draws those fully (no placeholder pop-in for anything immediately visible). Stage 2: stream the
      // action-triggered art (other weapons, effects, doors, climb hands, ammo boxes) BEHIND the running game —
      // each only appears once you act, and the renderer draws nothing until its sprite decodes, so none pops in.
      void preloadImages(criticalAssetUrls(), (loaded, total) =>
        this.loadProgress.set(total === 0 ? 1 : loaded / total),
      )
        .then(() => warmEnemyViews()) // bake the directional atlases before the loop → no procedural-blob flash
        .then(() => {
          this.loading.set(false);
          this.lastTimestamp = performance.now();
          this.rafId = requestAnimationFrame((timestamp) => this.frame(timestamp));
          void preloadImages(deferredAssetUrls()); // fire-and-forget; no overlay, no progress
        });
    });
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.rafId);
      this.audio.dispose();
    });
  }

  protected toggleMusic(): void {
    const muted = !this.musicMuted();

    this.musicMuted.set(muted);
    this.audio.setMuted(muted);
  }

  /** Trigger pressed (the first gesture also unblocks audio). Raises the held flag AND queues a single
   *  edge: a SEMI weapon takes the one-shot edge (the loop starts a swing + plays the key-clack, firing
   *  the core hit on the strike frame), while an AUTO weapon (the chaingun) fires continuously for as long
   *  as the trigger stays held. Shared by the mobile fire button + the locked-canvas mouse press. */
  protected onFireDown(): void {
    this.audio.ensureStarted();
    this.input.fireDown();
  }

  /** Trigger released — drops the held flag so an AUTO burst stops (the SEMI edge was already consumed).
   *  Wired to the mobile button's touchend/cancel and the document mouseup. */
  protected onFireUp(): void {
    this.input.fireUp();
  }

  /** Mobile use button — queues a "use" the loop checks against the exit switch. */
  protected use(): void {
    this.input.triggerUse();
  }

  /** Mobile weapon-switch button — queues a cycle the loop consumes (and unblocks audio on the gesture). */
  protected onSwitch(): void {
    this.audio.ensureStarted();
    this.input.triggerSwitch();
  }

  /** Mobile reload button — queues a reload the loop consumes (and unblocks audio on the gesture). Shown
   *  only for a magazine weapon (`weaponUsesMag`); the `r` key does the same on desktop. */
  protected onReload(): void {
    this.audio.ensureStarted();
    this.input.triggerReload();
  }

  /** Re-size the backing store and tell input the layout, on mount and on every resize / rotation. */
  @HostListener('window:resize')
  protected resizeCanvas(): void {
    const portrait = matchMedia('(pointer: coarse) and (orientation: portrait)').matches;

    this.input.setPortrait(portrait);
    this.renderer.resize(this.canvas().nativeElement, portrait);
    this.resizeHud();
  }

  /** Block iOS pinch-zoom (the non-standard `gesture*` events) while the game is mounted, so a
   *  two-finger drag plays the game instead of zooming the page. `user-scalable=no` is ignored on iOS,
   *  so this is the reliable lever. Scoped automatically: the component only exists while playing. */
  @HostListener('document:gesturestart', ['$event'])
  @HostListener('document:gesturechange', ['$event'])
  protected blockGestureZoom(event: Event): void {
    event.preventDefault();
  }

  // ---- desktop input -------------------------------------------------------
  @HostListener('document:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    this.audio.ensureStarted(); // first keypress is a user gesture → unblocks audio

    if (this.input.keyDown(event)) {
      event.preventDefault(); // a game key must not scroll the page / page down
    }
  }

  @HostListener('document:keyup', ['$event'])
  protected onKeyUp(event: KeyboardEvent): void {
    this.input.keyUp(event);
  }

  /** First canvas press engages pointer lock; once locked, the LEFT button holds the trigger down (released
   *  on the document mouseup) — a tap is one shot for a semi weapon, a continuous burst for an auto one —
   *  and the RIGHT button queues a reload (the desktop twin of the `r` key + mobile reload button). */
  protected onCanvasPointerDown(event?: MouseEvent): void {
    if (document.pointerLockElement === this.canvas().nativeElement) {
      // A SECONDARY click reloads — the right button (`button === 2`) OR a macOS Ctrl+click (`ctrlKey`,
      // which reports `button === 0`). ANYTHING else — a plain left click, or a defensive no-arg call —
      // fires, so the primary trigger can never be swallowed by the reload branch.
      if (event && (event.button === 2 || event.ctrlKey)) {
        // Stop the secondary press from popping the OS menu / dropping pointer lock (which would then make
        // the next left-click merely re-lock instead of fire) — then queue the reload.
        event.preventDefault();
        this.input.triggerReload();
      } else {
        this.onFireDown();
      }
    } else {
      this.audio.ensureStarted(); // click is a user gesture → unblocks audio
      this.canvas().nativeElement.requestPointerLock?.();
    }
  }

  /** Swallow the right-click context menu over the canvas — right-click is the in-game reload, not a menu. */
  protected onContextMenu(event: Event): void {
    event.preventDefault();
  }

  /** Mouse released anywhere — release the held trigger (ends an auto burst). */
  @HostListener('document:mouseup')
  protected onPointerUp(): void {
    this.input.fireUp();
  }

  /** Pointer-lock forced out (Alt+Tab, a dialog, a notification) with the trigger physically held fires no
   *  `mouseup` on the document — drop the hold here so an auto weapon can't stick firing. */
  @HostListener('document:pointerlockchange')
  protected onPointerLockChange(): void {
    this.input.fireUp();
  }

  @HostListener('document:mousemove', ['$event'])
  protected onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement === this.canvas().nativeElement) {
      this.input.look(event.movementX);
    }
  }

  /** Mouse-wheel while pointer-locked cycles the active weapon (one notch = one cycle; the edge-triggered
   *  queue collapses a fast scroll to a single switch per frame). Only while locked, so the page scroll is
   *  untouched everywhere else; `preventDefault` is guarded on `cancelable` since browsers mark wheel
   *  listeners passive. */
  @HostListener('document:wheel', ['$event'])
  protected onWheel(event: WheelEvent): void {
    if (document.pointerLockElement !== this.canvas().nativeElement) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    this.input.triggerSwitch();
  }

  // ---- mobile input (the component is just the touch boundary) --------------
  protected onJoyStart(event: TouchEvent): void {
    this.audio.ensureStarted(); // touch is a user gesture → unblocks audio
    this.input.joyStart(event);
  }

  protected onLookStart(event: TouchEvent): void {
    this.audio.ensureStarted();
    this.input.lookStart(event);
  }

  // ---- loop ----------------------------------------------------------------
  private frame(timestamp: number): void {
    const deltaTime = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);

    this.lastTimestamp = timestamp;
    if (this.dead()) {
      if (timestamp - this.deadSince >= GAMEOVER_DURATION) {
        this.respawnRun();
      }
    } else if (this.exitFade) {
      // The zone-exit airlock is mid-transition → the player is FROZEN (the world keeps ticking) while the
      // door opens + the screen fades to black, the next level loads, then it fades back in.
      this.advanceExitFade(deltaTime);
      this.checkDeath(timestamp);
    } else if (this.doorAnim) {
      // A keycard door is opening → the player is FROZEN (no movement/fire), but the world keeps ticking so
      // enemies still close in. On completion the seam clears and control returns.
      this.advanceDoorAnim(deltaTime);
      this.checkDeath(timestamp);
    } else {
      const intent = this.input.intent();

      const selected = this.input.consumeSelect();

      if (selected !== null) {
        this.selectWeapon(selected);
      }
      if (this.input.consumeSwitch()) {
        this.switchWeapon();
      }
      intent.reload = this.input.consumeReload(); // edge-triggered, like the switch (the `r` key / mobile button)
      if (this.autoFire) {
        this.stepAutoFire(intent, deltaTime);
      } else if (this.chargeFire) {
        this.stepChargeFire(intent, deltaTime);
      } else {
        this.stepSemiFire(intent, deltaTime);
      }
      // Drive the reload viewmodel off the engine's reload clock: the elapsed fraction picks the reload
      // strip frame; `null` once the reload finishes (or for a magazine-less weapon) → the fire/idle draw.
      const reloadTime = this.combat.reloadTime;

      this.weaponView.setReloadProgress(
        reloadTime > 0 && this.state.reloadClock > 0
          ? 1 - this.state.reloadClock / reloadTime
          : null,
      );
      this.punchOnChain();
      this.punchOnBfgImpact();
      this.handleUse();
      this.startDoorIfFacing(); // proximity: a keycard door dead ahead opens itself
      this.startExitIfFacing(); // proximity: reaching the exit airlock starts the zone transition
      this.checkDeath(timestamp);
    }
    this.syncHud(deltaTime);
    this.renderer.setDoorAnim(
      this.doorAnim ? this.doorAnim.colorIndex : null,
      this.doorAnim
        ? Math.min(DOOR_ANIM_FRAMES - 1, Math.floor(this.doorAnim.progress * DOOR_ANIM_FRAMES))
        : 0,
    );
    this.renderer.setExitAnim(
      this.exitFade?.phase === 'out'
        ? Math.min(DOOR_ANIM_FRAMES - 1, Math.floor(this.exitFade.progress * DOOR_ANIM_FRAMES))
        : null,
    );
    this.renderer.render(
      this.canvas().nativeElement,
      this.state,
      this.liveLevel,
      this.weaponView,
      this.climbView,
    );
    this.applyFade();
    this.applyShake(timestamp, deltaTime);
    this.applyFlash(deltaTime);
    this.rafId = requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }

  /** SEMI weapons (melee, the pistol, the shotgun): a fire press only STARTS a swing (and plays the
   *  key-clack on a real one); the core hit is emitted on the swing's strike frame, so `intent.fire`
   *  becomes the strike-frame edge — one hit per press. The tick runs every frame so the idle/cooldown
   *  timers keep advancing. */
  private stepSemiFire(intent: MoveIntent, deltaTime: number): void {
    // A magazine weapon needs a loaded round (and no reload running); a magazine-less weapon (melee) always
    // fires. An empty press plays a dry click, NOT a phantom fire swing.
    const loaded =
      !this.weaponUsesMag() ||
      (this.state.mag >= this.combat.ammoPerShot && this.state.reloadClock <= 0);

    if (intent.fire) {
      if (loaded && this.weaponView.tryTrigger()) {
        this.audio.playMelee();
      } else if (!loaded) {
        this.weaponView.dryFire();
      }
    }
    intent.fire = this.weaponView.tick(deltaTime);
    this.state = step(
      this.state,
      intent,
      this.liveMap,
      deltaTime,
      this.combat,
      this.renderer.aimTarget(),
    );
  }

  /** AUTO weapons (the chaingun + the chainsaw melee): a HELD trigger fires continuously. The pure
   *  engine already auto-fires whenever `intent.fire && fireCooldown <= 0`, so we feed it the raw held flag
   *  (a MAGAZINE weapon also gated on a loaded mag + not mid-reload; a mag-less melee always fires) and let
   *  it cadence the swing off `fireCooldown`. A magazine weapon punches its per-shot SFX + recoil + shake off
   *  the mag delta; the mag-less chainsaw has no delta, so it paces a grind tick + recoil off `sawClock`. The
   *  viewmodel loops its fire frames while firing (the chaingun's muzzle flashes, the chainsaw's spinning chain). */
  private stepAutoFire(intent: MoveIntent, deltaTime: number): void {
    const usesMag = this.weaponUsesMag();
    const held = this.input.firing();
    const firing = held && (!usesMag || (this.state.mag > 0 && this.state.reloadClock <= 0));
    const magBefore = this.state.mag;

    if (usesMag && held && !firing) {
      this.weaponView.dryFire(); // magazine weapon held but empty (or mid-reload) → a dry click, no loop
    }
    this.weaponView.setFiring(firing);
    this.weaponView.tick(deltaTime);
    intent.fire = firing;
    this.state = step(
      this.state,
      intent,
      this.liveMap,
      deltaTime,
      this.combat,
      this.renderer.aimTarget(),
    );
    if (usesMag) {
      if (this.state.mag < magBefore) {
        this.audio.playNail();
        this.weaponView.recoilKick();
        this.bumpShake();
      }

      return;
    }
    // Mag-less AUTO melee (the chainsaw): no mag delta to read, so pace the grind buzz + recoil vibration off
    // the saw clock — one tick per `fireCooldown` of continuous sawing — plus a sustained low motor rumble
    // (`SAW_SHAKE_PX`, re-pinned every frame while held). Reset the clock the moment the saw stops.
    if (firing) {
      this.shake = Math.max(this.shake, SAW_SHAKE_PX); // steady motor rumble while sawing
      this.sawClock += deltaTime;
      if (this.sawClock >= this.combat.fireCooldown) {
        this.sawClock -= this.combat.fireCooldown;
        this.audio.playSaw();
        this.weaponView.recoilKick();
      }
    } else {
      this.sawClock = 0;
    }
  }

  /** CHARGE weapon (the datacenter BFG): a fire press starts the viewmodel's spin-up — but only if the
   *  magazine holds a full `ammoPerShot` charge (else a fail blip) — and any press once it is already
   *  engaged is ignored (engaged once started, no cancel). The viewmodel holds the charge frame for
   *  `chargeTime`, then reports the discharge strike edge (via `tick`), which becomes `intent.fire` so the
   *  core launches the big projectile + drains the whole 40-round mag. The green charge-buildup tint tracks
   *  `chargeProgress` live; the discharge punches a bright green flash, a big screen-shake, and a weapon
   *  kick (the AOE explosion sprite is drawn by the renderer's `drawImpacts`). */
  private stepChargeFire(intent: MoveIntent, deltaTime: number): void {
    if (intent.fire && !this.weaponView.swinging()) {
      if (this.state.mag >= this.combat.ammoPerShot) {
        if (this.weaponView.tryTrigger()) {
          this.audio.playMelee(); // a low spin-up blip on a real charge start
        }
      } else {
        this.audio.playHurt(); // empty mag → a fail blip (reuses the hurt thump)
        this.weaponView.dryFire(); // …and a dry click instead of the charge spin-up
      }
    }
    intent.fire = this.weaponView.tick(deltaTime); // true only on the discharge frame
    this.state = step(
      this.state,
      intent,
      this.liveMap,
      deltaTime,
      this.combat,
      this.renderer.aimTarget(),
    );
    // Live green charge-buildup tint while spinning up; the discharge punch on the strike edge.
    this.chargeGlow = this.weaponView.charging()
      ? this.weaponView.chargeProgress() * CHARGE_GLOW_PEAK
      : 0;
    if (intent.fire) {
      this.flash = 1;
      this.flashGreen = true;
      this.shake = Math.max(this.shake, DISCHARGE_SHAKE_PX);
      this.weaponView.recoilKick();
    }
  }

  /** Bump the auto-fire screen-shake one nail's worth (capped). */
  private bumpShake(): void {
    this.shake = Math.min(SHAKE_MAX_PX, this.shake + SHAKE_BUMP_PX);
  }

  /** A plasma chain detonated THIS frame — a fresh, age-0 arc the engine pushed this step (only the chain
   *  spawns arcs; the rocket never does). Punch the blue flash to full + bump the shake, so the chain reads
   *  with a beat of its own on top of the per-shot recoil. */
  private punchOnChain(): void {
    if (this.state.arcs.some((arc) => arc.age === 0)) {
      this.flash = 1;
      this.flashGreen = false; // the plasma chain flash is blue (the BFG's green discharge sets this true)
      this.bumpShake();
    }
  }

  /** The BFG ball detonated THIS frame — a fresh, age-0 `explosion_bfg` impact the engine pushed this step.
   *  Punch the GREEN flash to full so the implosion reads with the same green beat as the charge-buildup +
   *  discharge (not just a world-space blast). */
  private punchOnBfgImpact(): void {
    if (this.state.impacts.some((impact) => impact.kind === 'explosion_bfg' && impact.age === 0)) {
      this.flash = 1;
      this.flashGreen = true;
      this.bumpShake();
    }
  }

  /** Decay the screen-shake and write it to the canvas as a subtle CSS transform (a slight overscan
   *  scale hides the translate gap). Clears the transform once settled — a non-auto weapon keeps the
   *  shake at 0, so this never touches the canvas there. */
  private applyShake(timestamp: number, deltaTime: number): void {
    this.shake = Math.max(0, this.shake - deltaTime * SHAKE_DECAY_PER_S);
    const canvas = this.canvas().nativeElement;

    if (this.shake < SHAKE_SETTLE_PX) {
      if (this.shakeApplied) {
        canvas.style.transform = '';
        this.shakeApplied = false;
      }

      return;
    }
    const shakeX = Math.sin(timestamp * SHAKE_FREQ_X) * this.shake;
    const shakeY = Math.cos(timestamp * SHAKE_FREQ_Y) * this.shake;

    canvas.style.transform = `scale(1.03) translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`;
    this.shakeApplied = true;
  }

  /** Decay the discharge/chain flash, fold in the LIVE green charge-buildup tint, and write the result to
   *  the overlay's opacity (like `applyShake`, a direct style write — no 60 fps signal churn). The `--charge`
   *  modifier swaps the overlay gradient to green whenever the BFG buildup is live OR the decaying flash is
   *  its green discharge; the plasma's blue chain flash leaves it off. Clears the inline opacity + the
   *  modifier once settled, so a frame with neither punch costs nothing. */
  private applyFlash(deltaTime: number): void {
    const decay = this.flashGreen ? CHARGE_FLASH_DECAY_PER_S : FLASH_DECAY_PER_S;

    this.flash = Math.max(0, this.flash - deltaTime * decay);
    const overlay = this.flashEl().nativeElement;
    const peak = this.flashGreen ? CHARGE_FLASH_PEAK : FLASH_PEAK;
    const opacity = Math.max(this.chargeGlow, this.flash * peak);

    if (opacity < FLASH_SETTLE) {
      if (this.flashApplied) {
        overlay.style.opacity = '';
        overlay.classList.remove('game__flash--charge');
        this.flashApplied = false;
        this.flashGreen = false;
      }

      return;
    }
    overlay.classList.toggle('game__flash--charge', this.chargeGlow > 0 || this.flashGreen);
    overlay.style.opacity = opacity.toFixed(3);
    this.flashApplied = true;
  }

  /** Size the HUD backing store to its displayed pixel size (DPR-aware, capped at the x1.0 native width)
   *  so `DoomHud` picks the matching art tier and draws crisp; the height keeps the bar's 5.24:1 aspect.
   *  Skips a not-yet-laid-out (0-width) rect — the next resize / frame sizes it. */
  private resizeHud(): void {
    const hud = this.hudCanvas().nativeElement;
    const rect = hud.getBoundingClientRect();

    if (rect.width < 1) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(HUD_NATIVE_WIDTH, Math.round(rect.width * dpr));

    hud.width = width;
    hud.height = Math.round((width * HUD_NATIVE_HEIGHT) / HUD_NATIVE_WIDTH);
  }

  /** Resolve a queued "use" as a manual fallback for the exit airlock (proximity already opens it via
   *  `startExitIfFacing`). Keycard doors no longer use it — they open on PROXIMITY via `startDoorIfFacing`. */
  private handleUse(): void {
    if (!this.input.consumeUse()) {
      return;
    }
    if (isFacingExit(this.state.pose, this.liveMap)) {
      this.beginExitTransition();
    }
  }

  /** PROXIMITY door open: a keycard door dead ahead (within the "use" reach) whose colour the player holds
   *  starts its open animation — no button press. No-op while another door is already animating, or facing a
   *  door whose key you lack (it stays closed). The seam clears when the animation completes (`advanceDoorAnim`). */
  private startDoorIfFacing(): void {
    const di = facingDoorIndex(this.state.pose, this.liveMap);

    if (di === null) {
      return;
    }
    const colorIndex = doorColorIndex(this.liveCells[di]);

    if (!hasKey(this.state.heldKeys, colorIndex)) {
      return; // the matching badge is missing — the door stays locked
    }
    this.doorAnim = {
      cells: doorGroup(this.liveCells, di, this.liveMap.width),
      progress: 0,
      colorIndex,
    };
    this.audio.playDoor();
  }

  /** Advance an opening keycard door while the player is FROZEN: the world still steps (enemies close in,
   *  projectiles fly) on a zeroed intent, the weapon viewmodel keeps ticking, and the open animation
   *  progresses. When it finishes, the whole seam clears to floor (passable) and control returns. */
  private advanceDoorAnim(deltaTime: number): void {
    const anim = this.doorAnim;

    if (!anim) {
      return;
    }
    this.stepFrozenWorld(deltaTime);
    anim.progress += deltaTime / DOOR_ANIM_DURATION_S;
    if (anim.progress >= 1) {
      for (const idx of anim.cells) {
        this.liveCells[idx] = 0; // the seam is now open floor — the player can walk through
      }
      this.doorAnim = null;
    }
  }

  /** Step the world for one frame with the PLAYER FROZEN (zeroed intent: no move/turn/fire), so enemies +
   *  projectiles still advance while a door / the exit airlock animates. Keeps the weapon viewmodel ticking. */
  private stepFrozenWorld(deltaTime: number): void {
    const frozen: MoveIntent = { forward: 0, strafe: 0, look: 0, fire: false, reload: false };

    this.state = step(this.state, frozen, this.liveMap, deltaTime, this.combat);
    this.weaponView.tick(deltaTime);
  }

  /** PROXIMITY exit: reaching the zone-exit airlock (facing it within the use reach) starts its transition —
   *  no button press. No-op while already transitioning / a door is opening (the `beginExitTransition` guard). */
  private startExitIfFacing(): void {
    if (isFacingExit(this.state.pose, this.liveMap)) {
      this.beginExitTransition();
    }
  }

  /** Begin the zone-exit airlock transition (the open anim + fade-to-black `out` phase). Guarded so it never
   *  restarts mid-transition or while a keycard door is animating. */
  private beginExitTransition(): void {
    if (this.exitFade || this.doorAnim) {
      return;
    }
    this.exitFade = { phase: 'out', progress: 0 };
    this.audio.playDoor();
  }

  /** Advance the zone-exit airlock transition while the player is FROZEN. `out`: the door opens + the screen
   *  fades to black, and at full black the next level loads (a new seed) and the phase flips to `in`. `in`:
   *  the screen fades back in on the new zone, then control returns. The world keeps ticking throughout. */
  private advanceExitFade(deltaTime: number): void {
    const fade = this.exitFade;

    if (!fade) {
      return;
    }
    this.stepFrozenWorld(deltaTime);
    if (fade.phase === 'out') {
      fade.progress += deltaTime / EXIT_FADE_OUT_S;
      if (fade.progress >= 1) {
        this.advanceLevel(); // load the next zone at full black (resets `exitFade` → re-armed for the fade-in)
        this.exitFade = { phase: 'in', progress: 0 };
      }
    } else {
      fade.progress += deltaTime / EXIT_FADE_IN_S;
      if (fade.progress >= 1) {
        this.exitFade = null; // fully faded in — control returns on the new zone
      }
    }
  }

  /** Drive the full-screen black fade overlay's opacity from the exit transition: rising 0→1 while the door
   *  opens (`out`), then falling 1→0 on the new zone (`in`); cleared (no inline opacity) when idle. A direct
   *  style write (no signal churn), gated like `applyFlash`. */
  private applyFade(): void {
    const fade = this.exitFade;
    const opacity = !fade ? 0 : fade.phase === 'out' ? fade.progress : 1 - fade.progress;
    const overlay = this.fadeEl().nativeElement;

    if (opacity <= 0) {
      if (this.fadeApplied) {
        overlay.style.opacity = '';
        this.fadeApplied = false;
      }

      return;
    }
    overlay.style.opacity = Math.min(1, opacity).toFixed(3);
    this.fadeApplied = true;
  }

  /** Flag the run dead once HP hits zero (shared by the normal step + the door/exit-freeze branches, so
   *  enemies can still finish you while a door or the exit airlock opens). */
  private checkDeath(timestamp: number): void {
    if (this.state.playerHp <= 0) {
      this.dead.set(true);
      this.deadSince = timestamp;
    }
  }

  /** Cycle to the next arted weapon, wrapping round the arsenal — the mouse-wheel + the mobile switch
   *  button (mobile has no number keys). */
  private switchWeapon(): void {
    this.setActiveWeapon((this.activeWeapon + 1) % ARSENAL.length);
  }

  /** Select an arted weapon directly by its 1-based HUD number (1 = fist, 2 = chainsaw,
   *  3 = pistol, 4 = shotgun, 5 = chaingun, 6 = lithium launcher, 7 = plasma cable, 8 = datacenter
   *  BFG) — the number keys feed this. A number past the arted roster (9+ today) is ignored. */
  private selectWeapon(slot: number): void {
    const index = slot - 1;

    if (index >= 0 && index < ARSENAL.length) {
      this.setActiveWeapon(index);
    }
  }

  /** Make `ARSENAL[index]` the active weapon. A no-op when it is already active or while a swing is
   *  mid-animation (a weapon never changes mid-attack); otherwise stashes the OUTGOING weapon's loaded
   *  magazine, rebuilds the viewmodel + combat numbers (its FPS + reload strips + HUD bay icon load
   *  async), tracks whether it uses a magazine + whether it is a held-trigger auto weapon, loads the
   *  INCOMING weapon's own mag (full on its first selection), CANCELS any in-progress reload (the fresh
   *  viewmodel starts idle), and blips the swap SFX.
   *  The HUD bay icon + ammo readout refresh on the next `syncHud`. */
  private setActiveWeapon(index: number): void {
    if (index === this.activeWeapon || this.weaponView.swinging()) {
      return;
    }
    this.mags.set(ARSENAL[this.activeWeapon].id, this.state.mag); // keep the outgoing weapon's loaded count
    this.activeWeapon = index;
    const weapon = ARSENAL[index];

    this.weaponView = new WeaponView(weapon, weaponViewConfig(weapon), reloadViewConfig(weapon));
    this.combat = weaponCombat(weapon);
    this.autoFire = weapon.fireMode === 'auto';
    this.chargeFire = weapon.fireMode === 'charge';
    this.chargeGlow = 0; // drop any leftover charge-buildup tint from the outgoing weapon
    this.weaponUsesMag.set((weapon.magSize ?? 0) > 0);
    const loaded = this.mags.get(weapon.id) ?? weapon.magSize ?? 0; // its own count, or a full mag first time

    this.state = { ...this.state, mag: loaded, reloadClock: 0 }; // load its mag, abandon any reload in progress
    this.audio.playMelee();
  }

  /** Push the live vitals to the image HUD and repaint it (the compositor dirty-checks, so an idle frame
   *  costs nothing). The face row = health, the gaze = this frame's turn rate, the grimace flashed by
   *  `onHit` off the damage edge in `playCombatSfx`; a keycard lights the frame its held-bit rises. */
  private syncHud(dt: number): void {
    this.playCombatSfx();
    this.carriedKills = this.state.kills;
    this.hud.setHealth(Math.max(0, this.state.playerHp));
    this.hud.setMental(this.state.playerArmor);
    // Ammo readout: a magazine weapon shows loaded mag + the active type's reserve; a flat-pool weapon shows
    // that reserve; a melee weapon passes `null` so the bay draws no digits (the icon only). The reserve is
    // the active weapon's OWN per-type pool (`ammoType` is non-null for every magazine / flat-pool weapon).
    const ammoType = ARSENAL[this.activeWeapon].ammoType;
    const reserve = ammoType !== null ? (this.state.playerAmmo[ammoType] ?? 0) : 0;

    if (this.weaponUsesMag()) {
      this.hud.setAmmo(this.state.mag, reserve);
    } else if (this.combat.costsAmmo) {
      this.hud.setAmmo(reserve);
    } else {
      this.hud.setAmmo(null);
    }
    // The arms grid lights one yellow number per arted weapon (1..N in arsenal order): fist 1,
    // chainsaw 2, pistol 3, shotgun 4, chaingun 5, rocket 6, plasma 7, bfg 8.
    this.hud.setArms(OWNED_SLOTS);
    this.hud.setWeapon(this.weaponView.icon() ?? null);
    if (this.state.heldKeys !== this.prevHeldKeys) {
      for (let bit = 0; bit < KEYCARD_COLORS.length; bit++) {
        if (hasKey(this.state.heldKeys, bit) && !hasKey(this.prevHeldKeys, bit)) {
          this.hud.addCard(KEYCARD_COLORS[bit]);
        }
      }
      this.prevHeldKeys = this.state.heldKeys;
    }
    const turnRate = dt > 0 ? this.shortestAngle(this.state.pose.dir - this.prevDir) / dt : 0;

    this.prevDir = this.state.pose.dir;
    this.hud.lookAt(this.gazeForTurn(turnRate));
    this.hud.render(this.hudCanvas().nativeElement, dt);
  }

  /** Map a signed turn rate (rad/s, + = turning right) to a HUD gaze: centre below `GAZE_TURN_RATE`,
   *  then a near or extreme glance toward the turn. */
  private gazeForTurn(turnRate: number): Gaze {
    const speed = Math.abs(turnRate);

    if (speed < GAZE_TURN_RATE) {
      return 0;
    }
    const far = speed >= GAZE_FAR_TURN_RATE ? 2 : 1;

    return (turnRate > 0 ? far : -far) as Gaze;
  }

  /** Shortest signed angular delta in [−π, π], robust to any wrapping of `pose.dir`. */
  private shortestAngle(delta: number): number {
    return Math.atan2(Math.sin(delta), Math.cos(delta));
  }

  /** Fire the combat SFX off this frame's state deltas (a landed hit, a kill, damage taken, a pickup
   *  collected). The audio methods self-silence when muted or before the first user gesture. */
  private playCombatSfx(): void {
    if (this.state.kills > this.prevKills) {
      this.audio.playKill();
    }
    if (this.state.hits > this.prevHits) {
      this.audio.playHit();
    }
    if (this.state.playerHp < this.prevHp) {
      this.audio.playHurt();
      this.hud.onHit();
    }
    // Both a vitals pickup and a collected ammo box (its count dropped — a FULL type keeps the box, so the
    // count holds and no sound fires) reuse the existing pickup SFX.
    if (
      this.state.pickups.length < this.prevPickups ||
      this.state.ammoPickups.length < this.prevAmmoPickups
    ) {
      this.audio.playPickup();
    }
    this.resetCombatBaseline();
  }

  /** Snapshot the current state as the baseline for the next frame's SFX deltas (also after a reseed,
   *  so a level swap / respawn never replays a spurious hit / kill / pickup sound). */
  private resetCombatBaseline(): void {
    this.prevKills = this.state.kills;
    this.prevHits = this.state.hits;
    this.prevHp = this.state.playerHp;
    this.prevPickups = this.state.pickups.length;
    this.prevAmmoPickups = this.state.ammoPickups.length;
  }

  /** Player died: reset the whole run to level 1 with full vitals + kills 0. */
  private respawnRun(): void {
    this.game.resetRun();
    this.input.consumeSwitch(); // drop any weapon-switch queued (key/wheel) during the death screen
    this.input.fireUp(); // drop a held trigger too, so an auto weapon doesn't resume firing on respawn
    this.mags.clear(); // every weapon reloads to full after a death; `seedState` re-seeds the active one
    this.carriedKills = 0;
    this.hud.clearCards();
    this.prevHeldKeys = 0;
    this.state = this.seedState();
    this.prevDir = this.state.pose.dir;
    this.resetCombatBaseline();
    this.renderer.applyLevel(this.game.level());
    this.dead.set(false);
  }

  /** Seed live state from the current level; keeps the cumulative kill count across levels via
   *  `carriedKills`. Also re-clones the live map (so opened doors never leak into the next level) — the
   *  single funnel for the field init, `advanceLevel`, and `respawnRun`. */
  private seedState(): GameState {
    const level = this.game.level();

    this.cloneLiveMap();

    return {
      pose: { ...level.spawn },
      enemies: level.enemies.map((enemy) => ({ ...enemy })),
      kills: this.carriedKills,
      hits: 0,
      fireCooldown: 0,
      bobPhase: 0,
      playerHp: 100,
      playerArmor: 0,
      playerAmmo: startingAmmo(), // each ammo type seeded at min(AMMO_START, its max) — per-type reserves
      mag: ARSENAL[this.activeWeapon].magSize ?? 0, // the active weapon spawns full; a melee weapon → 0
      reloadClock: 0,
      projectiles: [],
      playerProjectiles: [],
      impacts: [],
      arcs: [],
      pickups: level.pickups.map((pickup) => ({ ...pickup })),
      ammoPickups: level.ammoSpawns.flatMap((spawn) => this.resolveAmmoSpawn(spawn)),
      keys: level.keys.map((key) => ({ ...key })),
      heldKeys: 0,
      hurtFlash: 0,
      playerSlow: 0,
    };
  }

  /** Resolve one placed `AmmoSpawn` into a runtime `AmmoPickup`: the descriptor (`ammo-pickups.json`) gives
   *  the ammo type + amount; the cap comes from `weapons.json` `ammo_types[ammoType].max` (`ammoTypeMax`) —
   *  the per-type `max` is sourced there, never on the entity author. An unknown id resolves to nothing. */
  private resolveAmmoSpawn(spawn: AmmoSpawn): AmmoPickup[] {
    const descriptor = ammoPickupById(spawn.pickupId);

    if (!descriptor) {
      return [];
    }

    return [
      {
        x: spawn.x,
        y: spawn.y,
        kind: descriptor.id,
        ammoType: descriptor.ammoType,
        amount: descriptor.amount,
        max: ammoTypeMax(descriptor.ammoType),
        age: 0,
      },
    ];
  }

  /** Re-clone the live, mutable cells from the current level + the map/level views over them. Opening
   *  a door clears its seam in `liveCells` in place; re-cloning on every reseed keeps that local to the
   *  floor (and keeps `liveMap` the exact grid the raycast + collision read). */
  private cloneLiveMap(): void {
    const level = this.game.level();

    this.liveCells = [...level.map.cells];
    this.liveMap = { ...level.map, cells: this.liveCells };
    this.liveLevel = { ...level, map: this.liveMap };
    this.doorAnim = null; // never carry a half-open door across a reseed / respawn
    this.exitFade = null; // the exit transition re-arms its own `in` phase after the reseed it triggers
  }

  /** The exit switch was used: load the next level, reseed, swap the theme art. Keycards reset per floor. */
  private advanceLevel(): void {
    this.game.advanceLevel();
    this.hud.clearCards();
    this.prevHeldKeys = 0;
    this.state = this.seedState();
    this.prevDir = this.state.pose.dir;
    this.resetCombatBaseline();
    this.renderer.applyLevel(this.game.level());
  }
}
