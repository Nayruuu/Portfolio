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
import {
  parseLevelParams,
  RENDER_SETTLE_TIMEOUT_MS,
  settleWithin,
  type LevelParams,
} from '../../core/lib';
import { AssetLoader, type AssetLoaderHooks } from './boot/asset-loader';
import type { WarmZone } from './world/zone-world';
import { ZoneRuntime, EYE_HEIGHT, type ZoneRuntimeHooks } from './world/zone-runtime';
import { CombatRuntime, type CombatRuntimeHooks } from './world/combat-runtime';
import { PickupRuntime, type PickupRuntimeHooks } from './world/pickup-runtime';
import { PlayerMotion, type PlayerMotionHooks } from './world/player-motion';
import type { FxPools } from './world/fx-pools';
import { RenderHost, type DisplaySnapshot, type RenderRequest } from './render/render-host';
import type { ViewState } from './render/view-state';
import { DoomHud } from '../../core/lib/game/presentation/doom-hud';
import { impactEffect } from '../../core/lib/game/presentation/effects';
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

// native status-bar art dims → the backing store keeps the bar's 5.24:1 aspect
const HUD_NATIVE_WIDTH = 2117;
const HUD_NATIVE_HEIGHT = 404;
const HUD_MAX_WIDTH = 1024;

// Browser only — the loop starts in afterNextRender, so SSG/prerender stays inert.
@Component({
  selector: 'sd-bsp-demo',
  styleUrl: './bsp-demo.component.scss',
  templateUrl: './bsp-demo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class BspDemoComponent {
  public readonly exited = output<void>();
  public readonly fullscreen = input(false);
  public readonly fullscreenAvailable = input(false);
  public readonly fullscreenToggle = output<void>();

  protected readonly i18n = inject(I18nService);
  protected readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly hudCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('hud');
  protected readonly fps = signal(0);
  protected readonly frameMs = signal(0);
  protected readonly frameMaxMs = signal(0);
  protected readonly texturesLoaded = signal(false);
  protected readonly threads = signal(1);
  protected readonly poolSize = signal(1);
  protected readonly backend = signal<'cpu' | 'gpu'>('cpu');

  private readonly params: LevelParams = parseLevelParams(
    typeof location === 'undefined' ? '' : location.search,
  );
  // assigned in ctor (before any accessor) so it closes over the pool/transient seams below; owns the reified active world read by reference for render/combat/physics
  private readonly zoneRuntime: ZoneRuntime;
  // field initializer → constructed FIRST so CombatRuntime can close over renderHost.config; sole owner of pool/GPU/config/textures/framebuffer/telemetry
  private readonly renderHost = new RenderHost();
  // shared player camera — placed/translated by the zone runtime by reference; read + turned here
  private readonly camera = { x: 0, y: 0, angle: 0, z: EYE_HEIGHT, pitch: 0 } satisfies Camera;
  // the SAME two refs (camera + host config) the painters/sprites/combat read — never copied
  private readonly view: ViewState = { camera: this.camera, config: this.renderHost.config };
  // stable holder — a reset/crossing mutates fx.projectiles=[] etc. so captured refs stay live
  private readonly fx: FxPools = { projectiles: [], impacts: [], arcs: [] };
  private lastTime = 0;
  private frameId = 0;
  // blit target; null until afterNextRender (SSR-safe)
  private renderContext: CanvasRenderingContext2D | null = null;
  // a render is in flight — skip a fresh kick so the single shared framebuffer never overlaps
  private renderBusy = false;
  private lastBlit = 0; // previous blit ts → the drawDt clock for weapon/HUD anims (blit clock, not advance dt)
  private readonly hud = new DoomHud();
  // assigned in ctor — owns combat/inventory state; operates on the zone world + fx by reference
  private readonly combatRuntime: CombatRuntime;
  // assigned in ctor — owns pickup/objective/door stepping; reads the zone world by reference
  private readonly pickupRuntime: PickupRuntime;
  private readonly worldFxPainter = new WorldFxPainter();
  private readonly hudPainter = new HudPainter();
  private readonly weaponPainter = new WeaponPainter();
  // assigned in ctor — handlers are stable bound refs; add AND remove the SAME references or listeners leak
  private readonly inputController: InputController;
  // assigned in ctor — owns physics/mantle/bob; moves the shared camera by reference
  private readonly playerMotion: PlayerMotion;
  // assigned in ctor — decode callbacks gated on renderHost.disposed so a late decode after teardown is dropped
  private readonly assetLoader: AssetLoader;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // construct in dependency order — each closes over the ones before it (RenderHost is already a field init)
    this.zoneRuntime = new ZoneRuntime(this.buildZoneHooks());
    this.combatRuntime = new CombatRuntime(this.buildCombatHooks());
    this.pickupRuntime = new PickupRuntime(this.buildPickupHooks());
    this.inputController = new InputController(this.buildInputHooks());
    this.playerMotion = new PlayerMotion(this.buildMotionHooks());
    this.assetLoader = new AssetLoader(this.buildAssetHooks());
    // same path as every transition; pure map work → prerender-safe (enemies/pickups spawn once atlases decode)
    this.zoneRuntime.loadZone(this.params.levelKey);

    afterNextRender(() => {
      const canvasEl = this.canvas().nativeElement;
      const context = canvasEl.getContext('2d');

      if (context === null) {
        return;
      }

      this.bootstrapRenderHost(context, canvasEl);
      this.combatRuntime.climbView.preload(); // decode the mantle hands now so the first vault isn't blank
      this.bindInputListeners(canvasEl);
      const hudResize = this.observeHudResize();

      this.renderContext = context;
      this.armFrameLoop();
      void this.assetLoader.load();

      destroyRef.onDestroy(() => this.teardownGame(canvasEl, hudResize));
    });
  }

  private buildZoneHooks(): ZoneRuntimeHooks {
    return {
      camera: this.camera,
      params: this.params,
      onGeometryLoaded: (key, source, neighbors) => this.renderHost.setMaps(key, source, neighbors),
      onSeamSwap: (key, neighbors) => this.renderHost.swapTo(key, neighbors),
      onZoneReset: () => {
        // clear through the stable holder so the combat runtime's captured fx ref stays live
        this.fx.projectiles = [];
        this.fx.impacts = [];
        this.fx.arcs = [];
        this.playerMotion.reset();
      },
      onSeamTranslate: (dx, dy) => {
        // player's launched shots dropped — projectiles never cross zones; in-flight visuals follow, mutated through the holder
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

  private buildCombatHooks(): CombatRuntimeHooks {
    return {
      view: this.view,
      fx: this.fx,
      hud: this.hud,
      world: () => this.zoneRuntime.world,
    };
  }

  private buildPickupHooks(): PickupRuntimeHooks {
    return {
      camera: this.camera,
      hud: this.hud,
      combat: this.combatRuntime,
      zone: this.zoneRuntime,
    };
  }

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

  private buildMotionHooks(): PlayerMotionHooks {
    return {
      camera: this.camera,
      world: () => this.zoneRuntime.world,
      movementAxes: () => this.inputController.movementAxes(),
      movementWant: (angle, forward, strafe, reach) =>
        this.inputController.movementWant(angle, forward, strafe, reach),
      // gate: probe only when the active map HAS passable seams, so a seam-less zone skips the crossing test
      crossSeam: (fromX, fromY, toX, toY) =>
        this.zoneRuntime.seams.length > 0 && this.zoneRuntime.crossSeam(fromX, fromY, toX, toY),
    };
  }

  private buildAssetHooks(): AssetLoaderHooks {
    return {
      applyTextures: (loaded) => this.renderHost.applyTextures(loaded),
      onEnvTexturesLoaded: (hasArt) => this.texturesLoaded.set(hasArt),
      markAtlasesReady: () => this.zoneRuntime.markAtlasesReady(),
      seedReserves: () => this.combatRuntime.seedReserves(),
      isDisposed: () => this.renderHost.disposed,
    };
  }

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

  // handlers are stable bound refs — teardown removes the EXACT same functions or listeners leak
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
    this.resizeHud();
  }

  // canvas may be 0-size behind the loading screen on first paint → the observer sizes it on layout + every resize
  private observeHudResize(): ResizeObserver {
    const hudResize = new ResizeObserver(() => this.resizeHud());

    hudResize.observe(this.hudCanvas().nativeElement);

    return hudResize;
  }

  // NEVER gated on the worker join — a straggler costs one repeated frame, never a frozen pipeline; a render is kicked only when the pool is idle
  private armFrameLoop(): void {
    const loop = (now: number): void => {
      this.frame(now);
      this.frameId = requestAnimationFrame(loop);
    };

    this.frameId = requestAnimationFrame(loop);
  }

  private teardownGame(canvasEl: HTMLCanvasElement, hudResize: ResizeObserver): void {
    const input = this.inputController;

    this.renderHost.dispose();
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

  // per-frame work: advance → measure → (unless in flight/disposed) flush queued actuations → kick render → blit → paint → measure; drawDt from the blit clock. Sequence is pixel-load-bearing.
  private frame(now: number): void {
    const context = this.renderContext;

    if (context === null) {
      return; // SSR belt-and-braces: the loop only arms once the context is grabbed
    }
    const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (now - this.lastTime) / 1000);

    this.lastTime = now;
    this.advance(dt);
    this.applyDisplaySnapshot(this.renderHost.measureDisplay(now));

    if (this.renderHost.disposed || this.renderBusy) {
      return;
    }
    this.renderBusy = true;
    this.renderHost.flushPending(); // queued geometry re-points + resolution — no render in flight
    const renderStart = performance.now();

    // Watchdog the render: iOS can kill a worker so its join never settles. On a real settle → blit + measure
    // as always; on the timeout → the render never finished, so DON'T blit — just clear the latch so the next
    // frame retries (a dead pool is dropped to the main thread by then). renderBusy ALWAYS clears: it can
    // never latch true and freeze the screen.
    const render = this.renderHost.renderInto(this.buildRenderRequest());

    void settleWithin(render, RENDER_SETTLE_TIMEOUT_MS).then(({ settled }) => {
      if (this.renderHost.disposed) {
        return;
      }
      if (settled) {
        context.putImageData(this.renderHost.frame, 0, 0);
        const blitNow = performance.now();
        const drawDt = this.lastBlit === 0 ? dt : Math.min(0.05, (blitNow - this.lastBlit) / 1000);

        this.lastBlit = blitNow;
        this.paintOverlays(context, drawDt);
        this.renderHost.afterRender(renderStart);
        this.threads.set(this.renderHost.activeThreads);
      }
      this.renderBusy = false; // ALWAYS release — never latch true, even on a timed-out render
    });
  }

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
      sprites: this.liveSprites(),
      neighborSprites,
      zoneNeighbors: (sprites) => this.zoneRuntime.zoneNeighbors(sprites),
    };
  }

  private paintOverlays(context: CanvasRenderingContext2D, drawDt: number): void {
    this.paintWorldFx(context);
    this.paintWeapon(context, drawDt);
    this.paintFeedbackAndHud(context, drawDt);
  }

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

  // step runs on drawDt (NOT the advance dt), then paint — step-before-draw so the step's shotFx feeds this frame's crosshair
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

  // ordered tick — step order + each early return (dead/won/transition/mantle/crossSeam) is pixel/behaviour-load-bearing
  private advance(dt: number): void {
    this.combatRuntime.decayFx(dt);
    this.pickupRuntime.decayFx(dt); // runs always, before the end-state returns
    if (this.combatRuntime.dead) {
      this.combatRuntime.tickDeadClock(dt);

      return;
    }
    if (this.combatRuntime.won) {
      this.combatRuntime.tickWonClock(dt);

      return;
    }
    if (this.zoneRuntime.transition !== null) {
      this.zoneRuntime.stepTransition(dt);

      return;
    }
    this.stepWorld(dt);
    this.stepObjectiveAndDoors(dt);
    this.ageArcsAndImpacts(dt);

    // mid auto-mantle: the hoist owns the body (no move/look) until it completes
    if (this.playerMotion.isMantling()) {
      this.playerMotion.stepMantle(dt);

      return;
    }
    this.playerMotion.stepPlayerMotion(dt);
  }

  private stepWorld(dt: number): void {
    this.combatRuntime.stepStress(dt); // DEBUG load test (no-op unless toggled) — before projectiles so its shots step this frame
    stepEnemies(this.combatRuntime.activeFrame(), dt);
    stepEnemyShots(this.combatRuntime.activeFrame(), dt);
    this.zoneRuntime.stepWarm(dt); // the warm neighbor's foes think in THEIR map behind the seam
    stepProjectiles(this.combatRuntime.playerCombatFrame(), dt);
  }

  private stepObjectiveAndDoors(dt: number): void {
    this.pickupRuntime.stepPickups(dt);
    this.pickupRuntime.stepObjective(dt);
    this.pickupRuntime.stepDoors(dt); // after pickups, so this frame's badge state gates the door
    this.pickupRuntime.stepSliding(dt);
  }

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

  // size to displayed px (DPR-aware, capped) so DoomHud picks the matching art tier; height keeps the 5.24:1 aspect
  private resizeHud(): void {
    const hud = this.hudCanvas().nativeElement;
    const rect = hud.getBoundingClientRect();

    if (rect.width < 1) {
      return; // not laid out yet
    }
    const width = Math.min(HUD_MAX_WIDTH, Math.round(rect.width));

    hud.width = width;
    hud.height = Math.round((width * HUD_NATIVE_HEIGHT) / HUD_NATIVE_WIDTH);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.canvas().nativeElement.parentElement?.requestFullscreen();
    }
  }

  // alive billboards this frame; projectiles are NOT here — painted screen-space by drawProjectiles
  private liveSprites(): Sprite[] {
    return buildLiveSprites({
      world: this.zoneRuntime.world,
      viewX: this.camera.x,
      viewY: this.camera.y,
      atlasesReady: this.zoneRuntime.atlasesReady,
      zoneExits: this.zoneRuntime.exits,
      stress: this.combatRuntime.stressEnemies,
    });
  }

  // the warm neighbor's billboards in ITS own coordinates — oriented for the camera translated through the seam
  private warmSprites(warm: WarmZone): Sprite[] {
    return buildWarmSprites({
      warm,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      seams: this.zoneRuntime.seams,
    });
  }

  private resetGame(): void {
    this.combatRuntime.resetPlayer();
    this.zoneRuntime.cancelTransition();
    this.pickupRuntime.reset();
    this.zoneRuntime.loadZone(this.zoneRuntime.currentKey, undefined, true); // fresh=true → resets the building + respawns everything
  }
}
