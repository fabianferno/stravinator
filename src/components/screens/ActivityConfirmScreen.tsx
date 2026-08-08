import type { ActivitySummary } from "@/lib/types";
import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import { Button, ButtonLink } from "@/components/Button";
import {
  Card,
  CardMeta,
  CardTitle,
  CardTop,
  Readout,
  ReadoutUnit,
  StatPair,
  StatTile,
} from "@/components/Card";
import { DotMatrix } from "@/components/DotMatrix";
import { RouteBed } from "@/components/RouteBed";
import { InfoIcon } from "@/components/icons";
import { formatPace, km, metres, paceSecPerKm } from "@/components/format";
import { OUTPUT } from "@/lib/types";

export interface ActivityConfirmScreenProps {
  activity: ActivitySummary;
  /** Fallback link, used only when `createAction` is absent (mocks, previews). */
  createHref: string;
  /**
   * Server action that queues the render. Preferred over `createHref`: creating
   * a job is a side effect, so it belongs behind a POST, not a link a browser
   * or crawler might prefetch.
   */
  createAction?: (formData: FormData) => Promise<void>;
  backHref?: string;
  /** Seconds of finished video; defaults to the midpoint of the output contract. */
  estimatedDurationSec?: number;
  /** Human estimate of queue + render time, e.g. "about two minutes". */
  estimatedWait?: string;
}

export function ActivityConfirmScreen({
  activity,
  createHref,
  createAction,
  backHref = "/activities",
  estimatedDurationSec = 32,
  estimatedWait = "about two minutes",
}: ActivityConfirmScreenProps) {
  const pace = formatPace(paceSecPerKm(activity.distance, activity.movingTime));

  return (
    <div className="shell">
      <AppBar
        title={activity.name}
        backHref={backHref}
        backLabel="Back to your runs"
        trailing={
          <span className="circ sm" aria-hidden="true">
            <InfoIcon />
          </span>
        }
      />

      <div className="body">
        <Card tone="blue" tall>
          <CardTop>
            <CardTitle>Route preview</CardTitle>
            <CardMeta>Step 2 of 2</CardMeta>
          </CardTop>
          <Readout>
            <DotMatrix
              text={pace}
              label={`${pace.replace(":", " minutes ")} seconds per kilometre`}
            />
            <ReadoutUnit>Average pace / km</ReadoutUnit>
          </Readout>
          <RouteBed variant="confirm" />
        </Card>

        <StatPair>
          <StatTile label="Distance" value={km(activity.distance)} unit="km" />
          <StatTile label="Elevation" value={metres(activity.elevationGain)} unit="m" />
        </StatPair>
      </div>

      <div className="dock">
        <p className="dock-note">
          {estimatedDurationSec}-second vertical video, {OUTPUT.width} × {OUTPUT.height}. Ready in{" "}
          {estimatedWait}.
        </p>
        {createAction ? (
          <form action={createAction}>
            <input type="hidden" name="activityId" value={activity.id} />
            <Button type="submit" variant="primary">
              Create flyover
            </Button>
          </form>
        ) : (
          <ButtonLink href={createHref} variant="primary">
            Create flyover
          </ButtonLink>
        )}
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}
