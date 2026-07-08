import {
  buildBsp,
  isPassableSeam,
  locateSubSector,
  mapObstacles,
  mapSprites,
  seamCrossing,
  seamHysteresisPush,
  type Camera,
  type CompiledMap,
  type MapSource,
  type MutableSector,
  type Sprite,
  type ZoneNeighbor,
} from '../../../core/lib/bsp-engine';
import {
  doorCeilZ,
  LEVELS,
  resolveZone,
  stepEnemies,
  stepEnemyShots,
  zoneStates,
  type CombatFrame,
  type Level,
  type LevelParams,
  type ZoneLoad,
  type ZoneSnapshot,
} from '../../../core/lib';
import { buildPickups, takenFlags } from '../pickups';
import type { Foe } from '../enemy-runtime';
import type { Door, SeamEdge, SlidingDoor, WarmZone, ZoneExit } from '../zone-world';

/** Camera eye height above the floor — the world-vs-camera constant the runtime seats the player at on every
 *  load; the component reads it too (the eased step-up + the mantle hoist stand the eye this far off a floor). */
export const EYE_HEIGHT = 1.4;

/** Seconds each side of a FADE zone swap (fade to black, load the new floor at black, fade back in). The
 *  runtime drives the clock; the component's overlay painter reads it to draw the wash. */
export const ZONE_FADE = 0.35;

/** Spawn each level's enemy roster (the live game). A single lever mirrored from the component's old flag —
 *  flip to strip every zone's foes for an art-inspection capture without touching the runtime otherwise. */
const SPAWN_ENEMIES = true;

/** The empty pickup bundle a bare (pre-atlas) world carries — no floor items until the atlases decode. */
function emptyPickups(): Pick<
  WarmZone,
  'vitals' | 'ammoBoxes' | 'keycards' | 'weaponPickups' | 'exit'
> {
  return { vitals: [], ammoBoxes: [], keycards: [], weaponPickups: [], exit: null };
}

/** The between-frames + shared-state seams the runtime needs but does NOT own. The pool + GPU still live on
 *  the component (RenderHost is a later slice), so a geometry change is announced via callbacks the component
 *  actuates in its own no-render-in-flight window; the CAMERA is passed by reference (the runtime places +
 *  translates it, the component reads + turns it); the component's own transient FX are reset/translated on a
 *  zone change (they are not world state, so the runtime signals rather than reaches into them). */
/** A MUTABLE view of the engine's readonly {@link Camera} — the shared camera the runtime writes in place
 *  (placing the player on a load, translating it across a seam) while the renderer reads it as a `Camera`. */
export type MutableCamera = { -readonly [K in keyof Camera]-?: Camera[K] };

export interface ZoneRuntimeHooks {
  /** The shared player camera — the runtime writes its pose on a load/swap; never copied. */
  readonly camera: MutableCamera;
  /** The dev URL params — shape the initial load + honor `?noenemies=` for every zone the runtime resolves. */
  readonly params: LevelParams;
  /** A zone LOAD changed the primary geometry — the component re-points the render pool (`pool.setMaps`). */
  onGeometryLoaded(key: string, source: MapSource, neighbors: ReadonlyMap<string, MapSource>): void;
  /** A seam CROSSING swapped the primary — the component promotes the held map (`pool.swapTo`). */
  onSeamSwap(key: string, neighbors: ReadonlyMap<string, MapSource>): void;
  /** A load rebuilt the world — the component drops its transient FX (projectiles / impacts / arcs / mantle). */
  onZoneReset(): void;
  /** A seam crossing translated the player by (`dx`,`dy`) — the component drops projectiles and shifts its
   *  in-flight impacts/arcs into the new zone's coordinates (they age out in a blink). */
  onSeamTranslate(dx: number, dy: number): void;
}

/**
 * The WORLD-OWNERSHIP boundary of the BSP game: it owns the reified active {@link WarmZone GameWorld} (the
 * floor the player stands in), the one WARM neighbor kept alive behind a passable seam, and every level-bound
 * structure a floor bundles — sectors, compiled BSP, entities, doors, seams, exits. The component is the
 * coordinator: it reads `runtime.world.*` by reference for render/combat/physics and drives the lifecycle
 * (`loadZone`, `crossSeam`, `stepTransition`, `stepWarm`) from its frame loop, wiring the pool + camera +
 * atlas seams through {@link ZoneRuntimeHooks}.
 *
 * The KEY move: the active world is the SAME `WarmZone` shape as the warm neighbor, so a seamless crossing is
 * a pointer SWAP (active ⇄ warm) plus a re-derive of the location-only indexes — capturing/adopting collapse
 * to `this.activeWorld = …`. A FADE transition and a fresh restart run the full {@link loadZone} rebuild.
 */
export class ZoneRuntime {
  // The active floor's live world — assigned by the mandatory first `loadZone` (the component calls it in its
  // constructor before any accessor), so every later read sees a real world.
  private activeWorld!: WarmZone;
  // Guards the leaving-snapshot: false until the first load, so the very first `loadZone` has nothing to persist.
  private started = false;
  // The one warm neighbor behind the active map's first passable seam — simulated each frame, adopted on a
  // crossing. Null when the active map has no passable seam.
  private warmNeighbor: WarmZone | null = null;
  // The active zone's restored snapshot, consumed by the (possibly deferred) entity spawn.
  private zoneSnap: ZoneSnapshot | null = null;
  // Every zone compiled this session (primary + portal neighbors) — small maps, cached so a crossing/warm
  // build never recompiles a BSP it has already built.
  private readonly compiledZones = new Map<string, CompiledMap>();
  // The active map's LIVE-portal neighbors, re-derived each load: the render channel (compiled) + the worker
  // sources. Neighbors render their REGISTRY geometry; the LIFE behind a passable seam comes from the warm zone.
  private neighborCompiled: ReadonlyMap<string, CompiledMap> = new Map();
  private neighborSourceMap: ReadonlyMap<string, MapSource> = new Map();
  // The active map's PASSABLE seams (pre-resolved segments + transforms) — the per-frame crossing test.
  private seamEdges: SeamEdge[] = [];
  // The active zone's graph exits (walk-into fade transition points), each seated on its floor for the marker.
  private graphExits: ZoneExit[] = [];
  // The active zone's sliding glass doors (line + trigger midpoint) for the proximity drive.
  private slidingDoorIndex: SlidingDoor[] = [];
  // Arrival guard: exits re-arm only once the player has LEFT every exit radius (no instant bounce-back).
  private arrivalLocked = false;
  // Enemy/pickup atlases decoded → later loads spawn immediately; the initial (pre-decode) load spawns nothing
  // and the atlas callback flips this via `markAtlasesReady`, which populates the world in place.
  private atlasesDecoded = false;
  // The in-flight FADE zone swap (fade out → loadZone → fade in); null outside a transition.
  private pendingTransition: {
    readonly to: string;
    readonly entry: string;
    clock: number;
    swapped: boolean;
  } | null = null;

  constructor(private readonly hooks: ZoneRuntimeHooks) {}

  /** The active floor's live world — read by the component for render / combat / physics (by reference). */
  public get world(): WarmZone {
    return this.activeWorld;
  }

  /** The one warm neighbor behind the active map's passable seam (null when there is none). */
  public get warm(): WarmZone | null {
    return this.warmNeighbor;
  }

  /** The active map's passable seams — the component gates its crossing test on there being any. */
  public get seams(): readonly SeamEdge[] {
    return this.seamEdges;
  }

  /** The active zone's graph exits — read by the sprite build + the objective step's proximity scan. */
  public get exits(): readonly ZoneExit[] {
    return this.graphExits;
  }

  /** The active zone's sliding glass doors — read by the component's sliding-door proximity step. */
  public get slidingDoors(): readonly SlidingDoor[] {
    return this.slidingDoorIndex;
  }

  /** The active map's live-portal neighbor sources — the component seeds the render pool with them. */
  public get neighborSources(): ReadonlyMap<string, MapSource> {
    return this.neighborSourceMap;
  }

  /** Whether the enemy/pickup atlases have decoded (the deferred-spawn gate the sprite build also reads). */
  public get atlasesReady(): boolean {
    return this.atlasesDecoded;
  }

  /** The current zone's registry key — the fresh-restart reload target. */
  public get currentKey(): string {
    return this.activeWorld.key;
  }

  /** The in-flight fade transition (null outside one) — the component null-checks it + draws the wash. */
  public get transition(): {
    readonly to: string;
    readonly entry: string;
    readonly clock: number;
    readonly swapped: boolean;
  } | null {
    return this.pendingTransition;
  }

  /** Arrival guard — read + written by the objective step (re-armed here on every load/swap). */
  public get exitsLocked(): boolean {
    return this.arrivalLocked;
  }

  public set exitsLocked(locked: boolean) {
    this.arrivalLocked = locked;
  }

  /**
   * Swap the live world to zone `key` — THE load path (initial URL level, every FADE graph transition, and
   * the `fresh` restart; a passable-seam crossing takes the seamless {@link crossSeam} path instead). It
   * snapshots the zone being left, rebuilds every level-bound structure from the registry, notifies the
   * component to re-point the render workers + reset its transient FX, restores the target zone's snapshot
   * (corpses stay down, taken pickups stay gone, opened doors stay open), and places the player at the named
   * `entry`, else the dev spawn override (URL level only), else the level spawn. Player inventory travels
   * through untouched (component-side). `fresh` = a NEW GAME: the whole building resets first.
   */
  public loadZone(key: string, entry?: string, fresh = false): void {
    if (fresh) {
      zoneStates.reset();
      this.warmNeighbor = null; // a NEW GAME: the warm world must not leak pre-reset state back into the store
    } else if (this.started) {
      zoneStates.snapshot(this.activeWorld.key, this.snapshotWorld(this.activeWorld)); // leaving — persist it
    }
    const zone = resolveZone(key, entry, this.hooks.params);

    this.zoneSnap = zoneStates.restore(zone.key);
    this.activeWorld = this.buildWorld(zone, this.zoneSnap);
    this.started = true;
    this.deriveActiveIndexes();
    this.hooks.onGeometryLoaded(
      this.activeWorld.key,
      this.activeWorld.mapSource,
      this.neighborSourceMap,
    );
    this.hooks.onZoneReset();
    this.placePlayer(zone);
    this.arrivalLocked = true; // re-arm only once the player has left the arrival-side exit radius
    this.refreshWarm(); // warm up the zone behind this map's passable seam (a fresh load = a fresh warm world)
  }

  /** Flip the atlas gate + populate the active world in place (the deferred spawn) once the enemy/pickup
   *  atlases decode: the initial load built the world bare, so its entities appear now, and the warm neighbor
   *  can finally populate. Idempotent enough — called once from the component's atlas-decode callback. */
  public markAtlasesReady(): void {
    this.atlasesDecoded = true;
    const world = this.activeWorld;

    world.enemies = this.buildEnemies(world.level, world.map, this.zoneSnap);
    const pickups = buildPickups(world.level, this.zoneSnap, (x, y) =>
      this.floorOn(world.level, world.map, x, y),
    );

    world.vitals = pickups.vitals;
    world.ammoBoxes = pickups.ammoBoxes;
    world.keycards = pickups.keycards;
    world.weaponPickups = pickups.weaponPickups;
    world.exit = pickups.exit;
    world.populated = true;
    this.refreshWarm(); // the warm neighbor can only populate now its art exists
  }

  /** Does the movement step `from → to` cross a passable seam (front → back, within its span)? If so, perform
   *  the seamless zone swap and return true. The hysteresis lives in {@link swapZones}: the player lands ≥
   *  SEAM_HYSTERESIS beyond the line, so grazing it can't oscillate. */
  public crossSeam(fromX: number, fromY: number, toX: number, toY: number): boolean {
    for (const seam of this.seamEdges) {
      const beyond = seamCrossing(seam, fromX, fromY, toX, toY);

      if (beyond === null) {
        continue; // no front → back crossing within this seam's span
      }
      this.swapZones(seam, toX, toY, beyond);

      return true;
    }

    return false;
  }

  /** Advance the FADE zone swap: fade to black over {@link ZONE_FADE}, swap the floor at black, fade back in. */
  public stepTransition(dt: number): void {
    const transition = this.pendingTransition;

    if (transition === null) {
      return;
    }
    transition.clock += dt;
    if (!transition.swapped && transition.clock >= ZONE_FADE) {
      this.loadZone(transition.to, transition.entry);
      transition.swapped = true;
    }
    if (transition.clock >= 2 * ZONE_FADE) {
      this.pendingTransition = null;
    }
  }

  /** Begin a FADE transition to zone `to` at its named `entry` — the objective step arms this on a walk-into
   *  exit; {@link stepTransition} then owns the swap. */
  public beginTransition(to: string, entry: string): void {
    this.pendingTransition = { to, entry, clock: 0, swapped: false };
  }

  /** Drop any in-flight transition (the new-game restart clears it before reloading fresh). */
  public cancelTransition(): void {
    this.pendingTransition = null;
  }

  /** Keep the WARM neighbor alive: spin its pickups and run its enemy AI against the player's ghost — the
   *  camera translated into the warm zone's coordinates through the seam. Its foes think in THEIR map; the
   *  seam blocks their sight lines (and everything else), so nothing crosses until the player does — at which
   *  point this state is adopted as-is, positions and all. */
  public stepWarm(dt: number): void {
    const warm = this.warmNeighbor;

    if (warm === null) {
      return;
    }
    for (const vital of warm.vitals) {
      vital.age += dt;
    }
    for (const box of warm.ammoBoxes) {
      box.age += dt;
    }
    for (const card of warm.keycards) {
      card.age += dt;
    }
    const seam = this.seamEdges.find((edge) => edge.zone === warm.key);

    if (seam === undefined) {
      return; // no live seam into the warm zone (defensive — warm zones are seam-derived)
    }
    const camera = this.hooks.camera;
    const frame: CombatFrame = {
      map: warm.map,
      slides: warm.slides,
      obstacles: warm.obstacles,
      enemies: warm.enemies,
      shots: warm.enemyShots,
      px: camera.x - seam.dx, // the player, in the warm zone's coordinates
      py: camera.y - seam.dy,
      hurt: () => undefined, // a warm foe can never truly reach the player across the seam
    };

    stepEnemies(frame, dt);
    stepEnemyShots(frame, dt);
  }

  /** The render's neighbor channel: the compiled registry maps, plus the warm zone's live sprites where a
   *  warm world exists (the workers assemble the same map per frame). */
  public zoneNeighbors(
    sprites: ReadonlyMap<string, readonly Sprite[]> | undefined,
  ): ReadonlyMap<string, ZoneNeighbor> {
    const out = new Map<string, ZoneNeighbor>();

    for (const [key, map] of this.neighborCompiled) {
      out.set(key, { map, sprites: sprites?.get(key) });
    }

    return out;
  }

  /** Write each door's current ceilZ into a zone's live sector heights — the renderer + physics read these
   *  straight off `source.sectors` each frame, so a raised ceiling both shows AND becomes passable. Public so
   *  the component's per-frame door step can re-stamp the active world after driving the openness. */
  public applyDoors(doors: readonly Door[], sectors: MutableSector[]): void {
    for (const door of doors) {
      sectors[door.sector].ceilZ = doorCeilZ(door.closedCeilZ, door.openCeilZ, door.openness);
    }
  }

  /**
   * The SEAMLESS zone swap — the crossing counterpart of {@link loadZone}, with no fade and no reload: the
   * warm world (already compiled + simulated) is ADOPTED as the active zone (a pointer swap), the outgoing
   * live world becomes the new warm neighbor (the reverse portal), and the player is TRANSLATED by the seam's
   * transform — heading, pitch and eye height untouched, so the view continues exactly where the portal left
   * off. The component promotes the neighbor map the workers already hold (see `RenderPool.swapTo`).
   */
  private swapZones(seam: SeamEdge, toX: number, toY: number, beyond: number): void {
    const t0 = performance.now();
    // Positional hysteresis: land at least SEAM_HYSTERESIS past the line, so a graze can't instantly re-cross.
    const { x, y } = seamHysteresisPush(toX, toY, seam.nx, seam.ny, beyond);

    zoneStates.snapshot(this.activeWorld.key, this.snapshotWorld(this.activeWorld)); // bookkeeping snapshot
    const outgoing = this.activeWorld; // the old zone STAYS ALIVE — it becomes the warm neighbor
    const incoming =
      this.warmNeighbor !== null && this.warmNeighbor.key === seam.zone
        ? this.warmNeighbor
        : this.buildWarm(seam.zone);

    this.activeWorld = incoming; // ADOPT — the reified world swaps in place (nothing reloads, nothing respawns)
    this.zoneSnap = null; // adoption IS the restore — the world arrives live
    this.deriveActiveIndexes(); // only the location-derived indexes are re-derived
    this.warmNeighbor = outgoing;
    const camera = this.hooks.camera;

    // Translate the player into the new zone's coordinates (a pure translation — the geometry both sides of
    // the seam is mirrored, so nothing on screen moves).
    camera.x = x - seam.dx;
    camera.y = y - seam.dy;
    this.hooks.onSeamTranslate(seam.dx, seam.dy); // component: drop projectiles + shift impacts/arcs
    this.hooks.onSeamSwap(this.activeWorld.key, this.neighborSourceMap); // component: pool.swapTo (no rebuild)
    this.arrivalLocked = true; // generic arrival guard for any walk-into exits the new zone may have
    console.info(
      `[bsp] seam swap ${outgoing.key} → ${this.activeWorld.key} in ${(performance.now() - t0).toFixed(2)} ms`,
    );
  }

  /** Seat the player at the resolved zone's arrival pose — position, heading, and the eye a floor-height up. */
  private placePlayer(zone: ZoneLoad): void {
    const camera = this.hooks.camera;

    camera.x = zone.at.x;
    camera.y = zone.at.y;
    camera.angle = zone.at.angle;
    camera.z =
      this.floorOn(this.activeWorld.level, this.activeWorld.map, zone.at.x, zone.at.y) + EYE_HEIGHT;
    camera.pitch = 0;
  }

  /** Re-derive the location-only indexes off the current active world — the seams, the graph-exit markers,
   *  the sliding-door triggers, and the live-portal neighbors. Run after every load and every adopt (a warm
   *  world carries its entities but not these camera-relative derivations). */
  private deriveActiveIndexes(): void {
    this.gatherNeighbors();
    this.gatherSeams();
    this.indexSlidingDoors();
    this.graphExits = (this.activeWorld.level.exits ?? []).map((exit) => ({
      ...exit,
      z: this.floorOn(this.activeWorld.level, this.activeWorld.map, exit.x, exit.y),
    }));
  }

  /** Build a zone's full live world from a resolved load — the shared body of a fresh load (via {@link
   *  loadZone}) and a warm build (via {@link buildWarm}): its own mutable sectors + compiled BSP, animated
   *  doors (a remembered-open door comes back open, and is stamped into the sectors), and its snapshot-restored
   *  entities. Enemies/pickups need the decoded atlases; before that the world is bare geometry (populated =
   *  false) and {@link markAtlasesReady} fills it in place. */
  private buildWorld(zone: ZoneLoad, snap: ZoneSnapshot | null): WarmZone {
    const sectors = zone.level.map.sectors.map((sector) => ({ ...sector }));
    const mapSource = { ...zone.level.map, sectors };
    const map = buildBsp(mapSource);
    const doors = this.buildDoors(zone.level, snap);
    const pickups = this.atlasesDecoded
      ? buildPickups(zone.level, snap, (x, y) => this.floorOn(zone.level, map, x, y))
      : emptyPickups();

    this.applyDoors(doors, sectors); // a remembered-open door is open from the first frame

    return {
      key: zone.key,
      level: zone.level,
      populated: this.atlasesDecoded,
      sectors,
      mapSource,
      map,
      targets: mapSprites(map).map((sprite, i) => ({
        sprite,
        alive: snap?.barrels[i] !== false, // popped barrels stay popped
      })),
      enemies: this.atlasesDecoded ? this.buildEnemies(zone.level, map, snap) : [],
      enemyShots: [],
      doors,
      slides: zone.level.map.linedefs.map(() => 0), // sliding doors rest shut on a fresh build
      obstacles: mapObstacles(map),
      ...pickups,
    };
  }

  /** (Re)build the WARM neighbor — the zone behind the active map's first passable seam, restored from its
   *  snapshot and simulated from now on. Any previous warm world is snapshotted first, so nothing it lived
   *  through is lost. One warm zone max, by design. */
  private refreshWarm(): void {
    if (this.warmNeighbor !== null && this.warmNeighbor.populated) {
      zoneStates.snapshot(this.warmNeighbor.key, this.snapshotWorld(this.warmNeighbor)); // a bare world has nothing to say
    }
    const seam = this.seamEdges[0];

    this.warmNeighbor = seam === undefined ? null : this.buildWarm(seam.zone);
    // Pre-compile every zone the WARM map's own seams look into (usually the reverse seam → the ACTIVE zone
    // itself), so a later crossing finds its render neighbors ready — the swap costs no BSP build.
    for (const line of this.warmNeighbor?.mapSource.linedefs ?? []) {
      const zone = line.zonePortal?.zone;

      if (zone !== undefined && LEVELS[zone] !== undefined && !this.compiledZones.has(zone)) {
        this.compiledZones.set(zone, buildBsp(LEVELS[zone].map));
      }
    }
  }

  /** Build a warm zone's live world for `key` in the background — {@link buildWorld} over a freshly resolved
   *  load (respecting `?noenemies=`) restored from that zone's snapshot. */
  private buildWarm(key: string): WarmZone {
    const zone = resolveZone(key, undefined, this.hooks.params);

    return this.buildWorld(zone, zoneStates.restore(zone.key));
  }

  /** Derive the current zone's LIVE-portal neighbor maps: every zone referenced by a `zonePortal` linedef,
   *  compiled lazily (once per session) off its registry geometry. */
  private gatherNeighbors(): void {
    const sources = new Map<string, MapSource>();
    const compiled = new Map<string, CompiledMap>();

    for (const line of this.activeWorld.mapSource.linedefs) {
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
    this.neighborSourceMap = sources;
    this.neighborCompiled = compiled;
  }

  /** Pre-resolve the active map's PASSABLE seams (segment + outward normal + zone transform) for the
   *  per-frame crossing test. A seam naming an unknown zone stays a stage-2 window (never crossable). */
  private gatherSeams(): void {
    this.seamEdges = [];
    for (const line of this.activeWorld.mapSource.linedefs) {
      const portal = line.zonePortal;

      if (!isPassableSeam(portal) || LEVELS[portal.zone] === undefined) {
        continue;
      }
      const a = this.activeWorld.mapSource.vertices[line.v1];
      const b = this.activeWorld.mapSource.vertices[line.v2];
      const len = Math.hypot(b.x - a.x, b.y - a.y);

      this.seamEdges.push({
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

  /** Index the active zone's sliding glass doors (line + trigger midpoint) for the proximity drive. */
  private indexSlidingDoors(): void {
    const index: SlidingDoor[] = [];

    this.activeWorld.level.map.linedefs.forEach((line, index_) => {
      if (line.sliding === true) {
        const a = this.activeWorld.level.map.vertices[line.v1];
        const b = this.activeWorld.level.map.vertices[line.v2];

        index.push({ line: index_, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 });
      }
    });
    this.slidingDoorIndex = index;
  }

  /** Build a zone's animated doors — badge-locked gates start shut, but a door the zone's snapshot remembers
   *  as opened comes back open (a permanent unlock survives leaving the floor). */
  private buildDoors(level: Level, snap: ZoneSnapshot | null): Door[] {
    return level.doors.map((door, i) => {
      const sector = level.map.sectors[door.sector];

      return {
        sector: door.sector,
        triggerX: door.triggerX,
        triggerY: door.triggerY,
        closedCeilZ: sector.floorZ, // shut → ceil meets floor → no headroom → blocked
        openCeilZ: sector.ceilZ, // the authored open ceiling
        requiresCard: door.requiresCard,
        openness: snap?.doors[i] ?? 0,
      };
    });
  }

  /** Build a zone's enemy roster, each foe seated on its sector floor. The zone's snapshot (if any) is
   *  re-applied per roster index: a dead enemy comes back as a CORPSE frozen on its last death frame, a
   *  survivor at the position + hp it was left with. */
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

  /** The floor height at a map point (its sub-sector's `floorZ`, pristine — never the animated door ceiling) —
   *  seats each entity on whatever sector it sits on (the badge on the +1.6 dais, the exit in the −0.8 atrium). */
  private floorOn(level: Level, map: CompiledMap, x: number, y: number): number {
    return level.map.sectors[locateSubSector(map.root, x, y).sector].floorZ;
  }

  /** Capture everything a zone's live world could have visibly changed — the acceptance test is "nothing
   *  respawns on return". Index-aligned with the level's authoring arrays (see {@link ZoneSnapshot}). */
  private snapshotWorld(world: WarmZone): ZoneSnapshot {
    return {
      enemies: world.level.enemies.map((spawn, i) => {
        const enemy = world.enemies[i]; // absent before the atlases decode — persist the authored roster untouched

        return enemy === undefined
          ? { x: spawn.x, y: spawn.y, hp: spawn.spec.hp, dead: false }
          : { x: enemy.x, y: enemy.y, hp: enemy.hp, dead: enemy.dying }; // dying-in-progress persists as a corpse
      }),
      barrels: world.targets.map((target) => target.alive),
      vitalsTaken: takenFlags(
        world.level.health.length + world.level.armor.length,
        world.vitals,
        this.atlasesDecoded,
      ),
      ammoTaken: takenFlags(world.level.ammo.length, world.ammoBoxes, this.atlasesDecoded),
      cardsTaken: takenFlags(world.level.keycards.length, world.keycards, this.atlasesDecoded),
      weaponsTaken: takenFlags(
        world.level.weapons?.length ?? 0,
        world.weaponPickups,
        this.atlasesDecoded,
      ),
      doors: world.doors.map((door) => door.openness),
    };
  }
}
