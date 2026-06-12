import { describe, it, expect } from 'vitest';
import { spriteFeetClip } from './occlusion';
import type { FlatSpan, StepSpan } from './types';

/** A floor/ceiling FLAT strip standing `nearDepth` away at world height `worldZ`, its top edge at `yTop`. */
function flat(
  nearDepth: number,
  worldZ: number,
  yTop: number,
  kind: 'floor' | 'ceil' = 'floor',
): FlatSpan {
  return { kind, yTop, yBottom: 0, worldZ, material: 1, nearDepth };
}

/** A riser FACE standing `depth` away, its top edge at `yTop`. `stepFloor` = floor riser (a feet occluder);
 *  `stepCeil` = ceiling riser (never clips the feet). */
function step(depth: number, yTop: number, kind: 'stepFloor' | 'stepCeil' = 'stepFloor'): StepSpan {
  return {
    kind,
    depth,
    yTop,
    yBottom: 0,
    vTop: 0,
    vBottom: 1,
    side: 0,
    cell: 1,
    texX: 0,
    wallU: 0,
  };
}

describe('spriteFeetClip', () => {
  it('returns the unchanged bottom on a flat level (no spans → byte-identical)', () => {
    expect(spriteFeetClip([], 5, 0, 180)).toBe(180);
  });

  it('returns the unchanged bottom when every floor strip sits at the sprite floor height', () => {
    // Three same-height ('worldZ === floorZSprite') floor strips — the always-present flat tiling. None is
    // HIGHER than the sprite's own floor, so nothing clips → draw the whole sprite (flat byte-identity).
    const spans = [flat(2, 0, 120), flat(3, 0, 110), flat(8, 0, 100)];

    expect(spriteFeetClip(spans, 5, 0, 180)).toBe(180);
  });

  // ---- nearer, higher FLOOR surfaces (the "hill in front") ----

  it('clips the feet to a nearer, higher floor strip’s own top-edge silhouette', () => {
    // Nearer ('nearDepth 2 < 5') AND higher ('worldZ 0.4 > 0') → clip to the strip's screen `yTop`.
    expect(spriteFeetClip([flat(2, 0.4, 130)], 5, 0, 180)).toBe(130);
  });

  it('IGNORES a ceil strip — only floor surfaces occlude the feet', () => {
    // Nearer AND higher, but kind 'ceil' → neither branch matches.
    expect(spriteFeetClip([flat(2, 0.4, 130, 'ceil')], 5, 0, 180)).toBe(180);
  });

  it('IGNORES a floor strip FARTHER than the sprite (nearDepth ≥ depth)', () => {
    // Higher than the sprite floor, but at depth 8 ≥ 5 → behind the sprite, cannot hide its feet.
    expect(spriteFeetClip([flat(8, 0.4, 130)], 5, 0, 180)).toBe(180);
  });

  it('IGNORES a nearer floor strip that is LOWER than (or equal to) the sprite floor', () => {
    // Nearer ('nearDepth 2 < 5') but worldZ 0 is not > the sprite floor 0.3 → not a hill in front.
    expect(spriteFeetClip([flat(2, 0, 130)], 5, 0.3, 180)).toBe(180);
  });

  it('keeps the un-clipped bottom when a higher floor’s top is BELOW the feet (yTop ≥ bottom)', () => {
    // A faint rise whose silhouette sits below the feet hides nothing — the `span.yTop < clip` guard.
    expect(spriteFeetClip([flat(2, 0.4, 190)], 5, 0, 180)).toBe(180);
  });

  // ---- nearer RISER faces (a box on a step seen FROM BELOW — the step's nosing) ----

  it('clips the feet to a nearer stepFloor riser’s top edge (the step nosing, seen from below)', () => {
    // The front face of the step the box sits on — nearer ('depth 2 < 5'), top above the feet ('yTop 140').
    expect(spriteFeetClip([step(2, 140)], 5, 0.3, 180)).toBe(140);
  });

  it('IGNORES a stepCeil riser — a ceiling riser never clips the feet', () => {
    expect(spriteFeetClip([step(2, 140, 'stepCeil')], 5, 0.3, 180)).toBe(180);
  });

  it('IGNORES a stepFloor riser FARTHER than the sprite (depth ≥ sprite depth)', () => {
    expect(spriteFeetClip([step(8, 140)], 5, 0.3, 180)).toBe(180);
  });

  it('IGNORES a stepFloor riser whose top is BELOW the feet (yTop ≥ bottom)', () => {
    expect(spriteFeetClip([step(2, 185)], 5, 0.3, 180)).toBe(180);
  });

  // ---- combined ----

  it('picks the HIGHEST silhouette (smallest yTop) across floors AND risers', () => {
    // A higher floor (yTop 140), a nearer riser (yTop 120), and a lower riser (below the feet, ignored).
    const spans = [flat(2, 0.6, 140), step(3, 120), step(1, 188)];

    expect(spriteFeetClip(spans, 5, 0, 180)).toBe(120);
  });
});
