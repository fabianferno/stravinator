import { ActivityListScreen } from "@/components/screens/ActivityListScreen";
import { activitiesMock } from "@/components/screens/mocks/activities.mock";

export const metadata = { title: "Your runs — Stravinator" };

export default function ActivitiesPage() {
  return (
    <ActivityListScreen
      activities={activitiesMock}
      hrefFor={(activity) => `/activities/${activity.id}`}
      backHref="/"
    />
  );
}
