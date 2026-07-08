/**
 * World-state persistence for the OPEN-BUILDING runtime. Per-floor maps stay separately authored
 * (`Level`), but at play time the game is ONE persistent building: zones connected by `Level.exits` /
 * `Level.entries`, swapped live by the component's `loadZone`. When the player leaves a zone the component
 * snapshots everything he could have visibly changed — enemies (dead, or alive but moved/hurt), popped
 * barrels, taken pickups, opened doors — and restores it on re-entry, so NOTHING respawns behind his back.
 * Player inventory (hp / mental / ammo / arsenal / badges) is deliberately NOT here: it travels with the
 * player across zones.
 *
 * A module-scoped singleton (a plain instance — no Angular DI: the one canvas-driven game component is the
 * only consumer, and module scope lets the building survive leaving `/bsp` and coming back). Pure data
 * in/out: snapshots are deep-copied + frozen on write, so a stored zone can never be mutated through the
 * live game state it was captured from.
 */

/** One roster enemy's persisted state: where it stood + its hp — or `dead` (a corpse: it stays down). */
export interface ZoneEnemy {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly dead: boolean;
}

/** Everything a zone remembers while the player is elsewhere. Every array is INDEX-ALIGNED with the
 *  level's authoring arrays: `enemies` with the roster, `barrels` with the map's barrel sprites,
 *  `vitalsTaken` with `health` then `armor` (spawn order), `ammoTaken`/`cardsTaken`/`weaponsTaken`/`doors`
 *  with theirs. (A taken WEAPON pickup stays gone like any other pickup — but the weapon itself is
 *  inventory: ownership travels with the player, never through here.) */
export interface ZoneSnapshot {
  readonly enemies: readonly ZoneEnemy[];
  readonly barrels: readonly boolean[]; // still standing?
  readonly vitalsTaken: readonly boolean[];
  readonly ammoTaken: readonly boolean[];
  readonly cardsTaken: readonly boolean[];
  readonly weaponsTaken: readonly boolean[];
  readonly doors: readonly number[]; // per doors[] entry: openness 0 shut … 1 open (an unlock persists)
}

/** The per-zone snapshot store — see the module doc. `snapshot` on leave, `restore` on entry (`null` =
 *  never visited, spawn fresh), `reset` on a new game (the whole building respawns). */
export class ZoneStates {
  private readonly zones = new Map<string, ZoneSnapshot>();

  /** Persist `state` for zone `key` (replacing any previous snapshot) as an immutable deep copy. */
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

  /** The stored snapshot for `key`, or `null` when the zone was never left (spawn it fresh). */
  public restore(key: string): ZoneSnapshot | null {
    return this.zones.get(key) ?? null;
  }

  /** Forget every zone — a NEW GAME (the death/win restart): the whole building respawns. */
  public reset(): void {
    this.zones.clear();
  }
}

/** THE building's state — module-scoped so it outlives the game component (leave `/bsp`, come back). */
export const zoneStates = new ZoneStates();
