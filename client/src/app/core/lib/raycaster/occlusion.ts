import type { ColumnSpan } from './types';

/**
 * Screen-Y at which a GROUNDED billboard standing on floor height `floorZSprite` at perpendicular `depth`
 * has its feet clipped from BELOW by nearer terrain. A grounded sprite is hidden up to the SILHOUETTE of the
 * nearest geometry that stands in front of it and rises above its feet; the binding occluder is the one whose
 * top edge sits HIGHEST on screen (smallest `yTop`). `bottom` (the unclipped feet row) when none qualifies.
 *
 * TWO kinds of occluder, each clipped to its OWN `yTop` — the real far-edge/top-edge silhouette at its real
 * (nearer) distance, NEVER a height re-projected at the sprite's farther depth (that over-clips and eats
 * sprites that are actually in view):
 *   - a `FlatSpan` `'floor'` strip standing CLOSER (`nearDepth < depth`) and HIGHER (`worldZ > floorZSprite`)
 *     than the sprite's own floor — the "hill in front" that hides the lower body across rolling terrain;
 *   - a `'stepFloor'` riser FACE standing CLOSER (`depth < depth`) whose top edge is above the feet — the
 *     front of the step the sprite sits on (or a step in front of it), which hides the sprite's base when seen
 *     from BELOW, exactly as a box on a real stair tread is cut by the step's nosing. (A riser's top can equal
 *     the sprite's own floor height, so the `worldZ > floorZSprite` floor test would miss it — hence the
 *     separate riser pass, gated only by `yTop < clip` so a riser below the feet never cuts.)
 *
 * `'ceil'` strips and `'stepCeil'` risers are ABOVE and never clip the feet. A globally-flat level emits no
 * higher floor + no risers, so this always returns `bottom` there — byte-identical to the unclipped blit, no
 * special-case gate.
 *
 * The result may land ABOVE the sprite's `top` (the rise hides the whole sprite) — the caller computes
 * `drawnHeight = clip − top` and skips when it is ≤ 0, so this never clamps to `top`. Pure.
 */
export function spriteFeetClip(
  spans: readonly ColumnSpan[],
  depth: number,
  floorZSprite: number,
  bottom: number,
): number {
  let clip = bottom;

  for (const span of spans) {
    if (span.kind === 'floor') {
      // A nearer, higher floor surface — clip to its far-edge silhouette.
      if (span.worldZ > floorZSprite && span.nearDepth < depth && span.yTop < clip) {
        clip = span.yTop;
      }
    } else if (span.kind === 'stepFloor') {
      // A nearer riser FACE whose top rises above the feet — clip to its top edge (the step's nosing).
      if (span.depth < depth && span.yTop < clip) {
        clip = span.yTop;
      }
    }
  }

  return clip;
}
