import type { IneligibilityReason } from "@/lib/types";
import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import { ButtonLink } from "@/components/Button";
import { MIN_DISTANCE_M } from "@/lib/strava/eligibility";
import "./EmptyActivitiesScreen.css";

export type IneligibleCounts = Partial<Record<IneligibilityReason, number>>;

export interface EmptyActivitiesScreenProps {
  /**
   * How many activities came back from Strava. `0` selects the "nothing
   * recorded yet" variant; anything higher selects the "nothing renderable"
   * variant, which is the case spec §7 expects to be the most common.
   */
  totalActivities: number;
  /** How many of those were rejected, per reason. Drives the real numbers in the copy. */
  ineligibleCounts?: IneligibleCounts;
  /** Re-fetches the list. Same route by default. */
  refreshHref?: string;
  backHref?: string;
}

/** Order is the order the breakdown is listed in — commonest cause first. */
const REASON_ORDER: IneligibilityReason[] = ["no-gps", "no-stream", "too-short"];

/**
 * Breakdown copy, phrased as a description of the recording rather than a
 * verdict on the athlete. Distinct from `INELIGIBLE_COPY`, which has to fit on
 * one line of an activity row.
 */
const REASON_DETAIL: Record<IneligibilityReason, string> = {
  "no-gps": "recorded indoors — a treadmill or trainer has no position to record",
  "no-stream": "recorded without a usable GPS track",
  "too-short": `shorter than ${MIN_DISTANCE_M} m — too short for the camera to follow`,
};

const km = (MIN_DISTANCE_M / 1000).toFixed(1);

function total(counts: IneligibleCounts): number {
  return REASON_ORDER.reduce((sum, reason) => sum + (counts[reason] ?? 0), 0);
}

/** "All 14 of your recent activities" / "Your one recent activity". */
function headline(n: number, counts: IneligibleCounts): string {
  const indoor = (counts["no-gps"] ?? 0) + (counts["no-stream"] ?? 0);
  const short = counts["too-short"] ?? 0;
  const subject = n === 1 ? "Your one recent activity was" : `All ${n} of your recent activities were`;

  if (short === 0 && indoor > 0) return `${subject} recorded indoors.`;
  if (indoor === 0 && short > 0) return `${subject} too short to fly.`;
  return n === 1
    ? "Your one recent activity has no route we can fly."
    : `None of your ${n} recent activities have a route we can fly.`;
}

/**
 * Shown instead of the activity list when there is nothing to pick. Two
 * variants: no activities at all, and activities that exist but cannot be
 * rendered. The second is the one that matters — indoor runs are common and
 * the athlete did nothing wrong, so the copy explains rather than blames.
 */
export function EmptyActivitiesScreen({
  totalActivities,
  ineligibleCounts = {},
  refreshHref = "/activities",
  backHref = "/",
}: EmptyActivitiesScreenProps) {
  const counted = total(ineligibleCounts);
  const shown = counted > 0 ? counted : totalActivities;
  const nothingRecorded = totalActivities === 0;

  return (
    <div className="shell">
      <AppBar title="Your runs" backHref={backHref} backLabel="Back to the start" />

      <div className="body">
        <div className="section-head">
          <span className="step">Step 1 of 2</span>
          <h2>{nothingRecorded ? "Nothing to fly yet." : "No route to fly."}</h2>
        </div>

        <section className="empty-lede" role="group">
          <span className="empty-kind">
            {nothingRecorded ? "No activities" : "No GPS routes"}
          </span>
          <h3 className="empty-title">
            {nothingRecorded
              ? "There are no activities on this Strava account."
              : headline(shown, ineligibleCounts)}
          </h3>
          <p className="empty-body">
            {nothingRecorded
              ? "We looked at your 30 most recent activities and found none. Record an outdoor run and it will show up here."
              : "Nothing went wrong, and nothing is broken. Indoor activities record distance and pace but not position — a treadmill has no route, so there is nothing for the camera to fly along."}
          </p>

          {!nothingRecorded && counted > 0 ? (
            <ul className="empty-breakdown">
              {REASON_ORDER.filter((reason) => (ineligibleCounts[reason] ?? 0) > 0).map((reason) => (
                <li key={reason}>
                  <span className="empty-count">{ineligibleCounts[reason]}</span>
                  <span className="empty-reason">{REASON_DETAIL[reason]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="empty-next">
          <h3>What we can fly</h3>
          <ul className="empty-checks">
            <li>An outdoor run, ride, or walk recorded with GPS on your phone or watch.</li>
            <li>
              At least {MIN_DISTANCE_M} m ({km} km) long — shorter than that and there is no route
              worth watching.
            </li>
            <li>Recorded by the device, not entered by hand afterwards.</li>
          </ul>
          <div className="empty-actions">
            <ButtonLink href={refreshHref} variant="primary">
              Check Strava again
            </ButtonLink>
            <ButtonLink href={backHref} variant="quiet">
              Back to the start
            </ButtonLink>
          </div>
        </section>
      </div>

      <div className="dock dock-footer">
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}
