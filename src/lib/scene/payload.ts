/**
 * Payload loading for the render scene.
 *
 * Two sources: the job API (which the jobs/API agent will land at
 * `/api/render/[jobId]`) and the committed fixture. The fixture path exists so
 * this page — and the frame-stepping contract the whole capture pipeline rests
 * on — is testable today, standalone, with no database and no Strava.
 */

import type { RenderPayload } from "@/lib/types";
import { FIXTURE_PAYLOAD } from "./fixture";

export async function loadPayload(opts: {
  jobId: string | null;
  fixture: boolean;
}): Promise<RenderPayload> {
  if (opts.fixture) return FIXTURE_PAYLOAD;
  if (!opts.jobId) {
    throw new Error("no job specified: use /render?job=<id> or /render?fixture=1");
  }
  const res = await fetch(`/api/render/${encodeURIComponent(opts.jobId)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`payload fetch failed for job ${opts.jobId}: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as RenderPayload;
  assertPayload(payload);
  return payload;
}

/**
 * Fail loudly and early. A payload whose arrays disagree produces a video that
 * silently freezes or truncates, and that is far harder to diagnose from an MP4
 * than from a console error at frame zero.
 */
export function assertPayload(p: RenderPayload): void {
  if (!p || !Array.isArray(p.keyframes) || p.keyframes.length === 0) {
    throw new Error("payload has no keyframes");
  }
  if (!Array.isArray(p.route) || p.route.length < 2) {
    throw new Error("payload route needs at least two points");
  }
  if (p.routeProgressIndex.length !== p.keyframes.length) {
    throw new Error(
      `routeProgressIndex length ${p.routeProgressIndex.length} != keyframes length ${p.keyframes.length}`,
    );
  }
}
