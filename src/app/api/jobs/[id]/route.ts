import { NextResponse } from "next/server";
import { requireAthleteId } from "@/lib/session";
import { getJob } from "@/lib/jobs";

/** Status poll for the rendering screen. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let athleteId: string;
  try {
    athleteId = await requireAthleteId();
  } catch {
    return NextResponse.json({ error: "session-expired" }, { status: 401 });
  }

  const job = await getJob(id);
  // Same response for missing and not-yours: a job id should not be probeable.
  if (!job || job.athleteId !== athleteId) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      framesDone: job.framesDone,
      frameCount: job.frameCount,
      error: job.error,
      videoUrl: job.videoUrl,
    },
  });
}
