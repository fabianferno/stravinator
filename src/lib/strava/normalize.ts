/**
 * Strava's wire format -> the shared contract in `@/lib/types`.
 *
 * Streams arrive as PARALLEL ARRAYS that are supposed to be the same length
 * and in practice are not: Strava resamples each stream independently, devices
 * drop out mid-recording, and `velocity_smooth` in particular is frequently
 * shorter or missing entirely. Nothing here indexes an array without knowing it
 * is long enough, and nothing assumes `latlng` exists.
 */

import type { ActivitySummary, RawTrack, TrackPoint } from "@/lib/types";
import type { StravaActivity, StravaStreamSet } from "./client";
import { checkEligibility } from "./eligibility";

/** Strava emits `[lat, lng]`; everything downstream is Mapbox `[lng, lat]`. */
function isLatLngPair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Math.abs(v[0] as number) <= 90 &&
    Math.abs(v[1] as number) <= 180
  );
}

function numericData(stream: { data?: unknown } | undefined): number[] | null {
  const d = stream?.data;
  return Array.isArray(d) ? (d as number[]) : null;
}

function finiteAt(arr: number[] | null, i: number, fallback: number): number {
  if (!arr || i >= arr.length) return fallback;
  const v = arr[i];
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Length to zip to: the shortest of the streams that are actually PRESENT.
 * An absent stream does not constrain the length (it is filled with derived or
 * default values); a present-but-short stream does, because the alternative is
 * inventing coordinates for the tail of the track.
 */
export function zipLength(streams: StravaStreamSet): number {
  const present = [
    streams?.latlng?.data,
    streams?.altitude?.data,
    streams?.time?.data,
    streams?.distance?.data,
    streams?.velocity_smooth?.data,
  ].filter(Array.isArray) as unknown[][];

  if (present.length === 0) return 0;
  return present.reduce((min, d) => Math.min(min, d.length), Infinity);
}

/** Metres between two WGS84 points. Equirectangular is ample at GPS spacing. */
function metresBetween(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLng = (b[1] - a[1]) * toRad;
  const meanLat = ((a[0] + b[0]) / 2) * toRad;
  const x = dLng * Math.cos(meanLat);
  return Math.hypot(dLat, x) * R;
}

/**
 * Zips the streams into `TrackPoint`s. Points whose `latlng` is missing or
 * nonsensical are DROPPED rather than defaulted — a `[0, 0]` point would put
 * the camera in the Gulf of Guinea. Every other field degrades gracefully.
 */
export function toRawTrack(
  activity: StravaActivity,
  streams: StravaStreamSet,
): RawTrack {
  const n = zipLength(streams);
  const latlng = Array.isArray(streams?.latlng?.data) ? streams.latlng.data : null;
  const altitude = numericData(streams?.altitude);
  const time = numericData(streams?.time);
  const distance = numericData(streams?.distance);
  const velocity = numericData(streams?.velocity_smooth);

  const points: TrackPoint[] = [];
  // Running fallbacks for when `distance`/`time` are absent or short.
  let derivedDist = 0;
  let prev: [number, number] | null = null;
  let prevT = 0;

  for (let i = 0; i < n; i++) {
    const pair = latlng?.[i];
    if (!isLatLngPair(pair)) continue;

    const here: [number, number] = [pair[0], pair[1]];
    if (prev) derivedDist += metresBetween(prev, here);

    const t = finiteAt(time, i, prevT + 1);
    const dist = finiteAt(distance, i, derivedDist);

    // Fall back to the segment speed when `velocity_smooth` runs out.
    let vel = finiteAt(velocity, i, NaN);
    if (!Number.isFinite(vel)) {
      const dt = t - prevT;
      const last = points[points.length - 1];
      vel = last && dt > 0 ? Math.max(0, (dist - last.dist) / dt) : 0;
    }

    points.push({
      lng: here[1],
      lat: here[0],
      ele: finiteAt(altitude, i, 0),
      t,
      dist,
      vel,
    });

    prev = here;
    prevT = t;
  }

  return {
    activityId: String(activity.id),
    name: activity.name ?? "Untitled activity",
    startDate: startDateOf(activity),
    distance: finiteOr(activity.distance, points[points.length - 1]?.dist ?? 0),
    movingTime: finiteOr(activity.moving_time, points[points.length - 1]?.t ?? 0),
    elevationGain: finiteOr(activity.total_elevation_gain, 0),
    sportType: sportTypeOf(activity),
    points,
  };
}

/** Row shape for the activity picker. Never triggers a network call. */
export function toActivitySummary(activity: StravaActivity): ActivitySummary {
  return {
    id: String(activity.id),
    name: activity.name ?? "Untitled activity",
    startDate: startDateOf(activity),
    distance: finiteOr(activity.distance, 0),
    movingTime: finiteOr(activity.moving_time, 0),
    elevationGain: finiteOr(activity.total_elevation_gain, 0),
    sportType: sportTypeOf(activity),
    ineligible: checkEligibility(activity),
  };
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * The contract asks for local start time. Strava's `start_date_local` is an
 * ISO string with a `Z` suffix it does not mean — the wall-clock digits are
 * local, the zone marker is a lie. We keep the digits and drop the `Z`, so
 * downstream formatting shows the time the athlete actually ran.
 */
function startDateOf(activity: StravaActivity): string {
  const local = activity.start_date_local;
  if (typeof local === "string" && local.length > 0) return local.replace(/Z$/, "");
  return activity.start_date ?? "";
}

function sportTypeOf(activity: StravaActivity): string {
  return activity.sport_type || activity.type || "Workout";
}
