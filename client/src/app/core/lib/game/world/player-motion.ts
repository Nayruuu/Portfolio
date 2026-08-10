import {
  climbTarget,
  HEADROOM,
  mantleStep,
  movePlayer,
  PLAYER_RADIUS,
  STEP_MAX,
  type CompiledMap,
  type Obstacle,
} from '../../bsp-engine';
import {
  CLIMB_MAX,
  CLIMB_PROBE_REACH,
  CLIMB_VAULT_ADVANCE,
  MANTLE_DURATION,
  MOVE_SPEED,
} from '../game-tuning';
import type { MovementDelta } from '../controls';
import { EYE_HEIGHT, type MutableCamera } from './zone-runtime';

interface Mantle {
  progress: number;
  readonly startZ: number;
  readonly targetZ: number;
  readonly dirX: number;
  readonly dirY: number;
}

export interface MotionWorld {
  readonly map: CompiledMap;
  readonly slides: readonly number[];
  readonly obstacles: readonly Obstacle[];
}

export interface PlayerMotionHooks {
  readonly camera: MutableCamera;
  world(): MotionWorld;
  movementAxes(): { forward: number; strafe: number };
  movementWant(angle: number, forward: number, strafe: number, reach: number): MovementDelta;
  crossSeam(fromX: number, fromY: number, toX: number, toY: number): boolean;
}

export class PlayerMotion {
  private mantleState: Mantle | null = null;
  private bobPhase = 0;

  constructor(private readonly hooks: PlayerMotionHooks) {}

  public get bob(): number {
    return this.bobPhase;
  }

  public get mantle(): Mantle | null {
    return this.mantleState;
  }

  public isMantling(): boolean {
    return this.mantleState !== null;
  }

  public reset(): void {
    this.mantleState = null;
  }

  public stepPlayerMotion(dt: number): void {
    const { forward, strafe } = this.hooks.movementAxes();

    if (forward !== 0 || strafe !== 0) {
      this.bobPhase += dt * 9;
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
      true, // player may cross PASSABLE seams — the crossing check below performs the swap
      world.obstacles,
    );

    if (this.hooks.crossSeam(fromX, fromY, moved.x, moved.y)) {
      return; // world swapped under us — continue next frame in the new zone
    }

    camera.x = moved.x;
    camera.y = moved.y;

    const targetZ = moved.floorZ + EYE_HEIGHT;

    camera.z += (targetZ - camera.z) * Math.min(1, 12 * dt);
    this.tryClimb(forward, cos, sin, moved.floorZ);
  }

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
      this.mantleState = null;
    } else {
      m.progress = step.progress;
    }
  }

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
