import Link from "next/link";
import type { ActivitySummary } from "@/lib/types";
import { ChevronRight, RouteGlyph } from "./icons";
import { formatShortDate, ineligibleReasonText, km, metres } from "./format";
import "./ActivityRow.css";

export interface ActivityRowProps {
  activity: ActivitySummary;
  /** Route to open when the activity is renderable. */
  href: string;
  /** The most recent renderable activity gets the magenta treatment. */
  featured?: boolean;
  index?: number;
}

export function ActivityRow({ activity, href, featured = false, index = 0 }: ActivityRowProps) {
  const date = formatShortDate(activity.startDate);
  const reasonId = `activity-${activity.id}-reason`;

  if (activity.ineligible) {
    const reason = ineligibleReasonText(activity.ineligible);
    return (
      <div className="row row-off" aria-disabled="true" aria-describedby={reasonId}>
        <span className="thumb">
          <RouteGlyph seed={index} muted />
        </span>
        <span className="row-text">
          <span className="row-name">{activity.name}</span>
          <span className="row-meta" id={reasonId}>
            {date} · {reason}
          </span>
        </span>
        <span className="chev" aria-hidden="true" />
      </div>
    );
  }

  return (
    <Link className={featured ? "row row-featured" : "row"} href={href}>
      <span className="thumb">
        <RouteGlyph seed={index} />
      </span>
      <span className="row-text">
        <span className="row-name">{activity.name}</span>
        <span className="row-meta">
          {date} · {km(activity.distance)} km · {metres(activity.elevationGain)} m
        </span>
      </span>
      <span className="chev">
        <ChevronRight dim={!featured} />
      </span>
    </Link>
  );
}

export function ActivityRows({ children }: { children: React.ReactNode }) {
  return <div className="rows">{children}</div>;
}
