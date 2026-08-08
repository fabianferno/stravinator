import {
  OUTPUT,
  type ActivityStats,
  type CameraKeyframe,
  type LngLat,
  type RawTrack,
} from "../types";
import {
  cleanPoints,
  resampleByDistance,
  routeLength,
  smoothPositions,
} from "./resample";
import { buildSpline, sampleUniform } from "./spline";
import { smoothAltitude } from "./altitude";
import { bearingsFromSamples, smoothBearings } from "./bearing";
import { assembleKeyframes } from "./camera";
import { haversine } from "./geo";

export { PITCH, ZOOM } from "./camera";
export { MAX_TURN_RATE_DEG_PER_FRAME, BEARING_SIGMA_FRAMES } from "./bearing";
export { MEDIAN_WINDOW, GAUSSIAN_SIGMA } from "./altitude";
export * from "./geo";
export * from "./resample";
export * from "./spline";
export * from "./altitude";
export * from "./bearing";
export * from "./camera";

/**
 * Route length at which the video is at its minimum / maximum duration.
 * A 5 km parkrun and a 100 km sportive should not get the same 30 seconds;
 * equally, nobody watches a 3-minute flyover on Reels. Duration ramps
 * linearly between these bounds and clamps at OUTPUT.min/maxDurationSec.
 */
export const SHORT_ROUTE_M = 2_000;
export const LONG_ROUTE_M = 20_000;

/** Best available route length in metres: Strava's own figure, else measured. */
export function trackLength(track: RawTrack): number {
  if (Number.isFinite(track?.distance) && track.distance > 0) return track.distance;
  return routeLength(cleanPoints(track?.points ?? []));
}

/** Frame count for a track: duration scales with length, clamped to 20-40 s. */
export function frameCountFor(track: RawTrack): number {
  assertTrack(track);
  const length = trackLength(track);
  const span = LONG_ROUTE_M - SHORT_ROUTE_M;
  const u = Math.min(1, Math.max(0, (length - SHORT_ROUTE_M) / span));
  const seconds =
    OUTPUT.minDurationSec + u * (OUTPUT.maxDurationSec - OUTPUT.minDurationSec);
  return Math.round(seconds * OUTPUT.fps);
}

function assertTrack(track: RawTrack): void {
  if (!track || typeof track !== "object") {
    throw new Error("track: expected a RawTrack object");
  }
  if (!Array.isArray(track.points)) {
    throw new Error("track: RawTrack.points must be an array");
  }
  if (track.points.length === 0) {
    throw new Error("track: RawTrack.points is empty — nothing to render");
  }
}

/**
 * Turn a noisy raw track into exactly `frameCount` cinematic camera keyframes.
 *
 * Pure, zero-I/O. Throws on degenerate input rather than emitting garbage:
 * a broken video is worse than a clear error.
 */
export function buildCameraPath(
  track: RawTrack,
  frameCount: number,
): CameraKeyframe[] {
  assertTrack(track);
  if (!Number.isInteger(frameCount) || frameCount < 2) {
    throw new Error(
      `track: frameCount must be an integer >= 2, got ${String(frameCount)}`,
    );
  }

  // 1. Spatial resample — constant camera speed, independent of the athlete's.
  // A gentle position low-pass rides along here: at the 5 m resample floor the
  // vertices still carry GPS jitter, and the spline would faithfully reproduce
  // every wobble as a curvature spike.
  const route = smoothPositions(resampleByDistance(track.points));

  // 2. Altitude, smoothed independently and harder than position.
  const ele = smoothAltitude(route.map((r) => r.ele));

  // 3. Arc-length parameterized Catmull-Rom through the resampled route.
  const spline = buildSpline(route, ele);

  // 4. One sample per frame, uniform in distance.
  const samples = sampleUniform(spline, frameCount);

  // 5. Tangent bearings, unwrapped, low-passed and slew-limited.
  const bearings = smoothBearings(bearingsFromSamples(samples));

  // 6. Assemble.
  return assembleKeyframes({ spline, samples, bearings });
}

/** HUD stats derived from the track. Pace is seconds per km. */
export function toStats(track: RawTrack): ActivityStats {
  assertTrack(track);
  const distance = trackLength(track);
  const movingTime =
    Number.isFinite(track.movingTime) && track.movingTime > 0 ? track.movingTime : 0;
  const km = distance / 1000;
  // Guard both directions: a zero-distance or zero-time activity has no pace.
  const paceSecPerKm = km > 0 && movingTime > 0 ? movingTime / km : 0;
  return {
    name: track.name ?? "",
    date: track.startDate ?? "",
    distance,
    paceSecPerKm,
    elevationGain:
      Number.isFinite(track.elevationGain) && track.elevationGain > 0
        ? track.elevationGain
        : 0,
    movingTime,
  };
}

/** The full route as [lng, lat] pairs, for drawing the line. */
export function routeFrom(track: RawTrack): LngLat[] {
  assertTrack(track);
  const clean = cleanPoints(track.points);
  if (clean.length === 0) {
    throw new Error("track: no usable GPS points in track");
  }
  return clean.map((p) => [p.lng, p.lat] as LngLat);
}

/**
 * For each keyframe, how far along `routeFrom(track)` the progressive line
 * should be drawn. Non-decreasing, starts at 0, ends at route.length - 1.
 *
 * Mapping is by cumulative distance, not by raw index, so the drawn line stays
 * in step with a camera that advances at constant metres-per-frame.
 */
export function progressIndices(
  track: RawTrack,
  keyframes: CameraKeyframe[],
): number[] {
  const route = routeFrom(track);
  const last = route.length - 1;
  if (keyframes.length === 0) return [];
  if (last <= 0) return keyframes.map(() => 0);

  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    cum.push(
      cum[i - 1] +
        haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]),
    );
  }
  const total = cum[last];

  let cursor = 0;
  const out: number[] = [];
  for (let f = 0; f < keyframes.length; f++) {
    const p = Math.min(1, Math.max(0, keyframes[f].progress));
    if (total > 0) {
      const target = p * total;
      while (cursor < last && cum[cursor + 1] <= target) cursor++;
    } else {
      cursor = Math.round(p * last);
    }
    out.push(cursor);
  }
  // The line must be complete on the final frame.
  out[out.length - 1] = last;
  return out;
}
