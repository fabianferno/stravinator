import { NextResponse } from "next/server";
import { requireAthleteId } from "@/lib/session";
import { getAthleteTokens, saveAthleteTokens } from "@/lib/db/athletes";
import {
  withFreshToken,
  listActivities,
  toActivitySummary,
  checkEligibility,
  hasRotatedTokens,
  StravaRateLimitError,
} from "@/lib/strava";
import type { ActivitySummary } from "@/lib/types";

/**
 * The athlete's own recent activities, each already marked renderable or not.
 * Eligibility is decided from the summary alone, so listing a page costs one
 * Strava call regardless of how many rows it returns.
 */
export async function GET(req: Request) {
  const page = Number(new URL(req.url).searchParams.get("page") ?? "1");

  let athleteId: string;
  try {
    athleteId = await requireAthleteId();
  } catch {
    return NextResponse.json({ error: "session-expired" }, { status: 401 });
  }

  const stored = await getAthleteTokens(athleteId);

  try {
    const { result, tokens, rotated } = await withFreshToken(stored, (accessToken) =>
      listActivities(accessToken, { page, perPage: 30 }),
    );
    if (rotated) await saveAthleteTokens(athleteId, tokens);

    const activities: ActivitySummary[] = result.map((a) => ({
      ...toActivitySummary(a),
      ineligible: checkEligibility(a),
    }));

    return NextResponse.json({ activities });
  } catch (err) {
    if (hasRotatedTokens(err)) await saveAthleteTokens(athleteId, err.rotatedTokens);

    if (err instanceof StravaRateLimitError) {
      return NextResponse.json(
        { error: "rate-limited", retryAfterSec: err.retryAfterSec },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "strava-unavailable" }, { status: 502 });
  }
}
