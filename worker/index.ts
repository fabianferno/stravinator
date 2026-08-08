/**
 * The render worker. Claims a job, walks it through the pipeline, and reports
 * honest progress at every stage.
 *
 * Runs as a long-lived container: headless Chromium and ffmpeg cannot run in a
 * serverless function.
 */
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { captureVideo } from "./capture";
import type { RawTrack } from "../src/lib/types";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${randomUUID().slice(0, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const WORK_DIR = process.env.WORK_DIR ?? path.join(process.cwd(), ".worker");
const TILE_CACHE_DIR = path.join(WORK_DIR, "tile-cache");
const OUT_DIR = path.join(WORK_DIR, "out");

/** How long a claim is held before another worker may steal it. */
const LEASE_SECONDS = 120;
/** Extended well inside the lease so a long render is never stolen mid-flight. */
const HEARTBEAT_MS = 30_000;
/** Backoff when the queue is empty. */
const IDLE_POLL_MS = 5_000;

let shuttingDown = false;

async function main() {
  await mkdir(TILE_CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[${WORKER_ID}] up. app=${APP_URL} work=${WORK_DIR}`);

  process.on("SIGTERM", () => {
    shuttingDown = true;
    console.log(`[${WORKER_ID}] SIGTERM — finishing current job, then exiting.`);
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
  });

  while (!shuttingDown) {
    const job = await claimNext();
    if (!job) {
      await sleep(IDLE_POLL_MS);
      continue;
    }
    await runJob(job);
  }

  console.log(`[${WORKER_ID}] exited cleanly.`);
}

async function claimNext() {
  const { claim } = await import("../src/lib/jobs");
  try {
    return await claim(WORKER_ID, LEASE_SECONDS);
  } catch (err) {
    console.error(`[${WORKER_ID}] claim failed:`, err);
    return null;
  }
}

async function runJob(job: { id: string; athleteId: string; activityId: string }) {
  const jobs = await import("../src/lib/jobs");
  const beat = setInterval(
    () => void jobs.heartbeat(job.id, WORKER_ID).catch(() => {}),
    HEARTBEAT_MS,
  );

  console.log(`[${WORKER_ID}] claimed job ${job.id} (activity ${job.activityId})`);

  try {
    // 1. Fetch the track from Strava.
    await jobs.setStatus(job.id, "fetching");
    const track = await fetchTrack(job.athleteId, job.activityId);

    // 2. Turn noisy GPS into a cinematic camera path.
    await jobs.setStatus(job.id, "smoothing");
    const { buildCameraPath, frameCountFor, toStats, routeFrom } = await import(
      "../src/lib/track"
    );
    const frameCount = frameCountFor(track);
    const keyframes = buildCameraPath(track, frameCount);
    await jobs.setStatus(job.id, "rendering", {
      keyframes,
      stats: toStats(track),
      route: routeFrom(track),
      frameCount,
    });

    // 3. Step the scene frame by frame and encode.
    const outPath = path.join(OUT_DIR, `${job.id}.mp4`);
    await captureVideo({
      url: `${APP_URL}/render?job=${encodeURIComponent(job.id)}`,
      outPath,
      tileCacheDir: TILE_CACHE_DIR,
      onProgress: async (frame, total) => {
        await jobs.setStatus(job.id, "rendering", { framesDone: frame, progress: frame / total });
      },
    });

    // 4. Publish.
    await jobs.setStatus(job.id, "encoding");
    const videoUrl = await publish(job.id, outPath);
    await jobs.complete(job.id, videoUrl);

    const { size } = await stat(outPath);
    console.log(`[${WORKER_ID}] job ${job.id} done — ${(size / 1e6).toFixed(1)} MB`);
  } catch (err) {
    await handleFailure(job.id, err);
  } finally {
    clearInterval(beat);
  }
}

async function handleFailure(jobId: string, err: unknown) {
  const jobs = await import("../src/lib/jobs");
  const { StravaRateLimitError } = await import("../src/lib/strava");

  // Rate limiting is not this job's fault, so it must not burn an attempt.
  if (err instanceof StravaRateLimitError) {
    console.warn(`[${WORKER_ID}] job ${jobId} hit the Strava rate limit; requeueing.`);
    await jobs.requeueForRateLimit(jobId, err.retryAfterSec ?? 900);
    return;
  }

  console.error(`[${WORKER_ID}] job ${jobId} failed:`, err);
  await jobs.fail(jobId, userFacingReason(err));
}

/** Never leak a stack trace into the UI. */
function userFacingReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("time budget")) return "The render took too long and was stopped.";
  if (msg.startsWith("Frame ")) return "The map failed to load while rendering. Please try again.";
  if (msg.includes("ffmpeg")) return "Encoding the video failed. Please try again.";
  return "Something went wrong while making your flyover. Please try again.";
}

async function fetchTrack(athleteId: string, activityId: string): Promise<RawTrack> {
  const { getAthleteTokens, saveAthleteTokens } = await import("../src/lib/db/athletes");
  const strava = await import("../src/lib/strava");

  const stored = await getAthleteTokens(athleteId);

  try {
    const { result, tokens, rotated } = await strava.withFreshToken(
      stored,
      async (accessToken) => {
        const activity = await strava.getActivity(accessToken, activityId);
        const streams = await strava.getStreams(accessToken, activityId);
        return strava.toRawTrack(activity, streams);
      },
    );
    // Strava rotates the refresh token; losing it means forcing a re-auth.
    if (rotated) await saveAthleteTokens(athleteId, tokens);
    return result;
  } catch (err) {
    // A failed request must not strand the athlete holding a token Strava
    // has already burned.
    if (strava.hasRotatedTokens(err)) await saveAthleteTokens(athleteId, err.rotatedTokens);
    throw err;
  }
}

/**
 * v1 serves finished videos from the worker's local disk via the app. Swapping
 * in object storage means changing only this function.
 */
async function publish(jobId: string, outPath: string): Promise<string> {
  void outPath;
  return `/api/jobs/${jobId}/video`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error(`[${WORKER_ID}] fatal:`, err);
  process.exit(1);
});
