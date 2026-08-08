/**
 * End-to-end smoke test over the REAL job path: seeds a job in Postgres, then
 * captures it via `/render?job=<id>`, which makes the page fetch its payload
 * from `/api/render/[jobId]` using the worker token.
 *
 * `smoke.ts` uses the fixture payload and so never exercises the database, the
 * API route, or the auth header. This one does.
 *
 * Usage:
 *   DATABASE_URL=... WORKER_TOKEN=... APP_URL=... npx tsx worker/smoke-job.ts [frames]
 */
import { mkdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { captureVideo } from "./capture";
import { query } from "../src/lib/db/pool";
import { enqueue, setStatus } from "../src/lib/jobs";
import { buildCameraPath, frameCountFor, toStats, routeFrom } from "../src/lib/track";
import { loadFixture } from "../src/lib/track/fixtures";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const FRAMES = Number(process.argv[2] ?? 45);
const DIR = path.join(process.cwd(), ".worker", "smoke");

async function main() {
  await mkdir(DIR, { recursive: true });

  const athleteId = `smoke-${Date.now()}`;
  await query(
    `INSERT INTO athletes (id, name, avatar_url, access_token, refresh_token, token_expires_at)
     VALUES ($1, 'Smoke Athlete', NULL, 'a', 'r', now() + interval '6 hours')
     ON CONFLICT (id) DO NOTHING`,
    [athleteId],
  );

  // Run the real smoothing engine over a real fixture track, so what gets
  // rendered is what the worker would actually produce.
  const track = loadFixture("clean-loop");
  const frameCount = frameCountFor(track);
  const job = await enqueue(athleteId, "smoke-activity");
  await setStatus(job.id, "rendering", {
    keyframes: buildCameraPath(track, frameCount),
    stats: toStats(track),
    route: routeFrom(track),
    frameCount,
  });

  console.log(`seeded job ${job.id} (${frameCount} frames); capturing ${FRAMES}`);

  const outPath = path.join(DIR, "smoke-job.mp4");
  await rm(outPath, { force: true });

  await captureVideo({
    url: `${APP_URL}/render?job=${job.id}`,
    outPath,
    tileCacheDir: path.join(DIR, "tiles"),
    maxFrames: FRAMES,
    allowPlaceholder: true,
    onProgress: (f, total) => {
      if (f % 15 === 0 || f === total) console.log(`  ${f} / ${total}`);
    },
  });

  const { size } = await stat(outPath);
  console.log(`OK — ${outPath} (${(size / 1e6).toFixed(2)} MB)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE-JOB FAILED:", err);
  process.exit(1);
});
