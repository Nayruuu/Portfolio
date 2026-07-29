import {
  buildBsp,
  castRay,
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
} from '../../bsp-engine';
import { doorCeilZ } from '../doors';
import { LEVELS, resolveZone, type LevelParams, type ZoneLoad } from '../registry';
import { stepEnemies, stepEnemyShots } from '../enemy';
import { WAKE_CONE_COS, WAKE_SAFE_DIST, ZONE_FADE } from '../game-tuning';
import { zoneStates, type ZoneSnapshot } from '../zone';
import type { CombatFrame } from '../combat';
import type { Level } from '../level';
import { buildPickups, takenFlags } from './pickups';
import type { Foe } from './enemy-runtime';
import type { Door, SeamEdge, SlidingDoor, WarmZone, ZoneExit } from './zone-world';

export const EYE_HEIGHT = 1.4;

function emptyPickups(): Pick<
  WarmZone,
  'vitals' | 'ammoBoxes' | 'keycards' | 'weaponPickups' | 'exit'
> {
  return { vitals: [], ammoBoxes: [], keycards: [], weaponPickups: [], exit: null };
}

export type MutableCamera = { -readonly [K in keyof Camera]-?: Camera[K] };

export interface ZoneRuntimeHooks {
  readonly camera: MutableCamera;
  readonly params: LevelParams;
  onGeometryLoaded(key: string, source: MapSource, neighbors: ReadonlyMap<string, MapSource>): void;
  onSeamSwap(key: string, neighbors: ReadonlyMap<string, MapSource>): void;
  onZoneReset(): void;
  onSeamTranslate(dx: number, dy: number): void;
}

export class ZoneRuntime {
  // assigned by the mandatory first `loadZone` (before any accessor) — hence the !
  private activeWorld!: WarmZone;
  // false until the first load, so the very first `loadZone` has nothing to persist.
  private started = false;
  private warmNeighbor: WarmZone | null = null;
  private zoneSnap: ZoneSnapshot | null = null;
  private readonly compiledZones = new Map<string, CompiledMap>();
  private neighborCompiled: ReadonlyMap<string, CompiledMap> = new Map();
  private neighborSourceMap: ReadonlyMap<string, MapSource> = new Map();
  private seamEdges: SeamEdge[] = [];
  private graphExits: ZoneExit[] = [];
  private slidingDoorIndex: SlidingDoor[] = [];
  private arrivalLocked = false;
  private atlasesDecoded = false;
  // A species is only playable once ITS atlas decodes; foes of an undecoded species are placed
  // dormant and wake later, out of sight (see wakeHidden).
  private readonly decodedSpecs = new Set<string>();
  private spawnEnemies = true; // false = strip every zone's foes for an art-inspection capture
  private pendingTransition: {
    readonly to: string;
    readonly entry: string;
    clock: number;
    swapped: boolean;
  } | null = null;

  constructor(private readonly hooks: ZoneRuntimeHooks) {}

  public get world(): WarmZone {
    return this.activeWorld;
  }

  public get warm(): WarmZone | null {
    return this.warmNeighbor;
  }

  public get seams(): readonly SeamEdge[] {
    return this.seamEdges;
  }

  public get exits(): readonly ZoneExit[] {
    return this.graphExits;
  }

  public get slidingDoors(): readonly SlidingDoor[] {
    return this.slidingDoorIndex;
  }

  public get neighborSources(): ReadonlyMap<string, MapSource> {
    return this.neighborSourceMap;
  }

  public get atlasesReady(): boolean {
    return this.atlasesDecoded;
  }

  public get currentKey(): string {
    return this.activeWorld.key;
  }

  public get transition(): {
    readonly to: string;
    readonly entry: string;
    readonly clock: number;
    readonly swapped: boolean;
  } | null {
    return this.pendingTransition;
  }

  public get exitsLocked(): boolean {
    return this.arrivalLocked;
  }

  public set exitsLocked(locked: boolean) {
    this.arrivalLocked = locked;
  }

  public loadZone(key: string, entry?: string, fresh = false): void {
    if (fresh) {
      zoneStates.reset();
      this.warmNeighbor = null; // a NEW GAME must not leak the warm world's pre-reset state back into the store
    } else if (this.started) {
      zoneStates.snapshot(this.activeWorld.key, this.snapshotWorld(this.activeWorld));
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
    this.arrivalLocked = true; // unlock only once the player leaves the arrival-side exit radius (no bounce-back)
    this.refreshWarm();
  }

  public setSpawnEnemies(on: boolean): void {
    this.spawnEnemies = on;
  }

  /** The critical atlas landed: the floor's OBJECTS exist (pickups, badges, the exit) and the foes
   *  are placed — dormant until their own species decodes. This is what the loading screen waits on. */
  public markPopulated(): void {
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
    this.refreshWarm();
  }

  public markSpeciesDecoded(texName: string): void {
    this.decodedSpecs.add(texName);
    // Only the ACTIVE zone's foes wake here (via the per-frame wakeHidden). The warm neighbour is NOT
    // woken eagerly: the player sees into it through the seam, so an in-doorway husk would pop in. Its
    // foes rebuild non-dormant on the next refreshWarm, or wake out-of-sight once a crossing makes it active.
  }

  /** Wakes the decoded-species foes the player CANNOT see: behind a wall, outside the view cone, or
   *  far enough that a pop-in reads as nothing. A husk never materialises in his face. */
  public wakeHidden(x: number, y: number, angle: number): void {
    const world = this.activeWorld;
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);

    for (const foe of world.enemies) {
      if (!foe.dormant || !this.decodedSpecs.has(foe.spec.texName)) {
        continue;
      }
      const dx = foe.x - x;
      const dy = foe.y - y;
      const dist = Math.hypot(dx, dy);
      const facing = dist > 1e-4 ? (dx * fx + dy * fy) / dist : 1;
      const seen =
        dist < WAKE_SAFE_DIST &&
        facing > WAKE_CONE_COS &&
        castRay(world.map, x, y, dx / dist, dy / dist, dist) === null;

      if (!seen) {
        foe.dormant = false;
      }
    }
  }

  public crossSeam(fromX: number, fromY: number, toX: number, toY: number): boolean {
    for (const seam of this.seamEdges) {
      const beyond = seamCrossing(seam, fromX, fromY, toX, toY);

      if (beyond === null) {
        continue;
      }
      this.swapZones(seam, toX, toY, beyond);

      return true;
    }

    return false;
  }

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

  public beginTransition(to: string, entry: string): void {
    this.pendingTransition = { to, entry, clock: 0, swapped: false };
  }

  public cancelTransition(): void {
    this.pendingTransition = null;
  }

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
    // A warm neighbour is ALWAYS seam-derived (`refreshWarm`/`swapZones` build it FROM a seam edge, and a
    // crossing re-derives the reverse seam), so its key is guaranteed to index one — assert rather than guard.
    const seam = this.seamEdges.find((edge) => edge.zone === warm.key)!;
    const camera = this.hooks.camera;
    const frame: CombatFrame = {
      map: warm.map,
      slides: warm.slides,
      obstacles: warm.obstacles,
      enemies: warm.enemies,
      shots: warm.enemyShots,
      px: camera.x - seam.dx, // player in the warm zone's coordinates
      py: camera.y - seam.dy,
      hurt: () => undefined, // a warm foe can never truly reach the player across the seam
    };

    stepEnemies(frame, dt);
    stepEnemyShots(frame, dt);
  }

  public zoneNeighbors(
    sprites: ReadonlyMap<string, readonly Sprite[]> | undefined,
  ): ReadonlyMap<string, ZoneNeighbor> {
    const out = new Map<string, ZoneNeighbor>();

    for (const [key, map] of this.neighborCompiled) {
      out.set(key, { map, sprites: sprites?.get(key) });
    }

    return out;
  }

  // Public so the component's per-frame door step can re-stamp; renderer + physics read these off the live
  // sectors the same frame, so a raised ceiling both shows AND becomes passable.
  public applyDoors(doors: readonly Door[], sectors: MutableSector[]): void {
    for (const door of doors) {
      sectors[door.sector].ceilZ = doorCeilZ(door.closedCeilZ, door.openCeilZ, door.openness);
    }
  }

  private swapZones(seam: SeamEdge, toX: number, toY: number, beyond: number): void {
    const t0 = performance.now();
    // Positional hysteresis: land at least SEAM_HYSTERESIS past the line, so a graze can't instantly re-cross.
    const { x, y } = seamHysteresisPush(toX, toY, seam.nx, seam.ny, beyond);

    zoneStates.snapshot(this.activeWorld.key, this.snapshotWorld(this.activeWorld));
    const outgoing = this.activeWorld; // the old zone STAYS ALIVE — it becomes the warm neighbor
    // Adopt the warm neighbour when it ALREADY is the target (the common back-and-forth), else build fresh.
    const incoming =
      this.warmNeighbor !== null && this.warmNeighbor.key === seam.zone
        ? this.warmNeighbor
        : this.buildWarm(seam.zone);

    this.activeWorld = incoming;
    this.zoneSnap = null; // adoption IS the restore — the world arrives live
    this.deriveActiveIndexes();
    this.warmNeighbor = outgoing;
    const camera = this.hooks.camera;

    // A pure translation — the geometry both sides of the seam is mirrored, so nothing on screen moves.
    camera.x = x - seam.dx;
    camera.y = y - seam.dy;
    this.hooks.onSeamTranslate(seam.dx, seam.dy);
    this.hooks.onSeamSwap(this.activeWorld.key, this.neighborSourceMap);
    this.arrivalLocked = true;
    console.info(
      `[bsp] seam swap ${outgoing.key} → ${this.activeWorld.key} in ${(performance.now() - t0).toFixed(2)} ms`,
    );
  }

  private placePlayer(zone: ZoneLoad): void {
    const camera = this.hooks.camera;

    camera.x = zone.at.x;
    camera.y = zone.at.y;
    camera.angle = zone.at.angle;
    camera.z =
      this.floorOn(this.activeWorld.level, this.activeWorld.map, zone.at.x, zone.at.y) + EYE_HEIGHT;
    camera.pitch = 0;
  }

  private deriveActiveIndexes(): void {
    this.gatherNeighbors();
    this.gatherSeams();
    this.indexSlidingDoors();
    this.graphExits = (this.activeWorld.level.exits ?? []).map((exit) => ({
      ...exit,
      z: this.floorOn(this.activeWorld.level, this.activeWorld.map, exit.x, exit.y),
    }));
  }

  private buildWorld(zone: ZoneLoad, snap: ZoneSnapshot | null): WarmZone {
    const sectors = zone.level.map.sectors.map((sector) => ({ ...sector }));
    const mapSource = { ...zone.level.map, sectors };
    const map = buildBsp(mapSource);
    const doors = this.buildDoors(zone.level, snap);
    const pickups = this.atlasesDecoded
      ? buildPickups(zone.level, snap, (x, y) => this.floorOn(zone.level, map, x, y))
      : emptyPickups();

    this.applyDoors(doors, sectors);

    return {
      key: zone.key,
      level: zone.level,
      populated: this.atlasesDecoded,
      sectors,
      mapSource,
      map,
      targets: mapSprites(map).map((sprite, i) => ({
        sprite,
        alive: snap?.barrels[i] !== false, // undefined = alive; only an explicit false is a popped barrel
      })),
      enemies: this.atlasesDecoded ? this.buildEnemies(zone.level, map, snap) : [],
      enemyShots: [],
      doors,
      slides: zone.level.map.linedefs.map(() => 0),
      obstacles: mapObstacles(map),
      ...pickups,
    };
  }

  private refreshWarm(): void {
    if (this.warmNeighbor !== null && this.warmNeighbor.populated) {
      zoneStates.snapshot(this.warmNeighbor.key, this.snapshotWorld(this.warmNeighbor));
    }
    const seam = this.seamEdges[0];

    this.warmNeighbor = seam === undefined ? null : this.buildWarm(seam.zone);
    // Pre-compile the warm map's own seam neighbors so a later crossing costs no BSP build.
    for (const line of this.warmNeighbor?.mapSource.linedefs ?? []) {
      const zone = line.zonePortal?.zone;

      if (zone !== undefined && LEVELS[zone] !== undefined && !this.compiledZones.has(zone)) {
        this.compiledZones.set(zone, buildBsp(LEVELS[zone].map));
      }
    }
  }

  private buildWarm(key: string): WarmZone {
    const zone = resolveZone(key, undefined, this.hooks.params);

    return this.buildWorld(zone, zoneStates.restore(zone.key));
  }

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

  private buildDoors(level: Level, snap: ZoneSnapshot | null): Door[] {
    return level.doors.map((door, i) => {
      const sector = level.map.sectors[door.sector];

      return {
        sector: door.sector,
        triggerX: door.triggerX,
        triggerY: door.triggerY,
        closedCeilZ: sector.floorZ, // == floorZ → no headroom → blocked
        openCeilZ: sector.ceilZ,
        requiresCard: door.requiresCard,
        openness: snap?.doors[i] ?? 0,
      };
    });
  }

  private buildEnemies(level: Level, map: CompiledMap, snap: ZoneSnapshot | null): Foe[] {
    if (!this.spawnEnemies) {
      return [];
    }

    return level.enemies.map(({ spec, x, y }, i) => {
      const saved = snap?.enemies[i];
      const dead = saved?.dead ?? false;
      const atX = saved?.x ?? x;
      const atY = saved?.y ?? y;

      return {
        spec,
        dormant: !this.decodedSpecs.has(spec.texName),
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

  // The sub-sector floorZ, pristine — never the animated door ceiling.
  private floorOn(level: Level, map: CompiledMap, x: number, y: number): number {
    return level.map.sectors[locateSubSector(map.root, x, y).sector].floorZ;
  }

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
