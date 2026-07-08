import type { WeaponId } from '../../../../domain';
import type { MapSource } from '../../bsp-engine';
import type { EnemySpec } from '../enemy';
import type { KeycardColor } from '../types';

/** A self-contained playable level: geometry + every entity placement the demo component stamps. */
export interface Level {
  readonly map: MapSource;
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number };
  readonly enemies: readonly { readonly spec: EnemySpec; readonly x: number; readonly y: number }[];
  // health / mental(armor) pickups — `[x, y]` (large by default) or `[x, y, 'small']` for the small variant.
  readonly health: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly armor: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly ammo: readonly (readonly [number, number])[]; // one coordinate per AMMO_BOX_SPECS entry, in order
  // WEAPON pickups — `[x, y, weaponId]`: the DOOM progression rewards. The run starts FISTS-ONLY, so every
  // other weapon (chainsaw included) must be FOUND; collecting one unlocks it for the rest of the run
  // (ownership is inventory — it travels across zones) and grants one standard ammo box of its type.
  readonly weapons?: readonly (readonly [number, number, WeaponId])[];
  // access badges — `[x, y, color]`; each z is resolved from the floor it sits on (e.g. the dais, +1.6).
  readonly keycards: readonly (readonly [number, number, KeycardColor])[];
  // The WIN goal (z resolved from the floor) — reach it → level complete. A level wired into the
  // open-building graph may keep one alongside its `exits` (both work simultaneously) or omit it.
  readonly exit?: readonly [number, number];
  // OPEN-BUILDING graph (see core/lib/game/zone/zone-state.ts): walk-into transition points to sibling zones (`to` = a
  // `LEVELS` key, `entry` = a named arrival of the target) + this level's own named arrival points. A
  // level without `exits` keeps the single legacy `exit` behaviour above.
  readonly exits?: readonly {
    readonly x: number;
    readonly y: number;
    readonly to: string;
    readonly entry: string;
  }[];
  readonly entries?: Readonly<
    Record<string, { readonly x: number; readonly y: number; readonly angle: number }>
  >;
  // animated doors — open on approach (a null `requiresCard` = an automatic/unlocked door; a colour = badge-gated).
  readonly doors: readonly {
    readonly sector: number;
    readonly triggerX: number;
    readonly triggerY: number;
    readonly requiresCard: KeycardColor | null; // the badge colour the door needs (null = automatic, no badge)
  }[];
}
