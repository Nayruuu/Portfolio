import { MapBuilder } from './level-builder';
import type { MapSource, Sector, Thing, ZonePortalDef } from '../../core/lib/bsp-engine';

/** A world-coordinate point `[x, y]` — y grows DOWN, as everywhere in the engine. */
export type RoomPoint = readonly [number, number];

/** How a {@link RoomBuilder.connect} opening reads: a walkable doorway, one of the glass kinds, or a
 *  see-over-but-never-crossable fence (each maps to the {@link MapBuilder} line kind of the same name). */
export type ConnectionKind = 'portal' | 'glass' | 'glassPane' | 'slidingDoor' | 'fence';

/**
 * A room's {@link Sector} values plus its wall dressing: `wallTex` is the default texture of every
 * boundary wall; `walls` overrides single edges by index (edge `i` runs `polygon[i] → polygon[i+1]`,
 * wrapping — indices always refer to the polygon AS GIVEN, whichever way it was wound).
 */
export interface RoomSpec extends Sector {
  readonly wallTex: string;
  readonly walls?: Readonly<Record<number, string>>;
}

/** Options for {@link RoomBuilder.connect}. `tex` dresses the emitted line(s) — each kind falls back to
 *  its {@link MapBuilder} default ('METAL' / 'GLASS' / 'GLASS_PANE' / 'DOOR_GLASS' / 'METAL'); `at`
 *  restricts the opening to the `[x1, y1, x2, y2]` sub-span of the shared overlap (a door narrower
 *  than the full shared edge) — its endpoints need not pre-exist as polygon vertices. */
export interface ConnectOptions {
  readonly kind?: ConnectionKind;
  readonly tex?: string;
  readonly at?: readonly [number, number, number, number];
}

/** The shape of a {@link RoomBuilder.stairs} flight: `count` steps, each `depth` deep, rising `dz` each
 *  (step `i`'s floor at `zBase + (i+1)·dz`, so `zBase` is the floor of the room BELOW the flight) under
 *  one flat `ceilZ`. */
export interface StairSpec {
  readonly depth: number;
  readonly count: number;
  readonly zBase: number;
  readonly dz: number;
  readonly ceilZ: number;
  readonly light: number;
  readonly wallTex: string;
  readonly floorTex?: string; // default 'STEP'
  readonly ceilTex?: string; // default 'CEIL_LUX'
}

/**
 * A room-graph authoring layer that COMPILES down to {@link MapBuilder} calls: you declare closed room
 * polygons, then the connections between them, and the builder does everything the hand-authored levels
 * did by convention — it normalizes the winding (interior on the RIGHT of every directed edge, the
 * engine's rule), splits a long wall around a doorway (solid before, opening within, solid after),
 * emits each connection ONCE as a two-sided line, and walls up every span no connection claimed as
 * one-sided solids. Two back-to-back rooms that are never `connect`ed therefore each emit their own
 * opaque dividing wall, exactly like the hand-authored maps handled shared boundaries.
 */
export class RoomBuilder {
  private readonly builder = new MapBuilder();
  /** Room sector → its boundary edges. Only {@link room}s register here — islands and holes have no
   *  carve-able boundary (their edges are emitted whole, immediately). */
  private readonly boundaries = new Map<number, readonly BoundaryEdge[]>();
  private sectorCount = 0;

  /** A sector-room from a closed polygon (any winding, any decimals): registers the sector and defers
   *  its boundary walls until {@link build}, so later {@link connect}s can carve openings out of them.
   *  Returns the sector index. */
  public room(polygon: readonly RoomPoint[], spec: RoomSpec): number {
    const edges = orientedEdges(polygon, spec.wallTex, spec.walls, `room ${this.sectorCount}`);
    const sector = this.addSector(spec);

    this.boundaries.set(sector, edges);

    return sector;
  }

  /**
   * Declare that rooms `a` and `b` communicate: finds the colinear overlapping span(s) between their
   * boundaries and replaces each with ONE two-sided line (`front` = room `a`), leaving the rest of the
   * touched edges solid. The shared edge may be PARTIAL — a doorway in a long wall splits it — and with
   * `opts.at` the opening shrinks to a sub-span of the overlap. Throws if the rooms share no colinear
   * overlap (or the `at` span sits outside every overlap).
   */
  public connect(a: number, b: number, opts: ConnectOptions = {}): void {
    if (a === b) {
      throw new Error(`RoomBuilder.connect: cannot connect room ${a} to itself`);
    }
    const overlaps: Overlap[] = [];

    for (const edge of this.boundary(a, 'connect')) {
      for (const other of this.boundary(b, 'connect')) {
        const span = overlapSpan(edge, other);

        if (span) {
          overlaps.push({ edge, other, ...span });
        }
      }
    }
    if (overlaps.length === 0) {
      throw new Error(
        `RoomBuilder.connect: rooms ${a} and ${b} share no colinear boundary overlap`,
      );
    }
    for (const span of opts.at ? [restrict(overlaps, opts.at, a, b)] : overlaps) {
      const p = pointAt(span.edge, span.lo);
      const q = pointAt(span.edge, span.hi);
      const onOther = [along(span.other, p), along(span.other, q)];

      span.edge.cuts.push({ lo: span.lo, hi: span.hi });
      span.other.cuts.push({ lo: Math.min(...onOther), hi: Math.max(...onOther) });
      this.opening(opts.kind ?? 'portal', p, q, a, b, opts.tex);
    }
  }

  /** A room wholly INSIDE another (raised furniture block, dais, rug inset): every edge becomes a
   *  portal — or a blocking fence when `fenced` (a counter / turnstile the step-up physics must never
   *  walk onto) — between the island (`front`) and its `host` sector. Returns the island's sector. */
  public island(
    host: number,
    polygon: readonly RoomPoint[],
    spec: RoomSpec,
    opts: { readonly fenced?: boolean } = {},
  ): number {
    const edges = orientedEdges(polygon, spec.wallTex, spec.walls, `island ${this.sectorCount}`);
    const sector = this.addSector(spec);

    for (const e of edges) {
      if (opts.fenced) {
        this.builder.fence(e.ax, e.ay, e.bx, e.by, sector, host, e.tex);
      } else {
        this.builder.portal(e.ax, e.ay, e.bx, e.by, sector, host, e.tex);
      }
    }

    return sector;
  }

  /** A LIVE ZONE-PORTAL seam carved out of room `room`'s boundary: the `[x1, y1, x2, y2]` span of one of
   *  its walls is emitted as a one-sided {@link MapBuilder.zonePortal} line (solid for physics + hitscan,
   *  renders `portal.zone`'s map translated by `(dx, dy)`), the rest of the wall staying solid. `tex`
   *  defaults to that wall's texture — the solid fallback look when the neighbor map isn't provided.
   *  Throws when the span lies on no boundary edge of the room. */
  public zonePortal(
    room: number,
    at: readonly [number, number, number, number],
    portal: ZonePortalDef,
    tex?: string,
  ): void {
    const p: RoomPoint = [at[0], at[1]];
    const q: RoomPoint = [at[2], at[3]];

    for (const edge of this.boundary(room, 'zonePortal')) {
      if (Math.abs(offLine(edge, p)) > EPSILON || Math.abs(offLine(edge, q)) > EPSILON) {
        continue;
      }
      const s0 = along(edge, p);
      const s1 = along(edge, q);
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);

      if (hi - lo > EPSILON && lo >= -EPSILON && hi <= edge.len + EPSILON) {
        edge.cuts.push({ lo, hi });
        const [ax, ay] = pointAt(edge, lo);
        const [bx, by] = pointAt(edge, hi); // emitted along the edge direction → `front` = the room

        this.builder.zonePortal(ax, ay, bx, by, room, portal, tex ?? edge.tex);

        return;
      }
    }
    throw new Error(
      `RoomBuilder.zonePortal: span (${p[0]}, ${p[1]}) → (${q[0]}, ${q[1]}) lies on no boundary edge of room ${room}`,
    );
  }

  /** A solid column/pillar wholly inside `host`: one-sided walls facing the host on the OUTSIDE (the
   *  polygon's inside is dead space the BSP never enters). */
  public hole(host: number, polygon: readonly RoomPoint[], tex: string): void {
    // Oriented interior-on-the-right like a room, then emitted REVERSED — the pillar's inside lands on
    // the LEFT of each wall, leaving the host (the only renderable side) as the `front`.
    for (const e of orientedEdges(polygon, tex, undefined, `hole in sector ${host}`)) {
      this.builder.solid(e.bx, e.by, e.ax, e.ay, host, e.tex);
    }
  }

  /** A straight flight of `count` step rooms chained by portals, climbing on the RIGHT of the base edge
   *  `from → to` (the full-width bottom edge of the flight — e.g. west→east climbs NORTH, y down). The
   *  caller `connect`s the flight's ends: `connect(below, steps[0])` and `connect(above, steps.at(-1))`.
   *  Returns the step sector indices, bottom → top. */
  public stairs(from: RoomPoint, to: RoomPoint, spec: StairSpec): number[] {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);

    if (length <= EPSILON) {
      throw new Error('RoomBuilder.stairs: the base edge is degenerate');
    }
    // One step-depth toward the right of from→to ("right" of direction (dx,dy) is (dy,-dx)).
    const stepX = ((to[1] - from[1]) / length) * spec.depth;
    const stepY = (-(to[0] - from[0]) / length) * spec.depth;
    const sectors: number[] = [];

    for (let i = 0; i < spec.count; i++) {
      const sector = this.room(
        [
          [from[0] + stepX * i, from[1] + stepY * i],
          [to[0] + stepX * i, to[1] + stepY * i],
          [to[0] + stepX * (i + 1), to[1] + stepY * (i + 1)],
          [from[0] + stepX * (i + 1), from[1] + stepY * (i + 1)],
        ],
        {
          floorZ: +(spec.zBase + (i + 1) * spec.dz).toFixed(2),
          ceilZ: spec.ceilZ,
          floorTex: spec.floorTex ?? 'STEP',
          ceilTex: spec.ceilTex ?? 'CEIL_LUX',
          light: spec.light,
          wallTex: spec.wallTex,
        },
      );

      if (i > 0) {
        this.connect(sectors[i - 1], sector, { tex: spec.wallTex }); // shared step edge (front = the lower step)
      }
      sectors.push(sector);
    }

    return sectors;
  }

  /** Stamp a thing (spawn / prop) on the map. */
  public thing(x: number, y: number, angle: number, type: Thing['type']): void {
    this.builder.thing(x, y, angle, type);
  }

  /** Flush every room boundary's remaining SOLID spans (whatever no connection carved out), then
   *  assemble the map. Terminal: the boundaries are consumed. */
  public build(): MapSource {
    for (const [sector, edges] of this.boundaries) {
      for (const edge of edges) {
        for (const { lo, hi } of solidSpans(edge)) {
          const [x1, y1] = pointAt(edge, lo);
          const [x2, y2] = pointAt(edge, hi);

          this.builder.solid(x1, y1, x2, y2, sector, edge.tex);
        }
      }
    }
    this.boundaries.clear();

    return this.builder.build();
  }

  /** Register the sector VALUES only — `RoomSpec`'s wall dressing must not leak into the map. */
  private addSector({ floorZ, ceilZ, floorTex, ceilTex, light }: Sector): number {
    this.sectorCount++;

    return this.builder.sector({ floorZ, ceilZ, floorTex, ceilTex, light });
  }

  private boundary(sector: number, operation: string): readonly BoundaryEdge[] {
    const edges = this.boundaries.get(sector);

    if (!edges) {
      throw new Error(
        `RoomBuilder.${operation}: sector ${sector} is not a room (islands and holes have no connectable boundary)`,
      );
    }

    return edges;
  }

  /** Emit one connection line via the matching {@link MapBuilder} kind (`front` = room `a`). */
  private opening(
    kind: ConnectionKind,
    [x1, y1]: RoomPoint,
    [x2, y2]: RoomPoint,
    front: number,
    back: number,
    tex?: string,
  ): void {
    switch (kind) {
      case 'portal':
        this.builder.portal(x1, y1, x2, y2, front, back, tex);
        break;
      case 'glass':
        this.builder.glass(x1, y1, x2, y2, front, back, tex);
        break;
      case 'glassPane':
        this.builder.glassPane(x1, y1, x2, y2, front, back, tex);
        break;
      case 'slidingDoor':
        this.builder.slidingDoor(x1, y1, x2, y2, front, back, tex);
        break;
      case 'fence':
        this.builder.fence(x1, y1, x2, y2, front, back, tex);
        break;
    }
  }
}

/** Comparison slack for colinearity / overlap / split-point dedup — coordinates are decimals (0.1-deep
 *  backdrop boxes exist), so exact equality is out. */
const EPSILON = 1e-6;

/** A directed room-boundary edge — interior on the RIGHT of `(ax,ay) → (bx,by)`, `(ux,uy)` its unit
 *  direction — plus the opening spans already carved out of it (arc lengths from the `a` end). */
interface BoundaryEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ux: number;
  readonly uy: number;
  readonly len: number;
  readonly tex: string;
  readonly cuts: { lo: number; hi: number }[];
}

/** A colinear overlap between one edge of each connected room, in arc length along `edge` (room `a`'s
 *  side — the side the two-sided line fronts). */
interface Overlap {
  readonly edge: BoundaryEdge;
  readonly other: BoundaryEdge;
  readonly lo: number;
  readonly hi: number;
}

/**
 * Validate a polygon and return its boundary edges wound CANONICALLY — interior on the RIGHT of every
 * directed edge, which with y down is a NEGATIVE shoelace sum (the winding of the hand-authored rooms,
 * e.g. `(0,0) → (0,4) → (4,4) → (4,0)`). A polygon given the other way round is reversed edge by edge,
 * so `walls` indices keep pointing at the same geometric edges of the input.
 */
function orientedEdges(
  polygon: readonly RoomPoint[],
  wallTex: string,
  walls: Readonly<Record<number, string>> | undefined,
  label: string,
): readonly BoundaryEdge[] {
  const n = polygon.length;

  if (n < 3) {
    throw new Error(`RoomBuilder: ${label} needs at least 3 polygon points, got ${n}`);
  }
  for (const key of Object.keys(walls ?? {})) {
    const index = Number(key);

    if (!Number.isInteger(index) || index < 0 || index >= n) {
      throw new Error(`RoomBuilder: ${label} overrides wall ${key}, but edges run 0..${n - 1}`);
    }
  }
  let doubledArea = 0;

  for (let i = 0; i < n; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % n];

    if (Math.hypot(bx - ax, by - ay) <= EPSILON) {
      throw new Error(`RoomBuilder: ${label} repeats the consecutive point (${ax}, ${ay})`);
    }
    doubledArea += ax * by - bx * ay;
  }
  if (Math.abs(doubledArea) <= EPSILON) {
    throw new Error(`RoomBuilder: ${label} polygon has zero area`);
  }
  const reversed = doubledArea > 0;

  return polygon.map((p, i) => {
    const q = polygon[(i + 1) % n];

    return edgeOf(reversed ? q : p, reversed ? p : q, walls?.[i] ?? wallTex);
  });
}

function edgeOf(a: RoomPoint, b: RoomPoint, tex: string): BoundaryEdge {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);

  return {
    ax: a[0],
    ay: a[1],
    bx: b[0],
    by: b[1],
    ux: (b[0] - a[0]) / len,
    uy: (b[1] - a[1]) / len,
    len,
    tex,
    cuts: [],
  };
}

/** The colinear overlap of `other` on `edge` (as an arc-length span), or `null`. Handles diagonal
 *  edges — everything is parametrized and projected, nothing assumes axis alignment. */
function overlapSpan(edge: BoundaryEdge, other: BoundaryEdge): { lo: number; hi: number } | null {
  // Colinear = both of `other`'s endpoints sit on `edge`'s infinite line…
  if (Math.abs(offLine(edge, [other.ax, other.ay])) > EPSILON) {
    return null;
  }
  if (Math.abs(offLine(edge, [other.bx, other.by])) > EPSILON) {
    return null;
  }
  // …and ANTIPARALLEL: two rooms face each other across a boundary, so their interior-on-the-right
  // edges run in opposite directions (a same-direction pair is two walls of rooms on the SAME side).
  if (edge.ux * other.ux + edge.uy * other.uy >= 0) {
    return null;
  }
  const s0 = along(edge, [other.ax, other.ay]);
  const s1 = along(edge, [other.bx, other.by]);
  const lo = Math.max(0, Math.min(s0, s1));
  const hi = Math.min(edge.len, Math.max(s0, s1));

  return hi - lo > EPSILON ? { lo, hi } : null;
}

/** Narrow the overlaps down to the single `at` sub-span, or throw if it fits inside none of them. */
function restrict(
  overlaps: readonly Overlap[],
  at: readonly [number, number, number, number],
  a: number,
  b: number,
): Overlap {
  const p: RoomPoint = [at[0], at[1]];
  const q: RoomPoint = [at[2], at[3]];

  for (const overlap of overlaps) {
    if (
      Math.abs(offLine(overlap.edge, p)) > EPSILON ||
      Math.abs(offLine(overlap.edge, q)) > EPSILON
    ) {
      continue;
    }
    const s0 = along(overlap.edge, p);
    const s1 = along(overlap.edge, q);
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);

    if (hi - lo > EPSILON && lo >= overlap.lo - EPSILON && hi <= overlap.hi + EPSILON) {
      return { ...overlap, lo, hi };
    }
  }
  throw new Error(
    `RoomBuilder.connect: 'at' span (${p[0]}, ${p[1]}) → (${q[0]}, ${q[1]}) is not inside a shared overlap of rooms ${a} and ${b}`,
  );
}

/** The still-solid spans of an edge: the gaps between its (merged) cuts, dropping slivers ≤ EPSILON. */
function solidSpans(edge: BoundaryEdge): { lo: number; hi: number }[] {
  const spans: { lo: number; hi: number }[] = [];
  let cursor = 0;

  for (const cut of [...edge.cuts].sort((c, d) => c.lo - d.lo)) {
    if (cut.lo - cursor > EPSILON) {
      spans.push({ lo: cursor, hi: cut.lo });
    }
    cursor = Math.max(cursor, cut.hi);
  }
  if (edge.len - cursor > EPSILON) {
    spans.push({ lo: cursor, hi: edge.len });
  }

  return spans;
}

/** Signed perpendicular distance of a point from an edge's infinite line (`u` is unit length). */
function offLine(edge: BoundaryEdge, [x, y]: RoomPoint): number {
  return edge.ux * (y - edge.ay) - edge.uy * (x - edge.ax);
}

/** A point's arc-length coordinate along an edge's direction. */
function along(edge: BoundaryEdge, [x, y]: RoomPoint): number {
  return (x - edge.ax) * edge.ux + (y - edge.ay) * edge.uy;
}

/** The point at arc length `s` along an edge, snapped to the EPSILON grid so a computed split point
 *  lands on the exact same vertex key as the polygon endpoints around it ({@link MapBuilder} dedups
 *  vertices by exact value). */
function pointAt(edge: BoundaryEdge, s: number): RoomPoint {
  return [snap(edge.ax + edge.ux * s), snap(edge.ay + edge.uy * s)];
}

function snap(value: number): number {
  return Math.round(value * 1e6) / 1e6; // 1e6 = 1 / EPSILON
}
