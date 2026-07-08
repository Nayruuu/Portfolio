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
import {
  clampPitch,
  climbTarget,
  HEADROOM,
  mantleStep,
  movePlayer,
  PLAYER_RADIUS,
  STEP_MAX,
  type Camera,
  type Sprite,
  type Texture,
} from '../../core/lib/bsp-engine';
import { parseLevelParams, type LevelParams } from '../../core/lib';
import { buildAtlasJobs, loadAtlasTexture, loadEnvTextures } from './render/load-textures';
import type { WarmZone } from './zone-world';
import { ZoneRuntime, EYE_HEIGHT, ZONE_FADE } from './world/zone-runtime';
import { CombatRuntime } from './world/combat-runtime';
import { PickupRuntime } from './world/pickup-runtime';
import { RenderHost, type DisplaySnapshot, type RenderRequest } from './render/render-host';
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
  movementDelta,
  stepEnemies,
  stepEnemyShots,
  stepProjectiles,
  type Arc,
  type Impact,
  type Projectile,
} from '../../core/lib';

/** Keys we react to (lower-cased), covering both QWERTY (WASD) and AZERTY (ZQSD) + arrows. */
const CONTROLS = new Set([
  'w',
  'z',
  'arrowup',
  's',
  'arrowdown',
  'a',
  'q',
  'arrowleft',
  'd',
  'arrowright',
]);

const MOVE_SPEED = 4; // world units / second
// Auto-mantle: a ledge whose rise is in (STEP_MAX, CLIMB_MAX] is too tall to step but climbable — walking
// into it hoists the player up over MANTLE_DURATION while gliding CLIMB_VAULT_ADVANCE forward over the lip.
const CLIMB_MAX = 2.4; // tallest ledge you can vault (above this it stays a solid wall)
const CLIMB_PROBE_REACH = 0.45; // cells ahead the climb probe samples — just past the radius, into the ledge cell
const MANTLE_DURATION = 0.4; // seconds the hoist takes
const CLIMB_VAULT_ADVANCE = 0.5; // cells the hoist glides the player forward, so it clears the lip and stands on top
const MOUSE_SENS = 0.0035; // radians per pixel of mouse motion (turning is mouse-only)
const PITCH_UP_MAX = 0.85; // look-up limit (the camera pitch is a vertical y-shear, not a true rotation)
const PITCH_DOWN_MAX = 2.0; // look-DOWN limit — much deeper than up (aim down at enemies below a platform); the renderer handles the off-screen horizon, so this can exceed 1.0 (walls stay vertical, as in any sheared-frustum tilt)
const RESTART_DELAY = 1.2; // seconds after death/win before a click restarts (lets the end feedback settle)
// Internal render resolution per display mode: 720p when the canvas is embedded in the ~960px viewport (a
// near-free quality match, ~2× cheaper), full 1080p when it fills the screen in fullscreen (native, no
// upscale blur). Each mode ALWAYS renders at 100% of its tier — sharpness is part of the product. Under
// contention the RENDER GOVERNOR (core/lib/game/telemetry/render-governor.ts) trades the pool's ACTIVE WORKER COUNT
// only (join stalls shrink it, proven calm grows it back); it never touches the resolution.
const WINDOWED_RENDER = { width: 1280, height: 720 } as const;
const FULLSCREEN_RENDER = { width: 1920, height: 1080 } as const;
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
  private projectiles: Projectile[] = []; // launched shots in flight (projectile weapons), stepped each frame
  private arcs: Arc[] = []; // short-lived plasma chain-lightning visuals, aged out each frame
  private impacts: Impact[] = []; // burst-strip animations playing at hit points, aged out each frame
  // Non-null = mid auto-mantle: hoisting up over a too-tall-but-climbable ledge (movement/look frozen, gliding
  // forward along the captured heading). `progress` 0→1 drives both the z-lerp and the (future) hands overlay.
  private mantle: {
    progress: number;
    startZ: number;
    targetZ: number;
    dirX: number;
    dirY: number;
  } | null = null;
  private readonly held = new Set<string>();
  private lastTime = 0;
  private frameId = 0;
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
  private bob = 0; // weapon idle-bob phase, advanced while moving

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Wire the world-ownership boundary. The pool lives on {@link RenderHost} (the sole owner), so a geometry
    // change routes to the host, which QUEUES it and re-points the SAME workers in its next between-frames
    // window (never mid-render). The camera is shared by reference; the component's transient FX
    // (projectiles/impacts/arcs/mantle) are its own, so the runtime signals a reset/translate rather than
    // reaching into them.
    this.zoneRuntime = new ZoneRuntime({
      camera: this.camera,
      params: this.params,
      onGeometryLoaded: (key, source, neighbors) => this.renderHost.setMaps(key, source, neighbors),
      onSeamSwap: (key, neighbors) => this.renderHost.swapTo(key, neighbors),
      onZoneReset: () => {
        this.projectiles = [];
        this.impacts = [];
        this.arcs = [];
        this.mantle = null;
      },
      onSeamTranslate: (dx, dy) => {
        // In-flight visuals follow the seam translation (they age out in a blink); the player's own launched
        // shots are dropped — like enemies, projectiles never cross zones.
        this.projectiles = [];
        this.impacts = this.impacts.map((impact) => ({
          ...impact,
          x: impact.x - dx,
          y: impact.y - dy,
        }));
        this.arcs = this.arcs.map((arc) => ({
          ...arc,
          ax: arc.ax - dx,
          ay: arc.ay - dy,
          bx: arc.bx - dx,
          by: arc.by - dy,
        }));
      },
    });
    // Wire the player-combat boundary over the zone world + the transient FX (all by reference — the FX pools
    // are read through accessors because a zone reset / seam crossing reassigns them). The runtime reads the
    // shared camera's firing pose + the render config; it makes the shared HUD face react on a landed hit.
    this.combatRuntime = new CombatRuntime({
      camera: this.camera,
      config: this.renderHost.config,
      hud: this.hud,
      world: () => this.zoneRuntime.world,
      projectiles: () => this.projectiles,
      impacts: () => this.impacts,
      arcs: () => this.arcs,
    });
    // Wire the pickup-objective boundary over the zone world + the combat grant API + the HUD. It reads the
    // shared camera for proximity, mutates the zone world's pickup / door / slide arrays by reference, and owns
    // the collected badge set + the two collect-feedback timers the overlay painter reads.
    this.pickupRuntime = new PickupRuntime({
      camera: this.camera,
      hud: this.hud,
      combat: this.combatRuntime,
      zone: this.zoneRuntime,
    });
    // The initial zone load — the SAME code path as every open-building transition (URL level or default).
    // Pure map/data work, so it is prerender-safe; enemies/pickups spawn once the atlases decode below.
    this.zoneRuntime.loadZone(this.params.levelKey);

    afterNextRender(() => {
      const canvasEl = this.canvas().nativeElement;
      const context = canvasEl.getContext('2d');

      if (context === null) {
        return;
      }

      // Hand the render confluence its browser resources: the framebuffer/canvas backing store, the worker
      // pool (seeded with the initial zone's geometry), the governor, the dev perf ring, the async WebGPU
      // backend. From here the host is the SOLE owner of the pool/GPU/config/textures/framebuffer/telemetry.
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
          projectileCount: this.projectiles.length,
          stressEnemyCount: this.combatRuntime.stressEnemyCount,
          aiMs: this.combatRuntime.aiMs,
        }),
      });

      this.combatRuntime.climbView.preload(); // decode the mantle hands now, so the first vault never shows a blank frame
      const onDown = (event: KeyboardEvent): void => this.onKey(event, true);
      const onUp = (event: KeyboardEvent): void => this.onKey(event, false);
      const onClick = (): void => {
        if (this.combatRuntime.dead || this.combatRuntime.won) {
          // game over OR level complete → a click (after the settle delay) restarts the level
          if (
            (this.combatRuntime.dead
              ? this.combatRuntime.deadClock
              : this.combatRuntime.wonClock) >= RESTART_DELAY
          ) {
            this.resetGame();
          }

          return;
        }
        // `requestPointerLock` rejects with a SecurityError when re-locked too soon after an Escape (a browser
        // rate-limit); it's harmless (the next click locks), so swallow it rather than leak an uncaught rejection.
        Promise.resolve(canvasEl.requestPointerLock()).catch(() => undefined);
      };
      const onMouse = (event: MouseEvent): void => {
        if (document.pointerLockElement !== canvasEl || this.mantle !== null) {
          return; // look is frozen mid-mantle so the vault always clears the lip
        }
        this.camera.angle -= event.movementX * MOUSE_SENS;
        this.camera.pitch = clampPitch(
          this.camera.pitch - event.movementY * MOUSE_SENS,
          PITCH_DOWN_MAX,
          PITCH_UP_MAX,
        );
      };

      const onResize = (): void => {
        // (The HUD backing store is sized by its ResizeObserver below; here we only queue the render resolution.)
        // Fullscreen → render at full 1080p (the canvas fills the screen); windowed → the cheaper res —
        // always 100% of the tier. The host queues it for its next between-frames window (a live rebuild
        // mid-render would tear down the pool the frame is still painting into).
        const tier = document.fullscreenElement !== null ? FULLSCREEN_RENDER : WINDOWED_RENDER;

        this.renderHost.queueResolution(tier.width, tier.height);
      };
      const onMousedown = (event: MouseEvent): void => {
        if (document.pointerLockElement !== canvasEl) {
          return;
        }
        // SECONDARY click — the right button (`button === 2`) or a macOS Ctrl+click — reloads (the desktop
        // twin of the R key); the primary button (left) fires. Mirrors the grid's mouse handling.
        if (event.button === 2 || event.ctrlKey) {
          event.preventDefault();
          this.combatRuntime.reload();

          return;
        }
        if (event.button === 0) {
          this.combatRuntime.beginFire();
        }
      };
      const onMouseup = (event: MouseEvent): void => {
        if (event.button === 0) {
          this.combatRuntime.endFire(); // only the primary (fire) button releases the held auto-fire
        }
      };
      const onContextMenu = (event: Event): void => {
        event.preventDefault(); // right-click is the in-game reload over the canvas, not a context menu
      };
      // Wheel WHILE PLAYING (pointer-locked): cycle the active weapon AND block the page scroll. `passive:false`
      // is required for `preventDefault` to take on a wheel listener; when not locked we leave the page scroll
      // untouched (no preventDefault), so the embedded demo only traps the wheel during actual play.
      const onWheel = (event: WheelEvent): void => {
        if (document.pointerLockElement !== canvasEl) {
          return;
        }
        if (event.cancelable) {
          event.preventDefault();
        }
        const dir = Math.sign(event.deltaY);

        if (dir !== 0) {
          // Cycle across OWNED weapons only — with the fists-only start the wheel stays put until pickups
          // light more of the arms row.
          this.combatRuntime.cycleWeapon(dir);
        }
      };

      window.addEventListener('keydown', onDown);
      window.addEventListener('keyup', onUp);
      canvasEl.addEventListener('click', onClick);
      window.addEventListener('mousemove', onMouse);
      window.addEventListener('mousedown', onMousedown);
      window.addEventListener('mouseup', onMouseup);
      canvasEl.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('resize', onResize);
      document.addEventListener('fullscreenchange', onResize);
      this.resizeHud(); // size the HUD bar's backing store now the canvas is laid out
      // …but on first paint the canvas may not be measurable yet (0-size behind the loading screen), so a
      // one-shot `resizeHud` can no-op and leave the HUD blank until a manual resize. A ResizeObserver sizes it
      // the instant it IS laid out, and again on every fullscreen/window resize — a robust single owner.
      const hudResize = new ResizeObserver(() => this.resizeHud());

      hudResize.observe(this.hudCanvas().nativeElement);

      // The rAF chain is NEVER gated on the workers' frame join (the root of contention stutter: one
      // descheduled worker used to freeze display AND input for its whole scheduling quantum). The world
      // advances and the chain re-arms every display frame; a render is KICKED only when the pool is idle,
      // and its completion blits + releases. A join straggler therefore costs one REPEATED frame on screen —
      // never a frozen pipeline. Render and blit never overlap (the next kick waits for the release), so the
      // single shared framebuffer stays safe, as do the host's queued between-frames actuations
      // (`flushPending` — geometry re-points + a resolution switch) which apply only inside this gate.
      let renderBusy = false; // a render (kick → join → blit) is in flight
      let lastBlit = 0; // previous blit's timestamp → the dt stepping the weapon/HUD animations

      const loop = (now: number): void => {
        const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (now - this.lastTime) / 1000);

        this.lastTime = now;
        this.advance(dt);
        this.applyDisplaySnapshot(this.renderHost.measureDisplay(now));

        if (!this.renderHost.disposed && !renderBusy) {
          renderBusy = true;
          this.renderHost.flushPending(); // apply queued geometry re-points + resolution — no render in flight
          const renderStart = performance.now();

          void this.renderHost.renderInto(this.buildRenderRequest()).then(() => {
            if (this.renderHost.disposed) {
              return;
            }
            context.putImageData(this.renderHost.frame, 0, 0);
            const blitNow = performance.now();
            const drawDt = lastBlit === 0 ? dt : Math.min(0.05, (blitNow - lastBlit) / 1000);

            lastBlit = blitNow;
            this.paintOverlays(context, drawDt);
            this.renderHost.afterRender(renderStart); // join roll-up + governor re-band (no render in flight)
            this.threads.set(this.renderHost.activeThreads); // a re-band may have moved the active worker count
            renderBusy = false; // release AFTER the actuations — the next kick sees a settled pool
          });
        }
        this.frameId = requestAnimationFrame(loop);
      };

      this.frameId = requestAnimationFrame(loop);

      // Decode the real environment textures off the served WebP and swap them in live (each worker, or the
      // main thread, reads the map each frame). A failed/SSR load leaves the procedural textures untouched.
      void loadEnvTextures().then((loaded) => {
        this.renderHost.applyTextures(loaded);
        this.texturesLoaded.set(loaded.size > 0);
      });

      // Decode every enemy's atlases (walk/death/attack/pain + a ranged thrower's spin strip) AND every pickup
      // sprite (vitals + spinning ammo strips), register them (main + workers), then spawn the enemies + pickups
      // (so they never flash the magenta MISSING texture).
      const atlasJobs = buildAtlasJobs();

      void Promise.all(atlasJobs.map((job) => loadAtlasTexture(job.url, job.rows))).then(
        (textures) => {
          const loaded = new Map<string, Texture>();

          textures.forEach((texture, i) => {
            if (texture !== null) {
              loaded.set(atlasJobs[i].name, texture);
            }
          });
          if (loaded.size === 0) {
            return;
          }
          this.renderHost.applyTextures(loaded); // enemy/pickup atlases join the pool + GPU texel pool too
          // Flip the atlas gate + spawn the (deferred) active + warm entities in place now the art exists.
          this.zoneRuntime.markAtlasesReady();
          this.combatRuntime.seedReserves(); // the NEW-GAME ammo seed — zone transitions never re-run it
        },
      );

      destroyRef.onDestroy(() => {
        this.renderHost.dispose(); // tears down the pool workers + GPU device
        cancelAnimationFrame(this.frameId);
        window.removeEventListener('keydown', onDown);
        window.removeEventListener('keyup', onUp);
        canvasEl.removeEventListener('click', onClick);
        window.removeEventListener('mousemove', onMouse);
        window.removeEventListener('mousedown', onMousedown);
        window.removeEventListener('mouseup', onMouseup);
        canvasEl.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('fullscreenchange', onResize);
        hudResize.disconnect();
      });
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
    const config = this.renderHost.config;

    this.worldFxPainter.drawProjectiles(
      context,
      config,
      this.camera,
      this.projectiles,
      this.combatRuntime.weaponView,
      this.bob,
    );
    this.worldFxPainter.drawImpacts(context, config, this.camera, this.impacts);
    this.worldFxPainter.drawArcs(context, config, this.camera, this.arcs);
  }

  /** The weapon COMBAT STEP runs on the blit's `drawDt` (NOT the advance dt), then the viewmodel is PAINTED —
   *  step-before-draw, exactly as the monolithic drawWeapon did, so the step's shotFx feeds this frame's
   *  crosshair. */
  private paintWeapon(context: CanvasRenderingContext2D, drawDt: number): void {
    this.combatRuntime.stepWeapon(drawDt, this.mantle !== null);
    this.weaponPainter.draw({
      ctx: context,
      weaponView: this.combatRuntime.weaponView,
      climbView: this.combatRuntime.climbView,
      mantle: this.mantle,
      camera: this.camera,
      fov: this.renderHost.config.fov,
      bob: this.bob,
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

  private onKey(event: KeyboardEvent, down: boolean): void {
    const key = event.key.toLowerCase();

    if (down && (key === 'h' || key === 'j')) {
      if (key === 'h') {
        this.combatRuntime.hurtPlayer(15); // DEBUG: H = take a hit (routes through armour soak + the death check)
      } else {
        this.combatRuntime.heal(15); // DEBUG: J = heal
      }
      event.preventDefault();

      return;
    }
    if (down && key === 'f') {
      this.toggleFullscreen();
      event.preventDefault();

      return;
    }
    if (down && key >= '1' && key <= '8') {
      this.combatRuntime.selectWeapon(Number(key) - 1);
      event.preventDefault();

      return;
    }
    if (down && key === 'r') {
      this.combatRuntime.reload();
      event.preventDefault();

      return;
    }
    if (down && key === 'g') {
      this.combatRuntime.toggleStress(); // DEBUG: toggle the synthetic-enemy stress load
      event.preventDefault();

      return;
    }
    if (!CONTROLS.has(key)) {
      return;
    }

    if (down) {
      this.held.add(key);
    } else {
      this.held.delete(key);
    }
    event.preventDefault();
  }

  /** Integrate the body from the held keys + collisions: forward/back + strafe (turning is mouse-only). */
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
    this.combatRuntime.stepStress(dt); // DEBUG load test (no-op unless toggled) — runs before projectiles so its shots step now
    stepEnemies(this.combatRuntime.activeFrame(), dt); // real enemies chase / shoot / throw
    stepEnemyShots(this.combatRuntime.activeFrame(), dt); // throwers' projectiles fly at the player
    this.zoneRuntime.stepWarm(dt); // the warm neighbor lives too: its foes think in THEIR map behind the seam
    stepProjectiles(this.combatRuntime.playerCombatFrame(), dt);
    this.pickupRuntime.stepPickups(dt); // spin the ammo boxes + collect anything the player is standing on
    this.pickupRuntime.stepObjective(dt); // collect badges, drive zone exits, win the legacy exit
    this.pickupRuntime.stepDoors(dt); // animate doors (after pickups, so this frame's badge state gates the door)
    this.pickupRuntime.stepSliding(dt); // sliding glass doors: proximity-driven + auto-closing

    for (const arc of this.arcs) {
      arc.age += dt;
    }
    this.arcs = this.arcs.filter((arc) => arc.age < ARC_DURATION);

    for (const impact of this.impacts) {
      impact.age += dt;
    }
    this.impacts = this.impacts.filter((impact) => {
      const effect = impactEffect(impact.kind);

      return effect !== undefined && impact.age < effect.frames * effect.frameDuration_s;
    });

    // Mid auto-mantle: the hoist owns the body (no move/look) until it completes — see `stepMantle`.
    if (this.mantle) {
      this.stepMantle(dt);

      return;
    }
    const held = this.held;
    const forward =
      (held.has('w') || held.has('z') || held.has('arrowup') ? 1 : 0) -
      (held.has('s') || held.has('arrowdown') ? 1 : 0);
    const strafe =
      (held.has('d') || held.has('arrowright') ? 1 : 0) -
      (held.has('a') || held.has('q') || held.has('arrowleft') ? 1 : 0);

    if (forward !== 0 || strafe !== 0) {
      this.bob += dt * 9; // advance the weapon's walk-bob cadence only while moving
    }
    const reach = MOVE_SPEED * dt;
    const cos = Math.cos(this.camera.angle);
    const sin = Math.sin(this.camera.angle);
    const fromX = this.camera.x;
    const fromY = this.camera.y;
    const want = movementDelta(this.camera.angle, forward, strafe, reach);
    const world = this.zoneRuntime.world;
    const moved = movePlayer(
      world.map,
      fromX,
      fromY,
      want.x,
      want.y,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      world.slides,
      true, // the player may cross PASSABLE seams — the crossing check right below performs the swap
      world.obstacles,
    );

    // SEAMLESS crossing: stepping over a passable live seam swaps zones INSTANTLY — no fade. The portal
    // already showed exactly what now surrounds the player, so the view must not (and does not) jump.
    if (
      this.zoneRuntime.seams.length > 0 &&
      this.zoneRuntime.crossSeam(fromX, fromY, moved.x, moved.y)
    ) {
      return; // the world swapped under our feet; next frame continues in the new zone
    }

    this.camera.x = moved.x;
    this.camera.y = moved.y;

    // Ease the eye toward the floor under us, so stepping up/down is smooth rather than a jump.
    const targetZ = moved.floorZ + EYE_HEIGHT;

    this.camera.z += (targetZ - this.camera.z) * Math.min(1, 12 * dt);

    // Trigger a climb: pushing FORWARD into a too-tall-but-climbable ledge straight ahead. `movePlayer` has
    // already blocked the player a radius off it (its rise > STEP_MAX), so the probe just classifies that
    // obstacle as a vaultable ledge. A normal step (≤ STEP_MAX) is `null` here and was already walked up.
    if (forward > 0) {
      const ledge = climbTarget(
        world.map,
        this.camera.x,
        this.camera.y,
        moved.floorZ,
        cos,
        sin,
        CLIMB_PROBE_REACH,
        STEP_MAX,
        CLIMB_MAX,
        HEADROOM,
      );

      if (ledge !== null) {
        this.mantle = { progress: 0, startZ: moved.floorZ, targetZ: ledge, dirX: cos, dirY: sin };
      }
    }
  }

  /** Advance the auto-mantle one frame: glide forward along the captured heading by the slice of
   *  {@link CLIMB_VAULT_ADVANCE} covered this tick, lerp the eye from the launch floor up to the ledge, and
   *  clear the state on completion (snapping the eye exactly onto the ledge). Look + walk stay frozen so the
   *  vault always clears the lip. */
  private stepMantle(dt: number): void {
    const m = this.mantle;

    if (m === null) {
      return;
    }
    const step = mantleStep(m, dt, MANTLE_DURATION, CLIMB_VAULT_ADVANCE, EYE_HEIGHT);

    this.camera.x += step.dx;
    this.camera.y += step.dy;
    this.camera.z = step.z;

    if (step.done) {
      this.mantle = null; // landed on the ledge (the eye snapped exactly onto it)
    } else {
      m.progress = step.progress;
    }
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
    return buildLiveSprites(
      this.zoneRuntime.world,
      this.camera.x,
      this.camera.y,
      this.zoneRuntime.atlasesReady,
      this.zoneRuntime.exits,
      this.combatRuntime.stressEnemies,
    );
  }

  /** The WARM neighbor's billboards for the render's neighbor-sprites channel, in ITS own coordinates —
   *  directional props oriented for the camera translated through the seam (the same ghost point the warm
   *  AI tracks), so a totem seen through the window turns exactly like a local one. */
  private warmSprites(warm: WarmZone): Sprite[] {
    return buildWarmSprites(warm, this.camera.x, this.camera.y, this.zoneRuntime.seams);
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
