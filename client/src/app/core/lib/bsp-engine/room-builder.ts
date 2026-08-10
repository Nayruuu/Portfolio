import { MapBuilder } from './level-builder';
import type { MapSource, Sector, Thing, ZonePortalDef } from './types';

// y grows DOWN, as everywhere in the engine.
export type RoomPoint = readonly [number, number];

export type ConnectionKind = 'portal' | 'glass' | 'glassPane' | 'slidingDoor' | 'fence';

export interface RoomSpec extends Sector {
  readonly wallTex: string;
  // Overrides single edges by index — edge `i` runs polygon[i] → polygon[i+1] AS GIVEN, whichever winding.
  readonly walls?: Readonly<Record<number, string>>;
}

export interface ConnectOptions {
  readonly kind?: ConnectionKind;
  readonly tex?: string;
  readonly at?: readonly [number, number, number, number]; // shrink the opening to a sub-span of the overlap
}

// zBase is the floor of the room BELOW the flight; step i's floor = zBase + (i+1)·dz.
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

// A room-graph authoring layer compiling to MapBuilder calls: normalizes the winding, splits a long wall
// around a doorway, emits each connection ONCE as a two-sided line, and walls up every unclaimed span.
export class RoomBuilder {
  private readonly builder = new MapBuilder();
  // Only rooms register here — islands and holes have no carve-able boundary.
  private readonly boundaries = new Map<number, readonly BoundaryEdge[]>();
  private sectorCount = 0;

  // Defers boundary walls until build() so later connects can carve openings out of them.
  public room(polygon: readonly RoomPoint[], spec: RoomSpec): number {
    const edges = orientedEdges(polygon, spec.wallTex, spec.walls, `room ${this.sectorCount}`);
    const sector = this.addSector(spec);

    this.boundaries.set(sector, edges);

    return sector;
  }

  // Replaces each colinear overlap between the rooms with ONE two-sided line (front = room `a`). Throws if
  // they share no colinear overlap (or the `at` span sits outside every overlap).
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

  // A room wholly INSIDE `host`: every edge becomes a portal — or a blocking fence when `fenced`.
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

  // Emits the `at` span of one boundary wall as a one-sided zonePortal line, the rest staying solid.
  // Throws when the span lies on no boundary edge of the room.
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

  // A solid column/pillar inside `host`: the polygon's inside is dead space the BSP never enters.
  public hole(host: number, polygon: readonly RoomPoint[], tex: string): void {
    // Oriented interior-on-the-right then emitted REVERSED, so the host (the only renderable side) fronts.
    for (const e of orientedEdges(polygon, tex, undefined, `hole in sector ${host}`)) {
      this.builder.solid(e.bx, e.by, e.ax, e.ay, host, e.tex);
    }
  }

  // A flight of step rooms chained by portals, climbing on the RIGHT of the base edge `from → to`. The
  // caller connects the flight's ends. Returns the step sectors, bottom → top.
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
        this.connect(sectors[i - 1], sector, { tex: spec.wallTex });
      }
      sectors.push(sector);
    }

    return sectors;
  }

  public thing(x: number, y: number, angle: number, type: Thing['type']): void {
    this.builder.thing(x, y, angle, type);
  }

  // Terminal: consumes the boundaries.
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

  // Sector VALUES only — RoomSpec's wall dressing must not leak into the map.
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

// Coordinates are decimals (0.1-deep backdrop boxes exist), so exact equality is out.
const EPSILON = 1e-6;

// A directed room-boundary edge — interior on the RIGHT of a→b — plus the spans already carved out of it
// (arc lengths from the `a` end).
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

interface Overlap {
  readonly edge: BoundaryEdge;
  readonly other: BoundaryEdge;
  readonly lo: number;
  readonly hi: number;
}

// Canonical winding = interior on the RIGHT of every edge = a NEGATIVE shoelace sum with y down. A
// polygon wound the other way is reversed edge by edge, so `walls` indices keep pointing at the same edges.
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

function overlapSpan(edge: BoundaryEdge, other: BoundaryEdge): { lo: number; hi: number } | null {
  // Colinear = both of `other`'s endpoints sit on `edge`'s infinite line…
  if (Math.abs(offLine(edge, [other.ax, other.ay])) > EPSILON) {
    return null;
  }
  if (Math.abs(offLine(edge, [other.bx, other.by])) > EPSILON) {
    return null;
  }
  // …and ANTIPARALLEL: facing rooms' interior-on-the-right edges run opposite (a same-direction pair is
  // two walls of rooms on the SAME side).
  if (edge.ux * other.ux + edge.uy * other.uy >= 0) {
    return null;
  }
  const s0 = along(edge, [other.ax, other.ay]);
  const s1 = along(edge, [other.bx, other.by]);
  const lo = Math.max(0, Math.min(s0, s1));
  const hi = Math.min(edge.len, Math.max(s0, s1));

  return hi - lo > EPSILON ? { lo, hi } : null;
}

// Narrow the overlaps to the single `at` sub-span, or throw if it fits inside none.
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

// The gaps between an edge's merged cuts, dropping slivers ≤ EPSILON.
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

// Signed perpendicular distance of a point from an edge's infinite line (u is unit length).
function offLine(edge: BoundaryEdge, [x, y]: RoomPoint): number {
  return edge.ux * (y - edge.ay) - edge.uy * (x - edge.ax);
}

function along(edge: BoundaryEdge, [x, y]: RoomPoint): number {
  return (x - edge.ax) * edge.ux + (y - edge.ay) * edge.uy;
}

// Snapped to the EPSILON grid so a computed split point lands on the exact same vertex key as the
// polygon endpoints (MapBuilder dedups vertices by exact value).
function pointAt(edge: BoundaryEdge, s: number): RoomPoint {
  return [snap(edge.ax + edge.ux * s), snap(edge.ay + edge.uy * s)];
}

function snap(value: number): number {
  return Math.round(value * 1e6) / 1e6; // 1e6 = 1 / EPSILON
}
