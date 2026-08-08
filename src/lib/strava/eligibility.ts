/**
 * Can this activity become a flyover?
 *
 * `checkEligibility` answers from the ACTIVITY SUMMARY ALONE — no streams
 * call. That is the whole point: spec §7 expects indoor runs to be the most
 * common failure, and the picker lists ~30 activities at a time. Spending a
 * streams request per row to discover a treadmill run would burn the app-wide
 * 100-per-15-minutes budget in a single page load.
 */

import type { IneligibilityReason } from "@/lib/types";
import type { StravaActivity, StravaStreamSet } from "./client";

/**
 * Minimum route length, in metres.
 *
 * Below this the camera has nothing to fly: the output is clamped to 20-40
 * seconds (spec §6), so a 400 m route means a camera crawling for 20 seconds
 * over a single city block. 500 m is roughly the shortest route that still
 * reads as a route at flyover altitude.
 */
export const MIN_DISTANCE_M = 500;

/** Fewest GPS samples a usable spline can be fitted through. */
export const MIN_TRACK_POINTS = 10;

/**
 * Returns why the activity cannot be rendered, or `null` if it can.
 *
 * Order matters: `no-gps` is checked first because it is both the most common
 * case and the most useful message ("this was indoors" beats "this was short").
 */
export function checkEligibility(activity: StravaActivity): IneligibilityReason | null {
  if (!hasStartLocation(activity)) return "no-gps";
  if (!(activity.distance >= MIN_DISTANCE_M)) return "too-short";
  return null;
}

/**
 * True when the activity summary shows evidence of a real outdoor recording.
 *
 * Three independent signals, any of which condemns it:
 * - `trainer: true` — treadmill or indoor bike trainer.
 * - `manual: true` — hand-entered, so there is no recording at all.
 * - empty/absent `start_latlng` — Strava returns `[]` (not `null`) for indoor
 *   activities, which is falsy-adjacent but not falsy, so it must be length-
 *   checked rather than truthiness-checked.
 */
export function hasStartLocation(activity: StravaActivity): boolean {
  if (activity.trainer === true) return false;
  if (activity.manual === true) return false;
  const start = activity.start_latlng;
  if (!Array.isArray(start) || start.length < 2) return false;
  const [lat, lng] = start as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Null Island is Strava's tell for a corrupt or stripped location.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Second gate, after the streams call has actually been made. An activity can
 * pass `checkEligibility` and still come back without usable coordinates —
 * a device that recorded a location fix at the start and then lost GPS, or an
 * activity whose coordinates the athlete has hidden.
 */
export function checkStreamEligibility(streams: StravaStreamSet): IneligibilityReason | null {
  const latlng = streams?.latlng?.data;
  if (!Array.isArray(latlng) || latlng.length === 0) return "no-stream";
  if (latlng.length < MIN_TRACK_POINTS) return "no-stream";
  return null;
}
