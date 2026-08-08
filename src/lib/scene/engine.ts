/**
 * The scene engine contract.
 *
 * `/render` is not a map viewer — it is a deterministic frame server that a
 * headless browser screenshots. So the engine exposes exactly two verbs:
 * "put the camera at frame i" and "tell me when frame i is genuinely paintable".
 * There is no animation, no wall-clock interpolation, and no internal state that
 * depends on the order frames are requested in. Frame i must look the same
 * whether it is requested first, last, or twice.
 */

import type { CameraKeyframe, LngLat } from "@/lib/types";

export interface SceneEngine {
  /** Resolves once the engine is constructed and its style/assets are up. */
  readonly ready: Promise<void>;
  /**
   * Apply a frame's camera and route state instantly. Must not animate.
   * Returns once the frame is fully loaded and painted, or rejects on timeout —
   * a video with holes in the terrain is worse than a failed job (spec §7).
   */
  seek(frame: number): Promise<void>;
  destroy(): void;
  /** True when real Mapbox tiles are in play; false for the token-less placeholder. */
  readonly isReal: boolean;
}

export interface SceneInput {
  container: HTMLElement;
  keyframes: CameraKeyframe[];
  route: LngLat[];
  routeProgressIndex: number[];
  /** Reject a seek that has not settled within this many ms. */
  frameTimeoutMs: number;
}

export const LIME = "#C8F135";

/** Waits two animation frames, i.e. "the browser has actually painted this". */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Slice the route for a frame; always at least a 2-point line so the layer is valid. */
export function trailFor(route: LngLat[], upTo: number): LngLat[] {
  const end = Math.max(1, Math.min(route.length - 1, upTo));
  return route.slice(0, end + 1);
}
