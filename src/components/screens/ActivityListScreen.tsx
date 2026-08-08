import type { ActivitySummary } from "@/lib/types";
import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import { ActivityRow, ActivityRows } from "@/components/ActivityRow";
import { SearchIcon } from "@/components/icons";

export interface ActivityListScreenProps {
  activities: ActivitySummary[];
  /** Builds the confirm route for a renderable activity. */
  hrefFor: (activity: ActivitySummary) => string;
  backHref?: string;
}

export function ActivityListScreen({
  activities,
  hrefFor,
  backHref = "/",
}: ActivityListScreenProps) {
  const firstRenderable = activities.find((a) => a.ineligible === null)?.id;

  return (
    <div className="shell">
      <AppBar
        title="Your runs"
        backHref={backHref}
        trailing={
          <span className="circ" aria-hidden="true">
            <SearchIcon />
          </span>
        }
      />

      <div className="body">
        <div className="section-head">
          <span className="step">Step 1 of 2</span>
          <h2>Pick a run to fly.</h2>
        </div>

        {activities.length === 0 ? (
          <p className="dock-note">No recent activities on this Strava account yet.</p>
        ) : (
          <ActivityRows>
            {activities.map((activity, i) => (
              <ActivityRow
                key={activity.id}
                index={i}
                activity={activity}
                href={hrefFor(activity)}
                featured={activity.id === firstRenderable}
              />
            ))}
          </ActivityRows>
        )}
      </div>

      <div className="dock dock-footer">
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}
