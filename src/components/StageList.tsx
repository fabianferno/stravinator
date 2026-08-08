import type { JobStatus } from "@/lib/types";
import { CheckIcon } from "./icons";
import "./StageList.css";

/** The four stages the athlete sees, in the order the worker runs them. */
export const RENDER_STAGES = ["fetching", "smoothing", "rendering", "encoding"] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];

export interface StageListProps {
  /** Real job status straight off `Job.status`. */
  status: JobStatus;
  /** Real frame counters off `Job.framesDone` / `Job.frameCount`. */
  framesDone: number;
  frameCount: number;
  /** Optional real elapsed seconds per completed stage. Omitted stages read "Done". */
  stageSeconds?: Partial<Record<RenderStage, number>>;
  /** Number of smoothed track points, once known. */
  pointCount?: number;
}

const ORDER: Record<JobStatus, number> = {
  queued: -1,
  fetching: 0,
  smoothing: 1,
  rendering: 2,
  encoding: 3,
  done: 4,
  failed: 4,
};

type State = "done" | "now" | "todo";

function labelFor(stage: RenderStage, state: State, pointCount?: number): string {
  switch (stage) {
    case "fetching":
      return state === "done" ? "Fetched from Strava" : "Fetching from Strava";
    case "smoothing":
      if (state === "done") {
        return pointCount
          ? `Smoothed ${pointCount.toLocaleString("en-GB")} points`
          : "Smoothed track";
      }
      return "Smoothing track";
    case "rendering":
      return "Rendering frames";
    case "encoding":
      return state === "done" ? "Encoded video" : "Encoding video";
  }
}

export function StageList({
  status,
  framesDone,
  frameCount,
  stageSeconds,
  pointCount,
}: StageListProps) {
  const current = ORDER[status];
  const framePct = frameCount > 0 ? Math.min(100, (framesDone / frameCount) * 100) : 0;

  return (
    <ol className="stages">
      {RENDER_STAGES.map((stage, i) => {
        const state: State = i < current ? "done" : i === current ? "now" : "todo";
        const name = labelFor(stage, state, pointCount);
        const secs = stageSeconds?.[stage];

        // The rendering stage gets a wider treatment: honest frame counts + a bar.
        if (stage === "rendering" && state === "now") {
          return (
            <li className="stage-wide" key={stage} aria-current="step">
              <div className="stage-wide-head">
                <span className="dot dot-now" aria-hidden="true" />
                <span className="stage-name stage-name-now">{name}</span>
                <span className="stage-val stage-val-now">
                  {framesDone.toLocaleString("en-GB")} / {frameCount.toLocaleString("en-GB")}
                </span>
              </div>
              <div
                className="track"
                role="progressbar"
                aria-label="Frames rendered"
                aria-valuemin={0}
                aria-valuemax={frameCount}
                aria-valuenow={framesDone}
                aria-valuetext={`${framesDone} of ${frameCount} frames`}
              >
                <i style={{ width: `${framePct}%` }} />
              </div>
            </li>
          );
        }

        let value: string;
        if (state === "done") {
          value = secs !== undefined ? `${secs}s` : "Done";
        } else if (state === "now") {
          value =
            stage === "rendering"
              ? `${framesDone.toLocaleString("en-GB")} / ${frameCount.toLocaleString("en-GB")}`
              : "Working";
        } else {
          value = "Waiting";
        }

        return (
          <li
            className={`stage stage-${state}`}
            key={stage}
            aria-current={state === "now" ? "step" : undefined}
          >
            <span className={`dot dot-${state}`} aria-hidden="true">
              {state === "done" ? <CheckIcon /> : null}
            </span>
            <span className="stage-name">{name}</span>
            <span className="stage-val">{value}</span>
          </li>
        );
      })}
    </ol>
  );
}
