/**
 * Shared contracts between subsystems. Every module below depends on this file
 * and nothing depends on them, so this is the one place interfaces are agreed.
 */

/** WGS84 longitude/latitude, in Mapbox order. */
export type LngLat = [number, number];

/** One sample from a Strava activity, normalized. */
export interface TrackPoint {
  lng: number;
  lat: number;
  /** metres above sea level */
  ele: number;
  /** seconds since activity start */
  t: number;
  /** metres travelled since activity start */
  dist: number;
  /** metres per second, Strava's smoothed velocity where available */
  vel: number;
}

/** Everything `track/` needs, and everything `strava/` promises to produce. */
export interface RawTrack {
  activityId: string;
  name: string;
  /** ISO 8601, activity local start time */
  startDate: string;
  /** metres */
  distance: number;
  /** seconds */
  movingTime: number;
  /** metres */
  elevationGain: number;
  /** Strava activity type, e.g. "Run", "Ride" */
  sportType: string;
  points: TrackPoint[];
}

/** One frame of camera state. `track/` emits exactly `frameCount` of these. */
export interface CameraKeyframe {
  /** point the camera looks at */
  center: LngLat;
  /** degrees clockwise from north, 0–360, continuous across the sequence */
  bearing: number;
  /** degrees from vertical */
  pitch: number;
  zoom: number;
  /** metres above sea level at `center`, smoothed */
  elevation: number;
  /** 0–1, monotonically non-decreasing across the sequence */
  progress: number;
}

/** Stats the HUD draws. Derived from RawTrack, passed to the scene. */
export interface ActivityStats {
  name: string;
  /** ISO 8601 */
  date: string;
  /** metres */
  distance: number;
  /** seconds per kilometre */
  paceSecPerKm: number;
  /** metres */
  elevationGain: number;
  /** seconds */
  movingTime: number;
}

/** Everything the /render page needs to paint every frame. */
export interface RenderPayload {
  jobId: string;
  stats: ActivityStats;
  keyframes: CameraKeyframe[];
  /** full route, for drawing the line; same projection as keyframe centers */
  route: LngLat[];
  /** index into `route` that each frame's line should be drawn up to */
  routeProgressIndex: number[];
}

export const JOB_STATUSES = [
  "queued",
  "fetching",
  "smoothing",
  "rendering",
  "encoding",
  "done",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  athleteId: string;
  activityId: string;
  status: JobStatus;
  /** 0–1; meaningful during `rendering`, otherwise stage-level */
  progress: number;
  /** frames encoded so far, for honest progress reporting */
  framesDone: number;
  frameCount: number;
  /** user-facing reason, present only when status is `failed` */
  error: string | null;
  /** signed URL, present only when status is `done` */
  videoUrl: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Why an activity cannot be rendered. `null` means it can. */
export type IneligibilityReason = "no-gps" | "too-short" | "no-stream";

export interface ActivitySummary {
  id: string;
  name: string;
  /** ISO 8601 */
  startDate: string;
  /** metres */
  distance: number;
  /** seconds */
  movingTime: number;
  /** metres */
  elevationGain: number;
  sportType: string;
  /** null when renderable */
  ineligible: IneligibilityReason | null;
}

/** Fixed output contract. See spec §6. */
export const OUTPUT = {
  width: 1080,
  height: 1920,
  fps: 30,
  minDurationSec: 20,
  maxDurationSec: 40,
} as const;

export const ATTRIBUTION = ["Powered by Strava", "© Mapbox", "© OpenStreetMap"] as const;

/** Shortest signed angular difference a→b, in degrees, within (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}
