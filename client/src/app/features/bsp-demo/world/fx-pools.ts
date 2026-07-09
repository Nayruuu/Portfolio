import type { Arc, Impact, Projectile } from '../../../core/lib';

// ONE stable holder: collaborators capture `fx` and a reset/crossing mutates its arrays through the SAME
// reference (`fx.projectiles = []`), so no per-array accessor thunk is needed.
export interface FxPools {
  projectiles: Projectile[];
  impacts: Impact[];
  arcs: Arc[];
}
