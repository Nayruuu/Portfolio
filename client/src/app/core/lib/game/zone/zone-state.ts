// World-state persistence for the OPEN-BUILDING runtime: on leave, snapshot everything the player could
// have visibly changed; restore on re-entry so nothing respawns behind his back. Snapshots are deep-copied
// + FROZEN on write (a stored zone can't be mutated through the live state it was captured from). Player
// inventory (hp/mental/ammo/arsenal/badges) is deliberately NOT here — it travels with the player.

export interface ZoneEnemy {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly dead: boolean;
}

/** Every array is INDEX-ALIGNED with the level's authoring arrays (enemies↔roster, barrels↔sprites, etc.). */
export interface ZoneSnapshot {
  readonly enemies: readonly ZoneEnemy[];
  readonly barrels: readonly boolean[];
  readonly vitalsTaken: readonly boolean[];
  readonly ammoTaken: readonly boolean[];
  readonly cardsTaken: readonly boolean[];
  readonly weaponsTaken: readonly boolean[];
  readonly doors: readonly number[]; // per doors[] entry: openness 0 shut … 1 open (an unlock persists)
}

export class ZoneStates {
  private readonly zones = new Map<string, ZoneSnapshot>();

  public snapshot(key: string, state: ZoneSnapshot): void {
    this.zones.set(
      key,
      Object.freeze({
        enemies: Object.freeze(state.enemies.map((enemy) => Object.freeze({ ...enemy }))),
        barrels: Object.freeze([...state.barrels]),
        vitalsTaken: Object.freeze([...state.vitalsTaken]),
        ammoTaken: Object.freeze([...state.ammoTaken]),
        cardsTaken: Object.freeze([...state.cardsTaken]),
        weaponsTaken: Object.freeze([...state.weaponsTaken]),
        doors: Object.freeze([...state.doors]),
      }),
    );
  }

  /** null when the zone was never left (spawn it fresh). */
  public restore(key: string): ZoneSnapshot | null {
    return this.zones.get(key) ?? null;
  }

  public reset(): void {
    this.zones.clear();
  }
}

// module-scoped so it outlives the game component (leave /bsp, come back)
export const zoneStates = new ZoneStates();
