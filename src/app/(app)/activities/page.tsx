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

  // Fetch inside the try, render outside it: `redirect` works by throwing, so
  // rendering in here would let the catch swallow the navigation.
  let activities;
  let failure: string | null = null;

  try {
    activities = await getActivities(athleteId);
  } catch (err) {
    if (err instanceof StravaAuthError) redirect("/errors/session-expired");

    // Rate limiting is app-wide, not this athlete's fault, so say so honestly
    // rather than implying they did something wrong.
    failure =
      err instanceof StravaRateLimitError
        ? "Stravinator is briefly over its Strava request limit. Try again in a few minutes."
        : "We couldn't reach Strava just now.";
  }

  if (failure || !activities) {
    return (
      <ErrorScreen
        kind="render-failed"
        title="Couldn't load your runs"
        detail={failure ?? "We couldn't reach Strava just now."}
        action={{ label: "Try again", href: "/activities" }}
        backHref="/"
      />
    );
  }

  return (
    <ActivityListScreen
      activities={activities}
      hrefFor={(activity) => `/activities/${activity.id}`}
      backHref="/"
    />
  );
}
