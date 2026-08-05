// Coordinates are a flat 2D map plane (x right, y up); the third dimension is per-sector floorZ/ceilZ.

export type ThingType =
  | 'player_start'
  | 'barrel'
  | 'prop'
  | 'prop_screen'
  | 'prop_totem'
  | 'prop_board'
  | 'prop_chair'
  | 'prop_cooler';

export interface Vertex {
  readonly x: number;
  readonly y: number;
}

export interface Sector {
  readonly floorZ: number;
  readonly ceilZ: number;
  readonly floorTex: string;
  readonly ceilTex: string;
  readonly light: number; // 0..255
}

// Mutable per-zone clone so the game can animate heights live (doors).
export type MutableSector = { -readonly [K in keyof Sector]: Sector[K] };

// TRANSLATION ONLY (no rotation) — both sides of a seam must be authored same-oriented. Authored on a
// ONE-SIDED line, keeping the seam solid for hitscan. `passable` makes it a walkable doorway (the two
// sides must share their floor height — no cross-zone step check).
export interface ZonePortalDef {
  readonly zone: string;
  readonly dx: number;
  readonly dy: number;
  readonly passable?: boolean;
}

export interface SideDef {
  readonly sector: number; // index into MapSource.sectors
  readonly xOffset: number;
  readonly yOffset: number;
  readonly upperTex: string; // band above a neighbour's lower ceiling (two-sided)
  readonly lowerTex: string; // band below a neighbour's higher floor (two-sided)
  readonly middleTex: string; // the full wall (one-sided), or a see-through midtex
}

// `back === null` = solid one-sided wall (edge of the world); non-null = two-sided portal. Front is to
// the right of `v1 -> v2`.
export interface LineDef {
  readonly v1: number; // index into MapSource.vertices
  readonly v2: number;
  readonly front: SideDef;
  readonly back: SideDef | null;
  readonly glass?: boolean; // see-through (back renders through) but STILL blocks
  readonly pane?: boolean; // sample middleTex PER PIXEL over the opening (vs the flat tint wash of bare glass)
  readonly sliding?: boolean; // panel covers the opening when shut; openness fed per-frame, geometry never moves
  readonly fence?: boolean; // renders open but can NEVER be crossed
  readonly zonePortal?: ZonePortalDef; // solid for movement unless `passable`
}

export interface Thing {
  readonly x: number;
  readonly y: number;
  readonly angle: number; // radians, 0 = +x
  readonly type: ThingType;
}

export interface MapSource {
  readonly vertices: readonly Vertex[];
  readonly sectors: readonly Sector[];
  readonly linedefs: readonly LineDef[];
  readonly things: readonly Thing[];
}

export interface Seg {
  readonly v1: Vertex; // post-split endpoints, in map coords
  readonly v2: Vertex;
  readonly linedef: number;
  readonly side: 0 | 1; // 0 = same direction as the linedef (front), 1 = reversed (back)
  readonly sector: number;
}

// Convex region, all within one sector.
export interface SubSector {
  readonly segs: readonly Seg[];
  readonly sector: number;
}

export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// Front = the right-hand half-plane.
export interface Partition {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

export type NodeChild =
  | { readonly kind: 'node'; readonly node: BspNode }
  | { readonly kind: 'leaf'; readonly subsector: SubSector };

export interface BspNode {
  readonly partition: Partition;
  readonly frontBox: BBox;
  readonly backBox: BBox;
  readonly front: NodeChild;
  readonly back: NodeChild;
}

export interface CompiledMap {
  readonly source: MapSource;
  readonly segs: readonly Seg[];
  readonly subsectors: readonly SubSector[];
  readonly root: NodeChild;
}
