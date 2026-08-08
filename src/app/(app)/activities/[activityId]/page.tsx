import { notFound } from "next/navigation";
import { ActivityConfirmScreen } from "@/components/screens/ActivityConfirmScreen";
import { ErrorScreen } from "@/components/screens/ErrorScreen";
import { findMockActivity } from "@/components/screens/mocks/activities.mock";

export default async function ActivityConfirmPage({ params }: PageProps<"/activities/[activityId]">) {
  const { activityId } = await params;
  const activity = findMockActivity(activityId);
  if (!activity) notFound();

  if (activity.ineligible) {
    return <ErrorScreen kind="no-gps" activityName={activity.name} />;
  }

  return (
    <ActivityConfirmScreen
      activity={activity}
      createHref={`/jobs/${activity.id}`}
      backHref="/activities"
    />
  );
}
