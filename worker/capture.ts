/**
 * Frame-stepper. Drives the /render page one frame at a time and pipes the
 * screenshots straight into ffmpeg.
 *
 * This module knows nothing about running, maps, or Strava — it knows how to
 * step a page that implements the scene contract and how to feed an encoder.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn } from "node:child_process";
import { OUTPUT } from "../src/lib/types";

/** The contract `/render` promises. Kept here so drift shows up as a type error. */
declare global {
  interface Window {
    sceneReady: Promise<void>;
    frameCount: number;
    seekToFrame: (i: number) => Promise<void>;
    sceneInfo?: { real: boolean; jobId: string; frameCount: number };
  }
}

export interface CaptureOptions {
  /** Fully-qualified URL of the render page, including the job id. */
  url: string;
  /** Where the finished MP4 lands. */
  outPath: string;
  /** Directory for the terrain/imagery tile cache, reused across renders. */
  tileCacheDir: string;
  /** Called after each frame so the job can report honest progress. */
  onProgress?: (frame: number, total: number) => void | Promise<void>;
  /** Hard ceiling on the whole capture. Exceeding it fails the job. */
  timeoutMs?: number;
  /** Retries for a single frame before the job is failed. */
  frameRetries?: number;
  /**
   * Cap the frames captured. Smoke tests only — a real job must encode every
   * frame or the video ends early.
   */
  maxFrames?: number;
  /**
   * Permit capturing the no-token placeholder terrain. Smoke tests only; never
   * set this for a job whose output an athlete will see.
   */
  allowPlaceholder?: boolean;
  /**
   * Shared secret for `/api/render/[jobId]`. The scene fetches its payload from
   * inside the page, so the header has to be attached at the browser context —
   * there is no other hook between `goto` and that request.
   */
  workerToken?: string;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_FRAME_RETRIES = 3;
/** A single frame should never legitimately take this long. */
const FRAME_TIMEOUT_MS = 30_000;

export async function captureVideo(opts: CaptureOptions): Promise<string> {
  const {
    url,
    outPath,
    tileCacheDir,
    onProgress,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    frameRetries = DEFAULT_FRAME_RETRIES,
    maxFrames,
    allowPlaceholder = false,
    workerToken = process.env.WORKER_TOKEN,
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({
      // Full Chromium, not the headless shell: the shell's WebGL support is
      // too limited to render 3D terrain.
      channel: "chromium",
      args: [
        // Persist terrain and imagery tiles across frames and across renders. Tiles bill per
        // request, so this is a cost control, not just a speed one.
        `--disk-cache-dir=${tileCacheDir}`,
        "--disk-cache-size=1073741824",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        // Headless Chromium falls back to SwiftShader without this; terrain
        // rendering is unusably slow on the software path.
        "--use-gl=angle",
        "--enable-unsafe-swiftshader",
      ],
    });

    const page = await browser.newPage({
      viewport: { width: OUTPUT.width, height: OUTPUT.height },
      deviceScaleFactor: 1,
    });

    // The worker token goes only to our own app. `extraHTTPHeaders` would
    // attach it to every request the page makes, and a custom header on a
    // cross-origin tile request forces a CORS preflight that Cesium ion
    // rejects — the scene then dies with "Request has failed".
    if (workerToken) {
      const appOrigin = new URL(url).origin;
      await page.route(
        (u) => u.origin === appOrigin,
        (route) =>
          route.continue({ headers: { ...route.request().headers(), "x-worker-token": workerToken } }),
      );
    }

    // Surface page errors instead of letting them turn into blank frames.
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(url, { waitUntil: "load", timeout: 120_000 });

    // Wait for the flag the page sets, not for `window.sceneReady` directly:
    // evaluating a promise that does not exist yet resolves to undefined
    // immediately, which looks like success and yields a blank video.
    // The budget must exceed the scene's own cold-start timeout (180 s in
    // cesiumEngine.ts) so the page, not this driver, decides that a start
    // has failed and says why.
    await page.waitForFunction(
      () => document.body.dataset.sceneReady === "1" || !!document.body.dataset.sceneError,
      undefined,
      { timeout: 240_000 },
    );

    const sceneError = await page.evaluate(() => document.body.dataset.sceneError);
    if (sceneError) throw new Error(`Render page failed to start: ${sceneError}`);

    const frameCount = await page.evaluate(() => window.frameCount);
    if (!Number.isInteger(frameCount) || frameCount <= 0) {
      throw new Error(`Render page reported an invalid frame count: ${frameCount}`);
    }

    // The scene falls back to wireframe placeholder terrain when no Cesium ion
    // token is configured. That is fine for development and must never reach
    // an athlete as a finished video.
    const real = await page.evaluate(() => window.sceneInfo?.real !== false);
    if (!real && !allowPlaceholder) {
      throw new Error(
        "Render page is using placeholder terrain — NEXT_PUBLIC_CESIUM_ION_TOKEN is not configured.",
      );
    }

    const total = maxFrames ? Math.min(maxFrames, frameCount) : frameCount;
    const ffmpeg = startEncoder(outPath);

    for (let i = 0; i < total; i++) {
      if (Date.now() > deadline) {
        ffmpeg.kill();
        throw new Error(
          `Render exceeded its time budget at frame ${i} of ${total}. No partial video delivered.`,
        );
      }

      const png = await grabFrame(page, i, frameRetries, pageErrors);
      await writeFrame(ffmpeg.stdin, png);
      await onProgress?.(i + 1, total);
    }

    return await finishEncoder(ffmpeg, outPath);
  } finally {
    await browser?.close();
  }
}

/**
 * Seek and screenshot one frame, retrying on tile-load failures. We fail the
 * whole job rather than ship a video with holes in the terrain.
 */
async function grabFrame(
  page: Page,
  frame: number,
  retries: number,
  pageErrors: string[],
): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.evaluate(
        ([i, timeout]) =>
          Promise.race([
            window.seekToFrame(i as number),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("seekToFrame timed out")), timeout as number),
            ),
          ]),
        [frame, FRAME_TIMEOUT_MS] as const,
      );
      return await page.screenshot({ type: "png", timeout: FRAME_TIMEOUT_MS });
    } catch (err) {
      lastError = err;
    }
  }

  const detail = pageErrors.length ? ` Page errors: ${pageErrors.join("; ")}` : "";
  throw new Error(
    `Frame ${frame} failed after ${retries + 1} attempts: ${String(lastError)}.${detail}`,
  );
}

interface Encoder {
  stdin: NodeJS.WritableStream;
  done: Promise<number>;
  kill: () => void;
  stderr: () => string;
}

/** PNG frames in on stdin, H.264 MP4 out. */
function startEncoder(outPath: string): Encoder {
  const proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-f", "image2pipe",
      "-vcodec", "png",
      "-framerate", String(OUTPUT.fps),
      "-i", "-",
      "-vf", `scale=${OUTPUT.width}:${OUTPUT.height},format=yuv420p`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      // Instagram and friends need the index at the front to stream it.
      "-movflags", "+faststart",
      outPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    // ffmpeg is chatty; keep only the tail for diagnostics.
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  // Without this, an early ffmpeg exit turns into an unhandled EPIPE crash.
  proc.stdin.on("error", () => {});

  const done = new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? -1));
  });

  return { stdin: proc.stdin, done, kill: () => proc.kill("SIGKILL"), stderr: () => stderr };
}

/** Respect backpressure — a 1080x1920 PNG stream will outrun the encoder. */
function writeFrame(stdin: NodeJS.WritableStream, png: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stdin.write(png, (err) => (err ? reject(err) : undefined));
    if (ok) resolve();
    else stdin.once("drain", () => resolve());
  });
}

async function finishEncoder(enc: Encoder, outPath: string): Promise<string> {
  enc.stdin.end();
  const code = await enc.done;
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code}: ${enc.stderr()}`);
  }
  return outPath;
}
