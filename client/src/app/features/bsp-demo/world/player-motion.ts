import {
  climbTarget,
  HEADROOM,
  mantleStep,
  movePlayer,
  PLAYER_RADIUS,
  STEP_MAX,
  type CompiledMap,
  type Obstacle,
} from '../../../core/lib/bsp-engine';
import {
  CLIMB_MAX,
  CLIMB_PROBE_REACH,
  CLIMB_VAULT_ADVANCE,
  MANTLE_DURATION,
  MOVE_SPEED,
  type MovementDelta,
} from '../../../core/lib';
import { EYE_HEIGHT, type MutableCamera } from './zone-runtime';

// Auto-mantle (tuning in core/lib/game/game-tuning.ts): a ledge whose rise is in (STEP_MAX, CLIMB_MAX] is too
// tall to step but climbable — walking into it hoists the player up over MANTLE_DURATION while gliding
// CLIMB_VAULT_ADVANCE forward over the lip.

/** Non-null = mid auto-mantle: hoisting up over a too-tall-but-climbable ledge (movement/look frozen, gliding
 *  forward along the captured heading). `progress` 0→1 drives both the z-lerp and the hands overlay; the
 *  heading + the launch/target floors are captured once when the vault starts. `progress` is written each
 *  frame, so it is the one mutable field (the rest satisfy the engine's readonly {@link MantleState}). */
interface Mantle {
  progress: number;
  readonly startZ: number;
  readonly targetZ: number;
  readonly dirX: number;
  readonly dirY: number;
}

/** The active floor's motion-relevant geometry — the subset of the zone world {@link movePlayer} +
 *  {@link climbTarget} read (all by reference): the compiled map, the open sliding-door line indexes (a
 *  mostly-open slide stops blocking), and the solid decor obstacles props place on the floor. Structurally
 *  satisfied by the {@link WarmZone}; a test seats a light fixture. */
export interface MotionWorld {
  readonly map: CompiledMap;
  readonly slides: readonly number[];
  readonly obstacles: readonly Obstacle[];
}

/** The between-subsystem seams the player-motion needs but does NOT own: the SHARED player camera (moved +
 *  turned by reference — this writes `x`/`y`/`z`, reads `angle`), the active zone world (read by reference
 *  every tick, so a swap under our feet is picked up next frame), the movement axes + world-space want the
 *  input controller derives from the held keys, and the seamless-crossing check — a `from → to` move that
 *  steps over a passable seam performs the zone swap and returns true, which short-circuits the tick. */
export interface PlayerMotionHooks {
  /** The shared player camera — moved/eased in place here (`x`/`y`/`z` written, `angle` read), never copied. */
  readonly camera: MutableCamera;
  /** The active floor's live geometry (map + open slides + obstacles), read by reference each tick. */
  world(): MotionWorld;
  /** The current movement axes the held keys resolve to (`forward` ±1, `strafe` ±1). */
  movementAxes(): { forward: number; strafe: number };
  /** Map the axes + facing to the world-space want-displacement for one tick (before collision). */
  movementWant(angle: number, forward: number, strafe: number, reach: number): MovementDelta;
  /** Does the collided move `from → to` cross a passable seam? If so it performs the seamless zone swap and
   *  returns true — the caller wires it to gate on there being any seam, so a seam-less zone never probes. */
  crossSeam(fromX: number, fromY: number, toX: number, toY: number): boolean;
}

/**
 * The PLAYER MOTION of the BSP game: the physics collaborator that integrates the player's own body each tick
 * — read the movement axes, advance the walk-bob, resolve the collided/step-up move through {@link movePlayer},
 * take a seamless zone crossing (early-return — the world swapped under us), else commit the camera + ease the
 * eye onto the floor, then probe for a vaultable ledge ahead. It OWNS the auto-mantle state (the {@link Mantle}
 * hoist over a too-tall-but-climbable ledge) + the weapon walk-bob phase; the coordinator reads both (the
 * weapon/climb painter swaps to the two-handed pull mid-mantle and bobs the viewmodel by the phase) and drives
 * the two tick entry points (`stepMantle` while mantling, else `stepPlayerMotion`) in the SAME order the
 * monolithic tick did. The pure physics stays in core ({@link movePlayer}/{@link climbTarget}/{@link
 * mantleStep}); this is the stateful glue over the shared camera + the zone world (both by reference).
 */
export class PlayerMotion {
  // Non-null = mid auto-mantle (movement/look frozen, gliding forward along the captured heading). The
  // coordinator reads it (the climb overlay) + gates input on it; a zone reset clears it through `reset`.
  private mantleState: Mantle | null = null;
  private bobPhase = 0; // weapon idle-bob phase, advanced while moving

  constructor(private readonly hooks: PlayerMotionHooks) {}

  /** The weapon idle-bob phase, advanced only while moving — the weapon/FX painters bob the viewmodel by it. */
  public get bob(): number {
    return this.bobPhase;
  }

  /** The live auto-mantle pose (null outside a vault) — the climb overlay projects its grip line at
   *  `targetZ` and reads `progress`; the coordinator swaps the weapon for it while non-null. */
  public get mantle(): Mantle | null {
    return this.mantleState;
  }

  /** Mid an auto-mantle this frame? Input is frozen + the mantle tick owns the body while true. */
  public isMantling(): boolean {
    return this.mantleState !== null;
  }

  /** Clear the mantle on a zone reset / seam crossing (the world swapped — any in-flight vault is void). */
  public reset(): void {
    this.mantleState = null;
  }

  /** Integrate the player's own motion: read the movement axes, advance the walk-bob, resolve the collided
   *  move, take a seamless zone crossing (early-return — the world swapped under us), else commit the camera +
   *  ease the eye onto the floor, then probe for a vaultable ledge ahead. Only called when not mantling. */
  public stepPlayerMotion(dt: number): void {
    const { forward, strafe } = this.hooks.movementAxes();

    if (forward !== 0 || strafe !== 0) {
      this.bobPhase += dt * 9; // advance the weapon's walk-bob cadence only while moving
    }
    const reach = MOVE_SPEED * dt;
    const camera = this.hooks.camera;
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);
    const fromX = camera.x;
    const fromY = camera.y;
    const want = this.hooks.movementWant(camera.angle, forward, strafe, reach);
    const world = this.hooks.world();
    const moved = movePlayer(
      world.map,
      fromX,
      fromY,
      want.x,
      want.y,
      PLAYER_RADIUS,
      STEP_MAX,
      HEADROOM,
      world.slides,
      true, // the player may cross PASSABLE seams — the crossing check right below performs the swap
      world.obstacles,
    );

    // SEAMLESS crossing: stepping over a passable live seam swaps zones INSTANTLY — no fade. The portal
    // already showed exactly what now surrounds the player, so the view must not (and does not) jump.
    if (this.hooks.crossSeam(fromX, fromY, moved.x, moved.y)) {
      return; // the world swapped under our feet; next frame continues in the new zone
    }

    camera.x = moved.x;
    camera.y = moved.y;

    // Ease the eye toward the floor under us, so stepping up/down is smooth rather than a jump.
    const targetZ = moved.floorZ + EYE_HEIGHT;

    camera.z += (targetZ - camera.z) * Math.min(1, 12 * dt);
    this.tryClimb(forward, cos, sin, moved.floorZ);
  }

  /** Advance the auto-mantle one frame: glide forward along the captured heading by the slice of
   *  {@link CLIMB_VAULT_ADVANCE} covered this tick, lerp the eye from the launch floor up to the ledge, and
   *  clear the state on completion (snapping the eye exactly onto the ledge). Look + walk stay frozen so the
   *  vault always clears the lip. */
  public stepMantle(dt: number): void {
    const m = this.mantleState;

    if (m === null) {
      return;
    }
    const step = mantleStep(m, dt, MANTLE_DURATION, CLIMB_VAULT_ADVANCE, EYE_HEIGHT);
    const camera = this.hooks.camera;

    camera.x += step.dx;
    camera.y += step.dy;
    camera.z = step.z;

    if (step.done) {
      this.mantleState = null; // landed on the ledge (the eye snapped exactly onto it)
    } else {
      m.progress = step.progress;
    }
  }

  /** Trigger a climb: pushing FORWARD into a too-tall-but-climbable ledge straight ahead. `movePlayer` has
   *  already blocked the player a radius off it (its rise > STEP_MAX), so the probe just classifies that
   *  obstacle as a vaultable ledge. A normal step (≤ STEP_MAX) is `null` here and was already walked up. */
  private tryClimb(forward: number, cos: number, sin: number, floorZ: number): void {
    if (forward <= 0) {
      return;
    }
    const camera = this.hooks.camera;
    const ledge = climbTarget(
      this.hooks.world().map,
      camera.x,
      camera.y,
      floorZ,
      cos,
      sin,
      CLIMB_PROBE_REACH,
      STEP_MAX,
      CLIMB_MAX,
      HEADROOM,
    );

    if (ledge !== null) {
      this.mantleState = { progress: 0, startZ: floorZ, targetZ: ledge, dirX: cos, dirY: sin };
    }
  }
}
