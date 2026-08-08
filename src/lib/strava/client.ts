/**
 * Thin typed wrapper over the three Strava endpoints this product needs.
 *
 * Rate limits are APP-WIDE (100 requests / 15 min, 1000 / day by default), not
 * per athlete, so every call here is a shared resource. The picker must never
 * call `getStreams` speculatively — see `eligibility.ts`, which decides from
 * the activity summary alone.
 */

import { STRAVA_API_BASE, stravaFetch, type FetchImpl } from "./http";

/** Streams the flyover needs. Order matters only for readability. */
export const STREAM_KEYS = [
  "latlng",
  "altitude",
  "time",
  "distance",
  "velocity_smooth",
] as const;

export type StreamKey = (typeof STREAM_KEYS)[number];

export interface StravaStream<T> {
  type?: string;
  data: T[];
  series_type?: string;
  original_size?: number;
  resolution?: string;
}

/**
 * `key_by_type=true` response. Every key is optional — a treadmill run has no
 * `latlng`, and older uploads can be missing `velocity_smooth`.
 */
export interface StravaStreamSet {
  latlng?: StravaStream<[number, number]>;
  altitude?: StravaStream<number>;
  time?: StravaStream<number>;
  distance?: StravaStream<number>;
  velocity_smooth?: StravaStream<number>;
}

/**
 * Fields of a Strava activity this module reads. Deliberately partial — the
 * real payload has ~60 keys and we do not want to pretend to model them.
 */
export interface StravaActivity {
  id: number | string;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time?: number;
  total_elevation_gain: number;
  type?: string;
  sport_type?: string;
  start_date: string;
  start_date_local?: string;
  /** `[]` or absent for indoor activities. */
  start_latlng?: [number, number] | [] | null;
  end_latlng?: [number, number] | [] | null;
  /** True for treadmill / indoor trainer activities. */
  trainer?: boolean;
  /** Manually entered activities have no streams at all. */
  manual?: boolean;
  commute?: boolean;
  map?: { id?: string; polyline?: string | null; summary_polyline?: string | null };
  average_speed?: number;
  device_name?: string | null;
}

export interface ListActivitiesOptions {
  page?: number;
  perPage?: number;
  /** Unix seconds; only activities after this time. */
  after?: number;
  /** Unix seconds; only activities before this time. */
  before?: number;
  fetchImpl?: FetchImpl;
}

const DEFAULT_PER_PAGE = 30;
/** Strava caps `per_page` at 200; asking for more is silently clamped. */
const MAX_PER_PAGE = 200;

function authHeaders(token: string): RequestInit {
  return { method: "GET", headers: { Authorization: `Bearer ${token}` } };
}

/** The authenticated athlete's own activities, newest first. */
export async function listActivities(
  token: string,
  opts: ListActivitiesOptions = {},
): Promise<StravaActivity[]> {
  const params = new URLSearchParams({
    page: String(Math.max(1, opts.page ?? 1)),
    per_page: String(Math.min(MAX_PER_PAGE, Math.max(1, opts.perPage ?? DEFAULT_PER_PAGE))),
  });
  if (opts.after != null) params.set("after", String(opts.after));
  if (opts.before != null) params.set("before", String(opts.before));

  const body = await stravaFetch<StravaActivity[]>(
    `${STRAVA_API_BASE}/athlete/activities?${params.toString()}`,
    authHeaders(token),
    opts.fetchImpl ?? fetch,
  );
  return Array.isArray(body) ? body : [];
}

/** Detailed activity. `include_all_efforts=false` keeps the payload small. */
export async function getActivity(
  token: string,
  id: string | number,
  fetchImpl: FetchImpl = fetch,
): Promise<StravaActivity> {
  return stravaFetch<StravaActivity>(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(String(id))}?include_all_efforts=false`,
    authHeaders(token),
    fetchImpl,
  );
}

/**
 * All five streams in one request. `key_by_type=true` returns an object keyed
 * by stream name instead of an array, which is the only sane shape to consume.
 */
export async function getStreams(
  token: string,
  id: string | number,
  fetchImpl: FetchImpl = fetch,
  keys: readonly string[] = STREAM_KEYS,
): Promise<StravaStreamSet> {
  const params = new URLSearchParams({
    keys: keys.join(","),
    key_by_type: "true",
  });
  const body = await stravaFetch<StravaStreamSet>(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(String(id))}/streams?${params.toString()}`,
    authHeaders(token),
    fetchImpl,
  );
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}
