import { NextResponse } from "next/server";
import { getJobArtifacts } from "@/lib/jobs";
import type { RenderPayload } from "@/lib/types";

/**
 * Feeds the /render page. Consumed by the headless browser inside the worker,
 * not by the athlete's browser, so it is gated on a worker token rather than a
 * session cookie.
 */
export async function GET(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;

  const expected = process.env.WORKER_TOKEN;
  if (!expected || req.headers.get("x-worker-token") !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const artifacts = await getJobArtifacts(jobId);
  if (!artifacts) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const { keyframes, stats, route } = artifacts;
  if (!keyframes?.length || !route?.length || !stats) {
    return NextResponse.json({ error: "job-not-prepared" }, { status: 409 });
  }

  // Derived rather than stored: how far the route line is drawn is exactly the
  // camera's progress along it, so persisting it separately would be a second
  // copy of the same fact and a chance for the two to disagree.
  const last = route.length - 1;
  const routeProgressIndex = keyframes.map((k) => Math.round(k.progress * last));

  const payload: RenderPayload = { jobId, stats, keyframes, route, routeProgressIndex };
  return NextResponse.json(payload);
}
