import type { Camera } from '../../bsp-engine';
import type { RenderConfig } from './render-host';

/** Both fields are STABLE object references (camera turned/placed in place, config switched in place on a
 *  fullscreen toggle) — a `ViewState` holds the SAME refs every collaborator reads, never a defensive copy. */
export interface ViewState {
  readonly camera: Camera;
  readonly config: RenderConfig;
}
