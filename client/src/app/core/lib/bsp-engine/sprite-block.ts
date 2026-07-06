/**
 * World-anchored WALL-SPRITE geometry for directional props (the Build-engine upgrade over DOOM's
 * cell-switched billboards). A rotation billboard always faces the camera and SNAPS between cells at
 * the quadrant boundaries; a BLOCK prop instead anchors its four rotation cells onto vertical quads
 * fixed in the world — orbiting it shows two quads at 45°, each in true perspective, with real
 * parallax and no snap.
 *
 * Geometry: the four cells mount on TWO CROSSED QUADS through the thing's (x, y) — front/back share
 * the segment perpendicular to `facing`, left/right the segment along it — each `width` long, one
 * cell per SIDE (face `cell`'s outward normal points at `facing + cell·90°`; 0 front · 1 right ·
 * 2 back · 3 left, y-down like {@link rotationCell}, so back-face culling shows the cell the viewer
 * would have been served by the billboard). Centre-crossed rather than offset to a square's edges ON
 * PURPOSE: the rotation sheets are full-object VIEWS (each cell draws the whole prop, centred, with
 * alpha margins), so mounting them on a box's offset faces shows two complete objects a footprint
 * apart — the crossed quads make the two visible views intersect at the prop's axis and read as ONE
 * object. Texture `u` runs 0 at (`x1`,`y1`) → 1 at (`x2`,`y2`), chosen so a head-on viewer reads the
 * cell exactly as the billboard drew it (u grows screen-left → screen-right).
 */

/** One vertical quad side of a prop block: its two world endpoints (u = 0 → 1) + the cell it wears. */
export interface BlockFace {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly cell: number;
}

const HALF_TURN = Math.PI / 2;

/**
 * The four faces of a block prop: two crossed centre-anchored segments of length `width`, one face
 * per side, rotated by `facing` (radians, 0 = +x — a {@link Thing.angle}). Pure. Opposite faces
 * (k, k+2) are the SAME world segment with reversed endpoints — the two sides of one quad — so the
 * back-face culling below always keeps at most one of each pair.
 */
export function blockFaces(x: number, y: number, facing: number, width: number): BlockFace[] {
  const half = width / 2;
  // Tangent = the face normal rotated +90°: u then runs screen-left → screen-right for a head-on
  // viewer (side = −u in camera space), matching the billboard's left-to-right cell mapping. The
  // BACK side of each quad is its twin's exact endpoint SWAP (not a re-derived angle+π tangent):
  // fp-exact opposite normals, so a pair's two `faceVisible` dots are exact negatives and at most
  // one side of each quad ever passes the cull — even on a knife-edge viewpoint.
  const quad = (angle: number, cell: number): [BlockFace, BlockFace] => {
    const x1 = x + Math.sin(angle) * half;
    const y1 = y - Math.cos(angle) * half;
    const x2 = x - Math.sin(angle) * half;
    const y2 = y + Math.cos(angle) * half;

    return [
      { x1, y1, x2, y2, cell },
      { x1: x2, y1: y2, x2: x1, y2: y1, cell: cell + 2 },
    ];
  };
  const [front, back] = quad(facing, 0);
  const [right, left] = quad(facing + HALF_TURN, 1);

  return [front, right, back, left];
}

/**
 * Back-face culling: a face is visible only when its outward normal points toward the viewer
 * (strictly positive dot product). An edge-on face (the viewer in the face's plane — dot = 0) is
 * culled too: it projects to a zero-width line, and dropping it here is what guarantees the
 * renderer's projected endpoints never coincide. At most two faces of a block survive — one side of
 * each crossed quad.
 */
export function faceVisible(face: BlockFace, viewX: number, viewY: number): boolean {
  // The outward normal of P1→P2 is (dy, −dx) — see the tangent choice in {@link blockFaces}.
  const dx = face.x2 - face.x1;
  const dy = face.y2 - face.y1;
  const midX = (face.x1 + face.x2) / 2;
  const midY = (face.y1 + face.y2) / 2;

  return (viewX - midX) * dy - (viewY - midY) * dx > 0;
}

/** The ≤ 2 faces of the block at (`x`,`y`) visible from (`viewX`,`viewY`) — {@link blockFaces}
 *  filtered by {@link faceVisible}. Pure — called where a frame's sprite list is projected, so the
 *  CPU painter and the GPU command builder rasterise the exact same faces. */
export function visibleBlockFaces(
  x: number,
  y: number,
  facing: number,
  width: number,
  viewX: number,
  viewY: number,
): BlockFace[] {
  return blockFaces(x, y, facing, width).filter((face) => faceVisible(face, viewX, viewY));
}
