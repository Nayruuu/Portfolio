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
  castFloorCeil,
  castRay,
  climbTarget,
  locateSubSector,
  mapSprites,
  movePlayer,
  nearestTargetHit,
  renderFrame,
  type Camera,
  type MapSource,
  type Sprite,
  type Target,
  type Texture,
} from '../../core/lib/bsp-engine';
import { M1_LOBBY as LEVEL } from './level-m1-lobby'; // M1 "Lobby / Accueil" — episode opener (WIP, built incrementally)
import {
  loadAtlasTexture,
  loadEnvTextures,
  proceduralTextures,
  projectileWidth,
} from './load-textures';
import { ENEMY_SPECS, type EnemySpec, type EnemyProjectile } from './enemies';
import {
  AMMO_BOX_SPECS,
  EXIT_RADIUS,
  EXIT_SPEC,
  keycardSpec,
  PICKUP_RADIUS,
  PICKUP_TEXTURE_JOBS,
  VITAL_MAX,
  vitalSpec,
  type AmmoBox,
  type Keycard,
  type MarkerSpec,
  type Vital,
} from './pickups';
import { createRenderPool } from './render-pool';
import { DoomHud, type Gaze } from '../../shared/game/doom-hud';
import {
  AMMO_MAX,
  ARSENAL,
  reloadViewConfig,
  weaponCombat,
  weaponViewConfig,
} from '../../shared/game/weapons';
import { WeaponView } from '../../shared/game/weapon-view';
import { ClimbView } from '../../shared/game/climb-view';
import { impactEffect, projectileEffect } from '../../shared/game/effects';
import { IconComponent } from '../../shared/icon/icon.component';
import {
  ARC_DURATION,
  stepArsenal,
  type ChainSpec,
  type KeycardColor,
  type WeaponCombat,
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

const PLAYER_RADIUS = 0.3;
const STEP_MAX = 1.1; // a step ≤ this is climbable
const HEADROOM = 0.8; // minimum sector clearance to pass through
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
const MAX_SHOT_RANGE = 40; // cells a launched projectile flies before it despawns (hitscan uses the weapon's range)
const MUZZLE_CLEAR = 1.5; // cells a shot clears before floor/ceiling collision — lets a steep shot off a raised platform clear its own lip instead of bursting at your feet (wider than a pedestal half-width)
const BARREL_HIT_RADIUS = 0.2; // the barrel's SOLID half-width (its art fills only the middle 50% of the 0.8 billboard)
const HIT_FLASH_DURATION = 0.12; // seconds an enemy flashes white after a hit (mirrors the grid)
const ENEMY_RECOIL = 0.18; // world units an enemy flinches UP at full hit-flash (the grid's recoil, in world z)
const ENEMY_SEP_DIST = 0.85; // min centre distance between two living enemies (separation, so they don't stack)
const STANDOFF_BAND = 0.25; // hysteresis around an enemy's standoff: hold within ±this, advance/retreat outside
const PLAYER_HIT_RADIUS = 0.45; // a thrown enemy projectile within this of the camera lands on the player
const HURT_FX_DURATION = 0.35; // seconds the player's red damage flash lingers after taking a hit
const PICKUP_FX_DURATION = 0.3; // seconds the player's green pickup flash lingers after collecting an item
const ARMOR_ABSORB = 1 / 3; // fraction of an incoming hit armour soaks (the rest hits health) — DOOM green armour
const RESERVE_START = 50; // starting reserve per ammo type at spawn (then clamped to each type's cap) — pickups top up
const RESTART_DELAY = 1.2; // seconds after death/win before a click restarts (lets the end feedback settle)
const HINT_DURATION = 1.8; // seconds a transient objective hint lingers (e.g. "badge requis" at a locked exit)
const INSPECT_PICKUPS: boolean = false; // when true, ammo boxes spin but are never collected (art-inspection mode)
const SPAWN_ENEMIES: boolean = true; // spawn the level's enemies (the live game in the player); /bsp shares the same scene
const DOOR_OPEN_SPEED = 2.2; // openness units/second (≈0.45s for a door to fully raise)
const DOOR_TRIGGER_RADIUS = 2.4; // approach this close to a door's trigger point to start it opening
const SLIDE_OPEN_SPEED = 4; // sliding-glass panel openness units/second (a snappy automatic door)
const SLIDE_TRIGGER_RADIUS = 4; // an automatic sliding door senses you as you approach (then it stays open)
const PROJECTILE_SPAWN_AHEAD = 0.25; // cells ahead of the camera a launched shot spawns — close, so it leaves from the gun
// Screen-space projectile painting, mirroring the grid's blitEffect so a shot reads as leaving the weapon:
const PROJECTILE_SCREEN_SCALE = 0.42; // on-screen height = this × effects size, relative to a same-distance wall
const PROJECTILE_MAX_HEIGHT_FRACTION = 0.28; // cap a close shot's height at this fraction of the canvas (no screen-fill)
const PROJECTILE_MAX_DROP_FRACTION = 0.28; // cap how far below the crosshair a close shot rides (toward the weapon)
const PROJECTILE_CROSSHAIR_BLEND = 2; // cells: within this a shot is pulled to the crosshair, so it leaves from centre
const SHOT_FX_DURATION = 0.09; // seconds the muzzle flash + impact spark linger after a shot
const IMPACT_SCREEN_SCALE = 0.9; // on-screen size of an impact burst vs a same-distance wall (mirrors the grid)
const IMPACT_MAX_HEIGHT_FRACTION = 0.5; // cap a point-blank burst at this fraction of the canvas height
// Adaptive internal render resolution: small when the canvas is embedded in the ~960px viewport (a near-free
// quality match, ~2× cheaper), full 1080p when it fills the screen in fullscreen (native, no upscale blur).
const WINDOWED_RENDER = { width: 1280, height: 720 } as const;
const FULLSCREEN_RENDER = { width: 1920, height: 1080 } as const;
const CHARGE_GLOW_PEAK = 0.7; // peak green charge-buildup tint at full BFG spin-up (mirrors the grid)
const CHARGE_FLASH_PEAK = 0.92; // peak green discharge flash opacity (near-blinding ultimate)
const CHARGE_FLASH_DECAY_PER_S = 3; // how fast the green discharge flash fades
const HUD_NATIVE_WIDTH = 2117; // x1.0 status-bar art width (biggest tier) — only the aspect source now
const HUD_NATIVE_HEIGHT = 404; // …its height, so the backing store keeps the bar's 5.24:1 aspect
const HUD_MAX_WIDTH = 1024; // cap the HUD backing store here → a cheap repaint even fullscreen (still crisp)
const GAZE_TURN_RATE = 0.6; // rad/s of turning before the HUD face glances aside
const GAZE_FAR_TURN_RATE = 2.5; // rad/s of turning for the extreme-glance face columns
// DEBUG stress mode (toggle G): a load test for the MAIN-THREAD budget under a real fight — synthetic enemies
// run a per-frame AI cost (line-of-sight castRay + collision chase) and fire projectiles, ramping in number.
const STRESS_MAX = 64; // peak synthetic enemies the ramp climbs to
const STRESS_RAMP_STEP = 8; // enemies added per ramp tick
const STRESS_RAMP_INTERVAL = 2; // seconds between ramp ticks
const ENEMY_SPEED = 2; // chase speed (world units / second)
const ENEMY_FIRE_INTERVAL = 1.5; // seconds between an enemy's shots while it can see the player

/** A projectile in flight: a 3D position + horizontal heading + speed, the effects `kind` that draws it, and
 *  its blast on impact. It flies along the firing pitch — `z` climbs by `vSlope` per cell travelled — so a
 *  shot aimed over a barrel sails past it. */
interface Projectile {
  x: number;
  y: number;
  z: number; // world height, climbing with `vSlope` as it flies (so the vertical aim carries through)
  readonly dx: number;
  readonly dy: number;
  readonly vSlope: number; // vertical climb per cell of horizontal travel (from the pitch at launch)
  readonly speed: number;
  readonly kind: string; // effects.json projectile kind → its sprite + drop + anchor at draw time
  readonly impactKind: string; // effects.json impact kind → the burst strip played where it lands
  readonly damage: number; // damage dealt to an enemy on a direct hit (and within the splash)
  readonly radius: number; // collision half-width (cells)
  readonly splashR: number;
  readonly chain: ChainSpec | null; // the plasma's chain-lightning rider (null = no chain)
  traveled: number;
  alive: boolean;
}

/** A short-lived impact burst at a world point: an `impacts` strip animation (`kind`) played once from `age`,
 *  billboarded at (`x`,`y`,`z`) and culled when the strip finishes. */
interface Impact {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  age: number;
}

/** A short-lived chain-lightning arc between two world points (their mid-body height), faded over its age. */
interface Arc {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  age: number;
}

/** A shootable billboard (a destructible barrel): its sprite + whether it is still standing. */
interface Barrel {
  readonly sprite: Sprite;
  alive: boolean;
}

/** A placed single-sprite floor marker (the exit sign). */
interface Marker {
  x: number;
  y: number;
  z: number;
  spec: MarkerSpec;
}

/** A locked DOOR — a sector whose `ceilZ` animates between closed (== its floor, impassable) and open. Approach
 *  the trigger point holding the matching badge (if `requiresCard`) to open it; once opened it stays open (an unlock). */
interface Door {
  readonly sector: number; // the door sector whose ceilZ animates
  readonly triggerX: number; // approach within DOOR_TRIGGER_RADIUS of this point to open
  readonly triggerY: number;
  readonly closedCeilZ: number; // ceilZ when shut (== floorZ → no headroom → physics blocks it)
  readonly openCeilZ: number; // ceilZ when fully open (the sector's authored ceiling)
  readonly requiresCard: KeycardColor | null; // the badge colour needed to open (null = no badge required)
  openness: number; // 0 shut .. 1 open
}

/** A thrower's projectile in flight: a spinning billboard that hurts the player on contact (dodgeable). */
interface EnemyShot {
  x: number;
  y: number;
  z: number;
  readonly dx: number;
  readonly dy: number;
  readonly proj: EnemyProjectile;
  traveled: number;
  alive: boolean;
}

/** A live or dying enemy instance: its `spec` (kind) + world pose + walk-anim travel, hp, the white hit-flash
 *  timer, the death timer (`dying` → death atlas, frozen on the last frame = a corpse), and the attack timers. */
interface Foe {
  readonly spec: EnemySpec;
  x: number;
  y: number;
  z: number;
  walkDist: number;
  hp: number;
  dying: boolean;
  deathTime: number;
  hitFlash: number;
  windup: number; // seconds left on a telegraphed attack wind-up (0 = not attacking)
  cooldown: number; // seconds until it can attack again
}

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
  protected readonly threads = signal(1); // render workers in use (1 = single-threaded fallback)

  // The played level (`LEVEL` — L1 "Hangar"). Its sectors
  // are cloned into a MUTABLE per-instance copy so an animated DOOR can raise/lower a sector's `ceilZ` live
  // (the renderer + physics read sector heights straight off `source.sectors` each frame — no recompile needed).
  private readonly sectors = LEVEL.map.sectors.map((s) => ({ ...s }));
  private readonly mapSource: MapSource = { ...LEVEL.map, sectors: this.sectors };
  private readonly map = buildBsp(this.mapSource);
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
  private readonly camera = {
    x: LEVEL.spawn.x,
    y: LEVEL.spawn.y,
    angle: LEVEL.spawn.angle,
    z: EYE_HEIGHT,
    pitch: 0,
  } satisfies Camera;
  // Shootable billboards: the map's static sprites, each a target a hitscan can cull (destructible barrels).
  private readonly targets: Barrel[] = mapSprites(this.map).map((sprite) => ({
    sprite,
    alive: true,
  }));
  private projectiles: Projectile[] = []; // launched shots in flight (projectile weapons), stepped each frame
  private arcs: Arc[] = []; // short-lived plasma chain-lightning visuals, aged out each frame
  private impacts: Impact[] = []; // burst-strip animations playing at hit points, aged out each frame
  private readonly impactImages = new Map<string, HTMLImageElement>(); // impact strip sheets, lazily decoded
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
  private readonly projectileImages = new Map<string, HTMLImageElement>(); // projectile sprite art, lazily decoded
  private readonly held = new Set<string>();
  private lastTime = 0;
  private frameId = 0;
  private tickStart = 0;
  private framesSinceTick = 0;
  private msAccum = 0;
  private msMax = 0; // worst single frame in the current window → the spike readout
  // Perf telemetry (localhost only — never in prod): a session id + whether to POST samples to the dev server's
  // /perf sink, so a play session can be read back + analysed offline instead of eyeballing the HUD.
  private readonly perfSid = typeof performance === 'undefined' ? 0 : Math.round(performance.now());
  private readonly perfLog =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  private readonly hud = new DoomHud();
  private hp = 100; // player health — drained by enemy strikes/blasts/clips, refilled by coffee pickups
  private armor = 0; // player armour — soaks a fraction of each hit, refilled by RAM-stick pickups
  private dead = false; // hp hit 0 → the world freezes under a game-over wash until a click restarts
  private deadClock = 0; // seconds since death (gates the restart + fades the game-over wash in)
  private pickupFx = 0; // seconds left on the green pickup flash (collected an item)
  private vitals: Vital[] = []; // health/armour pickups on the floor, collected on proximity
  private ammoBoxes: AmmoBox[] = []; // spinning ammo boxes on the floor, collected on proximity
  private keycards: Keycard[] = []; // spinning access badges on the floor, collected on proximity
  private readonly heldCards = new Set<KeycardColor>(); // badge colours collected → unlock the matching doors
  private exit: Marker | null = null; // the exit sign marker (the level goal)
  private won = false; // reached the exit → the level-complete wash, frozen until a click restarts
  private wonClock = 0; // seconds since the win (gates the restart + fades the wash in)
  private hint = 0; // seconds left on a transient HUD hint (e.g. "badge requis" at a locked door)
  private doors: Door[] = []; // animated doors (the badge-locked annex gate); their ceilZ is driven each frame
  private slides: number[] = []; // per-linedef sliding-door openness (0 shut … 1 retracted); fed to render + physics
  private slidingDoors: { readonly line: number; readonly mx: number; readonly my: number }[] = [];
  private prevAngle = 0; // last frame's camera angle → the turn rate that aims the HUD face's gaze
  private turnEMA = 0; // smoothed turn rate → a steady gaze through a turn (no per-frame repaint flicker)
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

    afterNextRender(() => {
      const context = this.canvas().nativeElement.getContext('2d');

      if (context === null) {
        return;
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
      this.spawnDoors(); // shut the badge-locked annex door from the first frame (before the loop starts)
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
        this.camera.pitch = Math.max(
          -PITCH_DOWN_MAX,
          Math.min(PITCH_UP_MAX, this.camera.pitch - event.movementY * MOUSE_SENS),
        );
      };

      const onResize = (): void => {
        // (The HUD backing store is sized by its ResizeObserver below; here we only queue the render resolution.)
        // Fullscreen → render at full 1080p (the canvas fills the screen); windowed → the cheaper res. Queue it
        // for the loop (a live rebuild mid-render would tear down the pool the frame is still painting into).
        const target = document.fullscreenElement !== null ? FULLSCREEN_RENDER : WINDOWED_RENDER;

        if (target.width !== this.config.width || target.height !== this.config.height) {
          pendingRes = { width: target.width, height: target.height };
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
          this.selectWeapon((this.weaponIndex + dir + ARSENAL.length) % ARSENAL.length);
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
      const pool = createRenderPool(this.config, this.mapSource);
      let disposed = false;

      this.threads.set(pool?.threads ?? 1);

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
      };

      const renderInto = (): Promise<void> => {
        const sprites = this.liveSprites(); // alive billboards this frame (a culled barrel drops out)
        // Capture the current pool + framebuffer: a resolution rebuild only swaps them between frames, so the
        // pair stays consistent for this render (and the locals keep the non-null narrowing in the callback).
        const activePool = pool;
        const activeImage = image;

        if (activePool !== null) {
          return activePool
            .render(this.camera, sprites, this.sectors, this.slides) // live sector heights + door slides → workers
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
        );

        return Promise.resolve();
      };

      const loop = (now: number): void => {
        if (pendingRes !== null) {
          applyResolution(pendingRes.width, pendingRes.height); // safe here: no render is in flight
          pendingRes = null;
        }
        const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (now - this.lastTime) / 1000);

        this.lastTime = now;
        this.advance(dt);

        const renderStart = performance.now();

        void renderInto().then(() => {
          if (disposed) {
            return;
          }
          context.putImageData(image, 0, 0);
          this.drawProjectiles(context);
          this.drawImpacts(context);
          this.drawArcs(context);
          this.drawWeapon(dt, context);
          this.drawHurtFx(context);
          this.drawPickupFx(context);
          this.drawChargeFx(context);
          this.drawCrosshair(context);
          this.drawHint(context);
          this.drawHud(dt);
          this.drawGameOver(context);
          this.drawWinScreen(context);
          this.measureFps(now, performance.now() - renderStart);
          this.frameId = requestAnimationFrame(loop);
        });
      };

      this.frameId = requestAnimationFrame(loop);

      // Decode the real environment textures off the served WebP and swap them in live (each worker, or the
      // main thread, reads the map each frame). A failed/SSR load leaves the procedural textures untouched.
      void loadEnvTextures().then((loaded) => {
        if (pool !== null) {
          pool.setTextures(loaded);
        } else {
          for (const [name, texture] of loaded) {
            this.textures.set(name, texture);
          }
        }
        this.texturesLoaded.set(loaded.size > 0);
      });

      // Decode every enemy's atlases (walk/death/attack/pain + a ranged thrower's spin strip) AND every pickup
      // sprite (vitals + spinning ammo strips), register them (main + workers), then spawn the enemies + pickups
      // (so they never flash the magenta MISSING texture).
      const atlasJobs = [
        ...ENEMY_SPECS.flatMap((s) => [
          { name: s.texName, url: s.atlasUrl, rows: s.walkRows },
          { name: s.deathTexName, url: s.deathUrl, rows: 1 },
          { name: s.attackTexName, url: s.attackUrl, rows: 1 },
          { name: s.painTexName, url: s.painUrl, rows: 1 },
          ...(s.thrower ? [{ name: s.thrower.texName, url: s.thrower.url, rows: 1 }] : []),
        ]),
        ...PICKUP_TEXTURE_JOBS.map((job) => ({ name: job.name, url: job.url, rows: 1 })),
      ];

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
          this.seedReserves();
          this.spawnEnemies();
          this.spawnPickups();
        },
      );

      destroyRef.onDestroy(() => {
        disposed = true;
        pool?.dispose();
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
    this.stepStress(dt); // DEBUG load test (no-op unless toggled) — runs before projectiles so its shots step now
    this.stepEnemies(dt); // real enemies chase / shoot / throw
    this.stepEnemyShots(dt); // throwers' projectiles fly at the player
    this.stepProjectiles(dt);
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
    const wantX = (cos * forward + sin * strafe) * reach;
    const wantY = (sin * forward - cos * strafe) * reach;
    const moved = movePlayer(
      this.map,
      fromX,
      fromY,
      wantX,
      wantY,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      this.slides,
    );

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
    const progress = m.progress + dt / MANTLE_DURATION;
    const stride = CLIMB_VAULT_ADVANCE * Math.min(dt / MANTLE_DURATION, 1 - m.progress);

    this.camera.x += m.dirX * stride;
    this.camera.y += m.dirY * stride;

    if (progress >= 1) {
      this.camera.z = m.targetZ + EYE_HEIGHT; // landed on the ledge
      this.mantle = null;
    } else {
      this.camera.z = m.startZ + (m.targetZ - m.startZ) * progress + EYE_HEIGHT;
      m.progress = progress;
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

  /** Switch to an arsenal slot (0-based) — rebuilds the viewmodel for the new weapon. */
  private selectWeapon(index: number): void {
    if (index < 0 || index >= ARSENAL.length || index === this.weaponIndex) {
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
   *  out). Projectiles are NOT here: they are painted screen-space over the frame by `drawProjectiles`. */
  private liveSprites(): Sprite[] {
    const sprites = this.targets.filter((t) => t.alive).map((t) => t.sprite);

    for (const e of this.enemies) {
      const s = e.spec;
      // The hit-flash decays over its duration (0→1 additive brighten); the body flinches UP with it. A dying
      // enemy carries no flash — the death animation owns its feedback.
      const flash = e.dying ? 0 : e.hitFlash / HIT_FLASH_DURATION;
      const base = {
        x: e.x,
        y: e.y,
        z: e.z + flash * ENEMY_RECOIL,
        width: s.worldHeight * s.aspect,
        height: s.worldHeight,
        flash,
      };

      if (e.dying) {
        // Death atlas (front-only strip): advance by deathTime, then freeze on the last frame — a corpse.
        const col = Math.min(s.deathFrames - 1, Math.floor(e.deathTime * s.deathFps));

        sprites.push({ ...base, tex: s.deathTexName, cols: s.deathFrames, rows: 1, col, row: 0 });
      } else if (e.windup > 0) {
        // Attack atlas (front-only): the wind-up animation plays once across the telegraph. Its cell may have a
        // different aspect than the walk cell, so override the billboard width for this state.
        const col = Math.min(s.attackFrames - 1, Math.floor((s.windup - e.windup) * s.attackFps));

        sprites.push({
          ...base,
          width: s.worldHeight * (s.attackAspect ?? s.aspect),
          tex: s.attackTexName,
          cols: s.attackFrames,
          rows: 1,
          col,
          row: 0,
        });
      } else if (e.hitFlash > 0) {
        // Pain: a single front-only flinch frame while the hit-flash lasts (priority: attack → pain → walk).
        sprites.push({ ...base, tex: s.painTexName, cols: 1, rows: 1, col: 0, row: 0 });
      } else {
        // Walk frame from cumulative travel (legs tied to motion); front row — a foe faces the player in combat.
        const col = Math.floor(e.walkDist * s.walkStepRate) % s.walkCols;

        sprites.push({ ...base, tex: s.texName, cols: s.walkCols, rows: s.walkRows, col, row: 0 });
      }
    }
    for (const shot of this.enemyShots) {
      // The thrown projectile: a spinning front strip billboard at its world point.
      const col = Math.floor(shot.traveled * shot.proj.spinRate) % shot.proj.frames;

      sprites.push({
        x: shot.x,
        y: shot.y,
        z: shot.z,
        tex: shot.proj.texName,
        width: shot.proj.worldHeight * shot.proj.aspect,
        height: shot.proj.worldHeight,
        cols: shot.proj.frames,
        rows: 1,
        col,
        row: 0,
      });
    }
    for (const v of this.vitals) {
      // A grounded vitals billboard (health medkit/plant · mental figurine/card) — a turntable when `spin`,
      // else a static frame-0 billboard; depth-occluded by the z-buffer pass.
      const col = v.spec.spin ? Math.floor(v.age / (v.spec.frameMs / 1000)) % v.spec.frames : 0;

      sprites.push({
        x: v.x,
        y: v.y,
        z: v.z,
        tex: v.spec.texName,
        width: v.spec.worldHeight * v.spec.aspect,
        height: v.spec.worldHeight,
        cols: v.spec.frames,
        rows: 1,
        col,
        row: 0,
      });
    }
    for (const b of this.ammoBoxes) {
      // A spinning ammo box: advance the turntable frame from its age (the quad never rotates).
      const col = Math.floor(b.age / (b.spec.frameMs / 1000)) % b.spec.frames;

      sprites.push({
        x: b.x,
        y: b.y,
        z: b.z,
        tex: b.spec.texName,
        width: b.spec.worldHeight * b.spec.aspect,
        height: b.spec.worldHeight,
        cols: b.spec.frames,
        rows: 1,
        col,
        row: 0,
      });
    }
    for (const k of this.keycards) {
      // A spinning access badge (blue employee / yellow manager / red director): advance its turntable frame
      // from its age (the quad never rotates) — mirrors the vitals/ammo turntables; drops once collected.
      const col = Math.floor(k.age / (k.spec.frameMs / 1000)) % k.spec.frames;

      sprites.push({
        x: k.x,
        y: k.y,
        z: k.z,
        tex: k.spec.texName,
        width: k.spec.worldHeight * k.spec.aspect,
        height: k.spec.worldHeight,
        cols: k.spec.frames,
        rows: 1,
        col,
        row: 0,
      });
    }
    if (this.exit !== null) {
      // The exit sign — a grounded single-frame billboard (the level goal).
      sprites.push({
        x: this.exit.x,
        y: this.exit.y,
        z: this.exit.z,
        tex: this.exit.spec.texName,
        width: this.exit.spec.worldHeight * this.exit.spec.aspect,
        height: this.exit.spec.worldHeight,
      });
    }
    for (const e of this.stressEnemies) {
      sprites.push({ x: e.x, y: e.y, z: e.z, tex: 'BARREL', width: 0.8, height: 1.7 }); // synthetic enemy billboard
    }

    return sprites;
  }

  /** Spawn the level's enemies (once the atlases have decoded) at their authored points, each seated on its
   *  sector floor: lobby Drones, a corridor Husk, a Guard on the badge dais, a Consultant in the atrium. */
  private spawnEnemies(): void {
    if (!SPAWN_ENEMIES) {
      return;
    }
    for (const { spec, x, y } of LEVEL.enemies) {
      this.enemies.push({
        spec,
        x,
        y,
        z: this.floorAt(x, y),
        walkDist: 0,
        hp: spec.hp,
        dying: false,
        deathTime: 0,
        hitFlash: 0,
        windup: 0,
        cooldown: 0,
      });
    }
  }

  /** Seed every ammo type's reserve at spawn — RESERVE_START, clamped to each type's cap (so a low-cap type
   *  like batteries never starts over-full). The fight then runs on this + what the floor boxes top up. */
  private seedReserves(): void {
    for (const [type, max] of Object.entries(AMMO_MAX)) {
      this.reserve.set(type, Math.min(max, RESERVE_START));
    }
  }

  /** The floor height at a map point (its sub-sector's `floorZ`, pristine — never the animated door ceiling) —
   *  seats each entity on whatever sector it sits on (the badge on the +1.6 dais, the exit in the −0.8 atrium). */
  private floorAt(x: number, y: number): number {
    return LEVEL.map.sectors[locateSubSector(this.map.root, x, y).sector].floorZ;
  }

  /** Place the level's floor pickups (coffee = health, RAM = armour, spinning boxes = ammo, spinning access
   *  badges) + the exit marker, each seated on its sector floor. Coordinates come from the level (`LEVEL`). */
  private spawnPickups(): void {
    this.vitals = [
      ...LEVEL.health.map(([x, y, size]) => ({
        spec: vitalSpec('health', size),
        x,
        y,
        z: this.floorAt(x, y),
        age: 0,
      })),
      ...LEVEL.armor.map(([x, y, size]) => ({
        spec: vitalSpec('armor', size),
        x,
        y,
        z: this.floorAt(x, y),
        age: 0,
      })),
    ];
    this.ammoBoxes = AMMO_BOX_SPECS.map((spec, i) => ({
      spec,
      x: LEVEL.ammo[i][0],
      y: LEVEL.ammo[i][1],
      z: this.floorAt(LEVEL.ammo[i][0], LEVEL.ammo[i][1]),
      age: 0,
    }));
    this.keycards = LEVEL.keycards.map(([x, y, color]) => ({
      spec: keycardSpec(color),
      x,
      y,
      z: this.floorAt(x, y),
      age: 0,
    }));
    const [ex, ey] = LEVEL.exit;

    this.exit = { spec: EXIT_SPEC, x: ex, y: ey, z: this.floorAt(ex, ey) };
  }

  /** Spin the ammo boxes + collect any pickup the player overlaps: coffee/RAM refill health/armour (capped at
   *  VITAL_MAX), a box tops up its OWN ammo type's reserve (capped, KEPT if the type is already full). */
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

    this.stepObjective(dt);
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
    if (
      this.exit !== null &&
      Math.hypot(this.exit.x - this.camera.x, this.exit.y - this.camera.y) < EXIT_RADIUS
    ) {
      this.won = true;
      this.wonClock = 0;
      this.fireHeld = false;
    }
  }

  /** Set up the level's door(s) and shut them — the badge-locked gate (`LEVEL.door`) between the lobby and
   *  the atrium, so the atrium + exit sit behind the badge: grab it on the dais, open this door, descend. */
  private spawnDoors(): void {
    this.doors = LEVEL.doors.map((d) => {
      const sector = LEVEL.map.sectors[d.sector];

      return {
        sector: d.sector,
        triggerX: d.triggerX,
        triggerY: d.triggerY,
        closedCeilZ: sector.floorZ, // shut → ceil meets floor → no headroom → blocked
        openCeilZ: sector.ceilZ, // the authored open ceiling
        requiresCard: d.requiresCard,
        openness: 0,
      };
    });
    this.applyDoors(); // stamp the shut ceilZ now

    // Sliding glass doors are proximity-driven + auto-closing; index them (line + midpoint) + reset openness.
    this.slides = LEVEL.map.linedefs.map(() => 0);
    this.slidingDoors = [];
    LEVEL.map.linedefs.forEach((l, line) => {
      if (l.sliding === true) {
        const a = LEVEL.map.vertices[l.v1];
        const b = LEVEL.map.vertices[l.v2];

        this.slidingDoors.push({ line, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 });
      }
    });
  }

  /** Drive each door's animation: a player in trigger range (holding the badge, for a locked door) opens it; a
   *  locked door with no badge just flashes the "badge requis" hint. Once open it stays open (a permanent unlock). */
  private stepDoors(dt: number): void {
    for (const door of this.doors) {
      const near =
        Math.hypot(door.triggerX - this.camera.x, door.triggerY - this.camera.y) <
        DOOR_TRIGGER_RADIUS;
      const mayOpen = door.requiresCard === null || this.heldCards.has(door.requiresCard);

      if (near && mayOpen) {
        door.openness = Math.min(1, door.openness + DOOR_OPEN_SPEED * dt);
      } else if (near && !mayOpen && door.openness === 0) {
        this.hint = HINT_DURATION; // locked — the badge is needed
      }
    }
    this.applyDoors();
    this.stepSliding(dt);
  }

  /** Sliding glass doors: proximity-driven + AUTO-CLOSING (a real automatic door). Each animates toward open
   *  when the player is within range and back toward shut when they leave; `this.slides` feeds render + physics. */
  private stepSliding(dt: number): void {
    const step = SLIDE_OPEN_SPEED * dt;

    for (const s of this.slidingDoors) {
      const target =
        Math.hypot(s.mx - this.camera.x, s.my - this.camera.y) < SLIDE_TRIGGER_RADIUS ? 1 : 0;

      this.slides[s.line] =
        target > this.slides[s.line]
          ? Math.min(target, this.slides[s.line] + step)
          : Math.max(target, this.slides[s.line] - step);
    }
  }

  /** Write each door's current ceilZ into the live sector heights — the renderer + physics read these straight
   *  off `source.sectors` each frame, so a raised ceiling both shows AND becomes passable. */
  private applyDoors(): void {
    for (const door of this.doors) {
      this.sectors[door.sector].ceilZ =
        door.closedCeilZ + (door.openCeilZ - door.closedCeilZ) * door.openness;
    }
  }

  /** Real-enemy AI (per-spec). With line of sight a foe holds at its `standoff` (a melee Husk in your face, a
   *  ranged Guard on a firing lane), and when ready TELEGRAPHS a wind-up (feet planted, attack animation); on
   *  release it lands a melee strike if in reach, else lobs a projectile. `walkDist` drives the walk frame. */
  private stepEnemies(dt: number): void {
    if (this.enemies.length === 0) {
      return;
    }

    for (const e of this.enemies) {
      e.hitFlash = Math.max(0, e.hitFlash - dt); // fade the white hit-flash
      e.cooldown = Math.max(0, e.cooldown - dt);

      if (e.dying) {
        e.deathTime += dt; // play the death animation, then freeze on its last frame (a corpse)

        continue;
      }
      const dx = this.camera.x - e.x;
      const dy = this.camera.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      const s = e.spec;

      if (e.windup > 0) {
        // Telegraphed attack: feet planted; on release → a melee strike if in reach, else a shotgun blast or a
        // thrown projectile (whichever the kind has).
        e.windup = Math.max(0, e.windup - dt);
        if (e.windup === 0) {
          if (s.meleeReach > 0 && dist <= s.meleeReach) {
            this.hurtPlayer(s.meleeDamage);
          } else if (s.shotgun !== undefined) {
            this.fireShotgun(e, nx, ny, dist);
          } else if (
            s.thrower !== undefined &&
            castRay(this.map, e.x, e.y, nx, ny, dist) === null
          ) {
            this.throwProjectile(e, nx, ny);
          }
          e.cooldown = s.cooldownTime;
        }

        continue;
      }
      if (castRay(this.map, e.x, e.y, nx, ny, dist) !== null) {
        continue; // no line of sight → idle (no wander yet)
      }
      const canMelee = s.meleeReach > 0 && dist <= s.meleeReach;
      const canShoot = s.shotgun !== undefined && dist <= s.shotgun.range;
      const canThrow = s.thrower !== undefined && dist <= s.thrower.range;

      if (e.cooldown === 0 && (canMelee || canShoot || canThrow)) {
        e.windup = s.windup; // ready + in range → start the telegraph
      } else if (dist > s.standoff + STANDOFF_BAND) {
        this.moveEnemy(e, nx, ny, dt); // close in toward the standoff
      } else if (dist < s.standoff - STANDOFF_BAND) {
        this.moveEnemy(e, -nx, -ny, dt); // crowded → ease back toward the lane
      }
    }
    this.separateEnemies();
  }

  /** Move one enemy by its speed along a unit direction (collision-aware), accumulating `walkDist` for the legs. */
  private moveEnemy(e: Foe, dirX: number, dirY: number, dt: number): void {
    const reach = e.spec.speed * dt;
    const moved = movePlayer(
      this.map,
      e.x,
      e.y,
      dirX * reach,
      dirY * reach,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      this.slides, // respect open sliding doors (else foes stay stuck behind them)
    );

    e.walkDist += Math.hypot(moved.x - e.x, moved.y - e.y);
    e.x = moved.x;
    e.y = moved.y;
    e.z = moved.floorZ;
  }

  /** Fire a shotgunner's blast: INSTANT (hitscan), no projectile — it connects if the player is still within
   *  range + line of sight at the moment of release (so backing out of range during the wind-up dodges it). The
   *  firing tell is the enemy's own attack animation. */
  private fireShotgun(e: Foe, nx: number, ny: number, dist: number): void {
    const gun = e.spec.shotgun;

    if (
      gun !== undefined &&
      dist <= gun.range &&
      castRay(this.map, e.x, e.y, nx, ny, dist) === null
    ) {
      this.hurtPlayer(gun.damage);
    }
  }

  /** Lob a thrower's projectile from its upper body toward the player (a flying, dodgeable spinning billboard). */
  private throwProjectile(e: Foe, nx: number, ny: number): void {
    if (e.spec.thrower === undefined || this.enemyShots.length > 60) {
      return;
    }
    this.enemyShots.push({
      x: e.x,
      y: e.y,
      z: e.z + e.spec.worldHeight * 0.6,
      dx: nx,
      dy: ny,
      proj: e.spec.thrower,
      traveled: 0,
      alive: true,
    });
  }

  /** Step the thrown projectiles: fly forward, hurt the player on contact, die on a wall or past range. */
  private stepEnemyShots(dt: number): void {
    for (const shot of this.enemyShots) {
      const step = shot.proj.speed * dt;

      if (castRay(this.map, shot.x, shot.y, shot.dx, shot.dy, step, true, this.slides) !== null) {
        shot.alive = false; // struck a wall (or glass / a shut sliding door)
        continue;
      }
      shot.x += shot.dx * step;
      shot.y += shot.dy * step;
      shot.traveled += step;

      if (Math.hypot(this.camera.x - shot.x, this.camera.y - shot.y) <= PLAYER_HIT_RADIUS) {
        this.hurtPlayer(shot.proj.damage);
        shot.alive = false;
      } else if (shot.traveled > shot.proj.range) {
        shot.alive = false;
      }
    }
    this.enemyShots = this.enemyShots.filter((shot) => shot.alive);
  }

  /** Keep living enemies from stacking: push apart every overlapping pair (circle-circle, symmetric), then
   *  apply each push through `movePlayer` so the nudge still respects walls. O(n²), fine for these counts. */
  private separateEnemies(): void {
    const n = this.enemies.length;

    if (n < 2) {
      return;
    }
    const push = this.enemies.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      if (this.enemies[i].dying) {
        continue;
      }
      for (let j = i + 1; j < n; j++) {
        const a = this.enemies[i];
        const b = this.enemies[j];

        if (b.dying) {
          continue;
        }
        const d = Math.hypot(b.x - a.x, b.y - a.y);

        if (d >= ENEMY_SEP_DIST) {
          continue;
        }
        const nx = d > 1e-4 ? (b.x - a.x) / d : 1; // exact overlap → split along an arbitrary axis
        const ny = d > 1e-4 ? (b.y - a.y) / d : 0;
        const amt = (ENEMY_SEP_DIST - d) * 0.5;

        push[i].x -= nx * amt;
        push[i].y -= ny * amt;
        push[j].x += nx * amt;
        push[j].y += ny * amt;
      }
    }
    for (let i = 0; i < n; i++) {
      const p = push[i];

      if (p.x === 0 && p.y === 0) {
        continue;
      }
      const e = this.enemies[i];
      const moved = movePlayer(
        this.map,
        e.x,
        e.y,
        p.x,
        p.y,
        PLAYER_RADIUS,
        STEP_MAX,
        HEADROOM,
        this.slides,
      );

      e.x = moved.x;
      e.y = moved.y;
      e.z = moved.floorZ;
    }
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

  /** Restart the fight: restore vitals + the starting loadout, reset the camera to spawn, and re-place every
   *  enemy + pickup (clearing all in-flight shots/effects). */
  private resetGame(): void {
    this.dead = false;
    this.deadClock = 0;
    this.won = false;
    this.wonClock = 0;
    this.heldCards.clear();
    this.hint = 0;
    this.hud.clearCards();
    this.hp = 100;
    this.armor = 0;
    this.hurtFx = 0;
    this.pickupFx = 0;
    this.camera.x = LEVEL.spawn.x;
    this.camera.y = LEVEL.spawn.y;
    this.camera.z = EYE_HEIGHT;
    this.camera.angle = LEVEL.spawn.angle;
    this.camera.pitch = 0;
    this.mantle = null;
    this.enemies = [];
    this.enemyShots = [];
    this.projectiles = [];
    this.impacts = [];
    this.arcs = [];
    this.weaponIndex = 0;
    this.weaponView = new WeaponView(
      ARSENAL[0],
      weaponViewConfig(ARSENAL[0]),
      reloadViewConfig(ARSENAL[0]),
    );
    ARSENAL.forEach((weapon, i) => (this.mag[i] = weapon.magSize ?? 0));
    this.seedReserves();
    this.spawnEnemies();
    this.spawnPickups();
    this.spawnDoors(); // re-shut the badge-locked door for the fresh run
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

  /** Fire the active weapon along the crosshair: a projectile weapon LAUNCHES a travelling shot (straight, no
   *  cone); every other kind resolves an instant hitscan ray widened by the weapon's `cone`. */
  private fire(combat: WeaponCombat): void {
    const dx = Math.cos(this.camera.angle);
    const dy = Math.sin(this.camera.angle);

    this.shotFx = SHOT_FX_DURATION; // muzzle flash either way

    if (combat.projectile !== null) {
      const width = projectileWidth(combat.projectile.kind);

      if (width !== undefined) {
        const vSlope = this.aimVerticalSlope(); // the firing pitch → the shot's vertical climb per cell

        this.projectiles.push({
          x: this.camera.x + dx * PROJECTILE_SPAWN_AHEAD, // close, so the shot leaves from the gun
          y: this.camera.y + dy * PROJECTILE_SPAWN_AHEAD,
          z: this.camera.z + vSlope * PROJECTILE_SPAWN_AHEAD, // on the aim line at the spawn point
          dx,
          dy,
          vSlope,
          speed: combat.projectile.speed,
          kind: combat.projectile.kind,
          impactKind: combat.impactKind,
          damage: combat.damage,
          radius: width / 2,
          splashR: combat.projectile.splashRadius,
          chain: combat.projectile.chain,
          traveled: 0,
          alive: true,
        });
      }

      return;
    }
    if (combat.pellets > 1) {
      this.fireSpread(combat); // a shotgun: a fan of pellets across the cone

      return;
    }
    this.resolveHitscan(dx, dy, combat.cone, combat.range, combat.impactKind, combat.damage);
  }

  /** A shotgun blast: `pellets` tight rays fanned evenly across ±`cone`, each culling the nearest barrel it
   *  crosses within range (mirrors the grid's `resolveSpread` — a centred barrel eats several pellets). */
  private fireSpread(combat: WeaponCombat): void {
    for (let pellet = 0; pellet < combat.pellets; pellet++) {
      const fraction = combat.pellets === 1 ? 0.5 : pellet / (combat.pellets - 1);
      const angle = this.camera.angle + (-combat.cone + 2 * combat.cone * fraction);

      this.resolveHitscan(
        Math.cos(angle),
        Math.sin(angle),
        0,
        combat.range,
        combat.impactKind,
        combat.damage,
      );
    }
  }

  /** Step every projectile forward, detonating on the first hittable (barrel OR enemy) or wall it reaches;
   *  a direct hit deals `damage`, then `detonate` does the splash + burst. Cull the spent ones. */
  private stepProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      const step = p.speed * dt;
      const wall = castRay(this.map, p.x, p.y, p.dx, p.dy, step, true, this.slides); // glass/shut door stops shots
      const reach = wall === null ? step : Math.min(step, wall.dist);
      // Floor/ceiling collision: a shot diving at the ground (or into a step that rises above it) bursts there
      // instead of sailing on under the world — capped by the wall, so it can't reach a floor behind a wall.
      // The muzzle grace (what's left of it after `traveled`) lets a shot off a platform clear its own lip.
      const ground = castFloorCeil(
        this.map,
        p.x,
        p.y,
        p.dx,
        p.dy,
        p.z,
        p.vSlope,
        reach,
        undefined,
        Math.max(0, MUZZLE_CLEAR - p.traveled),
      );
      const targetReach = ground === null ? reach : Math.min(reach, ground.dist);
      const hittables = this.hittables(p.radius); // inflate each target by the shot's radius
      const hit = nearestTargetHit(
        p.x,
        p.y,
        p.dx,
        p.dy,
        targetReach,
        hittables.map((h) => h.target),
        0,
        p.z, // the shot's current height — must fall within the target (a shot flying over it sails on)
        p.vSlope,
      );

      if (hit !== null) {
        const h = hittables[hit.index];

        h.hit(p.damage);
        this.detonate(h.x, h.y, h.z, p.splashR, p.damage, p.impactKind);
        if (p.chain !== null) {
          this.chainFrom(h.x, h.y, h.z, p.chain); // the plasma hops its beam between nearby barrels
        }
        p.alive = false;
      } else if (ground !== null) {
        this.detonate(ground.x, ground.y, ground.z, p.splashR, p.damage, p.impactKind); // burst on the floor/ceiling
        p.alive = false;
      } else if (wall !== null) {
        this.detonate(wall.x, wall.y, p.z, p.splashR, p.damage, p.impactKind); // burst where it struck the wall
        p.alive = false;
      } else {
        p.x += p.dx * step;
        p.y += p.dy * step;
        p.z += p.vSlope * step; // climb/descend along the firing pitch
        p.traveled += step;
        p.alive = p.traveled <= MAX_SHOT_RANGE; // spend it once it has flown its distance
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  /** The combat targets this frame: every standing barrel + every living enemy, as a {@link Target} for the ray
   *  test plus a `hit(dmg)` that applies the right damage (a barrel pops; an enemy loses hp / flashes / dies).
   *  `inflate` grows each silhouette by a projectile's radius. */
  private hittables(
    inflate = 0,
  ): { target: Target; x: number; y: number; z: number; hit: (dmg: number) => void }[] {
    const out: { target: Target; x: number; y: number; z: number; hit: (dmg: number) => void }[] =
      [];

    for (const b of this.targets) {
      if (!b.alive) {
        continue;
      }
      const s = b.sprite;

      out.push({
        target: {
          x: s.x,
          y: s.y,
          radius: BARREL_HIT_RADIUS + inflate,
          zMin: s.z - inflate,
          zMax: s.z + s.height + inflate,
        },
        x: s.x,
        y: s.y,
        z: s.z + s.height / 2,
        hit: () => (b.alive = false),
      });
    }
    for (const e of this.enemies) {
      if (e.dying) {
        continue;
      }
      out.push({
        target: {
          x: e.x,
          y: e.y,
          radius: e.spec.hitRadius + inflate,
          zMin: e.z - inflate,
          zMax: e.z + e.spec.worldHeight + inflate,
        },
        x: e.x,
        y: e.y,
        z: e.z + e.spec.worldHeight / 2,
        hit: (dmg) => this.hurtEnemy(e, dmg),
      });
    }

    return out;
  }

  /** Apply `dmg` to a living enemy: flash it, and on hp ≤ 0 switch it to the death animation. */
  private hurtEnemy(enemy: Foe, dmg: number): void {
    enemy.hp -= dmg;
    enemy.hitFlash = HIT_FLASH_DURATION;
    if (enemy.hp <= 0) {
      enemy.dying = true;
      enemy.deathTime = 0;
    }
  }

  /** Apply an AOE blast at `(x, y, z)`: barrels in `splashR` pop, enemies take `splashDmg`; then spawn the
   *  weapon's `kind` burst strip at the hit point. (A direct hit is dealt by the caller before this.) */
  private detonate(
    x: number,
    y: number,
    z: number,
    splashR: number,
    splashDmg: number,
    kind: string,
  ): void {
    if (splashR > 0) {
      for (const t of this.targets) {
        if (t.alive && Math.hypot(t.sprite.x - x, t.sprite.y - y) <= splashR) {
          t.alive = false;
        }
      }
      for (const e of this.enemies) {
        if (!e.dying && Math.hypot(e.x - x, e.y - y) <= splashR) {
          this.hurtEnemy(e, splashDmg);
        }
      }
    }
    this.spawnImpact(kind, x, y, z);
  }

  /** Queue an impact burst (`kind` from `effects.json`) at a world point — drawn + aged out by the impact
   *  system. An empty kind (a weapon with no mapped impact) spawns nothing. */
  private spawnImpact(kind: string, x: number, y: number, z: number): void {
    if (kind !== '') {
      this.impacts.push({ kind, x, y, z, age: 0 });
    }
  }

  /** The plasma's chain-lightning: from the hit point, hop to the nearest still-standing barrel within
   *  `range`, up to `targets` times — culling each and spawning a visual {@link Arc} between hits. */
  private chainFrom(fromXIn: number, fromYIn: number, fromZIn: number, chain: ChainSpec): void {
    let fromX = fromXIn;
    let fromY = fromYIn;
    let fromZ = fromZIn;

    for (let hop = 0; hop < chain.targets; hop++) {
      let nearest: Barrel | null = null;
      let nearestDist = chain.range;

      for (const t of this.targets) {
        if (!t.alive) {
          continue;
        }
        const dist = Math.hypot(t.sprite.x - fromX, t.sprite.y - fromY);

        if (dist <= nearestDist) {
          nearestDist = dist;
          nearest = t;
        }
      }
      if (nearest === null) {
        break; // no barrel left within reach
      }
      nearest.alive = false;
      const toZ = nearest.sprite.z + nearest.sprite.height / 2;

      this.arcs.push({
        ax: fromX,
        ay: fromY,
        az: fromZ,
        bx: nearest.sprite.x,
        by: nearest.sprite.y,
        bz: toZ,
        age: 0,
      });
      fromX = nearest.sprite.x;
      fromY = nearest.sprite.y;
      fromZ = toZ;
    }
  }

  /** Paint the in-flight projectiles SCREEN-SPACE, mirroring the grid's `blitEffect`: the sprite face-cameras
   *  at the shot's world point — projected at its actual HEIGHT `z` so it climbs/dives with the firing pitch —
   *  distance-scaled (height capped so a close shot doesn't fill the screen), pulled to the crosshair near the
   *  muzzle, and DROPPED below the aim line (depth-attenuated + capped) so it reads as leaving the weapon. No
   *  wall occlusion (a shot detonates on contact, so it is never behind the wall it heads for). */
  private drawProjectiles(ctx: CanvasRenderingContext2D): void {
    if (this.projectiles.length === 0) {
      return;
    }
    const { width, height, fov } = this.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + this.camera.pitch * (height / 2);
    const cos = Math.cos(this.camera.angle);
    const sin = Math.sin(this.camera.angle);
    // The gun's current walk-bob offset — near the muzzle a fresh shot is anchored to the SWAYING barrel tip
    // (centre + this), not the screen centre, so it leaves from where the weapon actually is.
    const sway = this.weaponView.bobOffset(height, this.bob);
    const muzzleX = width / 2 + sway.x;

    for (const p of this.projectiles) {
      const effect = projectileEffect(p.kind);
      const image = this.projectileImage(p.kind, effect?.sprite);

      if (effect === undefined || image === undefined) {
        continue; // unmapped kind or not decoded yet
      }
      const rx = p.x - this.camera.x;
      const ry = p.y - this.camera.y;
      const depth = rx * cos + ry * sin;

      if (depth <= 0.1) {
        continue; // behind the camera
      }
      const side = -rx * sin + ry * cos;
      const drawHeight = Math.min(
        (height / depth) * (PROJECTILE_SCREEN_SCALE * effect.size),
        height * (PROJECTILE_MAX_HEIGHT_FRACTION * effect.size),
      );
      const drawWidth = drawHeight * (effect.width / effect.height);
      const worldScreenX = width / 2 - (side / depth) * focal;
      const blend = Math.max(0, 1 - depth / PROJECTILE_CROSSHAIR_BLEND);
      const screenX = worldScreenX + (muzzleX - worldScreenX) * blend; // near the muzzle → the swaying barrel tip
      const left = screenX - drawWidth * effect.anchorX; // align the sprite's CONTENT centre to the firing line
      const drop = Math.min(height * PROJECTILE_MAX_DROP_FRACTION, (height * effect.drop) / depth);
      const centerY = horizon - ((p.z - this.camera.z) * focal) / depth; // the shot's actual height on screen

      ctx.drawImage(
        image,
        left,
        centerY - drawHeight / 2 + drop + sway.y * blend,
        drawWidth,
        drawHeight,
      );
    }
  }

  /** The decoded projectile sprite for a kind, lazily kicking off the load (one `Image` per kind, reused);
   *  `undefined` until it has decoded (SSR / first frames), where the caller simply draws nothing. */
  private projectileImage(kind: string, src: string | undefined): HTMLImageElement | undefined {
    if (src === undefined || typeof Image === 'undefined') {
      return undefined;
    }
    let image = this.projectileImages.get(kind);

    if (image === undefined) {
      image = new Image();
      image.src = src;
      this.projectileImages.set(kind, image);
    }

    return image.complete && image.naturalWidth > 0 ? image : undefined;
  }

  /** Paint each live impact as a WORLD billboard at its hit point: face-camera, distance-scaled, the strip
   *  cell chosen from the impact's `age`. Like the barrels it sits at a true world (x,y,z), so a burst on a
   *  far wall reads small and one on a near barrel large. Drawn on top of the scene (brief bright flashes). */
  private drawImpacts(ctx: CanvasRenderingContext2D): void {
    if (this.impacts.length === 0) {
      return;
    }
    const { width, height, fov } = this.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + this.camera.pitch * (height / 2);
    const cos = Math.cos(this.camera.angle);
    const sin = Math.sin(this.camera.angle);

    for (const impact of this.impacts) {
      const effect = impactEffect(impact.kind);
      const image = this.impactImage(impact.kind, effect?.sheet);

      if (effect === undefined || image === undefined) {
        continue; // unmapped kind or not decoded yet
      }
      const rx = impact.x - this.camera.x;
      const ry = impact.y - this.camera.y;
      const depth = rx * cos + ry * sin;

      if (depth <= 0.1) {
        continue; // behind the camera
      }
      const side = -rx * sin + ry * cos;
      const drawHeight = Math.min(
        (height / depth) * (IMPACT_SCREEN_SCALE * effect.size),
        height * IMPACT_MAX_HEIGHT_FRACTION,
      );
      const drawWidth = drawHeight * (effect.frameWidth / effect.frameHeight) * effect.widthScale;
      const screenX = width / 2 - (side / depth) * focal;
      const frame = Math.min(Math.floor(impact.age / effect.frameDuration_s), effect.frames - 1);
      const centerY = horizon - ((impact.z - this.camera.z) * focal) / depth;

      ctx.drawImage(
        image,
        frame * effect.frameWidth, // source cell — the strip frame for this age
        0,
        effect.frameWidth,
        effect.frameHeight,
        screenX - drawWidth / 2,
        centerY - drawHeight / 2,
        drawWidth,
        drawHeight,
      );
    }
  }

  /** The decoded impact strip sheet for a kind, lazily loaded (one `Image` per kind, reused); `undefined`
   *  until decoded (SSR / first frames), where the caller draws nothing. */
  private impactImage(kind: string, src: string | undefined): HTMLImageElement | undefined {
    if (src === undefined || typeof Image === 'undefined') {
      return undefined;
    }
    let image = this.impactImages.get(kind);

    if (image === undefined) {
      image = new Image();
      image.src = src;
      this.impactImages.set(kind, image);
    }

    return image.complete && image.naturalWidth > 0 ? image : undefined;
  }

  /** Draw the live chain-lightning arcs, each endpoint projected to the barrel's mid-body. Screen-space, no
   *  wall occlusion — they are brief bright flashes, so an arc crossing a wall edge is acceptable. */
  private drawArcs(ctx: CanvasRenderingContext2D): void {
    if (this.arcs.length === 0) {
      return;
    }
    const { width, height, fov } = this.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + this.camera.pitch * (height / 2);
    const cos = Math.cos(this.camera.angle);
    const sin = Math.sin(this.camera.angle);
    const project = (x: number, y: number, z: number): { sx: number; sy: number } | null => {
      const rx = x - this.camera.x;
      const ry = y - this.camera.y;
      const forward = rx * cos + ry * sin;

      if (forward <= 0.1) {
        return null; // behind the camera
      }
      const side = -rx * sin + ry * cos;

      return {
        sx: width / 2 - (side / forward) * focal,
        sy: horizon - ((z - this.camera.z) * focal) / forward,
      };
    };

    for (const arc of this.arcs) {
      const a = project(arc.ax, arc.ay, arc.az);
      const b = project(arc.bx, arc.by, arc.bz);

      if (a === null || b === null) {
        continue;
      }
      this.strokeArc(ctx, a.sx, a.sy, b.sx, b.sy, Math.max(0, 1 - arc.age / ARC_DURATION));
    }
  }

  /** Stroke one jagged blue lightning segment (a 3-segment polyline kinked at the thirds, a soft glow under a
   *  bright core, additive), faded by `fade`. Mirrors the grid's plasma arc. */
  private strokeArc(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    fade: number,
  ): void {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    const perpX = -dy / length;
    const perpY = dx / length;
    const jag = Math.min(22, length * 0.16); // perpendicular kink (px), capped on a long segment
    const firstX = ax + dx / 3 + perpX * jag;
    const firstY = ay + dy / 3 + perpY * jag;
    const secondX = ax + (dx * 2) / 3 - perpX * jag;
    const secondY = ay + (dy * 2) / 3 - perpY * jag;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(firstX, firstY);
    ctx.lineTo(secondX, secondY);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = '#2f6bff'; // outer blue glow
    ctx.globalAlpha = fade * 0.4;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#cfe0ff'; // bright inner core
    ctx.globalAlpha = fade * 0.9;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  /** Resolve an instant hitscan ray along `(dx, dy)`, capped at the weapon's `range` (so a fist reaches only
   *  as far as its reach) AND the first wall, culling the nearest barrel within `cone` — both horizontally and
   *  VERTICALLY (the aim line rises/falls with the pitch, so a shot over/under a barrel misses). Records a
   *  debug readout and returns whether it hit (so a shotgun blast can tally its pellets). */
  private resolveHitscan(
    dx: number,
    dy: number,
    cone: number,
    range: number,
    impactKind: string,
    damage: number,
  ): boolean {
    const vSlope = this.aimVerticalSlope(); // how much the aim line climbs per cell of depth (from the pitch)
    const wall = castRay(this.map, this.camera.x, this.camera.y, dx, dy, range);
    const reach = wall === null ? range : wall.dist;
    // The aim line can leave the room through the floor/ceiling before the wall — a downward shot sparks on the
    // ground, an upward one on the ceiling, rather than on a wall it never visually reaches. The muzzle grace
    // lets a steep shot off a raised platform clear its own lip instead of sparking at the shooter's feet.
    const ground = castFloorCeil(
      this.map,
      this.camera.x,
      this.camera.y,
      dx,
      dy,
      this.camera.z,
      vSlope,
      reach,
      undefined,
      MUZZLE_CLEAR,
    );
    const targetReach = ground === null ? reach : Math.min(reach, ground.dist);
    const hittables = this.hittables();
    const hit = nearestTargetHit(
      this.camera.x,
      this.camera.y,
      dx,
      dy,
      targetReach,
      hittables.map((h) => h.target),
      cone,
      this.camera.z,
      vSlope,
    );

    if (hit !== null) {
      const h = hittables[hit.index];

      h.hit(damage);
      this.spawnImpact(impactKind, h.x, h.y, h.z);
    } else if (ground !== null) {
      this.spawnImpact(impactKind, ground.x, ground.y, ground.z); // sparks on the floor/ceiling
    } else if (wall !== null) {
      this.spawnImpact(impactKind, wall.x, wall.y, this.camera.z + vSlope * reach); // sparks on the wall
    }

    return hit !== null;
  }

  /** Vertical climb of the aim line per cell of forward depth, from the camera pitch (a screen y-shear): the
   *  crosshair points at `camera.z + slope·depth`, so looking up raises where a hitscan lands downrange. */
  private aimVerticalSlope(): number {
    const focal = this.config.width / 2 / Math.tan(this.config.fov / 2);

    return (this.camera.pitch * (this.config.height / 2)) / focal;
  }

  /** The centre reticle (always on) + a muzzle flash / impact spark while a shot is fresh + a debug readout. */
  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    const fx = this.shotFx / SHOT_FX_DURATION; // 1 → 0 over the flash (0 when idle)
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
      this.fire(combat); // the strike/discharge landed → launch a projectile or resolve a hitscan
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

  /** A red full-screen wash when the player just took a hit, fading over HURT_FX_DURATION (the grid's hurt flash). */
  private drawHurtFx(ctx: CanvasRenderingContext2D): void {
    if (this.hurtFx <= 0) {
      return;
    }
    ctx.save();
    ctx.fillStyle = `rgba(190, 0, 0, ${0.45 * (this.hurtFx / HURT_FX_DURATION)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** A brief faint-green wash when the player collects a pickup (the inverse of the red hurt flash). */
  private drawPickupFx(ctx: CanvasRenderingContext2D): void {
    if (this.pickupFx <= 0) {
      return;
    }
    ctx.save();
    ctx.fillStyle = `rgba(70, 230, 120, ${0.22 * (this.pickupFx / PICKUP_FX_DURATION)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** The game-over screen: a dark wash that fades in over the frozen scene + the satirical "you're fired"
   *  title, then a pulsing restart prompt once a click can restart (after RESTART_DELAY). */
  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    if (!this.dead) {
      return;
    }
    const { width, height } = ctx.canvas;

    ctx.save();
    ctx.fillStyle = `rgba(8, 0, 0, ${Math.min(0.72, this.deadClock * 0.9)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d23b2e';
    ctx.font = `900 ${Math.round(height * 0.12)}px system-ui, sans-serif`;
    ctx.fillText('VOUS ÊTES VIRÉ', width / 2, height * 0.42);
    if (this.deadClock >= RESTART_DELAY) {
      // a slow blink so the prompt reads as interactive
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.deadClock * 3));
      ctx.fillStyle = '#e8e2d2';
      ctx.font = `600 ${Math.round(height * 0.038)}px system-ui, sans-serif`;
      ctx.fillText('Cliquez pour repointer', width / 2, height * 0.56);
    }
    ctx.restore();
  }

  /** The level-complete screen: a dark-green wash fading in over the frozen scene + the "mission accomplished"
   *  title, then a pulsing restart prompt once a click can restart (after RESTART_DELAY). The win twin of
   *  {@link drawGameOver}. */
  private drawWinScreen(ctx: CanvasRenderingContext2D): void {
    if (!this.won) {
      return;
    }
    const { width, height } = ctx.canvas;

    ctx.save();
    ctx.fillStyle = `rgba(0, 14, 6, ${Math.min(0.72, this.wonClock * 0.9)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#39d27a';
    ctx.font = `900 ${Math.round(height * 0.1)}px system-ui, sans-serif`;
    ctx.fillText('SORTIE ATTEINTE', width / 2, height * 0.42);
    if (this.wonClock >= RESTART_DELAY) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.wonClock * 3));
      ctx.fillStyle = '#e8e2d2';
      ctx.font = `600 ${Math.round(height * 0.038)}px system-ui, sans-serif`;
      ctx.fillText('Cliquez pour rejouer', width / 2, height * 0.56);
    }
    ctx.restore();
  }

  /** A transient objective hint near the centre (e.g. "BADGE REQUIS" at a locked exit), fading over its life. */
  private drawHint(ctx: CanvasRenderingContext2D): void {
    if (this.hint <= 0) {
      return;
    }
    const { width, height } = ctx.canvas;

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.hint / 0.4); // hold, then fade out over the last 0.4s
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcf4d';
    ctx.font = `800 ${Math.round(height * 0.045)}px system-ui, sans-serif`;
    ctx.fillText('BADGE REQUIS', width / 2, height * 0.7);
    ctx.restore();
  }

  /** The BFG's green screen tint: the live charge-buildup while it spins up, and a decaying flash on the
   *  discharge — a full-frame green wash (mirrors the grid's `chargeGlow` + green discharge flash). */
  private drawChargeFx(ctx: CanvasRenderingContext2D): void {
    const alpha = Math.max(this.chargeGlow, this.dischargeFlash * CHARGE_FLASH_PEAK);

    if (alpha <= 0) {
      return;
    }
    ctx.save();
    ctx.fillStyle = `rgba(60, 255, 90, ${alpha})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** Push the player state into the DOOM status bar + repaint it onto its own canvas over the 3D frame:
   *  health, armour (the "mental" bay), the active weapon's ammo + icon, and the owned-weapon arms row. */
  private drawHud(dt: number): void {
    const weapon = ARSENAL[this.weaponIndex];
    // Ammo readout: a magazine weapon shows "loaded / reserve" (e.g. 1/50); a flat-pool weapon shows that
    // reserve; a melee weapon passes `null` so the bay draws the icon only (mirrors the grid's `syncHud`).
    const ammoType = weapon.ammoType;
    const reserve = ammoType !== null ? (this.reserve.get(ammoType) ?? 0) : 0;

    this.hud.setHealth(this.hp);
    this.hud.setMental(this.armor);
    if (weapon.magSize) {
      this.hud.setAmmo(this.mag[this.weaponIndex], reserve);
    } else if (ammoType !== null) {
      this.hud.setAmmo(reserve);
    } else {
      this.hud.setAmmo(null);
    }
    // Light the arms row by ARSENAL POSITION (1..8 = the number key that selects it), not the DOOM `slot`:
    // the fist + chainsaw share slot 1, so a slot-based row left "8" permanently grey and misaligned the
    // numbers with the keys (key 2 = chainsaw, not the slot-2 weapon). All eight are always owned in the demo.
    this.hud.setArms(ARSENAL.map((_, index) => index + 1));
    this.hud.setWeapon(this.weaponView.icon() ?? null);

    const turnRate = dt > 0 ? -(this.camera.angle - this.prevAngle) / dt : 0; // + = turning right

    this.prevAngle = this.camera.angle;
    this.turnEMA += (turnRate - this.turnEMA) * Math.min(1, 8 * dt); // smooth → the gaze holds steady mid-turn
    this.hud.lookAt(this.gazeForTurn(this.turnEMA));
    this.hud.render(this.hudCanvas().nativeElement, dt);
  }

  /** Map a signed turn rate (rad/s, + = turning right) to a HUD gaze: centre below GAZE_TURN_RATE, then a
   *  near or extreme glance toward the turn — the classic DOOM face that looks where you swing. */
  private gazeForTurn(turnRate: number): Gaze {
    const speed = Math.abs(turnRate);

    if (speed < GAZE_TURN_RATE) {
      return 0;
    }
    const far = speed >= GAZE_FAR_TURN_RATE ? 2 : 1;

    return (turnRate > 0 ? far : -far) as Gaze;
  }

  /** Roll up the achieved frame rate + average render cost, published ~4×/second (not every frame). */
  private measureFps(now: number, frameCost: number): void {
    this.framesSinceTick += 1;
    this.msAccum += frameCost;
    this.msMax = Math.max(this.msMax, frameCost);

    if (this.tickStart === 0) {
      this.tickStart = now;
    } else if (now - this.tickStart >= 250) {
      this.fps.set(Math.round((this.framesSinceTick * 1000) / (now - this.tickStart)));
      this.frameMs.set(Math.round((this.msAccum / this.framesSinceTick) * 10) / 10);
      this.frameMaxMs.set(Math.round(this.msMax * 10) / 10);
      this.logPerf(now);
      this.framesSinceTick = 0;
      this.msAccum = 0;
      this.msMax = 0;
      this.tickStart = now;
    }
  }

  /** Fire-and-forget one telemetry sample to the dev server's /perf sink (localhost only). Uses `sendBeacon`
   *  so it never blocks or counts against the frame budget. The position + view + resolution let an offline
   *  reader correlate frame-time spikes with WHERE the player is and HOW it is being rendered. */
  private logPerf(now: number): void {
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
