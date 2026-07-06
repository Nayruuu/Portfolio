import { describe, expect, it } from 'vitest';
import { blockFaces, faceVisible, visibleBlockFaces, type BlockFace } from './sprite-block';
import { rotationCell } from './sprite-rotation';

describe('blockFaces', () => {
  it('builds four `width`-long faces, all centred on the anchor (two crossed quads)', () => {
    const faces = blockFaces(10, 20, 0.7, 1.25);

    expect(faces.map((f) => f.cell)).toEqual([0, 1, 2, 3]);
    for (const face of faces) {
      expect(Math.hypot(face.x2 - face.x1, face.y2 - face.y1)).toBeCloseTo(1.25, 10);
      // Every face passes through the thing's anchor — the crossed-quads centre.
      expect((face.x1 + face.x2) / 2).toBeCloseTo(10, 10);
      expect((face.y1 + face.y2) / 2).toBeCloseTo(20, 10);
    }
  });

  it('makes opposite faces the two sides of ONE quad (same segment, reversed endpoints)', () => {
    const faces = blockFaces(3, 4, 1.1, 2);

    for (let k = 0; k < 2; k++) {
      const front = faces[k];
      const back = faces[k + 2];

      expect(back.x1).toBeCloseTo(front.x2, 10);
      expect(back.y1).toBeCloseTo(front.y2, 10);
      expect(back.x2).toBeCloseTo(front.x1, 10);
      expect(back.y2).toBeCloseTo(front.y1, 10);
    }
  });

  it('orients each face by facing + cell·90°, u running screen-left → right head-on', () => {
    const faces = blockFaces(5, 5, 0, 2); // facing +x, half = 1

    // FRONT (cell 0): the segment perpendicular to facing, u=0 at y−1 (screen-left head-on).
    expect(faces[0]).toEqual({ x1: 5, y1: 4, x2: 5, y2: 6, cell: 0 });
    // RIGHT (cell 1, y-down convention): normal +y → its segment runs along the facing axis.
    expect(faces[1].x1).toBeCloseTo(6, 10);
    expect(faces[1].y1).toBeCloseTo(5, 10);
    expect(faces[1].x2).toBeCloseTo(4, 10);
    expect(faces[1].y2).toBeCloseTo(5, 10);
  });

  it('rotates the whole cross with the facing (cells permute onto the same segments)', () => {
    const base = blockFaces(0, 0, 0, 1);
    const turned = blockFaces(0, 0, Math.PI / 2, 1);

    // A quarter-turn maps face k of the turned block onto face k+1's geometry of the base block.
    for (let k = 0; k < 4; k++) {
      const rotated = turned[k];
      const expected = base[(k + 1) % 4];

      expect(rotated.x1).toBeCloseTo(expected.x1, 10);
      expect(rotated.y1).toBeCloseTo(expected.y1, 10);
      expect(rotated.x2).toBeCloseTo(expected.x2, 10);
      expect(rotated.y2).toBeCloseTo(expected.y2, 10);
    }
  });
});

describe('faceVisible', () => {
  const faces = blockFaces(5, 5, 0, 2);

  it('keeps a face whose outward normal points at the viewer, culls the rest', () => {
    // Viewer head-on in front (facing 0 → +x): only the FRONT face survives — the perpendicular
    // quad is edge-on (dot = 0) and the back side faces away.
    expect(faces.map((f) => faceVisible(f, 9, 5))).toEqual([true, false, false, false]);
    // Viewer behind: only the BACK face.
    expect(faces.map((f) => faceVisible(f, 1, 5))).toEqual([false, false, true, false]);
  });

  it('culls an edge-on face (viewer exactly in the face plane — dot = 0)', () => {
    const front = faces[0]; // the x = 5 vertical segment

    expect(faceVisible(front, 5, 9)).toBe(false); // on the face's own line → edge-on → culled
  });
});

describe('visibleBlockFaces', () => {
  it('returns exactly one face head-on and exactly two at 45°', () => {
    const headOn = visibleBlockFaces(5, 5, 0, 2, 9, 5);
    const diagonal = visibleBlockFaces(5, 5, 0, 2, 9, 9);

    expect(headOn.map((f) => f.cell)).toEqual([0]);
    expect(diagonal.map((f) => f.cell)).toEqual([0, 1]); // front + right (y-down: +y = right)
  });

  it('never exposes more than two faces, from any viewpoint outside the block', () => {
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * 2 * Math.PI;
      const count = visibleBlockFaces(
        3,
        4,
        0.6,
        1.5,
        3 + 5 * Math.cos(angle),
        4 + 5 * Math.sin(angle),
      ).length;

      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('shows the face rotationCell would pick, for a viewer head-on to that face', () => {
    // The block mode must agree with the billboard rotation convention: standing on the prop's
    // front/right/back/left axis, the single visible face wears the cell rotationCell selects.
    const facing = 0.5;

    for (let cell = 0; cell < 4; cell++) {
      const bearing = facing + (cell * Math.PI) / 2;
      const viewX = 7 + 6 * Math.cos(bearing);
      const viewY = 2 + 6 * Math.sin(bearing);
      const visible = visibleBlockFaces(7, 2, facing, 1, viewX, viewY);

      // Head-on the perpendicular quad is edge-on: fp noise in the bearing may leave it culled or
      // degenerate (zero projected width — the renderer skips it), but the axis cell always shows.
      expect(visible.map((f: BlockFace) => f.cell)).toContain(cell);
      expect(visible.length).toBeLessThanOrEqual(2);
      expect(rotationCell(facing, 7, 2, viewX, viewY)).toBe(cell);
    }
  });
});
