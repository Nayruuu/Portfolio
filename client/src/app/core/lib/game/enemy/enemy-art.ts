// core/lib/game/enemy/enemy-art — the ART half of an enemy kind (atlas layout + animation cadence) and the
// full `EnemySpec` that composes it with the art-free `EnemyCombat`. Pure data shapes, zero DOM: the
// renderer reads the atlas/animation fields; the AI/hitscan steps read only the `EnemyCombat` half.
import type { EnemyCombat } from './enemy-spec';

/** The atlas layout + animation cadence of an enemy kind — the art half of {@link EnemySpec} (its combat +
 *  world-sizing half is {@link EnemyCombat}). */
export interface EnemyArt {
  readonly texName: string; // walk atlas key
  readonly atlasUrl: string; // served walk atlas (a `walkCols`×`walkRows` grid)
  readonly walkCols: number;
  readonly walkRows: number; // angle rows (front · ¾front · side · ¾back · back)
  readonly deathTexName: string;
  readonly deathUrl: string;
  readonly deathFrames: number;
  readonly deathFps: number;
  readonly attackTexName: string;
  readonly attackUrl: string;
  readonly attackFrames: number;
  readonly attackFps: number; // plays once across the wind-up
  readonly attackAspect?: number; // cell width/height of the attack atlas if it differs from `aspect`
  readonly painTexName: string;
  readonly painUrl: string;
  readonly aspect: number; // cell width / height → billboard width : height
  readonly walkStepRate: number; // walk frames advanced per world cell travelled
}

/** A full enemy kind = its art ({@link EnemyArt}) + its combat/physics tuning ({@link EnemyCombat}). */
export interface EnemySpec extends EnemyArt, EnemyCombat {}
