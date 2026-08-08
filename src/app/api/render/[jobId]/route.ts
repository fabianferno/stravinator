import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
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

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const { keyframes, stats, route, routeProgressIndex } = job as unknown as RenderPayload & {
    keyframes: RenderPayload["keyframes"];
  };

  if (!keyframes?.length || !route?.length) {
    return NextResponse.json({ error: "job-not-prepared" }, { status: 409 });
  }

  const payload: RenderPayload = { jobId, stats, keyframes, route, routeProgressIndex };
  return NextResponse.json(payload);
}
