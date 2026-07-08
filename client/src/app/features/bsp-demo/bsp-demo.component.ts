import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { type Camera, type Sprite } from '../../core/lib/bsp-engine';
import { parseLevelParams, type LevelParams } from '../../core/lib';
import { AssetLoader, type AssetLoaderHooks } from './boot/asset-loader';
import type { WarmZone } from './world/zone-world';
import { ZoneRuntime, EYE_HEIGHT, type ZoneRuntimeHooks } from './world/zone-runtime';
import { CombatRuntime, type CombatRuntimeHooks } from './world/combat-runtime';
import { PickupRuntime, type PickupRuntimeHooks } from './world/pickup-runtime';
import { PlayerMotion, type PlayerMotionHooks } from './world/player-motion';
import type { FxPools } from './world/fx-pools';
import { RenderHost, type DisplaySnapshot, type RenderRequest } from './render/render-host';
import type { ViewState } from './render/view-state';
import { DoomHud } from '../../shared/game/doom-hud';
import { impactEffect } from '../../shared/game/effects';
import { IconComponent } from '../../shared/icon/icon.component';
import { WorldFxPainter } from './painters/world-fx-painter';
import { HudPainter } from './painters/hud-painter';
import { WeaponPainter } from './painters/weapon-painter';
import { buildLiveSprites, buildWarmSprites } from './sprites/sprite-builder';
import {
  drawChargeFx,
  drawCrosshair,
  drawGameOver,
  drawHint,
  drawHurtFx,
  drawPickupFx,
  drawWinScreen,
  drawZoneFade,
} from './painters/overlay-painter';
import {
  ARC_DURATION,
  RESTART_DELAY,
  stepEnemies,
  stepEnemyShots,
  stepProjectiles,
  ZONE_FADE,
} from '../../core/lib';
import { InputController, type InputControllerHooks } from './input/input-controller';

const HUD_NATIVE_WIDTH = 2117; // x1.0 status-bar art width (biggest tier) — only the aspect source now
const HUD_NATIVE_HEIGHT = 404; // …its height, so the backing store keeps the bar's 5.24:1 aspect
const HUD_MAX_WIDTH = 1024; // cap the HUD backing store here → a cheap repaint even fullscreen (still crisp)

/**
 * The BSP software-engine game: it blits the {@link RenderHost}'s framebuffer onto a canvas each animation
 * frame and drives the camera with collisions + step-up. The fist moves/turns; clicking the canvas grabs
 * the pointer for mouse-look. Browser only (the loop starts in `afterNextRender`, so SSG/prerender stays
 * inert). Mounted by the player while the game is running — it then fills the player box and exposes the
 * exit / fullscreen mount interface — and standalone at `/bsp`.
 */
@Component({
  selector: 'sd-bsp-demo',
  styleUrl: './bsp-demo.component.scss',
  templateUrl: './bsp-demo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class BspDemoComponent {
  /** Asked to leave the game — the player owns the full exit (mode + any fullscreen it entered). */
  public readonly exited = output<void>();
  /** Current fullscreen state + whether native fullscreen is available (both driven by the player, which
   *  owns the Fullscreen API). When available, the in-game button toggles it via `fullscreenToggle`. */
  public readonly fullscreen = input(false);
  public readonly fullscreenAvailable = input(false);
  public readonly fullscreenToggle = output<void>();

  protected readonly i18n = inject(I18nService);
  protected readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly hudCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('hud');
  protected readonly fps = signal(0);
  protected readonly frameMs = signal(0); // avg CPU cost per frame — the real headroom signal (rAF caps fps to vsync)
  protected readonly frameMaxMs = signal(0); // WORST frame in the window — the spike/stutter signal
  protected readonly texturesLoaded = signal(false); // real WebP environment art swapped in for procedural
  protected readonly threads = signal(1); // ACTIVE render workers (governor-driven; 1 = single-threaded fallback)
  protected readonly poolSize = signal(1); // spawned render workers (the pool never respawns — idle ones wait warm)
  protected readonly backend = signal<'cpu' | 'gpu'>('cpu'); // active render backend (GPU is the default when WebGPU inits OK; `?renderer=cpu` forces CPU)

  // --- Dev URL params (`?level=&spawn=&noenemies=1` — see level-select.ts): they shape the INITIAL load
  // (`noenemies` strips every zone) and are handed to the zone runtime, which resolves every zone through them.
  private readonly params: LevelParams = parseLevelParams(
    typeof location === 'undefined' ? '' : location.search,
  );
  // --- The WORLD-OWNERSHIP boundary. The open building loads one floor at a time; {@link ZoneRuntime} owns
  // the reified active world (sectors / compiled BSP / entities / doors / pickups / seams / exits) and the
  // one warm neighbour behind a passable seam, swapping them on a crossing. The component reads
  // `zoneRuntime.world.*` by reference for render/combat/physics and drives the lifecycle from `advance`. It
  // is assigned in the constructor (before any accessor) so it can close over the pool/transient seams below.
  private readonly zoneRuntime: ZoneRuntime;
  // The RENDER-CONFLUENCE boundary. {@link RenderHost} is the SOLE owner of the worker pool + WebGPU backend +
  // the mutated-in-place render config + the texture library + the framebuffer + the whole telemetry stack. The
  // coordinator keeps the rAF loop / template signals / on-canvas blit and drives the host through it (geometry
  // re-points, resolution switches, the per-frame render + measure). Constructed FIRST so the combat runtime can
  // close over `renderHost.config` (the aim-slope projection reads it) and the zone hooks over its pool seam.
  private readonly renderHost = new RenderHost();
  // The SHARED player camera — the zone runtime places + translates it on loads/swaps (by reference); this
  // component reads + turns it. `z` starts at eye height until the first load seats it on the spawn floor.
  private readonly camera = { x: 0, y: 0, angle: 0, z: EYE_HEIGHT, pitch: 0 } satisfies Camera;
  // The render/aim VIEW value object — the shared camera + the render host's mutated-in-place config, bundled as
  // the SAME two refs the painters + sprite build + combat runtime read (never copied). Built after both above.
  private readonly view: ViewState = { camera: this.camera, config: this.renderHost.config };
  // The transient in-world FX pools, consolidated into ONE stable holder: a zone reset / seam crossing clears or
  // shifts them by mutating `fx.projectiles = []` etc., so every collaborator that captured `fx` stays live.
  private readonly fx: FxPools = { projectiles: [], impacts: [], arcs: [] };
  private lastTime = 0;
  private frameId = 0;
  // The blit target — the canvas 2D context the framebuffer is `putImageData`'d onto. Grabbed in
  // `afterNextRender` (null until then / on SSR); `frame` reads it every tick once the loop is armed.
  private renderContext: CanvasRenderingContext2D | null = null;
  // A render (kick → join → blit) is in flight — the rAF loop keeps advancing + re-arming but skips a fresh
  // kick until the outstanding one blits + releases, so the single shared framebuffer never overlaps.
  private renderBusy = false;
  private lastBlit = 0; // previous blit's timestamp → the dt stepping the weapon/HUD animations (the blit clock)
  private readonly hud = new DoomHud();
  // The PLAYER-COMBAT boundary. {@link CombatRuntime} owns the player's combat + inventory state (health,
  // armour, the death/win latch, the magazine + reserve pools, the weapon progression + viewmodel, the fire /
  // reload edges, and the screen-feedback timers) and every method that mutates it; it operates on the zone
  // world + the transient FX (below) by reference. Assigned in the constructor so it can close over them.
  private readonly combatRuntime: CombatRuntime;
  // The PICKUP-OBJECTIVE boundary. {@link PickupRuntime} owns the pickup / objective / door STEPPING — it reads
  // the zone world's floor items + doors + slides by reference, grants collected items through the combat
  // runtime's grant API + lights HUD badge cards, and drives the zone-exit transition. It owns the collected
  // badge set + the two collect-feedback timers (the green flash + the "badge requis" hint). Assigned in the
  // constructor so it can close over the combat + zone runtimes.
  private readonly pickupRuntime: PickupRuntime;
  // The in-world transient FX painter (projectiles / impacts / arcs) — owns its lazily-decoded sprite caches.
  private readonly worldFxPainter = new WorldFxPainter();
  // The DOOM status-bar sync painter — owns the turn-rate EMA that aims the HUD face's gaze through a turn.
  private readonly hudPainter = new HudPainter();
  // The weapon VIEWMODEL painter — the screen-space overlay half of the old drawWeapon (the fire STEP lives in
  // the combat runtime). Stateless; drew each blit just after the runtime's weapon step (step-before-draw).
  private readonly weaponPainter = new WeaponPainter();
  // The INPUT boundary. {@link InputController} owns the held-keys set + every DOM input handler (keyboard
  // movement + debug routing, mouse look, the fire / reload / weapon-cycle buttons, the wheel, the resize) and
  // derives the movement axes `advance` integrates. It mutates the shared camera on look + the combat runtime's
  // edges by reference; its handlers are stable bound refs so the component adds AND removes the SAME
  // references (an identity mismatch would leak the listeners). Assigned in the constructor over the runtimes.
  private readonly inputController: InputController;
  // The PLAYER-MOTION boundary. {@link PlayerMotion} owns the last physics chunk — the player's own body: it
  // integrates the collided/step-up move + walk-bob + eye ease each tick and OWNS the auto-mantle state + the
  // weapon walk-bob phase. It moves the shared camera by reference, reads the movement axes off the input
  // controller, and gates on the seamless-crossing check. Assigned in the constructor over both (the coordinator
  // reads its `mantle`/`bob` for the weapon overlay + gates input on `isMantling`).
  private readonly playerMotion: PlayerMotion;
  // The BOOTSTRAP asset-load boundary. {@link AssetLoader} owns the two decode pipelines (environment WebP +
  // enemy/pickup atlases) and, on each completion, feeds the decoded art back through the runtimes — but only
  // while the game is live: its callbacks are gated on `renderHost.disposed`, so a decode landing after teardown
  // is dropped (a stray `markAtlasesReady` would corrupt the next mount). Assigned over the runtimes below.
  private readonly assetLoader: AssetLoader;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Wire the collaborator boundaries in dependency order — each `new` takes its hook object from a build
    // helper (same instances, same closures, same order). RenderHost is a field initializer (already set), so
    // ZoneRuntime → CombatRuntime → PickupRuntime → InputController → PlayerMotion → AssetLoader construct in
    // sequence, each closing over the ones before it.
    this.zoneRuntime = new ZoneRuntime(this.buildZoneHooks());
    this.combatRuntime = new CombatRuntime(this.buildCombatHooks());
    this.pickupRuntime = new PickupRuntime(this.buildPickupHooks());
    this.inputController = new InputController(this.buildInputHooks());
    this.playerMotion = new PlayerMotion(this.buildMotionHooks());
    this.assetLoader = new AssetLoader(this.buildAssetHooks());
    // The initial zone load — the SAME code path as every open-building transition (URL level or default).
    // Pure map/data work, so it is prerender-safe; enemies/pickups spawn once the atlases decode below.
    this.zoneRuntime.loadZone(this.params.levelKey);

    afterNextRender(() => {
      const canvasEl = this.canvas().nativeElement;
      const context = canvasEl.getContext('2d');

      if (context === null) {
        return;
      }

      this.bootstrapRenderHost(context, canvasEl);
      this.combatRuntime.climbView.preload(); // decode the mantle hands now, so the first vault never shows a blank frame
      this.bindInputListeners(canvasEl);
      const hudResize = this.observeHudResize();

      this.renderContext = context; // hand `frame` the blit target now the loop is about to arm
      this.armFrameLoop();
      // Kick both decode pipelines (environment WebP + enemy/pickup atlases) — the loader feeds the decoded art
      // back through the runtimes on completion, gated on `renderHost.disposed` so a late decode is dropped.
      void this.assetLoader.load();

      destroyRef.onDestroy(() => this.teardownGame(canvasEl, hudResize));
    });
  }

  /** Build the world-ownership hooks. The pool lives on {@link RenderHost} (the sole owner), so a geometry
   *  change routes to the host, which QUEUES it and re-points the SAME workers in its next between-frames
   *  window (never mid-render). The camera is shared by reference; the component's transient FX
   *  (projectiles/impacts/arcs/mantle) are its own, so the runtime signals a reset/translate rather than
   *  reaching into them. */
  private buildZoneHooks(): ZoneRuntimeHooks {
    return {
      camera: this.camera,
      params: this.params,
      onGeometryLoaded: (key, source, neighbors) => this.renderHost.setMaps(key, source, neighbors),
      onSeamSwap: (key, neighbors) => this.renderHost.swapTo(key, neighbors),
      onZoneReset: () => {
        // Clear the transient FX THROUGH the stable holder, so the combat runtime's captured `fx` ref stays live.
        this.fx.projectiles = [];
        this.fx.impacts = [];
        this.fx.arcs = [];
        this.playerMotion.reset();
      },
      onSeamTranslate: (dx, dy) => {
        // In-flight visuals follow the seam translation (they age out in a blink); the player's own launched
        // shots are dropped — like enemies, projectiles never cross zones. Mutated through the holder.
        this.fx.projectiles = [];
        this.fx.impacts = this.fx.impacts.map((impact) => ({
          ...impact,
          x: impact.x - dx,
          y: impact.y - dy,
        }));
        this.fx.arcs = this.fx.arcs.map((arc) => ({
          ...arc,
          ax: arc.ax - dx,
          ay: arc.ay - dy,
          bx: arc.bx - dx,
          by: arc.by - dy,
        }));
      },
    };
  }

  /** Build the player-combat hooks over the render/aim {@link ViewState} + the {@link FxPools} holder + the zone
   *  world (all by reference — the `fx` holder is stable, so a zone reset / seam crossing clearing it through the
   *  holder stays visible). The runtime reads the camera's firing pose + the render config off `view`; it makes
   *  the shared HUD face react on a landed hit. */
  private buildCombatHooks(): CombatRuntimeHooks {
    return {
      view: this.view,
      fx: this.fx,
      hud: this.hud,
      world: () => this.zoneRuntime.world,
    };
  }

  /** Build the pickup-objective hooks over the zone world + the combat grant API + the HUD. It reads the shared
   *  camera for proximity, mutates the zone world's pickup / door / slide arrays by reference, and owns the
   *  collected badge set + the two collect-feedback timers the overlay painter reads. */
  private buildPickupHooks(): PickupRuntimeHooks {
    return {
      camera: this.camera,
      hud: this.hud,
      combat: this.combatRuntime,
      zone: this.zoneRuntime,
    };
  }

  /** Build the input hooks over the shared camera + the combat edges (by reference) + the canvas the pointer
   *  locks to; the mantle-freeze predicate + the three component callbacks (restart, fullscreen, resolution)
   *  are lazy hooks so it never reaches into private state directly. */
  private buildInputHooks(): InputControllerHooks {
    return {
      camera: this.camera,
      combat: this.combatRuntime,
      canvas: () => this.canvas().nativeElement,
      isMantling: () => this.playerMotion.isMantling(),
      restart: () => this.resetGame(),
      toggleFullscreen: () => this.toggleFullscreen(),
      queueResolution: (width, height) => this.renderHost.queueResolution(width, height),
    };
  }

  /** Build the player-motion hooks over the shared camera + the active zone world + the input controller's
   *  movement axes (all by reference/thunk). `crossSeam` folds the component's exact gate — probe only when the
   *  active map HAS passable seams — into the callback, so a seam-less zone never runs the crossing test and the
   *  seamless mid-tick early-return stays byte-identical. */
  private buildMotionHooks(): PlayerMotionHooks {
    return {
      camera: this.camera,
      world: () => this.zoneRuntime.world,
      movementAxes: () => this.inputController.movementAxes(),
      movementWant: (angle, forward, strafe, reach) =>
        this.inputController.movementWant(angle, forward, strafe, reach),
      crossSeam: (fromX, fromY, toX, toY) =>
        this.zoneRuntime.seams.length > 0 && this.zoneRuntime.crossSeam(fromX, fromY, toX, toY),
    };
  }

  /** Build the bootstrap asset-load hooks over the render host + the runtimes it feeds on decode completion.
   *  `isDisposed` reads the host's teardown latch so a late atlas decode never spawns into a destroyed game. */
  private buildAssetHooks(): AssetLoaderHooks {
    return {
      applyTextures: (loaded) => this.renderHost.applyTextures(loaded),
      onEnvTexturesLoaded: (hasArt) => this.texturesLoaded.set(hasArt),
      markAtlasesReady: () => this.zoneRuntime.markAtlasesReady(),
      seedReserves: () => this.combatRuntime.seedReserves(),
      isDisposed: () => this.renderHost.disposed,
    };
  }

  /** Hand the render confluence its browser resources: the framebuffer/canvas backing store, the worker pool
   *  (seeded with the initial zone's geometry), the governor, the dev perf ring, the async WebGPU backend. From
   *  here the host is the SOLE owner of the pool/GPU/config/textures/framebuffer/telemetry. */
  private bootstrapRenderHost(
    context: CanvasRenderingContext2D,
    canvasEl: HTMLCanvasElement,
  ): void {
    this.renderHost.bootstrap({
      context,
      canvas: canvasEl,
      zoneKey: this.zoneRuntime.currentKey,
      mapSource: this.zoneRuntime.world.mapSource,
      neighborSources: this.zoneRuntime.neighborSources,
      perfRing: this.params.perfRing,
      noGovernor: this.params.noGovernor,
      forceCpu: this.params.renderer === 'cpu',
      camera: this.camera,
      perfState: () => ({
        camera: this.camera,
        spriteCount: this.zoneRuntime.world.targets.reduce((n, t) => n + (t.alive ? 1 : 0), 0),
        projectileCount: this.fx.projectiles.length,
        stressEnemyCount: this.combatRuntime.stressEnemyCount,
        aiMs: this.combatRuntime.aiMs,
      }),
    });
  }

  /** Wire the DOM events to the input controller's handlers, then size the HUD bar. Each handler is a STABLE
   *  bound reference stored on the controller, so `teardownGame` removes the EXACT same function — the
   *  add/remove pair must match by identity or the listeners leak (the CLAUDE.md leak/SSR gotcha). */
  private bindInputListeners(canvasEl: HTMLCanvasElement): void {
    const input = this.inputController;

    window.addEventListener('keydown', input.onDown);
    window.addEventListener('keyup', input.onUp);
    canvasEl.addEventListener('click', input.onClick);
    window.addEventListener('mousemove', input.onMouse);
    window.addEventListener('mousedown', input.onMousedown);
    window.addEventListener('mouseup', input.onMouseup);
    canvasEl.addEventListener('contextmenu', input.onContextMenu);
    window.addEventListener('wheel', input.onWheel, { passive: false });
    window.addEventListener('resize', input.onResize);
    document.addEventListener('fullscreenchange', input.onResize);
    this.resizeHud(); // size the HUD bar's backing store now the canvas is laid out
  }

  /** Observe the HUD canvas so its backing store is sized the instant it IS laid out — on first paint the
   *  canvas may not be measurable yet (0-size behind the loading screen), so the one-shot `resizeHud` in
   *  `bindInputListeners` can no-op; the observer re-sizes on layout + every fullscreen/window resize. */
  private observeHudResize(): ResizeObserver {
    const hudResize = new ResizeObserver(() => this.resizeHud());

    hudResize.observe(this.hudCanvas().nativeElement);

    return hudResize;
  }

  /** Arm the rAF chain. It is NEVER gated on the workers' frame join (the root of contention stutter: one
   *  descheduled worker used to freeze display AND input for its whole scheduling quantum). The world advances
   *  and the chain re-arms every display frame; a render is KICKED only when the pool is idle, and its
   *  completion blits + releases. A join straggler therefore costs one REPEATED frame on screen — never a
   *  frozen pipeline. The per-frame WORK lives in `frame`; the loop does the frame then unconditionally re-arms
   *  (teardown's `cancelAnimationFrame` stops it). */
  private armFrameLoop(): void {
    const loop = (now: number): void => {
      this.frame(now);
      this.frameId = requestAnimationFrame(loop);
    };

    this.frameId = requestAnimationFrame(loop);
  }

  /** Tear the game down on destroy: dispose the render confluence (pool workers + GPU device), stop the rAF
   *  chain, then remove the EXACT input handler references `bindInputListeners` added and disconnect the HUD
   *  observer. */
  private teardownGame(canvasEl: HTMLCanvasElement, hudResize: ResizeObserver): void {
    const input = this.inputController;

    this.renderHost.dispose(); // tears down the pool workers + GPU device
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('keydown', input.onDown);
    window.removeEventListener('keyup', input.onUp);
    canvasEl.removeEventListener('click', input.onClick);
    window.removeEventListener('mousemove', input.onMouse);
    window.removeEventListener('mousedown', input.onMousedown);
    window.removeEventListener('mouseup', input.onMouseup);
    canvasEl.removeEventListener('contextmenu', input.onContextMenu);
    window.removeEventListener('wheel', input.onWheel);
    window.removeEventListener('resize', input.onResize);
    document.removeEventListener('fullscreenchange', input.onResize);
    hudResize.disconnect();
  }

  /** One rAF frame's WORK (the scheduling stays in the loop closure): step the world on the tick `dt`, push the
   *  display roll-up, then — unless a render is already in flight or the host tore down — flush the queued
   *  between-frames actuations and KICK a render, whose completion blits the framebuffer, paints the overlay
   *  stack, and rolls up the join. The sequence is pixel-load-bearing: advance → measure → render → blit →
   *  paint → measure, with the blit clock (`lastBlit`) driving the weapon/HUD animation `drawDt`. */
  private frame(now: number): void {
    const context = this.renderContext;

    if (context === null) {
      return; // the loop only arms once the context is grabbed, so this is a belt-and-braces SSR guard
    }
    const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (now - this.lastTime) / 1000);

    this.lastTime = now;
    this.advance(dt);
    this.applyDisplaySnapshot(this.renderHost.measureDisplay(now));

    if (this.renderHost.disposed || this.renderBusy) {
      return;
    }
    this.renderBusy = true;
    this.renderHost.flushPending(); // apply queued geometry re-points + resolution — no render in flight
    const renderStart = performance.now();

    void this.renderHost.renderInto(this.buildRenderRequest()).then(() => {
      if (this.renderHost.disposed) {
        return;
      }
      context.putImageData(this.renderHost.frame, 0, 0);
      const blitNow = performance.now();
      const drawDt = this.lastBlit === 0 ? dt : Math.min(0.05, (blitNow - this.lastBlit) / 1000);

      this.lastBlit = blitNow;
      this.paintOverlays(context, drawDt);
      this.renderHost.afterRender(renderStart); // join roll-up + governor re-band (no render in flight)
      this.threads.set(this.renderHost.activeThreads); // a re-band may have moved the active worker count
      this.renderBusy = false; // release AFTER the actuations — the next kick sees a settled pool
    });
  }

  /** Push one display roll-up into the HUD template signals: the backend readouts (active workers / pool size /
   *  render backend) flow EVERY frame — a governor re-band or a GPU init/failure changes them — while the
   *  distilled fps / frame-time land only when a ~250 ms window closed. */
  private applyDisplaySnapshot(snapshot: DisplaySnapshot): void {
    this.threads.set(snapshot.threads);
    this.poolSize.set(snapshot.poolSize);
    this.backend.set(snapshot.backend);
    if (snapshot.roll !== null) {
      this.fps.set(snapshot.roll.fps);
      if (snapshot.roll.meanMs !== null) {
        this.frameMs.set(snapshot.roll.meanMs);
      }
      this.frameMaxMs.set(snapshot.roll.maxMs);
    }
  }

  /** Assemble the render inputs for one frame: the shared camera + the active world's geometry/sprites, plus
   *  the WARM neighbour's live billboards (in ITS coordinates) through the seam windows and the thunk that
   *  reifies the zone-portal neighbours only on the paths (GPU / main-thread) that read them. */
  private buildRenderRequest(): RenderRequest {
    const world = this.zoneRuntime.world;
    const warm = this.zoneRuntime.warm;
    const neighborSprites =
      warm === null ? undefined : new Map([[warm.key, this.warmSprites(warm)]]);

    return {
      camera: this.camera,
      map: world.map,
      sectors: world.sectors,
      slides: world.slides,
      sprites: this.liveSprites(), // alive billboards this frame (a culled barrel drops out)
      neighborSprites,
      zoneNeighbors: (sprites) => this.zoneRuntime.zoneNeighbors(sprites),
    };
  }

  /** Paint the screen-space overlay stack over the just-blitted framebuffer, in draw order: the in-world FX
   *  (projectiles/impacts/arcs), the weapon step-then-draw, the feedback washes + crosshair + hint + zone
   *  fade, the DOOM status bar, and the game-over / win screens. Runs on the blit's `drawDt`. */
  private paintOverlays(context: CanvasRenderingContext2D, drawDt: number): void {
    this.paintWorldFx(context);
    this.paintWeapon(context, drawDt);
    this.paintFeedbackAndHud(context, drawDt);
  }

  /** The in-world transient FX, blitted first (behind the weapon + HUD): projectiles, impacts, plasma arcs. */
  private paintWorldFx(context: CanvasRenderingContext2D): void {
    this.worldFxPainter.drawProjectiles({
      ctx: context,
      view: this.view,
      projectiles: this.fx.projectiles,
      weaponView: this.combatRuntime.weaponView,
      bob: this.playerMotion.bob,
    });
    this.worldFxPainter.drawImpacts({ ctx: context, view: this.view, impacts: this.fx.impacts });
    this.worldFxPainter.drawArcs({ ctx: context, view: this.view, arcs: this.fx.arcs });
  }

  /** The weapon COMBAT STEP runs on the blit's `drawDt` (NOT the advance dt), then the viewmodel is PAINTED —
   *  step-before-draw, exactly as the monolithic drawWeapon did, so the step's shotFx feeds this frame's
   *  crosshair. */
  private paintWeapon(context: CanvasRenderingContext2D, drawDt: number): void {
    this.combatRuntime.stepWeapon(drawDt, this.playerMotion.isMantling());
    this.weaponPainter.draw({
      ctx: context,
      weaponView: this.combatRuntime.weaponView,
      climbView: this.combatRuntime.climbView,
      mantle: this.playerMotion.mantle,
      camera: this.camera,
      fov: this.renderHost.config.fov,
      bob: this.playerMotion.bob,
    });
  }

  /** The feedback washes + crosshair + hint + zone fade, the DOOM status bar, then the game-over / win screens. */
  private paintFeedbackAndHud(context: CanvasRenderingContext2D, drawDt: number): void {
    drawHurtFx(context, this.combatRuntime.hurtFx);
    drawPickupFx(context, this.pickupRuntime.pickupFx);
    drawChargeFx(context, this.combatRuntime.chargeGlow, this.combatRuntime.dischargeFlash);
    drawCrosshair(context, this.combatRuntime.shotFx);
    drawHint(context, this.pickupRuntime.hint);
    drawZoneFade(context, this.zoneRuntime.transition, ZONE_FADE);
    this.hudPainter.draw({
      hud: this.hud,
      canvas: this.hudCanvas().nativeElement,
      dt: drawDt,
      weaponIndex: this.combatRuntime.weaponIndex,
      reserve: this.combatRuntime.reserve,
      hp: this.combatRuntime.hp,
      armor: this.combatRuntime.armor,
      mag: this.combatRuntime.mag,
      ownedWeapons: this.combatRuntime.ownedWeapons,
      weaponView: this.combatRuntime.weaponView,
      cameraAngle: this.camera.angle,
    });
    drawGameOver(
      context,
      this.combatRuntime.dead,
      this.combatRuntime.deadClock,
      this.combatRuntime.deadClock >= RESTART_DELAY,
    );
    drawWinScreen(
      context,
      this.combatRuntime.won,
      this.combatRuntime.wonClock,
      this.combatRuntime.wonClock >= RESTART_DELAY,
    );
  }

  /** Integrate the body from the held keys + collisions: forward/back + strafe (turning is mouse-only). Runs the
   *  ordered tick — decay FX, the end-state guards, the world step, the objective/doors step, the FX aging, the
   *  mantle guard, then the player motion — each early-return (dead / won / transition / mantle / crossSeam)
   *  landing exactly where it did in the monolithic tick. Step order is pixel- and behaviour-load-bearing. */
  private advance(dt: number): void {
    this.combatRuntime.decayFx(dt); // fade the muzzle flash / red hurt flash / BFG discharge flash
    this.pickupRuntime.decayFx(dt); // fade the green pickup flash (runs always, before the end-state returns)
    if (this.combatRuntime.dead) {
      this.combatRuntime.tickDeadClock(dt); // world frozen under the game-over wash; a click restarts after RESTART_DELAY

      return;
    }
    if (this.combatRuntime.won) {
      this.combatRuntime.tickWonClock(dt); // world frozen under the level-complete wash; a click restarts after RESTART_DELAY

      return;
    }
    if (this.zoneRuntime.transition !== null) {
      this.zoneRuntime.stepTransition(dt); // the fade owns the world: everything freezes while the building swaps floors

      return;
    }
    this.stepWorld(dt);
    this.stepObjectiveAndDoors(dt);
    this.ageArcsAndImpacts(dt);

    // Mid auto-mantle: the hoist owns the body (no move/look) until it completes — see `PlayerMotion.stepMantle`.
    if (this.playerMotion.isMantling()) {
      this.playerMotion.stepMantle(dt);

      return;
    }
    this.playerMotion.stepPlayerMotion(dt);
  }

  /** The world step: the stress load-test shots (before projectiles so their shots step this frame), the real
   *  enemies, the throwers' shots, the warm neighbour's own AI behind the seam, then the player's projectiles. */
  private stepWorld(dt: number): void {
    this.combatRuntime.stepStress(dt); // DEBUG load test (no-op unless toggled) — runs before projectiles so its shots step now
    stepEnemies(this.combatRuntime.activeFrame(), dt); // real enemies chase / shoot / throw
    stepEnemyShots(this.combatRuntime.activeFrame(), dt); // throwers' projectiles fly at the player
    this.zoneRuntime.stepWarm(dt); // the warm neighbor lives too: its foes think in THEIR map behind the seam
    stepProjectiles(this.combatRuntime.playerCombatFrame(), dt);
  }

  /** The pickup + objective + door step, in the load-bearing order: collect pickups, drive the objective / zone
   *  exits, animate doors (after pickups, so this frame's badge state gates them), then the sliding glass. */
  private stepObjectiveAndDoors(dt: number): void {
    this.pickupRuntime.stepPickups(dt); // spin the ammo boxes + collect anything the player is standing on
    this.pickupRuntime.stepObjective(dt); // collect badges, drive zone exits, win the legacy exit
    this.pickupRuntime.stepDoors(dt); // animate doors (after pickups, so this frame's badge state gates the door)
    this.pickupRuntime.stepSliding(dt); // sliding glass doors: proximity-driven + auto-closing
  }

  /** Age the transient in-world FX out: advance every plasma arc + impact by `dt` and drop the ones whose
   *  lifetime elapsed (arcs past {@link ARC_DURATION}, impacts past their effect's full frame span). */
  private ageArcsAndImpacts(dt: number): void {
    for (const arc of this.fx.arcs) {
      arc.age += dt;
    }
    this.fx.arcs = this.fx.arcs.filter((arc) => arc.age < ARC_DURATION);

    for (const impact of this.fx.impacts) {
      impact.age += dt;
    }
    this.fx.impacts = this.fx.impacts.filter((impact) => {
      const effect = impactEffect(impact.kind);

      return effect !== undefined && impact.age < effect.frames * effect.frameDuration_s;
    });
  }

  /** Size the HUD bar's backing store to its displayed pixel size (DPR-aware, capped at the native width),
   *  so {@link DoomHud} picks the matching art tier; the height keeps the bar's 5.24:1 aspect. */
  private resizeHud(): void {
    const hud = this.hudCanvas().nativeElement;
    const rect = hud.getBoundingClientRect();

    if (rect.width < 1) {
      return; // not laid out yet — a resize / the next call sizes it
    }
    const width = Math.min(HUD_MAX_WIDTH, Math.round(rect.width)); // 1:1 with display, capped — cheap repaint

    hud.width = width;
    hud.height = Math.round((width * HUD_NATIVE_HEIGHT) / HUD_NATIVE_WIDTH);
  }

  /** Toggle fullscreen on the viewport. The render resolution stays 1920×1080 (the canvas just displays
   *  bigger), so it's a free way to test the engine + HUD at screen scale. */
  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.canvas().nativeElement.parentElement?.requestFullscreen();
    }
  }

  /** The world billboards still alive this frame — the render's per-frame sprite list (culled barrels drop
   *  out). Projectiles are NOT here: they are painted screen-space over the frame by `drawProjectiles`.
   *  Sources the active zone's live state for the pure {@link buildLiveSprites}. */
  private liveSprites(): Sprite[] {
    // The active world (a WarmZone) satisfies the sprite source directly — no per-frame re-bundling.
    return buildLiveSprites({
      world: this.zoneRuntime.world,
      viewX: this.camera.x,
      viewY: this.camera.y,
      atlasesReady: this.zoneRuntime.atlasesReady,
      zoneExits: this.zoneRuntime.exits,
      stress: this.combatRuntime.stressEnemies,
    });
  }

  /** The WARM neighbor's billboards for the render's neighbor-sprites channel, in ITS own coordinates —
   *  directional props oriented for the camera translated through the seam (the same ghost point the warm
   *  AI tracks), so a totem seen through the window turns exactly like a local one. */
  private warmSprites(warm: WarmZone): Sprite[] {
    return buildWarmSprites({
      warm,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      seams: this.zoneRuntime.seams,
    });
  }

  /** Restart the run — a NEW GAME: the combat runtime restores vitals + the starting loadout + the seeded
   *  reserves, the pickup runtime drops every badge + clears the HUD bay + the collect-feedback timers, then the
   *  current zone reloads `fresh` (the whole building's zone state resets, every enemy + pickup + door respawns). */
  private resetGame(): void {
    this.combatRuntime.resetPlayer();
    this.zoneRuntime.cancelTransition();
    this.pickupRuntime.reset();
    this.zoneRuntime.loadZone(this.zoneRuntime.currentKey, undefined, true); // fresh: resets the building + respawns everything
  }
}
