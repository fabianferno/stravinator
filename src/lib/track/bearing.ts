import { angleDelta } from "../types";
import { bearingFromXY, normalizeBearing } from "./geo";
import { gaussianSmooth } from "./altitude";
import type { SplineSample } from "./spline";

/**
 * Bearing smoothing — the part that decides whether the video looks cinematic
 * or seasick.
 *
 * The non-negotiable step is UNWRAPPING. Angles live on a circle; filters do
 * not. A 359 deg -> 1 deg step is +2 deg, not -358 deg, and any filter applied
 * to wrapped degrees will yank the camera through a full rotation at every
 * north crossing. So: unwrap to a continuous real-valued series, filter there,
 * and only wrap back at the very end.
 */

/**
 * Gaussian sigma for the low-pass, in FRAMES. At 30 fps, sigma = 10 gives a
 * ~0.33 s time constant and a ~0.7 s visible response: the camera leans into a
 * corner rather than snapping to it, while still tracking the route closely
 * enough that the line ahead stays in shot.
 *
 * Gaussian (a symmetric, zero-phase kernel) rather than a one-pole EMA
 * specifically because an EMA lags: the camera would consistently point at
 * where the runner *was*. Zero phase keeps the heading centred on the turn.
 */
export const BEARING_SIGMA_FRAMES = 10;

/**
 * Hard cap on how fast the camera may yaw, degrees per frame.
 *
 * 4 deg/frame = 120 deg/s at 30 fps. Above roughly this rate a full-bleed
 * vertical video reads as a whip-pan and induces motion sickness on a phone
 * held at arm's length; below it, a 180 deg switchback takes ~1.5 s to swing
 * through, which is about how long a drone operator would take. This is the
 * documented bearing-continuity threshold the tests assert against.
 */
export const MAX_TURN_RATE_DEG_PER_FRAME = 4;

/**
 * Unwrap a wrapped angle series into a continuous one, using the shortest
 * signed step between consecutive samples. Output starts at `series[0]` and is
 * NOT confined to [0, 360).
 */
export function unwrapAngles(series: number[]): number[] {
  if (series.length === 0) return [];
  const out = [series[0]];
  for (let i = 1; i < series.length; i++) {
    out.push(out[i - 1] + angleDelta(series[i - 1], series[i]));
  }
  return out;
}

/** Inverse of `unwrapAngles`: fold back into [0, 360). */
export function wrapAngles(series: number[]): number[] {
  return series.map(normalizeBearing);
}

/** Zero-phase low-pass over an already-unwrapped angle series. */
export function lowPassAngles(
  unwrapped: number[],
  sigma = BEARING_SIGMA_FRAMES,
): number[] {
  return gaussianSmooth(unwrapped, sigma);
}

/**
 * Clamp the per-step change of a series. Applied after the low-pass as a hard
 * guarantee: no matter how pathological the input, the camera cannot yaw
 * faster than `maxStep` per frame. It is causal, so on an extreme turn the
 * output lags briefly and then catches up.
 */
export function slewLimit(
  series: number[],
  maxStep = MAX_TURN_RATE_DEG_PER_FRAME,
): number[] {
  if (series.length === 0) return [];
  const out = [series[0]];
  for (let i = 1; i < series.length; i++) {
    const prev = out[i - 1];
    const delta = series[i] - prev;
    const clamped = Math.max(-maxStep, Math.min(maxStep, delta));
    out.push(prev + clamped);
  }
  return out;
}

export interface BearingOptions {
  sigma?: number;
  maxStep?: number;
}

/**
 * Raw (wrapped) bearings in, cinematic bearings in [0, 360) out.
 * Continuity is guaranteed in the angular sense: `angleDelta` between any two
 * consecutive outputs is within `maxStep`.
 */
export function smoothBearings(raw: number[], opts: BearingOptions = {}): number[] {
  if (raw.length === 0) return [];
  const safe = raw.map((v, i) => (Number.isFinite(v) ? v : (raw[i - 1] ?? 0)));
  const unwrapped = unwrapAngles(safe);
  const filtered = lowPassAngles(unwrapped, opts.sigma ?? BEARING_SIGMA_FRAMES);
  const limited = slewLimit(filtered, opts.maxStep ?? MAX_TURN_RATE_DEG_PER_FRAME);
  return wrapAngles(limited);
}

/** Raw heading of each spline sample, from its tangent. */
export function bearingsFromSamples(samples: SplineSample[]): number[] {
  return samples.map((s) => bearingFromXY(s.t.x, s.t.y));
}
