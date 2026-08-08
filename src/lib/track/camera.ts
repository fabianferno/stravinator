import type { CameraKeyframe } from "../types";
import type { SplineSample, Spline } from "./spline";
import { isFiniteNumber } from "./geo";

/**
 * Camera framing constants. v1 ships one preset with zero user knobs (spec
 * §6), but the numbers live here as named constants because tuning these is
 * the fastest lever on how the output feels.
 */

/**
 * Degrees from vertical. 65 is a chase-helicopter angle: high enough that the
 * route line ahead stays readable and the horizon sits in the upper third of a
 * 9:16 frame, low enough that 3D terrain relief actually reads as relief.
 * Mapbox caps pitch at 85; anything past ~72 puts most of the frame in sky.
 */
export const PITCH = 65;

/**
 * Mapbox zoom. 14.5 is roughly a 1-2 km visible span at this pitch — the
 * route reads as a route rather than a squiggle, and terrain tiles are
 * available at full detail. Lower and the athlete is a dot; higher and the
 * camera outruns the tile budget.
 */
export const ZOOM = 14.5;

export interface AssembleInput {
  spline: Spline;
  /** one per frame, uniformly spaced by arc length */
  samples: SplineSample[];
  /** one per frame, already smoothed and wrapped to [0, 360) */
  bearings: number[];
  pitch?: number;
  zoom?: number;
}

/** Combine geometry, heading and framing into the final keyframe array. */
export function assembleKeyframes(input: AssembleInput): CameraKeyframe[] {
  const { spline, samples, bearings } = input;
  if (samples.length !== bearings.length) {
    throw new Error(
      `track/camera: sample count ${samples.length} != bearing count ${bearings.length}`,
    );
  }
  if (samples.length === 0) {
    throw new Error("track/camera: cannot assemble zero keyframes");
  }
  const pitch = input.pitch ?? PITCH;
  const zoom = input.zoom ?? ZOOM;
  const n = samples.length;

  return samples.map((s, i) => {
    const { lng, lat } = spline.projector.toLngLat(s.p);
    // Progress is derived from the frame index, not from arc length, because
    // the samples are uniform in arc length by construction and index-based
    // progress is exactly monotonic and exactly hits 0 and 1.
    const progress = n === 1 ? 1 : i / (n - 1);
    const kf: CameraKeyframe = {
      center: [lng, lat],
      bearing: bearings[i],
      pitch,
      zoom,
      elevation: s.ele,
      progress,
    };
    assertFiniteKeyframe(kf, i);
    return kf;
  });
}

/** Fail loudly rather than shipping NaN into the renderer. */
export function assertFiniteKeyframe(kf: CameraKeyframe, index: number): void {
  const checks: Array<[string, number]> = [
    ["center[0]", kf.center[0]],
    ["center[1]", kf.center[1]],
    ["bearing", kf.bearing],
    ["pitch", kf.pitch],
    ["zoom", kf.zoom],
    ["elevation", kf.elevation],
    ["progress", kf.progress],
  ];
  for (const [name, value] of checks) {
    if (!isFiniteNumber(value)) {
      throw new Error(
        `track/camera: keyframe ${index} field ${name} is not finite (${value})`,
      );
    }
  }
}
