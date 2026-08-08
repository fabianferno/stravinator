import type { TrackPoint } from "../types";
import { haversine, isFiniteNumber, makeProjector } from "./geo";
import { gaussianSmooth } from "./altitude";

/** A route vertex after spatial resampling. Time and velocity are gone by design. */
export interface RoutePoint {
  lng: number;
  lat: number;
  ele: number;
  /** cumulative distance along the resampled route, metres */
  dist: number;
}

/**
 * Two GPS fixes closer together than this are treated as the same place. It is
 * below consumer-GPS precision (~3-5 m), so collapsing them destroys no real
 * signal, and it makes tunnels / stationary starts (long runs of identical
 * coordinates) degenerate cleanly instead of producing zero-length segments
 * whose bearing is undefined.
 */
export const DEDUPE_EPSILON_M = 0.5;

/** Resample interval bounds; the actual interval targets ~TARGET_VERTICES vertices. */
export const MIN_INTERVAL_M = 5;
export const MAX_INTERVAL_M = 25;
export const TARGET_VERTICES = 1000;

/** Drop non-finite points and consecutive near-duplicates. */
export function cleanPoints(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const p of points) {
    if (!p || !isFiniteNumber(p.lng) || !isFiniteNumber(p.lat)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
    const prev = out[out.length - 1];
    if (prev && haversine(prev.lng, prev.lat, p.lng, p.lat) < DEDUPE_EPSILON_M) {
      continue;
    }
    out.push({ ...p, ele: isFiniteNumber(p.ele) ? p.ele : (prev?.ele ?? 0) });
  }
  return out;
}

/** Total planimetric length of a cleaned point list, metres. */
export function routeLength(points: Array<{ lng: number; lat: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(
      points[i - 1].lng,
      points[i - 1].lat,
      points[i].lng,
      points[i].lat,
    );
  }
  return total;
}

/** Interval that yields roughly TARGET_VERTICES vertices, clamped to sane bounds. */
export function intervalFor(lengthM: number): number {
  return Math.min(
    MAX_INTERVAL_M,
    Math.max(MIN_INTERVAL_M, lengthM / TARGET_VERTICES),
  );
}

/**
 * Resample to a fixed SPATIAL interval. The camera therefore advances at a
 * constant speed in metres regardless of how fast the athlete was moving —
 * a pause at a traffic light must not become a pause in the video.
 *
 * A GPS dropout (a long jump between two fixes) is bridged by straight-line
 * interpolation: we cannot invent the missing geometry, but we can refuse to
 * teleport the camera.
 */
export function resampleByDistance(
  points: TrackPoint[],
  intervalM?: number,
): RoutePoint[] {
  const clean = cleanPoints(points);
  if (clean.length < 2) {
    throw new Error(
      `track/resample: need at least 2 distinct GPS points, got ${clean.length}`,
    );
  }
  const length = routeLength(clean);
  if (!(length > 0)) {
    throw new Error("track/resample: route has zero length");
  }
  const step = intervalM ?? intervalFor(length);
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new Error(`track/resample: invalid interval ${step}`);
  }

  // Cumulative arc length of the cleaned polyline.
  const cum: number[] = [0];
  for (let i = 1; i < clean.length; i++) {
    cum.push(
      cum[i - 1] +
        haversine(clean[i - 1].lng, clean[i - 1].lat, clean[i].lng, clean[i].lat),
    );
  }

  const out: RoutePoint[] = [];
  let seg = 0;
  const n = Math.max(1, Math.floor(length / step));
  for (let k = 0; k <= n; k++) {
    const target = Math.min(length, k * step);
    while (seg < clean.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    const a = clean[seg];
    const b = clean[seg + 1];
    out.push({
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
      ele: a.ele + (b.ele - a.ele) * t,
      dist: target,
    });
  }
  // Always land exactly on the final fix.
  const last = clean[clean.length - 1];
  const tail = out[out.length - 1];
  if (haversine(tail.lng, tail.lat, last.lng, last.lat) > DEDUPE_EPSILON_M) {
    out.push({ lng: last.lng, lat: last.lat, ele: last.ele, dist: length });
  }
  return out;
}

/**
 * Gaussian sigma for horizontal position smoothing, in resampled vertices.
 *
 * Deliberately gentler than the altitude pipeline (median 9 + sigma 6): the
 * route line is drawn from these coordinates and must still visibly follow the
 * road, whereas altitude only has to look plausible. At the 5 m floor interval
 * sigma = 3 is a ~15 m spatial window, which averages out consumer-GPS jitter
 * (~3-5 m) while preserving anything a runner could actually have run.
 */
export const POSITION_SIGMA_VERTICES = 3;

/**
 * Low-pass the resampled route's horizontal position and rebuild its
 * cumulative distances. Done in a local metre frame so the smoothing is
 * isotropic rather than squashed by the longitude/latitude scale difference.
 */
export function smoothPositions(
  route: RoutePoint[],
  sigma = POSITION_SIGMA_VERTICES,
): RoutePoint[] {
  if (route.length < 3 || !(sigma > 0)) return route.map((r) => ({ ...r }));
  const proj = makeProjector(route[0].lng, route[0].lat);
  const xy = route.map((r) => proj.toXY(r.lng, r.lat));
  const xs = gaussianSmooth(xy.map((p) => p.x), sigma);
  const ys = gaussianSmooth(xy.map((p) => p.y), sigma);
  const out: RoutePoint[] = [];
  let dist = 0;
  for (let i = 0; i < route.length; i++) {
    const { lng, lat } = proj.toLngLat({ x: xs[i], y: ys[i] });
    if (i > 0) dist += haversine(out[i - 1].lng, out[i - 1].lat, lng, lat);
    out.push({ lng, lat, ele: route[i].ele, dist });
  }
  return out;
}
