/**
 * The DOOM-style map data model for the from-scratch BSP software engine.
 *
 * Two layers: the **source** map (authored — vertices, linedefs, sidedefs, sectors, things) and the
 * **compiled** map (produced by the node builder — segs, subsectors, a BSP tree). The renderer (SP2+)
 * and physics (SP4) consume the compiled form; humans/tools author the source form.
 *
 * Coordinates are a flat 2D map plane (x right, y up). The third dimension is per-sector: `floorZ` /
 * `ceilZ`. Distances are abstract map units (the projection scale is a renderer concern, not here).
 */

/** A thing = a point of interest stamped on the map (spawn, props; enemies/pickups in SP6). */
export type ThingType =
  | 'player_start'
  | 'barrel'
  | 'prop'
  | 'prop_screen'
  | 'prop_totem'
  | 'prop_board'
  | 'prop_chair'
  | 'prop_cooler';

/** A 2D point on the map plane. */
export interface Vertex {
  readonly x: number;
  readonly y: number;
}

/** A floor/ceiling region: the heights + surface textures + brightness that define a walkable area. */
export interface Sector {
  readonly floorZ: number;
  readonly ceilZ: number;
  readonly floorTex: string;
  readonly ceilTex: string;
  readonly light: number; // 0..255 sector brightness
}

/**
 * A LIVE window into another zone's map: the linedef's opening renders `zone`'s world, translated by
 * (`dx`, `dy`) — a neighbor point plus the offset lands on this map's point. TRANSLATION ONLY (no
 * rotation): the two sides of a seam must be authored with matching orientation. Authored on a
 * ONE-SIDED line (`back === null`), which keeps the seam solid for hitscan (shots never cross zones);
 * the renderer fills its middle band from the neighbor map when one is provided (solid `middleTex`
 * fallback).
 *
 * `passable` makes the seam a WALKABLE doorway: `movePlayer` (asked to `crossSeams`) lets the CROSSING
 * body through, and the game swaps zones the instant the player steps over the line — the seamless
 * counterpart of the walk-into exit fade. The two sides of a passable seam must share their floor
 * height (there is no cross-zone step check). Default false = stage-2 behaviour, a solid live window.
 */
export interface ZonePortalDef {
  readonly zone: string;
  readonly dx: number;
  readonly dy: number;
  readonly passable?: boolean;
}

/** One face of a linedef: which sector it fronts, plus the textures painted on its wall bands. */
export interface SideDef {
  readonly sector: number; // index into MapSource.sectors
  readonly xOffset: number;
  readonly yOffset: number;
  readonly upperTex: string; // band above a neighbour's lower ceiling (two-sided)
  readonly lowerTex: string; // band below a neighbour's higher floor (two-sided)
  readonly middleTex: string; // the full wall (one-sided), or a see-through midtex
}

/**
 * A wall edge between two vertices. `back === null` is a solid **one-sided** wall (the edge of the
 * world); a non-null `back` is a **two-sided** line — a portal between two sectors (a doorway, a window,
 * or a step where the floors/ceilings differ). The front side is to the right of `v1 -> v2`.
 */
export interface LineDef {
  readonly v1: number; // index into MapSource.vertices
  readonly v2: number;
  readonly front: SideDef;
  readonly back: SideDef | null;
  // A see-through GLASS wall: a two-sided line (the back sector renders through it) that STILL blocks the
  // player, with a translucent overlay (its `front.middleTex`) painted over the opening — a window / partition.
  readonly glass?: boolean;
  // A textured glass PANE: sample the `front.middleTex` over the opening PER PIXEL (opaque texels = mullions /
  // reflections, clear texels = see-through + tint), exactly like a sliding door leaf — instead of the flat
  // tint wash a bare `glass` line gets. A static full-width mapping (the pane shows once across the window).
  readonly pane?: boolean;
  // An automatic SLIDING DOOR: a two-sided line whose panel (its `front.middleTex`) covers the opening when
  // shut and retracts sideways into the wall as it opens. Its openness is supplied per-frame to the renderer
  // (a covered fraction) and gates a dedicated collision; the BSP geometry itself never moves.
  readonly sliding?: boolean;
  // A FENCE: a two-sided line that renders open (see-over/see-through) but can NEVER be crossed — the edge of
  // waist-high blocking furniture (a reception counter, a turnstile rail) the step-up physics would otherwise
  // silently walk onto.
  readonly fence?: boolean;
  // A LIVE ZONE PORTAL (see {@link ZonePortalDef}): this line's opening shows another zone's map. Solid for
  // hitscan always; solid for movement too unless the portal is `passable` (a seamless walk-through crossing —
  // the walk-into `exits` fade remains the mechanism for non-seam edges).
  readonly zonePortal?: ZonePortalDef;
}

/** A point of interest placed on the map (position + facing). */
export interface Thing {
  readonly x: number;
  readonly y: number;
  readonly angle: number; // radians, 0 = +x
  readonly type: ThingType;
}

/** The authored map. */
export interface MapSource {
  readonly vertices: readonly Vertex[];
  readonly sectors: readonly Sector[];
  readonly linedefs: readonly LineDef[];
  readonly things: readonly Thing[];
}

// ---------------------------------------------------------------------------
// Compiled (produced by the node builder).
// ---------------------------------------------------------------------------

/** A (possibly split) directed wall segment carved out by the node builder, fronting one sector. */
export interface Seg {
  readonly v1: Vertex; // post-split endpoints, in map coords
  readonly v2: Vertex;
  readonly linedef: number; // the source linedef this seg was carved from
  readonly side: 0 | 1; // 0 = same direction as the linedef (front), 1 = reversed (back)
  readonly sector: number; // the sector this seg fronts
}

/** A BSP leaf: a convex region bounded by its segs, all within one sector. */
export interface SubSector {
  readonly segs: readonly Seg[];
  readonly sector: number;
}

/** An axis-aligned bounds used to cull BSP subtrees. */
export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A splitting line: a point (`x`,`y`) and a direction (`dx`,`dy`). Front = the right-hand half-plane. */
export interface Partition {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

/** A BSP tree link: either an internal node or a leaf subsector. */
export type NodeChild =
  | { readonly kind: 'node'; readonly node: BspNode }
  | { readonly kind: 'leaf'; readonly subsector: SubSector };

/** An internal BSP node: a partition line and its two half-spaces (each a node or a leaf). */
export interface BspNode {
  readonly partition: Partition;
  readonly frontBox: BBox;
  readonly backBox: BBox;
  readonly front: NodeChild;
  readonly back: NodeChild;
}

/** The full compiled map: the source plus the carved segs, the subsectors, and the BSP root. */
export interface CompiledMap {
  readonly source: MapSource;
  readonly segs: readonly Seg[];
  readonly subsectors: readonly SubSector[];
  readonly root: NodeChild;
}
