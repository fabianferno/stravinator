import { NextResponse } from "next/server";
import { requireAthleteId } from "@/lib/session";
import { enqueue, listJobsForAthlete } from "@/lib/jobs";

/** Submit an activity for rendering. */
export async function POST(req: Request) {
  let athleteId: string;
  try {
    athleteId = await requireAthleteId();
  } catch {
    return NextResponse.json({ error: "session-expired" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { activityId?: string } | null;
  const activityId = body?.activityId;
  if (!activityId) {
    return NextResponse.json({ error: "activityId is required" }, { status: 400 });
  }

  const job = await enqueue(athleteId, String(activityId));
  return NextResponse.json({ job }, { status: 201 });
}

export async function GET() {
  let athleteId: string;
  try {
    athleteId = await requireAthleteId();
  } catch {
    return NextResponse.json({ error: "session-expired" }, { status: 401 });
  }
  return NextResponse.json({ jobs: await listJobsForAthlete(athleteId) });
}
