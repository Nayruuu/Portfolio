// core/lib/game/combat/projectile — a player projectile in flight plus the two short-lived visual bursts it
// produces on impact (the blast strip + the plasma's chain-lightning arc). Pure data shapes, zero DOM.

import type { ChainSpec } from '../types';

/** A projectile in flight: a 3D position + horizontal heading + speed, the effects `kind` that draws it, and
 *  its blast on impact. It flies along the firing pitch — `z` climbs by `vSlope` per cell travelled — so a
 *  shot aimed over a barrel sails past it. */
export interface Projectile {
  x: number;
  y: number;
  z: number; // world height, climbing with `vSlope` as it flies (so the vertical aim carries through)
  readonly dx: number;
  readonly dy: number;
  readonly vSlope: number; // vertical climb per cell of horizontal travel (from the pitch at launch)
  readonly speed: number;
  readonly kind: string; // effects.json projectile kind → its sprite + drop + anchor at draw time
  readonly impactKind: string; // effects.json impact kind → the burst strip played where it lands
  readonly damage: number; // damage dealt to an enemy on a direct hit (and within the splash)
  readonly radius: number; // collision half-width (cells)
  readonly splashR: number;
  readonly chain: ChainSpec | null; // the plasma's chain-lightning rider (null = no chain)
  traveled: number;
  alive: boolean;
}

/** A short-lived impact burst at a world point: an `impacts` strip animation (`kind`) played once from `age`,
 *  billboarded at (`x`,`y`,`z`) and culled when the strip finishes. */
export interface Impact {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  age: number;
}

/** A short-lived chain-lightning arc between two world points (their mid-body height), faded over its age. */
export interface Arc {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  age: number;
}
