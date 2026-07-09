import type { LineDef, MapSource, Sector, SideDef, Thing, Vertex, ZonePortalDef } from './types';

// Winding rule: a linedef's `front` side is the sector to the RIGHT of `v1 → v2` (right of (dx,dy) is
// (dy,-dx)). A SHARED edge between two sectors is ONE two-sided `portal`, never two solids.
export class MapBuilder {
  private readonly verts: Vertex[] = [];
  private readonly vertKey = new Map<string, number>();
  private readonly lines: LineDef[] = [];
  private readonly secs: Sector[] = [];
  private readonly thingList: Thing[] = [];

  // Call order defines the sector indices.
  public sector(s: Sector): number {
    this.secs.push(s);

    return this.secs.length - 1;
  }

  public solid(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sector: number,
    tex = 'BRICK',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(sector, tex),
      back: null,
    });
  }

  public portal(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    front: number,
    back: number,
    tex = 'METAL',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(front, tex),
      back: this.side(back, tex),
    });
  }

  // Renders like a portal but can NEVER be crossed — waist-high blocking furniture the step-up physics
  // would otherwise silently walk onto.
  public fence(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    front: number,
    back: number,
    tex = 'METAL',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(front, tex),
      back: this.side(back, tex),
      fence: true,
    });
  }

  // See-through (back sector renders through it) but BLOCKING.
  public glass(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    front: number,
    back: number,
    tex = 'GLASS',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(front, tex),
      back: this.side(back, tex),
      glass: true,
    });
  }

  // Like glass but `tex` is sampled PER PIXEL: opaque texels painted, clear texels stay see-through + tinted.
  public glassPane(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    front: number,
    back: number,
    tex = 'GLASS_PANE',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(front, tex),
      back: this.side(back, tex),
      glass: true,
      pane: true,
    });
  }

  // Proximity-driven double door; NOT a `Level.doors[]` entry.
  public slidingDoor(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    front: number,
    back: number,
    tex = 'DOOR_GLASS',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(front, tex),
      back: this.side(back, tex),
      glass: true,
      sliding: true,
    });
  }

  // One-sided wall (stays solid for physics + hitscan) whose middle band renders another zone's map,
  // translated by (dx, dy). TRANSLATION only — both sides of a seam must be authored same-oriented.
  public zonePortal(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sector: number,
    portal: ZonePortalDef,
    tex = 'BRICK',
  ): void {
    this.lines.push({
      v1: this.vertex(x1, y1),
      v2: this.vertex(x2, y2),
      front: this.side(sector, tex),
      back: null,
      zonePortal: { ...portal },
    });
  }

  public thing(x: number, y: number, angle: number, type: Thing['type']): void {
    this.thingList.push({ x, y, angle, type });
  }

  public build(): MapSource {
    return {
      vertices: this.verts,
      sectors: this.secs,
      linedefs: this.lines,
      things: this.thingList,
    };
  }

  private vertex(x: number, y: number): number {
    const key = `${x},${y}`;
    const existing = this.vertKey.get(key);

    if (existing !== undefined) {
      return existing;
    }
    const index = this.verts.length;

    this.verts.push({ x, y });
    this.vertKey.set(key, index);

    return index;
  }

  private side(sector: number, tex: string): SideDef {
    return { sector, xOffset: 0, yOffset: 0, upperTex: tex, lowerTex: tex, middleTex: tex };
  }
}
