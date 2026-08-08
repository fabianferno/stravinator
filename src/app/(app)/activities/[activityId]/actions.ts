"use server";

import { redirect } from "next/navigation";
import { requireAthleteId } from "@/lib/session";
import { getActivitySummary } from "@/lib/activities";
import { enqueue } from "@/lib/jobs";

/**
 * Creates a render job for one of the athlete's own activities.
 *
 * Eligibility is re-checked here rather than trusted from the page that
 * rendered the button — a treadmill run must not become a queued job just
 * because someone posted the form directly.
 */
export async function createFlyover(formData: FormData) {
  const activityId = String(formData.get("activityId") ?? "");
  if (!activityId) redirect("/activities");

  const athleteId = await requireAthleteId();
  const activity = await getActivitySummary(athleteId, activityId);

  if (activity.ineligible) redirect(`/activities/${activityId}`);

  const job = await enqueue(athleteId, activityId);
  redirect(`/jobs/${job.id}`);
}
