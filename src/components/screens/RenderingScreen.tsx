import type { Job } from "@/lib/types";
import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import { Button } from "@/components/Button";
import { Card, Readout, ReadoutUnit } from "@/components/Card";
import { DotMatrix } from "@/components/DotMatrix";
import { StageList, type RenderStage } from "@/components/StageList";

export interface RenderingScreenProps {
  /** Real job state. Every number on this screen comes from here — never a timer. */
  job: Pick<Job, "status" | "progress" | "framesDone" | "frameCount">;
  /** Title of the activity being flown. */
  activityName?: string;
  /** Real elapsed seconds for stages already finished. */
  stageSeconds?: Partial<Record<RenderStage, number>>;
  /** Smoothed track point count, once `smoothing` has run. */
  pointCount?: number;
  backHref?: string;
  /** Cancel action. Omit to hide the cancel affordance. */
  cancelHref?: string;
}

const STAGE_COPY: Record<Job["status"], string> = {
  queued: "Waiting for a renderer",
  fetching: "Fetching from Strava",
  smoothing: "Smoothing your track",
  rendering: "Rendering frames",
  encoding: "Encoding video",
  done: "Finished",
  failed: "Stopped",
};

export function RenderingScreen({
  job,
  activityName,
  stageSeconds,
  pointCount,
  backHref = "/activities",
  cancelHref,
}: RenderingScreenProps) {
  // Honest percentage: frame-derived while rendering, stage-level otherwise.
  const fraction =
    job.status === "rendering" && job.frameCount > 0
      ? job.framesDone / job.frameCount
      : job.progress;
  const percent = `${Math.max(0, Math.min(100, Math.round(fraction * 100)))}%`;

  const caption =
    job.status === "rendering" && job.frameCount > 0
      ? `Frame ${job.framesDone.toLocaleString("en-GB")} of ${job.frameCount.toLocaleString("en-GB")}`
      : STAGE_COPY[job.status];

  return (
    <div className="shell">
      <AppBar title="Flying your route" backHref={backHref} backLabel="Back to your runs" />

      <div className="body">
        <Card tone="magenta" className="card-centred" style={{ minHeight: 250 }}>
          <Readout flush>
            <DotMatrix text={percent} label={`${percent} complete`} />
            <ReadoutUnit>{caption}</ReadoutUnit>
          </Readout>
        </Card>

        <Card style={{ padding: "6px 20px" }}>
          <StageList
            status={job.status}
            framesDone={job.framesDone}
            frameCount={job.frameCount}
            stageSeconds={stageSeconds}
            pointCount={pointCount}
          />
        </Card>

        <p className="sr-only" aria-live="polite">
          {activityName ? `${activityName}: ` : ""}
          {caption}, {percent} complete.
        </p>
      </div>

      <div className="dock">
        <p className="dock-note">
          Leave this screen if you like — we keep rendering and notify you when it&rsquo;s ready.
        </p>
        {cancelHref ? (
          <form action={cancelHref} method="post">
            <Button type="submit" variant="quiet" className="btn-block">
              Cancel render
            </Button>
          </form>
        ) : null}
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}
