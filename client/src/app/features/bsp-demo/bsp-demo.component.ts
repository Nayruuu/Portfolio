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
  buildBsp,
  castRay,
  clampPitch,
  climbTarget,
  HEADROOM,
  locateSubSector,
  mantleStep,
  mapObstacles,
  mapSprites,
  movePlayer,
  PLAYER_RADIUS,
  renderFrame,
  isPassableSeam,
  seamCrossing,
  seamHysteresisPush,
  STEP_MAX,
  type Camera,
  type CompiledMap,
  type MapSource,
  type MutableSector,
  type Obstacle,
  type Sprite,
  type Texture,
  type ZoneNeighbor,
} from '../../core/lib/bsp-engine';
import {
  LEVELS,
  parseLevelParams,
  resolveZone,
  type Level,
  type LevelParams,
} from '../../core/lib';
import {
  buildAtlasJobs,
  loadAtlasTexture,
  loadEnvTextures,
  proceduralTextures,
  projectileWidth,
} from './render/load-textures';
import type { Foe } from './enemy-runtime';
import type { Door, SeamEdge, WarmZone, ZoneExit } from './zone-world';
import {
  buildPickups,
  EXIT_RADIUS,
  PICKUP_RADIUS,
  takenFlags,
  VITAL_MAX,
  weaponAmmoDose,
  type AmmoBox,
  type Keycard,
  type Marker,
  type Vital,
  type WeaponPickup,
  type WeaponPickupSpec,
} from './pickups';
import { createGpuRenderer, type GpuRenderer } from './render/gpu-renderer';
import { createRenderPool, type RenderPool } from './render/render-pool';
import { DoomHud } from '../../shared/game/doom-hud';
import {
  AMMO_MAX,
  ARSENAL,
  STARTING_WEAPON_IDS,
  ammoTypeMax,
  reloadViewConfig,
  weaponCombat,
  weaponViewConfig,
} from '../../shared/game/weapons';
import { WeaponView } from '../../shared/game/weapon-view';
import { ClimbView } from '../../shared/game/climb-view';
import { impactEffect } from '../../shared/game/effects';
import { IconComponent } from '../../shared/icon/icon.component';
import { WorldFxPainter } from './painters/world-fx-painter';
import { HudPainter } from './painters/hud-painter';
import { buildLiveSprites, buildWarmSprites, HIT_FLASH_DURATION } from './sprites/sprite-builder';
import {
  drawChargeFx,
  drawCrosshair,
  drawGameOver,
  drawHint,
  drawHurtFx,
  drawPickupFx,
  drawWinScreen,
  drawZoneFade,
  HURT_FX_DURATION,
  PICKUP_FX_DURATION,
  SHOT_FX_DURATION,
} from './painters/overlay-painter';
import {
  ARC_DURATION,
  DOOR_TRIGGER_RADIUS,
  FRAME_STATS_WINDOW_MS,
  FrameStats,
  SLIDE_TRIGGER_RADIUS,
  doorCeilZ,
  fireWeapon,
  initialRenderGovernor,
  movementDelta,
  nextOwnedIndex,
  shouldAutoEquip,
  stepArsenal,
  stepDoorOpenness,
  stepEnemies,
  stepEnemyShots,
  stepProjectiles,
  stepRenderGovernor,
  stepSlideOpenness,
  zoneStates,
  type Arc,
  type Barrel,
  type CombatEnemy,
  type CombatFrame,
  type EnemyShot,
  type Impact,
  type KeycardColor,
  type PlayerCombatFrame,
  type Projectile,
  type RenderGovernorState,
  type ZoneSnapshot,
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

const EYE_HEIGHT = 1.4; // camera height above the floor
const MOVE_SPEED = 4; // world units / second
// Auto-mantle: a ledge whose rise is in (STEP_MAX, CLIMB_MAX] is too tall to step but climbable — walking
// into it hoists the player up over MANTLE_DURATION while gliding CLIMB_VAULT_ADVANCE forward over the lip.
const CLIMB_MAX = 2.4; // tallest ledge you can vault (above this it stays a solid wall)
const CLIMB_PROBE_REACH = 0.45; // cells ahead the climb probe samples — just past the radius, into the ledge cell
const MANTLE_DURATION = 0.4; // seconds the hoist takes
const CLIMB_VAULT_ADVANCE = 0.5; // cells the hoist glides the player forward, so it clears the lip and stands on top
const CLIMB_LEDGE_DEPTH = 0.3; // arm's-reach depth the ledge top is projected at, to pin the hands' grip line
const CLIMB_LEDGE_MIN = 0.22; // hold the grip line within this band (fractions of screen height): the hands grip
const CLIMB_LEDGE_MAX = 0.72; // the lip near the top, then slide down it as the hoist raises the camera past it
const MOUSE_SENS = 0.0035; // radians per pixel of mouse motion (turning is mouse-only)
const PITCH_UP_MAX = 0.85; // look-up limit (the camera pitch is a vertical y-shear, not a true rotation)
const PITCH_DOWN_MAX = 2.0; // look-DOWN limit — much deeper than up (aim down at enemies below a platform); the renderer handles the off-screen horizon, so this can exceed 1.0 (walls stay vertical, as in any sheared-frustum tilt)
const ARMOR_ABSORB = 1 / 3; // fraction of an incoming hit armour soaks (the rest hits health) — DOOM green armour
const RESERVE_START = 50; // starting reserve per ammo type at spawn (then clamped to each type's cap) — pickups top up
const RESTART_DELAY = 1.2; // seconds after death/win before a click restarts (lets the end feedback settle)
const ZONE_FADE = 0.35; // seconds each side of a zone swap fades (to black, swap the floor, back in)
const HINT_DURATION = 1.8; // seconds a transient objective hint lingers (e.g. "badge requis" at a locked exit)
const INSPECT_PICKUPS: boolean = false; // when true, ammo boxes spin but are never collected (art-inspection mode)
const SPAWN_ENEMIES: boolean = true; // spawn the level's enemies (the live game in the player); /bsp shares the same scene
// Internal render resolution per display mode: 720p when the canvas is embedded in the ~960px viewport (a
// near-free quality match, ~2× cheaper), full 1080p when it fills the screen in fullscreen (native, no
// upscale blur). Each mode ALWAYS renders at 100% of its tier — sharpness is part of the product. Under
// contention the RENDER GOVERNOR (core/lib/game/telemetry/render-governor.ts) trades the pool's ACTIVE WORKER COUNT
// only (join stalls shrink it, proven calm grows it back); it never touches the resolution.
const WINDOWED_RENDER = { width: 1280, height: 720 } as const;
const FULLSCREEN_RENDER = { width: 1920, height: 1080 } as const;
const CHARGE_GLOW_PEAK = 0.7; // peak green charge-buildup tint at full BFG spin-up (mirrors the grid)
const CHARGE_FLASH_DECAY_PER_S = 3; // how fast the green discharge flash fades
const HUD_NATIVE_WIDTH = 2117; // x1.0 status-bar art width (biggest tier) — only the aspect source now
const HUD_NATIVE_HEIGHT = 404; // …its height, so the backing store keeps the bar's 5.24:1 aspect
const HUD_MAX_WIDTH = 1024; // cap the HUD backing store here → a cheap repaint even fullscreen (still crisp)
// DEBUG stress mode (toggle G): a load test for the MAIN-THREAD budget under a real fight — synthetic enemies
// run a per-frame AI cost (line-of-sight castRay + collision chase) and fire projectiles, ramping in number.
const STRESS_MAX = 64; // peak synthetic enemies the ramp climbs to
const STRESS_RAMP_STEP = 8; // enemies added per ramp tick
const STRESS_RAMP_INTERVAL = 2; // seconds between ramp ticks
const ENEMY_SPEED = 2; // chase speed (world units / second)
const ENEMY_FIRE_INTERVAL = 1.5; // seconds between an enemy's shots while it can see the player
const PERF_RING_SIZE = 4096; // frames the dev perf ring (`?perflog=1`) holds — a power of two (index masks)

/**
 * The BSP software-engine game: it blits {@link renderFrame}'s framebuffer onto a canvas each animation
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

  // --- The CURRENT zone. The open building loads one floor at a time: `loadZone` swaps every level-bound
  // structure below (sectors copy, compiled BSP, barrels, enemies, pickups, doors, exits) while the player's
  // inventory travels through. Dev URL params (`?level=&spawn=&noenemies=1` — see level-select.ts) shape the
  // INITIAL load; `noenemies` strips every zone. Assigned by the constructor's initial `loadZone`.
  private readonly params: LevelParams = parseLevelParams(
    typeof location === 'undefined' ? '' : location.search,
  );
  private zoneKey = ''; // '' only before the constructor's initial loadZone — then always a LEVELS key
  private level!: Level;
  private zoneSnap: ZoneSnapshot | null = null; // the zone's restored snapshot, re-applied by the spawn fns
  // The zone's sectors, cloned into a MUTABLE per-zone copy so an animated DOOR can raise/lower a sector's
  // `ceilZ` live (renderer + physics read sector heights straight off `source.sectors` each frame).
  private sectors!: MutableSector[];
  private mapSource!: MapSource;
  private map!: CompiledMap;
  private obstacles: readonly Obstacle[] = []; // the active zone's solid decor (props block movers)
  // The zone's LIVE-portal neighbors: every zone this map's `zonePortal` seams look into, compiled once per
  // session (`compiledZones` caches them — zones are small) and re-derived by each `loadZone`. The workers
  // receive the sources (each builds its own BSP); the main-thread fallback renders the compiled forms.
  // Neighbors render their REGISTRY geometry (static heights, doors shut) — the LIFE behind a passable seam
  // comes from the WARM zone below, whose sprites feed the render as the neighbor-sprites channel.
  private readonly compiledZones = new Map<string, CompiledMap>();
  private neighborMaps: ReadonlyMap<string, CompiledMap> = new Map();
  private neighborSources: ReadonlyMap<string, MapSource> = new Map();
  // The active map's PASSABLE seams (pre-resolved segments + transforms) — the per-frame crossing test.
  private seams: SeamEdge[] = [];
  // The WARM neighbor: the zone behind the active map's passable seam, kept ALIVE while it is visible —
  // its enemies simulate each frame (in their own map, against the player's seam-translated ghost) and its
  // sprites render through the window. One warm zone max. Crossing the seam adopts it as the active world.
  private warm: WarmZone | null = null;
  // The main-thread render fallback library — the SAME procedural map the workers build, so the two can't
  // drift (every extended palette key has a fallback until its WebP decodes). WebP swaps in via `setTextures`.
  private readonly textures = proceduralTextures();
  // The CURRENT internal render resolution (software-rendered each frame, upscaled to the canvas' CSS size
  // with `image-rendering: pixelated`). Mutated by `applyResolution` on fullscreen toggle — windowed renders
  // at WINDOWED_RENDER (cheap, the viewport is only ~960px), fullscreen at FULLSCREEN_RENDER (native 1080p).
  private readonly config: { width: number; height: number; fov: number } = {
    ...WINDOWED_RENDER,
    fov: Math.PI / 2,
  };
  private readonly camera = { x: 0, y: 0, angle: 0, z: EYE_HEIGHT, pitch: 0 } satisfies Camera; // placed by loadZone
  // Shootable billboards: the zone map's static sprites, each a target a hitscan can cull (destructible barrels).
  private targets: Barrel[] = [];
  private projectiles: Projectile[] = []; // launched shots in flight (projectile weapons), stepped each frame
  private arcs: Arc[] = []; // short-lived plasma chain-lightning visuals, aged out each frame
  private impacts: Impact[] = []; // burst-strip animations playing at hit points, aged out each frame
  // Real enemies (per-spec: melee Husk + ranged Guard). Spawned once the atlases decode. `walkDist` drives the
  // walk frame; `dying` → death atlas (`deathTime` advancing it); `hitFlash` is the pain pop.
  private enemies: Foe[] = [];
  private enemyShots: EnemyShot[] = []; // throwers' projectiles flying at the player
  // DEBUG stress mode (toggle G): synthetic chasing enemies + their projectiles, to load-test the main thread.
  private stress = false;
  private stressEnemies: { x: number; y: number; z: number; cooldown: number }[] = [];
  private stressClock = 0; // ramp timer
  private aiMs = 0; // measured per-frame AI cost (LOS + chase) — logged to telemetry to isolate it from render
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
  // The pure per-window roll-up (fps / mean / max / worst-stall) behind the HUD signals + perf beacon — it
  // ingests each completed render's cost and distils the window ~4×/second (core/lib/game/telemetry/frame-stats.ts).
  private readonly frameStats = new FrameStats();
  private lastRenderMs = 0; // the last completed render's measurements — the ring's render columns
  private lastStallMs = 0;
  private lastSlowest = 0;
  private lastComputeMs = 0; // last join's fastest-band compute (the governor's compute input)
  // The render governor's state — the pure contention-resilience controller (see render-governor.ts).
  // Null when there is no worker pool: the main-thread fallback has no join to stall, and its compute
  // cost is the platform's single-thread baseline — nothing for the governor to trade.
  private governor: RenderGovernorState | null = null;
  // Perf telemetry (localhost only — never in prod): a session id + whether to POST samples to the dev server's
  // /perf sink, so a play session can be read back + analysed offline instead of eyeballing the HUD.
  private readonly perfSid = typeof performance === 'undefined' ? 0 : Math.round(performance.now());
  private readonly perfLog =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  // Dev-only per-frame ring (`?perflog=1` — see level-select.ts): the last PERF_RING_SIZE rAF-to-rAF deltas +
  // render costs, exposed on `window.__bspPerfRing` for a scripted reader (p50/p95/p99/spike analysis). Null
  // when off — the loop then pays a single null check and allocates nothing.
  private perfRing: {
    readonly delta: Float64Array;
    readonly render: Float64Array;
    readonly stall: Float64Array; // join straggler stall (slowest band vs median — see JoinStats)
    readonly slowest: Float64Array; // worker index of the stalled band (the straggler's identity)
    readonly workers: Float64Array; // active worker count that frame (the governor's rung)
    readonly compute: Float64Array; // fastest-band compute (the governor's compute input)
    n: number;
  } | null = null;
  private perfRingLast = 0; // previous frame's rAF timestamp (0 = no previous frame yet)
  private readonly hud = new DoomHud();
  private hp = 100; // player health — drained by enemy strikes/blasts/clips, refilled by coffee pickups
  private armor = 0; // player armour — soaks a fraction of each hit, refilled by RAM-stick pickups
  private dead = false; // hp hit 0 → the world freezes under a game-over wash until a click restarts
  private deadClock = 0; // seconds since death (gates the restart + fades the game-over wash in)
  private pickupFx = 0; // seconds left on the green pickup flash (collected an item)
  // Floor pickups, each carrying its spawn index (`idx`) so a zone snapshot can flag WHICH were taken.
  private vitals: (Vital & { idx: number })[] = []; // health/armour, collected on proximity
  private ammoBoxes: (AmmoBox & { idx: number })[] = []; // spinning ammo boxes, collected on proximity
  private keycards: (Keycard & { idx: number })[] = []; // spinning access badges, collected on proximity
  private weaponPickups: (WeaponPickup & { idx: number })[] = []; // weapon unlocks, collected on proximity
  private readonly heldCards = new Set<KeycardColor>(); // badge colours collected → unlock the matching doors
  private exit: Marker | null = null; // the legacy exit sign marker (the win goal; null when `exits` rule)
  private zoneExits: ZoneExit[] = []; // the zone's graph exits (walk-into transition points)
  private exitsLocked = false; // arrival guard: exits re-arm once the player has LEFT every exit radius
  private transition: {
    readonly to: string;
    readonly entry: string;
    clock: number;
    swapped: boolean;
  } | null = null; // the in-flight zone swap (fade out → loadZone → fade in)
  private pool: RenderPool | null = null; // the worker render pool (null = single-threaded fallback / pre-init)
  // The WebGPU compute backend (the DEFAULT; `?renderer=cpu` forces the CPU path — see gpu-renderer.ts).
  // Null until its async init lands, and again after any GPU failure: the CPU path (pool or main thread)
  // is ALWAYS the running fallback.
  private gpu: GpuRenderer | null = null;
  private atlasesReady = false; // enemy/pickup atlases decoded → later zone loads can spawn immediately
  private won = false; // reached the exit → the level-complete wash, frozen until a click restarts
  private wonClock = 0; // seconds since the win (gates the restart + fades the wash in)
  private hint = 0; // seconds left on a transient HUD hint (e.g. "badge requis" at a locked door)
  private doors: Door[] = []; // animated doors (the badge-locked annex gate); their ceilZ is driven each frame
  private slides: number[] = []; // per-linedef sliding-door openness (0 shut … 1 retracted); fed to render + physics
  private slidingDoors: { readonly line: number; readonly mx: number; readonly my: number }[] = [];
  // The in-world transient FX painter (projectiles / impacts / arcs) — owns its lazily-decoded sprite caches.
  private readonly worldFxPainter = new WorldFxPainter();
  // The DOOM status-bar sync painter — owns the turn-rate EMA that aims the HUD face's gaze through a turn.
  private readonly hudPainter = new HudPainter();
  // The DOOM weapon PROGRESSION: the ids the player has unlocked. A new game starts FISTS-ONLY
  // (STARTING_WEAPON_IDS) and every other weapon is a level pickup; ownership is INVENTORY — it travels
  // across zones/seam swaps untouched and resets only in {@link resetGame}.
  private readonly ownedWeapons = new Set<string>(STARTING_WEAPON_IDS);
  private weaponIndex = 0;
  private weaponView = new WeaponView(
    ARSENAL[0],
    weaponViewConfig(ARSENAL[0]),
    reloadViewConfig(ARSENAL[0]),
  );
  private readonly climbView = new ClimbView(); // the two-handed mantle pull, shown over the weapon mid-vault
  private readonly mag = ARSENAL.map((weapon) => weapon.magSize ?? 0); // loaded rounds per weapon
  private bob = 0; // weapon idle-bob phase, advanced while moving
  private fireHeld = false; // mouse held → automatic fire
  private fireEdge = false; // mousedown landed this frame → one semi-auto shot
  private reloadEdge = false; // R pressed this frame → start a reload
  private fireCooldown = 0; // seconds until the active weapon can fire again
  private reloadClock = 0; // seconds left on the active weapon's reload
  private readonly reserve = new Map<string, number>(); // ammo-type → reserve pool (lazily seeded)
  private shotFx = 0; // seconds left on the muzzle-flash + impact-spark feedback
  private hurtFx = 0; // seconds left on the red damage flash (player took a hit)
  private chargeGlow = 0; // 0..1 live green charge-buildup tint while the BFG spins up
  private dischargeFlash = 0; // 0..1 green discharge flash on a BFG shot, decayed each frame

  constructor() {
    const destroyRef = inject(DestroyRef);

    // The initial zone load — the SAME code path as every open-building transition (URL level or default).
    // Pure map/data work, so it is prerender-safe; enemies/pickups spawn once the atlases decode below.
    this.loadZone(this.params.levelKey);

    afterNextRender(() => {
      const context = this.canvas().nativeElement.getContext('2d');

      if (context === null) {
        return;
      }

      // Dev perf ring (`?perflog=1`): allocate once and expose on `window` so a scripted perf run can read
      // the raw per-frame series back. Off (the default) → null, and the loop allocates/writes nothing.
      if (this.params.perfRing) {
        this.perfRing = {
          delta: new Float64Array(PERF_RING_SIZE),
          render: new Float64Array(PERF_RING_SIZE),
          stall: new Float64Array(PERF_RING_SIZE),
          slowest: new Float64Array(PERF_RING_SIZE),
          workers: new Float64Array(PERF_RING_SIZE),
          compute: new Float64Array(PERF_RING_SIZE),
          n: 0,
        };
        (window as unknown as Record<string, unknown>)['__bspPerfRing'] = this.perfRing;
        // The scripted-run telemetry seam (same dev flag as the ring): the LIVE camera, so a scripted
        // perf/playtest run can read the player's position + heading back between moves.
        (window as unknown as Record<string, unknown>)['__bspCam'] = this.camera;
      }

      const canvasEl = this.canvas().nativeElement;
      // The framebuffer + z-buffer + canvas backing store + worker pool are all sized to the CURRENT render
      // resolution; `applyResolution` rebuilds them (between frames) when fullscreen toggles the target.
      let image = context.createImageData(this.config.width, this.config.height);
      let zbuffer = new Float32Array(this.config.width * this.config.height);
      let pendingRes: { width: number; height: number } | null = null; // queued resolution change (applied between frames)

      canvasEl.width = this.config.width; // backing store = the internal render resolution (CSS upscales it)
      canvasEl.height = this.config.height;

      this.climbView.preload(); // decode the mantle hands now, so the first vault never shows a blank frame
      const onDown = (event: KeyboardEvent): void => this.onKey(event, true);
      const onUp = (event: KeyboardEvent): void => this.onKey(event, false);
      const onClick = (): void => {
        if (this.dead || this.won) {
          // game over OR level complete → a click (after the settle delay) restarts the level
          if ((this.dead ? this.deadClock : this.wonClock) >= RESTART_DELAY) {
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
        // always 100% of the tier. Queue it for the loop (a live rebuild mid-render would tear down the
        // pool the frame is still painting into).
        const tier = document.fullscreenElement !== null ? FULLSCREEN_RENDER : WINDOWED_RENDER;

        if (tier.width !== this.config.width || tier.height !== this.config.height) {
          pendingRes = { width: tier.width, height: tier.height };
        }
      };
      const onMousedown = (event: MouseEvent): void => {
        if (document.pointerLockElement !== canvasEl) {
          return;
        }
        // SECONDARY click — the right button (`button === 2`) or a macOS Ctrl+click — reloads (the desktop
        // twin of the R key); the primary button (left) fires. Mirrors the grid's mouse handling.
        if (event.button === 2 || event.ctrlKey) {
          event.preventDefault();
          this.reload();

          return;
        }
        if (event.button === 0) {
          this.fireHeld = true;
          this.fireEdge = true;
        }
      };
      const onMouseup = (event: MouseEvent): void => {
        if (event.button === 0) {
          this.fireHeld = false; // only the primary (fire) button releases the held auto-fire
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
          this.selectWeapon(nextOwnedIndex(this.ownedFlags(), this.weaponIndex, dir));
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

      // Multi-thread when the platform allows it (SharedArrayBuffer + cross-origin isolation); otherwise the
      // pool is null and we render single-threaded on the main thread. Either way the frame lands in `image`.
      // Kept on `this.pool` too, so `loadZone` can re-point the SAME workers at the next zone's geometry.
      const pool = createRenderPool(
        this.config,
        this.zoneKey,
        this.mapSource,
        this.neighborSources,
      );
      let disposed = false;

      this.pool = pool;

      this.threads.set(pool?.active ?? 1);
      this.poolSize.set(pool?.threads ?? 1);
      // `?nogov=1` (dev — see level-select.ts) pins the pool at full workers / full resolution: the
      // A/B control for measuring what the governor buys under contention.
      this.governor =
        pool === null || this.params.noGovernor ? null : initialRenderGovernor(pool.threads);

      // The WEBGPU COMPUTE backend is the DEFAULT (`?renderer=cpu` forces the worker-pool path — see
      // level-select.ts). Its init is async; until it lands — and on ANY failure (no WebGPU, device loss) —
      // the CPU path keeps rendering (no user-visible error, the debug readout shows the active backend).
      // The governor stays CPU-path-only.
      if (this.params.renderer !== 'cpu') {
        void createGpuRenderer(this.config).then((gpu) => {
          if (gpu === null || disposed) {
            gpu?.dispose();
            if (!disposed) {
              console.info('[bsp] WebGPU unavailable — staying on the CPU renderer');
            }

            return;
          }
          gpu.resize(this.config); // the resolution may have changed while the device was initializing
          gpu.setTextures(this.textures);
          this.gpu = gpu;
          this.backend.set('gpu');
          console.info('[bsp] WebGPU compute backend active');
          if (this.params.perfRing) {
            // Dev perf hook (like __bspPerfRing): a STABLE stats object, mutated in place each frame.
            (window as unknown as Record<string, unknown>)['__bspGpuStats'] = gpu.stats;
          }
        });
      }

      // Switch the render targets to a new resolution (framebuffer/z-buffer/canvas + the worker bands). The pool
      // re-points its EXISTING workers (they keep their built map + textures) — no respawn, so it costs a few ms.
      // Called between frames (via `pendingRes`) so no render is mid-flight.
      const applyResolution = (width: number, height: number): void => {
        this.config.width = width;
        this.config.height = height;
        canvasEl.width = width;
        canvasEl.height = height;
        image = context.createImageData(width, height);
        zbuffer = new Float32Array(width * height);
        pool?.resize(this.config);
        this.gpu?.resize(this.config);
      };

      const renderInto = (): Promise<void> => {
        const sprites = this.liveSprites(); // alive billboards this frame (a culled barrel drops out)
        // The WARM zone's live billboards, in ITS coordinates — rendered through the seam windows.
        const neighborSprites =
          this.warm === null ? undefined : new Map([[this.warm.key, this.warmSprites(this.warm)]]);
        // Capture the current pool + framebuffer: a resolution rebuild only swaps them between frames, so the
        // pair stays consistent for this render (and the locals keep the non-null narrowing in the callback).
        const activePool = pool;
        const activeImage = image;
        const gpu = this.gpu;

        if (gpu !== null) {
          // The GPU path: build the command buffer on the main thread (the FULL renderFrame surface —
          // live sprites, sliding doors, zone-portal neighbours with the warm zone's life), dispatch the
          // compute pass, read back into the same ImageData the shared blit + overlay stack paints. Any
          // failure (a lost device) silently drops back to the CPU path for good — the next kick renders CPU.
          return gpu
            .render(
              this.map,
              this.camera,
              activeImage.data,
              sprites,
              this.slides,
              this.zoneNeighbors(neighborSprites),
            )
            .catch(() => {
              this.gpu = null;
              this.backend.set('cpu');
              gpu.dispose();
            });
        }
        if (activePool !== null) {
          return activePool
            .render(this.camera, sprites, this.sectors, this.slides, neighborSprites) // live heights + slides + warm life → workers
            .then(() => activeImage.data.set(activePool.frame)); // workers → shared buf → blit
        }
        renderFrame(
          this.map,
          this.camera,
          this.config,
          this.textures,
          image.data,
          zbuffer,
          0,
          this.config.height,
          sprites,
          this.slides,
          this.zoneNeighbors(neighborSprites),
        );

        return Promise.resolve();
      };

      // The rAF chain is NEVER gated on the workers' frame join (the root of contention stutter: one
      // descheduled worker used to freeze display AND input for its whole scheduling quantum). The world
      // advances and the chain re-arms every display frame; a render is KICKED only when the pool is
      // idle, and its completion blits + releases. A join straggler therefore costs one REPEATED frame
      // on screen — never a frozen pipeline. Render and blit never overlap (the next kick waits for the
      // release), so the single shared framebuffer stays safe, as do the between-frames contracts of
      // `applyResolution` / `setWorkers` — both actuate only while no render is in flight.
      let renderBusy = false; // a render (kick → join → blit) is in flight
      let lastBlit = 0; // previous blit's timestamp → the dt stepping the weapon/HUD animations

      const loop = (now: number): void => {
        const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (now - this.lastTime) / 1000);

        this.lastTime = now;
        this.advance(dt);
        this.measureDisplay(now);

        if (!renderBusy) {
          renderBusy = true;
          if (pendingRes !== null) {
            applyResolution(pendingRes.width, pendingRes.height); // safe here: no render is in flight
            pendingRes = null;
          }
          const renderStart = performance.now();

          void renderInto().then(() => {
            if (disposed) {
              return;
            }
            context.putImageData(image, 0, 0);
            const blitNow = performance.now();
            const drawDt = lastBlit === 0 ? dt : Math.min(0.05, (blitNow - lastBlit) / 1000);

            lastBlit = blitNow;
            this.worldFxPainter.drawProjectiles(
              context,
              this.config,
              this.camera,
              this.projectiles,
              this.weaponView,
              this.bob,
            );
            this.worldFxPainter.drawImpacts(context, this.config, this.camera, this.impacts);
            this.worldFxPainter.drawArcs(context, this.config, this.camera, this.arcs);
            this.drawWeapon(drawDt, context);
            drawHurtFx(context, this.hurtFx);
            drawPickupFx(context, this.pickupFx);
            drawChargeFx(context, this.chargeGlow, this.dischargeFlash);
            drawCrosshair(context, this.shotFx);
            drawHint(context, this.hint);
            drawZoneFade(context, this.transition, ZONE_FADE);
            this.hudPainter.draw({
              hud: this.hud,
              canvas: this.hudCanvas().nativeElement,
              dt: drawDt,
              weaponIndex: this.weaponIndex,
              reserve: this.reserve,
              hp: this.hp,
              armor: this.armor,
              mag: this.mag,
              ownedWeapons: this.ownedWeapons,
              weaponView: this.weaponView,
              cameraAngle: this.camera.angle,
            });
            drawGameOver(context, this.dead, this.deadClock, this.deadClock >= RESTART_DELAY);
            drawWinScreen(context, this.won, this.wonClock, this.wonClock >= RESTART_DELAY);
            // GPU frames have no worker join — their stats stay out of the stall/governor loop entirely.
            const join = pool === null || this.gpu !== null ? null : pool.stats;

            this.recordRender(
              performance.now() - renderStart,
              join?.stallMs ?? 0,
              join?.slowest ?? 0,
              join?.computeMs ?? 0,
            );
            // CONTENTION governor (pure — render-governor.ts): straggler stalls shrink the active worker
            // set, proven calm grows it back — resolution is never traded. Applied HERE, while no render
            // is in flight, so a re-band never races one.
            if (pool !== null && join !== null && this.governor !== null) {
              const prev = this.governor;
              const next = stepRenderGovernor(prev, {
                stallMs: join.stallMs,
                computeMs: join.computeMs,
                joinMs: join.joinMs,
              });

              this.governor = next;
              if (next.workers !== prev.workers) {
                pool.setWorkers(next.workers);
                this.threads.set(pool.active);
              }
            }
            renderBusy = false; // release AFTER the actuations — the next kick sees a settled pool
          });
        }
        this.frameId = requestAnimationFrame(loop);
      };

      this.frameId = requestAnimationFrame(loop);

      // Decode the real environment textures off the served WebP and swap them in live (each worker, or the
      // main thread, reads the map each frame). A failed/SSR load leaves the procedural textures untouched.
      void loadEnvTextures().then((loaded) => {
        pool?.setTextures(loaded);
        for (const [name, texture] of loaded) {
          this.textures.set(name, texture); // the main-thread fallback AND the GPU pool read this map
        }
        this.gpu?.setTextures(this.textures);
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
          for (const [name, texture] of loaded) {
            this.textures.set(name, texture);
          }
          pool?.setTextures(loaded);
          this.gpu?.setTextures(this.textures); // the enemy/pickup atlases join the GPU texel pool too
          this.atlasesReady = true; // later zone loads spawn immediately (the art is decoded once, globally)
          this.seedReserves(); // the NEW-GAME ammo seed — zone transitions never re-run it
          this.spawnEnemies();
          this.spawnPickups();
          this.refreshWarm(); // the warm neighbor can only populate now its art exists
        },
      );

      destroyRef.onDestroy(() => {
        disposed = true;
        pool?.dispose();
        this.pool = null;
        this.gpu?.dispose();
        this.gpu = null;
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

  private onKey(event: KeyboardEvent, down: boolean): void {
    const key = event.key.toLowerCase();

    if (down && (key === 'h' || key === 'j')) {
      if (key === 'h') {
        this.hurtPlayer(15); // DEBUG: H = take a hit (routes through armour soak + the death check)
      } else {
        this.hp = Math.min(100, this.hp + 15); // DEBUG: J = heal
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
      this.selectWeapon(Number(key) - 1);
      event.preventDefault();

      return;
    }
    if (down && key === 'r') {
      this.reload();
      event.preventDefault();

      return;
    }
    if (down && key === 'g') {
      this.stress = !this.stress; // DEBUG: toggle the synthetic-enemy stress load
      if (!this.stress) {
        this.stressEnemies = [];
        this.stressClock = 0;
        this.aiMs = 0;
      }
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
    this.shotFx = Math.max(0, this.shotFx - dt); // fade the muzzle flash / impact spark
    this.hurtFx = Math.max(0, this.hurtFx - dt); // fade the red damage flash
    this.pickupFx = Math.max(0, this.pickupFx - dt); // fade the green pickup flash
    this.dischargeFlash = Math.max(0, this.dischargeFlash - CHARGE_FLASH_DECAY_PER_S * dt); // fade the BFG flash
    if (this.dead) {
      this.deadClock += dt; // world frozen under the game-over wash; a click restarts after RESTART_DELAY

      return;
    }
    if (this.won) {
      this.wonClock += dt; // world frozen under the level-complete wash; a click restarts after RESTART_DELAY

      return;
    }
    if (this.transition !== null) {
      this.stepTransition(dt); // the fade owns the world: everything freezes while the building swaps floors

      return;
    }
    this.stepStress(dt); // DEBUG load test (no-op unless toggled) — runs before projectiles so its shots step now
    stepEnemies(this.activeFrame(), dt); // real enemies chase / shoot / throw
    stepEnemyShots(this.activeFrame(), dt); // throwers' projectiles fly at the player
    this.stepWarm(dt); // the warm neighbor lives too: its foes think in THEIR map behind the seam
    stepProjectiles(this.playerCombatFrame(), dt);
    this.stepPickups(dt); // spin the ammo boxes + collect anything the player is standing on
    this.stepDoors(dt); // animate doors (after pickups, so this frame's badge state gates the door) before moving

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
    const moved = movePlayer(
      this.map,
      fromX,
      fromY,
      want.x,
      want.y,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      this.slides,
      true, // the player may cross PASSABLE seams — the crossing check right below performs the swap
      this.obstacles,
    );

    // SEAMLESS crossing: stepping over a passable live seam swaps zones INSTANTLY — no fade. The portal
    // already showed exactly what now surrounds the player, so the view must not (and does not) jump.
    if (this.seams.length > 0 && this.crossSeam(fromX, fromY, moved.x, moved.y)) {
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
        this.map,
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

  /** Per-arsenal-position owned flags (the 1..8 key row) — the shape the pure cycling/HUD logic reads. */
  private ownedFlags(): boolean[] {
    return ARSENAL.map((weapon) => this.ownedWeapons.has(weapon.id));
  }

  /** Switch to an arsenal slot (0-based) — rebuilds the viewmodel for the new weapon. An UNOWNED slot is
   *  inert (the DOOM progression: a number key does nothing until its weapon has been picked up). */
  private selectWeapon(index: number): void {
    if (
      index < 0 ||
      index >= ARSENAL.length ||
      index === this.weaponIndex ||
      !this.ownedWeapons.has(ARSENAL[index].id)
    ) {
      return;
    }
    this.weaponIndex = index;
    this.fireCooldown = 0;
    this.reloadClock = 0;
    const weapon = ARSENAL[index];

    this.weaponView = new WeaponView(weapon, weaponViewConfig(weapon), reloadViewConfig(weapon));
  }

  /** Request a reload — `stepArsenal` stages it (reserve → mag over the weapon's reloadTime) next frame. */
  private reload(): void {
    this.reloadEdge = true;
  }

  /** The world billboards still alive this frame — the render's per-frame sprite list (culled barrels drop
   *  out). Projectiles are NOT here: they are painted screen-space over the frame by `drawProjectiles`.
   *  Sources the active zone's live state for the pure {@link buildLiveSprites}. */
  private liveSprites(): Sprite[] {
    return buildLiveSprites(
      {
        targets: this.targets,
        enemies: this.enemies,
        enemyShots: this.enemyShots,
        vitals: this.vitals,
        ammoBoxes: this.ammoBoxes,
        keycards: this.keycards,
        weaponPickups: this.weaponPickups,
        exit: this.exit,
      },
      this.camera.x,
      this.camera.y,
      this.atlasesReady,
      this.zoneExits,
      this.stressEnemies,
    );
  }

  /** The WARM neighbor's billboards for the render's neighbor-sprites channel, in ITS own coordinates —
   *  directional props oriented for the camera translated through the seam (the same ghost point the warm
   *  AI tracks in {@link stepWarm}), so a totem seen through the window turns exactly like a local one. */
  private warmSprites(warm: WarmZone): Sprite[] {
    return buildWarmSprites(warm, this.camera.x, this.camera.y, this.seams);
  }

  /** Spawn the active zone's enemies (once the atlases have decoded) — see {@link buildEnemies}. */
  private spawnEnemies(): void {
    this.enemies = this.buildEnemies(this.level, this.map, this.zoneSnap);
  }

  /** Build a zone's enemy roster, each foe seated on its sector floor. The zone's snapshot (if any) is
   *  re-applied per roster index: a dead enemy comes back as a CORPSE frozen on its last death frame, a
   *  survivor at the position + hp it was left with. Shared by the active spawn and the warm-zone build. */
  private buildEnemies(level: Level, map: CompiledMap, snap: ZoneSnapshot | null): Foe[] {
    if (!SPAWN_ENEMIES) {
      return [];
    }

    return level.enemies.map(({ spec, x, y }, i) => {
      const saved = snap?.enemies[i];
      const dead = saved?.dead ?? false;
      const atX = saved?.x ?? x;
      const atY = saved?.y ?? y;

      return {
        spec,
        x: atX,
        y: atY,
        z: this.floorOn(level, map, atX, atY),
        walkDist: 0,
        hp: dead ? 0 : (saved?.hp ?? spec.hp),
        dying: dead,
        deathTime: dead ? spec.deathFrames / spec.deathFps : 0, // holds the last frame — a settled corpse
        hitFlash: 0,
        windup: 0,
        cooldown: 0,
      };
    });
  }

  /** Seed every ammo type's reserve at spawn — RESERVE_START, clamped to each type's cap (so a low-cap type
   *  like batteries never starts over-full). The fight then runs on this + what the floor boxes top up. */
  private seedReserves(): void {
    for (const [type, max] of Object.entries(AMMO_MAX)) {
      this.reserve.set(type, Math.min(max, RESERVE_START));
    }
  }

  /** The active zone's floor height at a map point — see {@link floorOn}. */
  private floorAt(x: number, y: number): number {
    return this.floorOn(this.level, this.map, x, y);
  }

  /** The floor height at a map point (its sub-sector's `floorZ`, pristine — never the animated door ceiling) —
   *  seats each entity on whatever sector it sits on (the badge on the +1.6 dais, the exit in the −0.8 atrium). */
  private floorOn(level: Level, map: CompiledMap, x: number, y: number): number {
    return level.map.sectors[locateSubSector(map.root, x, y).sector].floorZ;
  }

  /** Place the active zone's floor pickups + the legacy exit marker — the pure {@link buildPickups}, seated on
   *  the active level's floor. */
  private spawnPickups(): void {
    const built = buildPickups(this.level, this.zoneSnap, (x, y) =>
      this.floorOn(this.level, this.map, x, y),
    );

    this.vitals = built.vitals;
    this.ammoBoxes = built.ammoBoxes;
    this.keycards = built.keycards;
    this.weaponPickups = built.weaponPickups;
    this.exit = built.exit;
  }

  /** Spin the ammo boxes + collect any pickup the player overlaps: coffee/RAM refill health/armour (capped at
   *  VITAL_MAX), a box tops up its OWN ammo type's reserve (capped, KEPT if the type is already full), and a
   *  weapon pickup unlocks its weapon (see {@link collectWeapon}). */
  private stepPickups(dt: number): void {
    this.vitals = this.vitals.filter((v) => {
      v.age += dt; // advance the turntable spin whether or not it is collected
      if (Math.hypot(v.x - this.camera.x, v.y - this.camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      if (v.spec.kind === 'health') {
        this.hp = Math.min(VITAL_MAX, this.hp + v.spec.amount);
      } else {
        this.armor = Math.min(VITAL_MAX, this.armor + v.spec.amount);
      }
      this.pickupFx = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });

    this.ammoBoxes = this.ammoBoxes.filter((b) => {
      b.age += dt; // advance its spin clock whether or not it is collected

      if (INSPECT_PICKUPS) {
        return true; // TEMP: keep every box (spinning) so the ammo art can be inspected up close
      }
      const reserve = this.reserve.get(b.spec.ammoType) ?? 0;

      if (
        Math.hypot(b.x - this.camera.x, b.y - this.camera.y) >= PICKUP_RADIUS ||
        reserve >= b.spec.max
      ) {
        return true; // out of reach, or this type is already full → keep the box
      }
      this.reserve.set(b.spec.ammoType, Math.min(b.spec.max, reserve + b.spec.amount));
      this.pickupFx = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });

    this.weaponPickups = this.weaponPickups.filter((p) => {
      p.age += dt; // advance its (future) turntable spin whether or not it is collected
      if (Math.hypot(p.x - this.camera.x, p.y - this.camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      this.collectWeapon(p.spec); // always collectible — a repeat pickup is still an ammo top-up

      return false; // collected — drop it
    });

    this.stepObjective(dt);
  }

  /** Unlock a collected weapon (the DOOM progression): own it for the rest of the run, grant its starter
   *  ammo dose (ONE standard box of its type — {@link weaponAmmoDose} — capped at the reserve max), and
   *  AUTO-EQUIP it when it is a FIRST pickup into a strictly better arsenal position (finding a pistol
   *  while holding the shotgun never downgrades; a repeat pickup only tops the reserve up). */
  private collectWeapon(spec: WeaponPickupSpec): void {
    const index = ARSENAL.findIndex((weapon) => weapon.id === spec.id);
    const alreadyOwned = this.ownedWeapons.has(spec.id);

    this.ownedWeapons.add(spec.id);
    const dose = weaponAmmoDose(spec.ammoType);

    if (spec.ammoType !== null && dose > 0) {
      const held = this.reserve.get(spec.ammoType) ?? 0;

      this.reserve.set(spec.ammoType, Math.min(ammoTypeMax(spec.ammoType), held + dose));
    }
    if (shouldAutoEquip(alreadyOwned)) {
      this.selectWeapon(index);
    }
    this.pickupFx = PICKUP_FX_DURATION;
  }

  /** The level objective: spin + collect each access badge on proximity (→ the HUD card bay; each unlocks its
   *  colour-matched DOOR), and finish the level on reaching the exit. The badge gate is the locked door, so the
   *  exit itself just wins. */
  private stepObjective(dt: number): void {
    this.hint = Math.max(0, this.hint - dt);
    this.keycards = this.keycards.filter((k) => {
      k.age += dt; // advance the badge turntable spin whether or not it is collected
      if (Math.hypot(k.x - this.camera.x, k.y - this.camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      this.heldCards.add(k.spec.color);
      this.hud.addCard(k.spec.color); // light its card in the HUD bay
      this.pickupFx = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });
    // OPEN-BUILDING transition: walking into an `exits[]` point swaps the zone behind a short fade. The
    // arrival side stays LOCKED until the player has left every exit radius — no instant bounce-back
    // through the reciprocal exit next to the entry point.
    if (this.transition === null) {
      const inside = this.zoneExits.find(
        (e) => Math.hypot(e.x - this.camera.x, e.y - this.camera.y) < EXIT_RADIUS,
      );

      if (this.exitsLocked) {
        this.exitsLocked = inside !== undefined;
      } else if (inside !== undefined) {
        this.transition = { to: inside.to, entry: inside.entry, clock: 0, swapped: false };
        this.fireHeld = false;
      }
    }
    // The legacy single exit (levels outside the graph): reaching it wins, exactly as before.
    if (
      this.exit !== null &&
      Math.hypot(this.exit.x - this.camera.x, this.exit.y - this.camera.y) < EXIT_RADIUS
    ) {
      this.won = true;
      this.wonClock = 0;
      this.fireHeld = false;
    }
  }

  /** Set up the active zone's door(s) + sliding-door index — see {@link buildDoors}. Sliding glass doors
   *  always reset shut: they are proximity-driven and reopen on approach. */
  private spawnDoors(): void {
    this.doors = this.buildDoors(this.level, this.zoneSnap);
    this.applyDoors(this.doors, this.sectors); // stamp the current ceilZ now
    this.slides = this.level.map.linedefs.map(() => 0);
    this.indexSlidingDoors();
  }

  /** Build a zone's animated doors — badge-locked gates start shut, but a door the zone's snapshot
   *  remembers as opened comes back open (a permanent unlock survives leaving the floor). Shared by the
   *  active spawn and the warm-zone build. */
  private buildDoors(level: Level, snap: ZoneSnapshot | null): Door[] {
    return level.doors.map((d, i) => {
      const sector = level.map.sectors[d.sector];

      return {
        sector: d.sector,
        triggerX: d.triggerX,
        triggerY: d.triggerY,
        closedCeilZ: sector.floorZ, // shut → ceil meets floor → no headroom → blocked
        openCeilZ: sector.ceilZ, // the authored open ceiling
        requiresCard: d.requiresCard,
        openness: snap?.doors[i] ?? 0,
      };
    });
  }

  /** Index the active zone's sliding glass doors (line + trigger midpoint) for the proximity drive. */
  private indexSlidingDoors(): void {
    this.slidingDoors = [];
    this.level.map.linedefs.forEach((l, line) => {
      if (l.sliding === true) {
        const a = this.level.map.vertices[l.v1];
        const b = this.level.map.vertices[l.v2];

        this.slidingDoors.push({ line, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 });
      }
    });
  }

  /** Index the zone's graph exits (walk-into transition points), each seated on its floor for the marker. */
  private spawnExits(): void {
    this.zoneExits = (this.level.exits ?? []).map((e) => ({
      ...e,
      z: this.floorAt(e.x, e.y),
    }));
  }

  /**
   * Swap the live world to zone `key` — THE load path (initial URL level, every fade graph transition,
   * and the `fresh` restart; a passable-seam crossing takes the seamless {@link swapZones} path instead). It snapshots the zone being left into {@link zoneStates}, rebuilds every level-bound
   * structure from the registry, re-points the render workers at the new geometry (rebuilt in place — no
   * respawn, no leak), restores the target zone's snapshot (corpses stay down, taken pickups stay gone,
   * opened doors stay open), and places the player: at the named `entry`, else the dev spawn override
   * (URL level only), else the level spawn. Player inventory (hp / mental / ammo / arsenal / badges)
   * deliberately travels through untouched. `fresh` = a NEW GAME: the whole building resets first.
   */
  private loadZone(key: string, entry?: string, fresh = false): void {
    if (fresh) {
      zoneStates.reset();
      this.warm = null; // a NEW GAME: the warm world must not leak pre-reset state back into the store
    } else if (this.zoneKey !== '') {
      zoneStates.snapshot(this.zoneKey, this.captureZone()); // leaving — persist the visible world state
    }
    const zone = resolveZone(key, entry, this.params);

    this.zoneKey = zone.key;
    this.level = zone.level;
    this.zoneSnap = zoneStates.restore(zone.key);
    this.sectors = this.level.map.sectors.map((s) => ({ ...s }));
    this.mapSource = { ...this.level.map, sectors: this.sectors };
    this.map = buildBsp(this.mapSource);
    this.obstacles = mapObstacles(this.map);
    this.gatherNeighbors();
    this.gatherSeams();
    this.pool?.setMaps(this.zoneKey, this.mapSource, this.neighborSources); // the workers rebuild their BSPs in place (textures kept)
    this.targets = mapSprites(this.map).map((sprite, i) => ({
      sprite,
      alive: this.zoneSnap?.barrels[i] !== false, // popped barrels stay popped
    }));
    this.projectiles = [];
    this.enemyShots = [];
    this.impacts = [];
    this.arcs = [];
    this.enemies = [];
    this.mantle = null;
    this.spawnDoors();
    this.spawnExits();
    if (this.atlasesReady) {
      this.spawnEnemies();
      this.spawnPickups();
    } // else: the initial atlas decode spawns them (reading the same `zoneSnap`)
    this.camera.x = zone.at.x;
    this.camera.y = zone.at.y;
    this.camera.angle = zone.at.angle;
    this.camera.z = this.floorAt(zone.at.x, zone.at.y) + EYE_HEIGHT;
    this.camera.pitch = 0;
    this.exitsLocked = true; // re-arm only once the player has left the arrival-side exit radius
    this.refreshWarm(); // warm up the zone behind this map's passable seam (a fresh load = a fresh warm world)
  }

  /** Derive the current zone's LIVE-portal neighbor maps: every zone referenced by a `zonePortal` linedef,
   *  compiled lazily (once per session) off its registry geometry. See the fields' doc for the contract. */
  private gatherNeighbors(): void {
    const sources = new Map<string, MapSource>();
    const compiled = new Map<string, CompiledMap>();

    for (const line of this.mapSource.linedefs) {
      const zone = line.zonePortal?.zone;

      if (zone === undefined || sources.has(zone) || LEVELS[zone] === undefined) {
        continue;
      }
      let full = this.compiledZones.get(zone);

      if (full === undefined) {
        full = buildBsp(LEVELS[zone].map);
        this.compiledZones.set(zone, full);
      }
      sources.set(zone, full.source);
      compiled.set(zone, full);
    }
    this.neighborSources = sources;
    this.neighborMaps = compiled;
  }

  /** Pre-resolve the active map's PASSABLE seams (segment + outward normal + zone transform) for the
   *  per-frame crossing test. A seam naming an unknown zone stays a stage-2 window (never crossable). */
  private gatherSeams(): void {
    this.seams = [];
    for (const line of this.mapSource.linedefs) {
      const portal = line.zonePortal;

      if (!isPassableSeam(portal) || LEVELS[portal.zone] === undefined) {
        continue;
      }
      const a = this.mapSource.vertices[line.v1];
      const b = this.mapSource.vertices[line.v2];
      const len = Math.hypot(b.x - a.x, b.y - a.y);

      this.seams.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        len,
        nx: -(b.y - a.y) / len, // unit normal toward the seam's BACK side — out of the room, into `zone`
        ny: (b.x - a.x) / len,
        zone: portal.zone,
        dx: portal.dx,
        dy: portal.dy,
      });
    }
  }

  /** The render's neighbor channel for the main-thread fallback: the compiled registry maps, plus the
   *  warm zone's live sprites where a warm world exists (the workers assemble the same map per frame). */
  private zoneNeighbors(
    sprites: ReadonlyMap<string, readonly Sprite[]> | undefined,
  ): ReadonlyMap<string, ZoneNeighbor> {
    const out = new Map<string, ZoneNeighbor>();

    for (const [key, map] of this.neighborMaps) {
      out.set(key, { map, sprites: sprites?.get(key) });
    }

    return out;
  }

  /** (Re)build the WARM neighbor — the zone behind the active map's first passable seam, restored from its
   *  snapshot (corpses stay down, taken pickups stay gone) and simulated from now on. Any previous warm
   *  world is snapshotted first, so nothing it lived through is lost. One warm zone max, by design. */
  private refreshWarm(): void {
    if (this.warm !== null && this.warm.populated) {
      zoneStates.snapshot(this.warm.key, this.snapshotWorld(this.warm)); // a bare world has nothing to say
    }
    const seam = this.seams[0];

    this.warm = seam === undefined ? null : this.buildWarm(seam.zone);
    // Pre-compile every zone the WARM map's own seams look into (usually the reverse seam → the ACTIVE
    // zone itself), so a later crossing finds its render neighbors ready — the swap costs no BSP build.
    for (const line of this.warm?.mapSource.linedefs ?? []) {
      const zone = line.zonePortal?.zone;

      if (zone !== undefined && LEVELS[zone] !== undefined && !this.compiledZones.has(zone)) {
        this.compiledZones.set(zone, buildBsp(LEVELS[zone].map));
      }
    }
  }

  /** Build a zone's full live world in the background — `loadZone`'s twin for the WARM neighbor: its own
   *  mutable sectors + compiled BSP (so a crossing later adopts pointers, compiling nothing) and its
   *  snapshot-restored entities. Enemies/pickups need the decoded atlases; before that the world is bare
   *  geometry and the atlas callback's `refreshWarm` populates it. */
  private buildWarm(key: string): WarmZone {
    const zone = resolveZone(key, undefined, this.params); // respects ?noenemies= for every zone
    const snap = zoneStates.restore(zone.key);
    const sectors = zone.level.map.sectors.map((sec) => ({ ...sec }));
    const mapSource = { ...zone.level.map, sectors };
    const map = buildBsp(mapSource);
    const doors = this.buildDoors(zone.level, snap);
    const pickups = this.atlasesReady
      ? buildPickups(zone.level, snap, (x, y) => this.floorOn(zone.level, map, x, y))
      : { vitals: [], ammoBoxes: [], keycards: [], weaponPickups: [], exit: null };

    this.applyDoors(doors, sectors); // a remembered-open door is open for the warm sim's foes too

    return {
      key: zone.key,
      level: zone.level,
      populated: this.atlasesReady,
      sectors,
      mapSource,
      map,
      targets: mapSprites(map).map((sprite, i) => ({
        sprite,
        alive: snap?.barrels[i] !== false, // popped barrels stay popped
      })),
      enemies: this.atlasesReady ? this.buildEnemies(zone.level, map, snap) : [],
      enemyShots: [],
      doors,
      slides: zone.level.map.linedefs.map(() => 0), // sliding doors rest shut in a warm zone
      obstacles: mapObstacles(map),
      ...pickups,
    };
  }

  /** The ACTIVE zone's live world as a {@link WarmZone} — what a crossing demotes to the warm slot. */
  private captureWorld(): WarmZone {
    return {
      key: this.zoneKey,
      level: this.level,
      populated: this.atlasesReady,
      sectors: this.sectors,
      mapSource: this.mapSource,
      map: this.map,
      targets: this.targets,
      enemies: this.enemies,
      enemyShots: this.enemyShots,
      vitals: this.vitals,
      ammoBoxes: this.ammoBoxes,
      keycards: this.keycards,
      weaponPickups: this.weaponPickups,
      doors: this.doors,
      slides: this.slides,
      obstacles: this.obstacles,
      exit: this.exit,
    };
  }

  /** Adopt a live world as the ACTIVE zone — the seamless half of a crossing: every pointer swaps in place
   *  (nothing reloads, nothing respawns) and only the location-derived indexes are re-derived. */
  private adoptWorld(world: WarmZone): void {
    this.zoneKey = world.key;
    this.level = world.level;
    this.zoneSnap = null; // adoption IS the restore — the world arrives live
    this.sectors = world.sectors;
    this.mapSource = world.mapSource;
    this.map = world.map;
    this.obstacles = world.obstacles;
    this.targets = world.targets;
    this.enemies = world.enemies;
    this.enemyShots = world.enemyShots;
    this.vitals = world.vitals;
    this.ammoBoxes = world.ammoBoxes;
    this.keycards = world.keycards;
    this.weaponPickups = world.weaponPickups;
    this.doors = world.doors;
    this.slides = world.slides;
    this.exit = world.exit;
    this.indexSlidingDoors();
    this.spawnExits();
    this.gatherNeighbors();
    this.gatherSeams();
  }

  /** Does the movement step `from → to` cross a passable seam (front → back, within its span)? If so,
   *  perform the seamless zone swap and return true. The hysteresis lives in {@link swapZones}: the player
   *  lands ≥ SEAM_HYSTERESIS beyond the line, so grazing it can't oscillate. */
  private crossSeam(fromX: number, fromY: number, toX: number, toY: number): boolean {
    for (const seam of this.seams) {
      const beyond = seamCrossing(seam, fromX, fromY, toX, toY);

      if (beyond === null) {
        continue; // no front → back crossing within this seam's span
      }
      this.swapZones(seam, toX, toY, beyond);

      return true;
    }

    return false;
  }

  /**
   * The SEAMLESS zone swap — the crossing counterpart of `loadZone`, with no fade and no reload: the warm
   * world (already compiled + simulated) is ADOPTED as the active zone, the outgoing live world becomes the
   * new warm neighbor (the reverse portal), and the player is TRANSLATED by the seam's transform — heading,
   * pitch and eye height untouched, so the view continues exactly where the portal left off. The workers
   * just promote the neighbor map they already hold (see `RenderPool.swapTo`). Inventory travels untouched.
   */
  private swapZones(seam: SeamEdge, toX: number, toY: number, beyond: number): void {
    const t0 = performance.now();
    // Positional hysteresis: land at least SEAM_HYSTERESIS past the line, so a graze can't instantly re-cross.
    const { x, y } = seamHysteresisPush(toX, toY, seam.nx, seam.ny, beyond);

    zoneStates.snapshot(this.zoneKey, this.captureZone()); // bookkeeping (the WARM world keeps the live continuity)
    const outgoing = this.captureWorld(); // the old zone STAYS ALIVE — it becomes the warm neighbor
    const incoming =
      this.warm !== null && this.warm.key === seam.zone ? this.warm : this.buildWarm(seam.zone);

    this.adoptWorld(incoming);
    this.warm = outgoing;
    // Translate the player into the new zone's coordinates (a pure translation — the geometry both sides
    // of the seam is mirrored, so nothing on screen moves).
    this.camera.x = x - seam.dx;
    this.camera.y = y - seam.dy;
    // In-flight visuals follow the same translation (they age out in a blink); the player's own launched
    // shots are dropped — like enemies, projectiles never cross zones.
    this.projectiles = [];
    this.impacts = this.impacts.map((i) => ({ ...i, x: i.x - seam.dx, y: i.y - seam.dy }));
    this.arcs = this.arcs.map((a) => ({
      ...a,
      ax: a.ax - seam.dx,
      ay: a.ay - seam.dy,
      bx: a.bx - seam.dx,
      by: a.by - seam.dy,
    }));
    this.pool?.swapTo(this.zoneKey, this.neighborSources); // workers: promote the held map — no rebuild
    this.exitsLocked = true; // generic arrival guard for any walk-into exits the new zone may have
    console.info(
      `[bsp] seam swap ${outgoing.key} → ${this.zoneKey} in ${(performance.now() - t0).toFixed(2)} ms`,
    );
  }

  /** Capture everything the player could have VISIBLY changed in the ACTIVE zone — see {@link snapshotWorld}. */
  private captureZone(): ZoneSnapshot {
    return this.snapshotWorld(this.captureWorld());
  }

  /** Capture everything a zone's live world could have visibly changed — the acceptance test is "nothing
   *  respawns on return". Index-aligned with the level's authoring arrays (see {@link ZoneSnapshot}). */
  private snapshotWorld(world: WarmZone): ZoneSnapshot {
    return {
      enemies: world.level.enemies.map((spawn, i) => {
        const e = world.enemies[i]; // absent before the atlases decode — persist the authored roster untouched

        return e === undefined
          ? { x: spawn.x, y: spawn.y, hp: spawn.spec.hp, dead: false }
          : { x: e.x, y: e.y, hp: e.hp, dead: e.dying }; // dying-in-progress persists as a corpse
      }),
      barrels: world.targets.map((t) => t.alive),
      vitalsTaken: takenFlags(
        world.level.health.length + world.level.armor.length,
        world.vitals,
        this.atlasesReady,
      ),
      ammoTaken: takenFlags(world.level.ammo.length, world.ammoBoxes, this.atlasesReady),
      cardsTaken: takenFlags(world.level.keycards.length, world.keycards, this.atlasesReady),
      weaponsTaken: takenFlags(
        world.level.weapons?.length ?? 0,
        world.weaponPickups,
        this.atlasesReady,
      ),
      doors: world.doors.map((d) => d.openness),
    };
  }

  /** Advance the zone swap: fade to black over {@link ZONE_FADE}, swap the floor at black, fade back in. */
  private stepTransition(dt: number): void {
    const t = this.transition;

    if (t === null) {
      return;
    }
    t.clock += dt;
    if (!t.swapped && t.clock >= ZONE_FADE) {
      this.loadZone(t.to, t.entry);
      t.swapped = true;
    }
    if (t.clock >= 2 * ZONE_FADE) {
      this.transition = null;
    }
  }

  /** Drive each door's animation: a player in trigger range (holding the badge, for a locked door) opens it; a
   *  locked door with no badge just flashes the "badge requis" hint. Once open it stays open (a permanent unlock). */
  private stepDoors(dt: number): void {
    for (const door of this.doors) {
      const near =
        Math.hypot(door.triggerX - this.camera.x, door.triggerY - this.camera.y) <
        DOOR_TRIGGER_RADIUS;
      const mayOpen = door.requiresCard === null || this.heldCards.has(door.requiresCard);

      door.openness = stepDoorOpenness(door.openness, dt, near, mayOpen);
      if (near && !mayOpen && door.openness === 0) {
        this.hint = HINT_DURATION; // locked — the badge is needed
      }
    }
    this.applyDoors(this.doors, this.sectors);
    this.stepSliding(dt);
  }

  /** Sliding glass doors: proximity-driven + AUTO-CLOSING (a real automatic door). Each animates toward open
   *  when the player is within range and back toward shut when they leave; `this.slides` feeds render + physics. */
  private stepSliding(dt: number): void {
    for (const s of this.slidingDoors) {
      const near = Math.hypot(s.mx - this.camera.x, s.my - this.camera.y) < SLIDE_TRIGGER_RADIUS;

      this.slides[s.line] = stepSlideOpenness(this.slides[s.line], dt, near);
    }
  }

  /** Write each door's current ceilZ into a zone's live sector heights — the renderer + physics read these
   *  straight off `source.sectors` each frame, so a raised ceiling both shows AND becomes passable. */
  private applyDoors(doors: readonly Door[], sectors: MutableSector[]): void {
    for (const door of doors) {
      sectors[door.sector].ceilZ = doorCeilZ(door.closedCeilZ, door.openCeilZ, door.openness);
    }
  }

  /** The ACTIVE zone's {@link CombatFrame}: the live map/foes, the real player, the real hurt. */
  private activeFrame(): CombatFrame {
    return {
      map: this.map,
      slides: this.slides,
      obstacles: this.obstacles,
      enemies: this.enemies,
      shots: this.enemyShots,
      px: this.camera.x,
      py: this.camera.y,
      hurt: (dmg) => this.hurtPlayer(dmg),
    };
  }

  /** The active zone's {@link PlayerCombatFrame}: the live map/barrels/foes + shared projectile pool + the
   *  camera's firing pose, with the shell's side-effect callbacks (hurt a foe, queue an impact/arc, resolve a
   *  projectile kind's width). The pure hitscan / projectile steppers read + mutate the shared arrays. */
  private playerCombatFrame(): PlayerCombatFrame {
    return {
      map: this.map,
      slides: this.slides,
      targets: this.targets,
      enemies: this.enemies,
      projectiles: this.projectiles,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      cameraZ: this.camera.z,
      angle: this.camera.angle,
      vSlope: this.aimVerticalSlope(),
      hurtEnemy: (enemy, dmg) => this.hurtEnemy(enemy, dmg),
      addImpact: (kind, x, y, z) => this.spawnImpact(kind, x, y, z),
      addArc: (arc) => this.arcs.push(arc),
      projectileWidth,
    };
  }

  /** Keep the WARM neighbor alive: spin its pickups and run its enemy AI against the player's ghost —
   *  the camera translated into the warm zone's coordinates through the seam. Its foes think in THEIR
   *  map; the seam blocks their sight lines (and everything else), so nothing crosses until the player
   *  does — at which point this state is adopted as-is, positions and all. */
  private stepWarm(dt: number): void {
    const warm = this.warm;

    if (warm === null) {
      return;
    }
    for (const v of warm.vitals) {
      v.age += dt;
    }
    for (const b of warm.ammoBoxes) {
      b.age += dt;
    }
    for (const k of warm.keycards) {
      k.age += dt;
    }
    const seam = this.seams.find((s) => s.zone === warm.key);

    if (seam === undefined) {
      return; // no live seam into the warm zone (defensive — warm zones are seam-derived)
    }
    const frame: CombatFrame = {
      map: warm.map,
      slides: warm.slides,
      obstacles: warm.obstacles,
      enemies: warm.enemies,
      shots: warm.enemyShots,
      px: this.camera.x - seam.dx, // the player, in the warm zone's coordinates
      py: this.camera.y - seam.dy,
      hurt: () => undefined, // a warm foe can never truly reach the player across the seam
    };

    stepEnemies(frame, dt);
    stepEnemyShots(frame, dt);
  }

  /** A landed enemy strike: armour soaks a fraction of the hit (the rest drains hp), fire the red damage flash,
   *  make the HUD face react, and on hp 0 enter the game-over state. */
  private hurtPlayer(dmg: number): void {
    if (this.dead) {
      return;
    }
    const soak = Math.min(this.armor, Math.floor(dmg * ARMOR_ABSORB));

    this.armor -= soak;
    this.hp = Math.max(0, this.hp - (dmg - soak));
    this.hurtFx = HURT_FX_DURATION;
    this.hud.onHit();
    if (this.hp === 0) {
      this.die();
    }
  }

  /** hp hit 0: freeze the world under a game-over wash. A click after RESTART_DELAY runs {@link resetGame}. */
  private die(): void {
    this.dead = true;
    this.deadClock = 0;
    this.fireHeld = false;
  }

  /** Restart the run — a NEW GAME: restore vitals + the starting loadout, then reload the current zone
   *  `fresh` (the whole building's zone state resets, every enemy + pickup + door respawns). */
  private resetGame(): void {
    this.dead = false;
    this.deadClock = 0;
    this.won = false;
    this.wonClock = 0;
    this.transition = null;
    this.heldCards.clear();
    this.hint = 0;
    this.hud.clearCards();
    this.hp = 100;
    this.armor = 0;
    this.hurtFx = 0;
    this.pickupFx = 0;
    // Back to the FISTS-ONLY loadout: every picked-up weapon is lost with the run (its floor pickups
    // respawn with the fresh building below). The fist is ARSENAL[0], so the equip below stays owned.
    this.ownedWeapons.clear();
    for (const id of STARTING_WEAPON_IDS) {
      this.ownedWeapons.add(id);
    }
    this.weaponIndex = 0;
    this.weaponView = new WeaponView(
      ARSENAL[0],
      weaponViewConfig(ARSENAL[0]),
      reloadViewConfig(ARSENAL[0]),
    );
    ARSENAL.forEach((weapon, i) => (this.mag[i] = weapon.magSize ?? 0));
    this.seedReserves();
    this.loadZone(this.zoneKey, undefined, true); // fresh: resets the building + respawns everything
  }

  /** DEBUG stress mode (toggle G): ramp synthetic enemies and run a realistic per-frame AI cost — a line-of-
   *  sight `castRay` for EVERY enemy + a collision-aware chase + a projectile flux — to load-test the MAIN
   *  thread (where AI + projectile stepping live, serial, while the workers render in parallel). `aiMs` is
   *  measured so the telemetry separates the AI cost from the render cost. No-op until toggled. */
  private stepStress(dt: number): void {
    if (!this.stress) {
      return;
    }
    this.stressClock += dt;
    const want = Math.min(
      STRESS_MAX,
      STRESS_RAMP_STEP * (1 + Math.floor(this.stressClock / STRESS_RAMP_INTERVAL)),
    );

    while (this.stressEnemies.length < want) {
      this.stressEnemies.push({
        x: 1 + Math.random() * 13,
        y: 1 + Math.random() * 10,
        z: 0,
        cooldown: Math.random() * ENEMY_FIRE_INTERVAL,
      });
    }

    const t0 = performance.now();
    const reach = ENEMY_SPEED * dt;

    for (const e of this.stressEnemies) {
      const dx = this.camera.x - e.x;
      const dy = this.camera.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      // Line of sight = the per-enemy cost that scales the main thread. On LOS: chase (collision-aware) + fire.
      if (castRay(this.map, e.x, e.y, nx, ny, dist) === null) {
        const moved = movePlayer(
          this.map,
          e.x,
          e.y,
          nx * reach,
          ny * reach,
          PLAYER_RADIUS,
          STEP_MAX,
          HEADROOM,
          this.slides,
          false,
          this.obstacles,
        );

        e.x = moved.x;
        e.y = moved.y;
        e.z = moved.floorZ;
        e.cooldown -= dt;
        if (e.cooldown <= 0) {
          e.cooldown = ENEMY_FIRE_INTERVAL;
          this.fireEnemyShot(e.x, e.y, e.z, nx, ny);
        }
      }
    }
    this.aiMs = performance.now() - t0;
  }

  /** A synthetic enemy shot toward the player — reuses the player projectile system (stepped + collided each
   *  frame), so it loads `stepProjectiles`. Capped so a runaway flux can't lock the loop. */
  private fireEnemyShot(x: number, y: number, z: number, nx: number, ny: number): void {
    if (this.projectiles.length > 150) {
      return;
    }
    const width = projectileWidth('nail') ?? 0.45;

    this.projectiles.push({
      x,
      y,
      z: z + 1,
      dx: nx,
      dy: ny,
      vSlope: 0,
      speed: 7,
      kind: 'nail',
      impactKind: 'impact_metal',
      damage: 0, // debug stress shots don't damage the real enemies
      radius: width / 2,
      splashR: 0,
      chain: null,
      traveled: 0,
      alive: true,
    });
  }

  /** Apply `dmg` to a living enemy: flash it, and on hp ≤ 0 switch it to the death animation. The BSP-game's
   *  {@link PlayerCombatFrame} routes every foe hit (direct + splash) through here — the flash/kill timing
   *  stays in the shell, off the pure combat math. */
  private hurtEnemy(enemy: CombatEnemy, dmg: number): void {
    enemy.hp -= dmg;
    enemy.hitFlash = HIT_FLASH_DURATION;
    if (enemy.hp <= 0) {
      enemy.dying = true;
      enemy.deathTime = 0;
    }
  }

  /** Queue an impact burst (`kind` from `effects.json`) at a world point — drawn + aged out by the impact
   *  system. An empty kind (a weapon with no mapped impact) spawns nothing. */
  private spawnImpact(kind: string, x: number, y: number, z: number): void {
    if (kind !== '') {
      this.impacts.push({ kind, x, y, z, age: 0 });
    }
  }

  /** Vertical climb of the aim line per cell of forward depth, from the camera pitch (a screen y-shear): the
   *  crosshair points at `camera.z + slope·depth`, so looking up raises where a hitscan lands downrange. */
  private aimVerticalSlope(): number {
    const focal = this.config.width / 2 / Math.tan(this.config.fov / 2);

    return (this.camera.pitch * (this.config.height / 2)) / focal;
  }

  /** Advance + draw the held weapon. Mirrors the grid's three fire paths: the viewmodel is driven FIRST, then
   *  the fire edge it reports feeds the shared core {@link stepArsenal} (which spends the mag) — AUTO fires off
   *  the held trigger, SEMI on the swing's strike, CHARGE (the BFG) on the discharge after its spin-up. */
  private drawWeapon(dt: number, ctx: CanvasRenderingContext2D): void {
    // Mid-mantle, both hands are on the ledge: the two-handed climb pull REPLACES the weapon viewmodel for
    // the brief hoist. Drop any queued fire/reload edges so nothing discharges the instant the vault ends.
    if (this.mantle !== null) {
      this.drawClimb(ctx);
      this.fireEdge = false;
      this.reloadEdge = false;

      return;
    }
    const weapon = ARSENAL[this.weaponIndex];
    const combat = weaponCombat(weapon);
    const mode = weapon.fireMode ?? 'semi';
    const ammoType = combat.ammoType;
    const reserve = ammoType !== null ? (this.reserve.get(ammoType) ?? RESERVE_START) : 0;
    const mag = this.mag[this.weaponIndex];
    const ready = this.reloadClock <= 0;
    let fireIntent: boolean;

    if (mode === 'auto') {
      // Held trigger → continuous fire; the loop cadences the swing off the core's fireCooldown.
      const firing = this.fireHeld && (combat.magSize === 0 || (mag > 0 && ready));

      if (this.fireHeld && combat.magSize > 0 && !firing) {
        this.weaponView.dryFire(); // held but empty / mid-reload → a dry click, no loop
      }
      this.weaponView.setFiring(firing);
      this.weaponView.tick(dt);
      fireIntent = firing;
    } else {
      // SEMI / CHARGE: a press starts the swing (or the BFG spin-up, if not already engaged); the shot fires on
      // the strike / discharge edge `tick` reports — the BFG holds its charge frame for `chargeTime` first.
      const loaded = combat.magSize === 0 || (mag >= combat.ammoPerShot && ready);

      if (this.fireEdge && !(mode === 'charge' && this.weaponView.swinging())) {
        if (loaded) {
          this.weaponView.tryTrigger();
        } else if (combat.magSize > 0) {
          this.weaponView.dryFire();
        }
      }
      fireIntent = this.weaponView.tick(dt);
    }

    const result = stepArsenal(
      combat,
      { fireCooldown: this.fireCooldown, mag, reserve, reloadClock: this.reloadClock },
      { fire: fireIntent, reload: this.reloadEdge },
      dt,
    );

    this.fireCooldown = result.fireCooldown;
    this.mag[this.weaponIndex] = result.mag;
    this.reloadClock = result.reloadClock;
    if (ammoType !== null) {
      this.reserve.set(ammoType, result.reserve);
    }
    if (result.fired) {
      this.shotFx = SHOT_FX_DURATION; // muzzle flash either way
      fireWeapon(this.playerCombatFrame(), combat); // launch a projectile or resolve a hitscan
    }

    // The BFG's live green charge-buildup tint while spinning up, and a bright green flash on the discharge.
    this.chargeGlow = this.weaponView.charging()
      ? this.weaponView.chargeProgress() * CHARGE_GLOW_PEAK
      : 0;
    if (mode === 'charge' && result.fired) {
      this.dischargeFlash = 1;
    }
    this.fireEdge = false;
    this.reloadEdge = false;

    this.weaponView.setReloadProgress(
      combat.reloadTime > 0 && result.reloadClock > 0
        ? 1 - result.reloadClock / combat.reloadTime
        : null,
    );
    this.weaponView.draw(ctx, ctx.canvas.width, ctx.canvas.height, this.bob);
  }

  /** Draw the two-handed mantle pull mid-vault: project the ledge's top edge (world height `targetZ`) at
   *  arm's-reach depth to get its screen-Y, hold it in a visible band, and feed it + the hoist `progress` to
   *  {@link ClimbView}. As the camera rises past the lip the grip slides down it — the pull-up traction. */
  private drawClimb(ctx: CanvasRenderingContext2D): void {
    const m = this.mantle;

    if (m === null) {
      return;
    }
    const { width, height } = ctx.canvas;
    const focal = width / 2 / Math.tan(this.config.fov / 2);
    const horizon = height / 2 + this.camera.pitch * (height / 2);
    const rawLedgeY = horizon + ((this.camera.z - m.targetZ) * focal) / CLIMB_LEDGE_DEPTH;
    const ledgeY = Math.max(
      height * CLIMB_LEDGE_MIN,
      Math.min(height * CLIMB_LEDGE_MAX, rawLedgeY),
    );

    this.climbView.draw(ctx, width, height, m.progress, ledgeY);
  }

  /** Record one COMPLETED render (called per join, not per rAF): its cost + join-stall measurements feed
   *  the overlay averages, the telemetry beacon, and the ring's render columns until the next completion. */
  private recordRender(
    frameCost: number,
    stallMs: number,
    slowest: number,
    computeMs: number,
  ): void {
    this.lastRenderMs = frameCost;
    this.lastStallMs = stallMs;
    this.lastSlowest = slowest;
    this.lastComputeMs = computeMs;
    this.frameStats.record(frameCost, stallMs);
  }

  /** Per-rAF display bookkeeping: the ring row + the ~4×/second overlay/telemetry roll-up. The `fps`
   *  readout counts RENDERED frames (distinct images on screen — the honest visual rate now the rAF chain
   *  never blocks on the join); the delta column is the display cadence itself. */
  private measureDisplay(now: number): void {
    // Dev perf ring: one row per DISPLAY frame — the raw rAF-to-rAF delta (any pause shows — GC, layout,
    // a blocked main thread) + the LAST COMPLETED render's cost / straggler stall (which worker, how
    // late) / active worker count, duplicated across the rAFs it stays on screen (duration-weighted).
    // `n` counts total frames; the reader derives the ring window from it.
    if (this.perfRing !== null) {
      if (this.perfRingLast !== 0) {
        const i = this.perfRing.n % PERF_RING_SIZE;

        this.perfRing.delta[i] = now - this.perfRingLast;
        this.perfRing.render[i] = this.lastRenderMs;
        this.perfRing.stall[i] = this.lastStallMs;
        this.perfRing.slowest[i] = this.lastSlowest;
        this.perfRing.workers[i] = this.pool?.active ?? 1;
        this.perfRing.compute[i] = this.lastComputeMs;
        this.perfRing.n += 1;
      }
      this.perfRingLast = now;
    }

    // Roll the window up ~4×/second (the pure accumulator owns the timing + reset): push the distilled
    // fps / mean / max into the HUD signals and fire one perf beacon carrying the worst stall.
    const roll = this.frameStats.rollUp(now, FRAME_STATS_WINDOW_MS);

    if (roll !== null) {
      this.fps.set(roll.fps);
      if (roll.meanMs !== null) {
        this.frameMs.set(roll.meanMs);
      }
      this.frameMaxMs.set(roll.maxMs);
      this.logPerf(now, roll.stallMax);
    }
  }

  /** Fire-and-forget one telemetry sample to the dev server's /perf sink (localhost only). Uses `sendBeacon`
   *  so it never blocks or counts against the frame budget. The position + view + resolution let an offline
   *  reader correlate frame-time spikes with WHERE the player is and HOW it is being rendered. */
  private logPerf(now: number, stallMax: number): void {
    if (!this.perfLog || typeof navigator === 'undefined' || navigator.sendBeacon === undefined) {
      return;
    }
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const sample = {
      sid: this.perfSid,
      t: Math.round(now),
      fps: this.fps(),
      ms: this.frameMs(),
      max: this.frameMaxMs(),
      th: this.threads(),
      pool: this.poolSize(),
      stall: r2(stallMax), // worst join straggler stall in the window (ms)
      w: this.config.width,
      h: this.config.height,
      fs: typeof document !== 'undefined' && document.fullscreenElement !== null,
      x: r2(this.camera.x),
      y: r2(this.camera.y),
      z: r2(this.camera.z),
      a: r2(this.camera.angle),
      p: r2(this.camera.pitch),
      spr: this.targets.reduce((n, t) => n + (t.alive ? 1 : 0), 0),
      proj: this.projectiles.length,
      en: this.stressEnemies.length, // stress-mode enemy count → correlate frame time with load
      ai: Math.round(this.aiMs * 100) / 100, // per-frame AI cost (ms) → main-thread cost isolated from render
    };

    navigator.sendBeacon('/perf', JSON.stringify(sample));
  }
}
