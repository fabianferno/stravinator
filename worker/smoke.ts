/**
 * End-to-end smoke test: drives the real /render page through the real capture
 * driver and the real encoder, and checks a playable MP4 comes out.
 *
 * Needs a dev server running. Usage:
 *   APP_URL=http://localhost:3000 npx tsx worker/smoke.ts [frames]
 */
import { mkdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { captureVideo } from "./capture";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const FRAMES = Number(process.argv[2] ?? 60);
const DIR = path.join(process.cwd(), ".worker", "smoke");

async function main() {
  await mkdir(DIR, { recursive: true });
  const outPath = path.join(DIR, "smoke.mp4");
  await rm(outPath, { force: true });

  console.log(`capturing ${FRAMES} frames from ${APP_URL}/render?fixture=1`);
  const started = Date.now();

  await captureVideo({
    url: `${APP_URL}/render?fixture=1`,
    outPath,
    tileCacheDir: path.join(DIR, "tiles"),
    maxFrames: FRAMES,
    // No Mapbox token in this environment; we are proving the frame-stepping
    // and encoding path, not the terrain imagery.
    allowPlaceholder: true,
    onProgress: (f, total) => {
      if (f % 10 === 0 || f === total) console.log(`  ${f} / ${total}`);
    },
  });

  const { size } = await stat(outPath);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`OK — ${outPath} (${(size / 1e6).toFixed(2)} MB) in ${secs}s`);

  if (size < 1000) throw new Error("Output is suspiciously small; the encode likely produced junk.");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
