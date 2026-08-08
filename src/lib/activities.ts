/**
 * Server-side activity access. Shared by the activity pages and the API route
 * so both apply the same eligibility rules and the same token rotation
 * handling.
 */
import "server-only";
import { getAthleteTokens, saveAthleteTokens } from "@/lib/db/athletes";
import {
  withFreshToken,
  listActivities,
  getActivity,
  toActivitySummary,
  checkEligibility,
  hasRotatedTokens,
} from "@/lib/strava";
import type { ActivitySummary } from "@/lib/types";

async function callStrava<T>(
  athleteId: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const stored = await getAthleteTokens(athleteId);
  try {
    const { result, tokens, rotated } = await withFreshToken(stored, fn);
    if (rotated) await saveAthleteTokens(athleteId, tokens);
    return result;
  } catch (err) {
    // Strava has already burned the old refresh token by this point; dropping
    // the new one would force the athlete to re-authorize.
    if (hasRotatedTokens(err)) await saveAthleteTokens(athleteId, err.rotatedTokens);
    throw err;
  }
}

export async function getActivities(athleteId: string, page = 1): Promise<ActivitySummary[]> {
  const activities = await callStrava(athleteId, (token) =>
    listActivities(token, { page, perPage: 30 }),
  );
  return activities.map((a) => ({ ...toActivitySummary(a), ineligible: checkEligibility(a) }));
}

export async function getActivitySummary(
  athleteId: string,
  activityId: string,
): Promise<ActivitySummary> {
  const activity = await callStrava(athleteId, (token) => getActivity(token, activityId));
  return { ...toActivitySummary(activity), ineligible: checkEligibility(activity) };
}
