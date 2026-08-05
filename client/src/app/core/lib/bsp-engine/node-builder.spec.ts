import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector } from './node-builder';
import { SAMPLE_MAP } from './sample-map';
import type { NodeChild, Seg } from './types';

function totalLength(segs: readonly Seg[]): number {
  return segs.reduce((sum, s) => sum + Math.hypot(s.v2.x - s.v1.x, s.v2.y - s.v1.y), 0);
}

function eachNode(
  child: NodeChild,
  visit: (node: Extract<NodeChild, { kind: 'node' }>['node']) => void,
): void {
  if (child.kind !== 'node') {
    return;
  }
  visit(child.node);
  eachNode(child.node.front, visit);
  eachNode(child.node.back, visit);
}

describe('buildBsp', () => {
  it('compiles the sample map into a non-trivial BSP tree with subsectors', () => {
    const compiled = buildBsp(SAMPLE_MAP);

    expect(compiled.root.kind).toBe('node');
    expect(compiled.subsectors.length).toBeGreaterThan(1);
    expect(compiled.segs.length).toBeGreaterThan(0);
  });

  it('locates known points in the correct sector via the tree', () => {
    const { root } = buildBsp(SAMPLE_MAP);

    expect(locateSubSector(root, 8, 5).sector).toBe(1);
    expect(locateSubSector(root, 3, 5).sector).toBe(0);
    expect(locateSubSector(root, 1, 9).sector).toBe(0);
    expect(locateSubSector(root, 14, 2).sector).toBe(0);
  });

  it('produces single-sector, non-empty convex leaves', () => {
    const { subsectors } = buildBsp(SAMPLE_MAP);

    for (const sub of subsectors) {
      expect(sub.segs.length).toBeGreaterThan(0);
      expect(sub.segs.every((s) => s.sector === sub.sector)).toBe(true);
    }
  });

  it('conserves total seg length across splits (no seg lost or duplicated)', () => {
    const compiled = buildBsp(SAMPLE_MAP);

    const initialLength =
      10 +
      12 +
      Math.hypot(4, 4) +
      6 +
      16 +
      2 * (Math.hypot(4, 3) * 4) +
      2 * (Math.hypot(3, 2) * 4) +
      2 * (Math.hypot(2, 1) * 4);

    expect(totalLength(compiled.segs)).toBeCloseTo(initialLength, 6);
  });

  it('is deterministic — same input yields an identical tree', () => {
    expect(JSON.stringify(buildBsp(SAMPLE_MAP))).toBe(JSON.stringify(buildBsp(SAMPLE_MAP)));
  });

  it('keeps each child within the node union bounds', () => {
    const { root } = buildBsp(SAMPLE_MAP);

    eachNode(root, (node) => {
      const unionMinX = Math.min(node.frontBox.minX, node.backBox.minX);
      const unionMaxX = Math.max(node.frontBox.maxX, node.backBox.maxX);
      const unionMinY = Math.min(node.frontBox.minY, node.backBox.minY);
      const unionMaxY = Math.max(node.frontBox.maxY, node.backBox.maxY);

      for (const box of [node.frontBox, node.backBox]) {
        expect(box.minX).toBeGreaterThanOrEqual(unionMinX);
        expect(box.maxX).toBeLessThanOrEqual(unionMaxX);
        expect(box.minY).toBeGreaterThanOrEqual(unionMinY);
        expect(box.maxY).toBeLessThanOrEqual(unionMaxY);
      }
    });
  });
});
