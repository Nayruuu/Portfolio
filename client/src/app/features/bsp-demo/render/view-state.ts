import type { Camera } from '../../../core/lib/bsp-engine';
import type { RenderConfig } from './render-host';

/**
 * The render/aim VIEW value object: the shared player {@link Camera} + the mutated-in-place {@link RenderConfig}
 * (internal resolution + fov). BOTH are STABLE object references — the camera is turned/placed in place, the
 * config is switched in place on a fullscreen toggle — so a `ViewState` holds the SAME refs every collaborator
 * reads (never a defensive copy). Consumed by the world-FX painters (the screen-space projection), the sprite
 * build's view point, and the combat runtime's vertical aim-slope, so the two things that always travel together
 * ride as one cohesive parameter instead of a `(camera, config)` clump.
 */
export interface ViewState {
  /** The shared player camera — read for the render/aim pose here (turned + placed elsewhere, by reference). */
  readonly camera: Camera;
  /** The live render resolution + fov — mutated in place by a resolution switch, observed through this ref. */
  readonly config: RenderConfig;
}
