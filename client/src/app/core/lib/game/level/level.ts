import type { WeaponId } from '../../../../domain';
import type { MapSource } from '../../bsp-engine';
import type { EnemySpec } from '../enemy';
import type { KeycardColor } from '../types';

export interface Level {
  readonly map: MapSource;
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number };
  readonly enemies: readonly { readonly spec: EnemySpec; readonly x: number; readonly y: number }[];
  readonly health: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly armor: readonly (readonly [number, number, ('large' | 'small')?])[];
  readonly ammo: readonly (readonly [number, number])[]; // one coord per AMMO_BOX_SPECS entry, IN ORDER
  readonly weapons?: readonly (readonly [number, number, WeaponId])[];
  readonly keycards: readonly (readonly [number, number, KeycardColor])[];
  readonly exit?: readonly [number, number];
  // OPEN-BUILDING graph edges: `to` = a LEVELS registry key, `entry` = a named arrival in the target.
  readonly exits?: readonly {
    readonly x: number;
    readonly y: number;
    readonly to: string;
    readonly entry: string;
  }[];
  readonly entries?: Readonly<
    Record<string, { readonly x: number; readonly y: number; readonly angle: number }>
  >;
  readonly doors: readonly {
    readonly sector: number;
    readonly triggerX: number;
    readonly triggerY: number;
    readonly requiresCard: KeycardColor | null; // null = automatic (no badge)
  }[];
}
