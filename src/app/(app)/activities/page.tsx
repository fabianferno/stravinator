import { redirect } from "next/navigation";
import { ActivityListScreen } from "@/components/screens/ActivityListScreen";
import { ErrorScreen } from "@/components/screens/ErrorScreen";
import { getAthleteId } from "@/lib/session";
import { getActivities } from "@/lib/activities";
import { StravaRateLimitError, StravaAuthError } from "@/lib/strava";

export const metadata = { title: "Your runs — Stravinator" };
export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const athleteId = await getAthleteId();
  if (!athleteId) redirect("/errors/session-expired");

  try {
    const activities = await getActivities(athleteId);
    return (
      <ActivityListScreen
        activities={activities}
        hrefFor={(activity) => `/activities/${activity.id}`}
        backHref="/"
      />
    );
  } catch (err) {
    if (err instanceof StravaAuthError) redirect("/errors/session-expired");

    // Rate limiting is app-wide, not this athlete's fault, so say so honestly
    // rather than implying they did something wrong.
    const detail =
      err instanceof StravaRateLimitError
        ? "Stravinator is briefly over its Strava request limit. Try again in a few minutes."
        : "We couldn't reach Strava just now.";

    return (
      <ErrorScreen
        kind="render-failed"
        title="Couldn't load your runs"
        detail={detail}
        action={{ label: "Try again", href: "/activities" }}
        backHref="/"
      />
    );
  }
}
