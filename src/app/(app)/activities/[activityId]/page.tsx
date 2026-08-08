import { redirect } from "next/navigation";
import { ActivityConfirmScreen } from "@/components/screens/ActivityConfirmScreen";
import { ErrorScreen } from "@/components/screens/ErrorScreen";
import { getAthleteId } from "@/lib/session";
import { getActivitySummary } from "@/lib/activities";
import { StravaAuthError } from "@/lib/strava";
import { createFlyover } from "./actions";

export const dynamic = "force-dynamic";

export default async function ActivityConfirmPage({
  params,
}: PageProps<"/activities/[activityId]">) {
  const { activityId } = await params;

  const athleteId = await getAthleteId();
  if (!athleteId) redirect("/errors/session-expired");

  // Fetch inside the try, render outside it: `redirect` works by throwing, so
  // rendering in here would let the catch swallow the navigation.
  let activity;
  try {
    activity = await getActivitySummary(athleteId, activityId);
  } catch (err) {
    if (err instanceof StravaAuthError) redirect("/errors/session-expired");
  }

  if (!activity) {
    return (
      <ErrorScreen
        kind="render-failed"
        title="Couldn't load that run"
        detail="We couldn't reach Strava just now."
        action={{ label: "Back to your runs", href: "/activities" }}
      />
    );
  }

  if (activity.ineligible) {
    return (
      <ErrorScreen
        kind="no-gps"
        activityName={activity.name}
        detail={
          activity.ineligible === "too-short"
            ? "This run is too short to make a watchable flyover."
            : undefined
        }
        action={{ label: "Pick another run", href: "/activities" }}
      />
    );
  }

  return (
    <ActivityConfirmScreen
      activity={activity}
      createHref={`/activities/${activity.id}`}
      createAction={createFlyover}
      backHref="/activities"
    />
  );
}
