import type { Sprite } from '../../bsp-engine';

export interface Barrel {
  readonly sprite: Sprite;
  alive: boolean;
}
