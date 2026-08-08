import type { Job } from "@/lib/types";
import type { RenderStage } from "@/components/StageList";

/** STATIC MOCK — replace with a poll of GET /api/jobs/:id. */
export const jobMock: Pick<Job, "status" | "progress" | "framesDone" | "frameCount"> = {
  status: "rendering",
  progress: 0.64,
  framesDone: 614,
  frameCount: 960,
};

export const jobStageSecondsMock: Partial<Record<RenderStage, number>> = {
  fetching: 3,
  smoothing: 1,
};

export const jobPointCountMock = 2481;
export const jobActivityNameMock = "Morning Run";
