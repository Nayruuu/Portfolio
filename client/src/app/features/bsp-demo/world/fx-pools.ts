import type { Arc, Impact, Projectile } from '../../../core/lib';

/**
 * The transient in-world combat FX pools value object: launched {@link Projectile}s in flight, impact-burst
 * {@link Impact}s, and plasma chain {@link Arc}s. Owned by the component as ONE stable `fx` holder — a zone reset
 * / a seam crossing CLEARS or shifts them by mutating the holder's arrays through the SAME reference
 * (`fx.projectiles = []`), so every collaborator that captured `fx` keeps seeing the live pools without a
 * per-array accessor thunk. The combat runtime pushes into these arrays by reference; the world-FX painter draws
 * them; the coordinator ages them out. Not world state (they never cross a zone), so they live beside — not
 * inside — the {@link WarmZone}.
 */
export interface FxPools {
  projectiles: Projectile[];
  impacts: Impact[];
  arcs: Arc[];
}
