import type { EnemyCombat } from './enemy-spec';

export interface EnemyArt {
  readonly texName: string;
  readonly atlasUrl: string;
  readonly walkCols: number;
  readonly walkRows: number; // angle rows, in order: front · ¾front · side · ¾back · back
  readonly deathTexName: string;
  readonly deathUrl: string;
  readonly deathFrames: number;
  readonly deathFps: number;
  readonly attackTexName: string;
  readonly attackUrl: string;
  readonly attackFrames: number;
  readonly attackFps: number;
  readonly attackAspect?: number; // set only when the attack cell differs from `aspect`
  readonly painTexName: string;
  readonly painUrl: string;
  readonly aspect: number;
  readonly walkStepRate: number; // walk frames advanced per world cell travelled
}

export interface EnemySpec extends EnemyArt, EnemyCombat {}
