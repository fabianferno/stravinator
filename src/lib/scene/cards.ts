/**
 * Intro and outro card opacity, as a pure function of frame index.
 *
 * Deliberately not a CSS transition: a transition is driven by wall-clock time,
 * so frame 12 would look different depending on how long the capture driver took
 * to get there. Opacity is computed from `i` alone and applied as an inline
 * style, which keeps the "same index, same pixels" guarantee intact.
 */

import { OUTPUT } from "@/lib/types";

/** Frames the intro is fully opaque before it starts fading. */
const INTRO_HOLD = Math.round(OUTPUT.fps * 0.7);
/** Frames the intro takes to fade out. */
const INTRO_FADE = Math.round(OUTPUT.fps * 0.5);
/** Frames the outro takes to fade in. */
const OUTRO_FADE = Math.round(OUTPUT.fps * 0.5);
/** Frames the outro is fully opaque at the end. */
const OUTRO_HOLD = Math.round(OUTPUT.fps * 1.0);

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Ease so the fade doesn't read as a linear wipe. */
function ease(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function introOpacity(frame: number): number {
  if (frame <= INTRO_HOLD) return 1;
  return ease(1 - (frame - INTRO_HOLD) / INTRO_FADE);
}

export function outroOpacity(frame: number, frameCount: number): number {
  const start = frameCount - (OUTRO_HOLD + OUTRO_FADE);
  if (frame < start) return 0;
  return ease((frame - start) / OUTRO_FADE);
}

/** The HUD hides completely behind a fully-opaque card. */
export function hudOpacity(frame: number, frameCount: number): number {
  return clamp01(1 - Math.max(introOpacity(frame), outroOpacity(frame, frameCount)));
}
