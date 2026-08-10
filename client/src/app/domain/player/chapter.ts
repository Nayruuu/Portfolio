import { SceneId } from './scene-id';

export interface Chapter {
  /** Player scene identifier (see `SceneId`); lives in content.*.json, compared by equality. */
  id: SceneId;
  timestamp: string;
  title: string;
  seconds: number;
}
