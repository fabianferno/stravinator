/**
 * A committed sample `RenderPayload`, so `/render?fixture=1` is testable with no
 * database, no Strava, and no API route. Everything here is generated from pure
 * arithmetic — no randomness, no clock — so the fixture is byte-identical on
 * every machine and every run. That property matters: the scene page's whole
 * contract is "frame index in, identical pixels out".
 *
 * The synthetic track is a switchbacking climb above Chamonix, chosen because
 * the terrain there is dramatic enough that a broken `setTerrain` is obvious.
 */

import { OUTPUT, type CameraKeyframe, type LngLat, type RenderPayload } from "@/lib/types";
import { haversine } from "@/lib/track/geo";

const ORIGIN_LNG = 6.8694;
const ORIGIN_LAT = 45.9237;

/** 20 s at 30 fps — the short end of the duration clamp in spec §6. */
const FIXTURE_FRAMES = OUTPUT.fps * OUTPUT.minDurationSec;
const ROUTE_POINTS = 480;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

/**
 * Route shape: a north-easterly traverse with three switchbacks, expressed in
 * metres from the origin and then converted to lng/lat.
 */
function routePointAt(u: number): LngLat {
  // u in [0,1]
  const along = u * 4200; // metres of northward progress
  const across = 900 * Math.sin(u * Math.PI * 3) * (0.35 + 0.65 * u);
  const lng = ORIGIN_LNG + across / M_PER_DEG_LNG;
  const lat = ORIGIN_LAT + along / M_PER_DEG_LAT;
  return [round6(lng), round6(lat)];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function buildRoute(): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i < ROUTE_POINTS; i++) {
    pts.push(routePointAt(i / (ROUTE_POINTS - 1)));
  }
  return pts;
}

function bearingBetween(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * M_PER_DEG_LNG;
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Unwrap so bearing is continuous across the sequence, as CameraKeyframe requires. */
function unwrap(prev: number | null, next: number): number {
  if (prev === null) return next;
  let d = ((next - prev) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return prev + d;
}

function buildKeyframes(): CameraKeyframe[] {
  const frames: CameraKeyframe[] = [];
  let bearing: number | null = null;
  for (let i = 0; i < FIXTURE_FRAMES; i++) {
    const progress = i / (FIXTURE_FRAMES - 1);
    const u = progress;
    const center = routePointAt(u);
    const ahead = routePointAt(Math.min(1, u + 0.01));
    bearing = unwrap(bearing, bearingBetween(center, ahead));
    frames.push({
      center,
      bearing: round6(bearing),
      pitch: 68,
      zoom: 14.6,
      // A plausible climb profile: 1035 m at the trailhead to ~1720 m at the col.
      elevation: Math.round(1035 + 685 * u),
      progress: round6(progress),
    });
  }
  return frames;
}

/**
 * Frame i draws the route up to this index. Monotonic and always ahead of the
 * camera by nothing — the line trails the camera exactly, per spec §4.3.
 */
function buildProgressIndex(route: LngLat[], keyframes: CameraKeyframe[]): number[] {
  const last = route.length - 1;
  return keyframes.map((kf) => Math.min(last, Math.round(kf.progress * last)));
}

function totalDistance(route: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < route.length; i++) {
    d += haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
  }
  return Math.round(d);
}

const FIXTURE_ROUTE = buildRoute();
const FIXTURE_KEYFRAMES = buildKeyframes();
const FIXTURE_DISTANCE = totalDistance(FIXTURE_ROUTE);
/** 5:12 /km, a believable trail-run pace for 685 m of gain. */
const FIXTURE_PACE = 312;

export const FIXTURE_PAYLOAD: RenderPayload = {
  jobId: "fixture",
  stats: {
    name: "Le Brévent — morning climb",
    date: "2026-07-19T06:41:00+02:00",
    distance: FIXTURE_DISTANCE,
    paceSecPerKm: FIXTURE_PACE,
    elevationGain: 685,
    movingTime: Math.round((FIXTURE_DISTANCE / 1000) * FIXTURE_PACE),
  },
  keyframes: FIXTURE_KEYFRAMES,
  route: FIXTURE_ROUTE,
  routeProgressIndex: buildProgressIndex(FIXTURE_ROUTE, FIXTURE_KEYFRAMES),
};
