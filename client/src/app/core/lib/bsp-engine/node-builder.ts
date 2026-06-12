import type { BBox, CompiledMap, MapSource, NodeChild, Partition, Seg, SubSector } from './types';

/**
 * The BSP compiler. Carves a {@link MapSource} into a binary tree of convex {@link SubSector} leaves —
 * the structure the software renderer (SP2) walks front-to-back, and physics (SP4) uses for point
 * location. Simple-but-correct: partition selection just minimises splits + imbalance; a balanced/
 * optimised builder can come later without changing the output contract.
 *
 * Convention: a wall's FRONT is the right-hand side of `v1 -> v2`, which here is the **negative** signed
 * side (see {@link signedSide}). A two-sided linedef yields two opposing segs, one fronting each sector.
 */

const EPS = 1e-9;

/** Signed side of point (`px`,`py`) vs the directed partition line. < 0 = front (right), > 0 = back. */
export function signedSide(part: Partition, px: number, py: number): number {
  return part.dx * (py - part.y) - part.dy * (px - part.x);
}

/** The infinite line carrying a seg, as a partition. */
function partitionOf(seg: Seg): Partition {
  return { x: seg.v1.x, y: seg.v1.y, dx: seg.v2.x - seg.v1.x, dy: seg.v2.y - seg.v1.y };
}

type Classification = 'front' | 'back' | 'spanning' | 'coincident';

/** Where a seg falls relative to a partition line. */
function classify(part: Partition, seg: Seg): Classification {
  const d1 = signedSide(part, seg.v1.x, seg.v1.y);
  const d2 = signedSide(part, seg.v2.x, seg.v2.y);
  const front = d1 < -EPS || d2 < -EPS;
  const back = d1 > EPS || d2 > EPS;

  if (front && back) {
    return 'spanning';
  }
  if (front) {
    return 'front';
  }
  if (back) {
    return 'back';
  }

  return 'coincident'; // both endpoints on the line
}

/** Split a spanning seg at the partition line into its front and back pieces. */
function split(part: Partition, seg: Seg): { front: Seg; back: Seg } {
  const d1 = signedSide(part, seg.v1.x, seg.v1.y);
  const d2 = signedSide(part, seg.v2.x, seg.v2.y);
  const t = d1 / (d1 - d2);
  const hit = { x: seg.v1.x + t * (seg.v2.x - seg.v1.x), y: seg.v1.y + t * (seg.v2.y - seg.v1.y) };
  const a: Seg = { ...seg, v2: hit };
  const b: Seg = { ...seg, v1: hit };

  return d1 < 0 ? { front: a, back: b } : { front: b, back: a };
}

/** Pick the seg whose line best partitions the set (fewest splits, most balanced), or null if convex. */
function chooseSplitter(segs: readonly Seg[]): Seg | null {
  let best: Seg | null = null;
  let bestScore = Infinity;

  for (const candidate of segs) {
    const part = partitionOf(candidate);
    let front = 0;
    let back = 0;
    let spanning = 0;

    for (const seg of segs) {
      if (seg === candidate) {
        continue;
      }
      const side = classify(part, seg);

      if (side === 'front') {
        front++;
      } else if (side === 'back') {
        back++;
      } else if (side === 'spanning') {
        spanning++;
      }
    }

    if (back === 0 && spanning === 0) {
      continue;
    } // does not separate anything → not a splitter

    const score = spanning * 8 + Math.abs(front - back);

    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** Axis-aligned bounds of a seg set. */
function boundsOf(segs: readonly Seg[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const seg of segs) {
    minX = Math.min(minX, seg.v1.x, seg.v2.x);
    minY = Math.min(minY, seg.v1.y, seg.v2.y);
    maxX = Math.max(maxX, seg.v1.x, seg.v2.x);
    maxY = Math.max(maxY, seg.v1.y, seg.v2.y);
  }

  return { minX, minY, maxX, maxY };
}

/** Build a leaf, recording it in the accumulator. The leaf's sector is its segs' (a convex cell is one). */
function makeLeaf(segs: readonly Seg[], outSegs: Seg[], outSubs: SubSector[]): NodeChild {
  const subsector: SubSector = { segs, sector: segs[0].sector };

  outSubs.push(subsector);
  outSegs.push(...segs);

  return { kind: 'leaf', subsector };
}

/** Recursively partition a seg set into a BSP subtree. */
function build(segs: readonly Seg[], outSegs: Seg[], outSubs: SubSector[]): NodeChild {
  const splitter = chooseSplitter(segs);

  if (splitter === null) {
    return makeLeaf(segs, outSegs, outSubs);
  }

  const part = partitionOf(splitter);
  const front: Seg[] = [];
  const back: Seg[] = [];

  for (const seg of segs) {
    const side = classify(part, seg);

    if (side === 'front') {
      front.push(seg);
    } else if (side === 'back') {
      back.push(seg);
    } else if (side === 'spanning') {
      const pieces = split(part, seg);

      front.push(pieces.front);
      back.push(pieces.back);
    } else {
      // coincident: keep it with the half it faces (same direction as the partition → front).
      const dot = (seg.v2.x - seg.v1.x) * part.dx + (seg.v2.y - seg.v1.y) * part.dy;

      (dot >= 0 ? front : back).push(seg);
    }
  }

  return {
    kind: 'node',
    node: {
      partition: part,
      frontBox: boundsOf(front),
      backBox: boundsOf(back),
      front: build(front, outSegs, outSubs),
      back: build(back, outSegs, outSubs),
    },
  };
}

/** Generate the initial segs: one per one-sided wall, two (opposing) for each two-sided portal. */
function initialSegs(map: MapSource): Seg[] {
  const segs: Seg[] = [];

  map.linedefs.forEach((line, linedef) => {
    const a = map.vertices[line.v1];
    const b = map.vertices[line.v2];

    segs.push({ v1: a, v2: b, linedef, side: 0, sector: line.front.sector });
    if (line.back !== null) {
      segs.push({ v1: b, v2: a, linedef, side: 1, sector: line.back.sector });
    }
  });

  return segs;
}

/** Compile a source map into its BSP tree, segs, and subsectors. */
export function buildBsp(map: MapSource): CompiledMap {
  const segs: Seg[] = [];
  const subsectors: SubSector[] = [];
  const root = build(initialSegs(map), segs, subsectors);

  return { source: map, segs, subsectors, root };
}

/** Walk the BSP to the subsector containing (`x`,`y`). */
export function locateSubSector(root: NodeChild, x: number, y: number): SubSector {
  let child = root;

  while (child.kind === 'node') {
    child = signedSide(child.node.partition, x, y) < 0 ? child.node.front : child.node.back;
  }

  return child.subsector;
}
