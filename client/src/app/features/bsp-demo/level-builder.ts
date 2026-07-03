import type {
  LineDef,
  MapSource,
  Sector,
  SideDef,
  Thing,
  Vertex,
  ZonePortalDef,
} from '../../core/lib/bsp-engine';

/**
 * A coordinate-based authoring builder for BSP {@link MapSource}s. You author in WORLD COORDINATES; it dedups
 * vertices and accumulates linedefs / sectors / things, so the error-prone vertex-INDEX juggling of raw
 * authoring (as in `demo-map.ts`) disappears.
 *
 * Winding is still the author's job, but the rule is one line: **a linedef's `front` side is the sector to the
 * RIGHT of `v1 → v2`** ("right" of direction `(dx,dy)` is `(dy,-dx)`). A one-sided {@link solid} wall fronts
 * its sector on that right; a two-sided {@link portal}'s `front` is the right-hand sector, `back` the left
 * (the renderer derives the upper/lower bands from the two sectors' heights, so which side is taller is free).
 *
 * A SHARED edge between two sectors is a single two-sided linedef — emit it ONCE as a `portal`, never as two
 * solids.
 */
export class MapBuilder {
  private readonly verts: Vertex[] = [];
  private readonly vertKey = new Map<string, number>();
  private readonly lines: LineDef[] = [];
  private readonly secs: Sector[] = [];
  private readonly thingList: Thing[] = [];

  /** Register a sector, returning its index (the order of `sector` calls defines the indices). */
  public sector(s: Sector): number {
    this.secs.push(s);

    return this.secs.length - 1;
  }

  /** A one-sided wall `(x1,y1) → (x2,y2)` fronting `sector` on its RIGHT (the edge of the world). */
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

  /** A two-sided portal `(x1,y1) → (x2,y2)`: `front` is the sector on the RIGHT of the edge, `back` on the left. */
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

  /** A two-sided FENCE edge `(x1,y1) → (x2,y2)`: renders exactly like a portal (open above the shared band)
   *  but can NEVER be crossed — the edge of waist-high blocking furniture (a counter, a turnstile rail) that
   *  the step-up physics would otherwise silently walk onto. */
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

  /** A two-sided GLASS wall `(x1,y1) → (x2,y2)`: see-through (the `back` sector renders through it) but
   *  BLOCKING — a window / interior partition. `front` is the right-hand sector, `back` the left; `tex` is
   *  the translucent glass overlay painted over the opening. */
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

  /** A two-sided textured GLASS PANE `(x1,y1) → (x2,y2)`: like {@link glass} (see-through + blocking), but its
   *  `tex` is a real glass image sampled PER PIXEL over the opening — opaque texels (mullions / reflections) are
   *  painted, clear texels stay see-through + tinted — the same treatment a sliding door leaf gets. */
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

  /** A two-sided automatic SLIDING GLASS door `(x1,y1) → (x2,y2)`: a DOUBLE door — two textured leaves that
   *  meet at the centre and retract toward their ends as it opens — barring the way until mostly open.
   *  Proximity-driven (auto-opens and auto-closes); NOT a `Level.doors[]` entry. */
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

  /** A LIVE ZONE-PORTAL seam `(x1,y1) → (x2,y2)` fronting `sector` on its RIGHT: a one-sided wall (so it
   *  stays solid for physics + hitscan) whose middle band renders ANOTHER zone's map — `portal.zone`'s
   *  world translated by `(dx, dy)` (neighbor point + offset = this map's point; TRANSLATION only, so both
   *  sides of a seam must be authored with the same orientation). `tex` is the solid fallback painted when
   *  the renderer is given no map for that zone. */
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

  /** Stamp a thing (spawn / prop) on the map. */
  public thing(x: number, y: number, angle: number, type: Thing['type']): void {
    this.thingList.push({ x, y, angle, type });
  }

  /** Assemble the authored map. */
  public build(): MapSource {
    return {
      vertices: this.verts,
      sectors: this.secs,
      linedefs: this.lines,
      things: this.thingList,
    };
  }

  /** Add (or reuse) a vertex at (x,y), returning its index. */
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
