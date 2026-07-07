// core/lib/game/combat/barrel — a shootable, destructible billboard (a barrel). It rides a bsp-engine
// `Sprite` (core → core, legal) and tracks whether it is still standing.

import type { Sprite } from '../../bsp-engine';

/** A shootable billboard (a destructible barrel): its sprite + whether it is still standing. */
export interface Barrel {
  readonly sprite: Sprite;
  alive: boolean;
}
