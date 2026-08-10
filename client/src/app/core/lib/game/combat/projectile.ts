import type { ChainSpec } from '../types';

export interface Projectile {
  x: number;
  y: number;
  z: number;
  readonly dx: number;
  readonly dy: number;
  readonly vSlope: number; // vertical climb per cell of horizontal travel
  readonly speed: number;
  readonly kind: string;
  readonly impactKind: string;
  readonly damage: number;
  readonly radius: number;
  readonly splashR: number;
  readonly chain: ChainSpec | null;
  traveled: number;
  alive: boolean;
}

export interface Impact {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  age: number;
}

export interface Arc {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  age: number;
}
