/**
 * Token-less fallback scene.
 *
 * When `NEXT_PUBLIC_CESIUM_ION_TOKEN` is unset there is no map to render, but the
 * page still has to be testable: the capture driver's whole contract is
 * `sceneReady` / `frameCount` / `seekToFrame`, and that contract should be
 * verifiable without a billable Cesium ion account. So we draw a deliberately
 * synthetic wireframe terrain with the same camera maths — right pitch, right
 * bearing, right trail — and mark it loudly as NOT the real scene so nobody
 * mistakes a placeholder capture for a shippable video.
 *
 * It is a 2D canvas with a hand-rolled pinhole projection. Heights come from a
 * fixed sum of sines, so this too is fully deterministic.
 */

import { LIME, nextPaint, trailFor, type SceneEngine, type SceneInput } from "./engine";
import { OUTPUT, type CameraKeyframe, type LngLat } from "@/lib/types";

const M_PER_DEG_LAT = 110574;
const FOV_Y = (40 * Math.PI) / 180;
const NEAR = 40;

export function createPlaceholderEngine(input: SceneInput): SceneEngine {
  const { container, keyframes, route, routeProgressIndex } = input;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT.width;
  canvas.height = OUTPUT.height;
  canvas.style.width = `${OUTPUT.width}px`;
  canvas.style.height = `${OUTPUT.height}px`;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  async function seek(frame: number): Promise<void> {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);
    draw(ctx, kf, trailFor(route, routeProgressIndex[frame] ?? 1));
    await nextPaint();
  }

  return {
    ready: Promise.resolve(),
    seek,
    destroy: () => canvas.remove(),
    isReal: false,
  };
}

/** Deterministic pseudo-terrain, metres above sea level. */
function heightAt(x: number, y: number): number {
  return (
    1200 +
    380 * Math.sin(x / 1400) * Math.cos(y / 1750) +
    210 * Math.sin((x + y) / 620) +
    90 * Math.cos(x / 260)
  );
}

interface Camera {
  lng0: number;
  lat0: number;
  mPerDegLng: number;
  sinP: number;
  cosP: number;
  behind: number;
  above: number;
  cosB: number;
  sinB: number;
  focal: number;
  groundZ: number;
}

function makeCamera(kf: CameraKeyframe): Camera {
  const lat = kf.center[1];
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const mPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** kf.zoom;
  const dist = mPerPixel * OUTPUT.height * 0.5;
  const p = (kf.pitch * Math.PI) / 180;
  const b = (kf.bearing * Math.PI) / 180;
  return {
    lng0: kf.center[0],
    lat0: lat,
    mPerDegLng,
    sinP: Math.sin(p),
    cosP: Math.cos(p),
    behind: dist * Math.sin(p),
    above: dist * Math.cos(p),
    cosB: Math.cos(b),
    sinB: Math.sin(b),
    focal: OUTPUT.height / 2 / Math.tan(FOV_Y / 2),
    groundZ: heightAt(0, 0),
  };
}

/** World metres relative to the camera target, rotated so +Y is the view bearing. */
function toLocal(cam: Camera, lng: number, lat: number): [number, number] {
  const east = (lng - cam.lng0) * cam.mPerDegLng;
  const north = (lat - cam.lat0) * M_PER_DEG_LAT;
  return [east * cam.cosB - north * cam.sinB, east * cam.sinB + north * cam.cosB];
}

/** Pinhole projection to screen pixels; null when behind the near plane. */
function project(cam: Camera, x: number, y: number, z: number): [number, number] | null {
  const vy = y + cam.behind;
  const vz = z - cam.groundZ - cam.above;
  const depth = vy * cam.sinP - vz * cam.cosP;
  if (depth < NEAR) return null;
  const up = vy * cam.cosP + vz * cam.sinP;
  return [OUTPUT.width / 2 + (cam.focal * x) / depth, OUTPUT.height / 2 - (cam.focal * up) / depth];
}

function draw(ctx: CanvasRenderingContext2D, kf: CameraKeyframe, trail: LngLat[]) {
  const cam = makeCamera(kf);
  const W = OUTPUT.width;
  const H = OUTPUT.height;

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, "#05060B");
  sky.addColorStop(1, "#1A2036");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Terrain wireframe: a grid in the rotated local frame, so it slides under the
  // camera as bearing and position change.
  const span = 9000;
  const step = 300;
  ctx.lineWidth = 1;
  for (let gx = -span; gx <= span; gx += step) {
    strokePolyline(ctx, sampleLine(cam, gx, -span, gx, span, step), "rgba(120,150,190,0.18)");
  }
  for (let gy = -span; gy <= span; gy += step) {
    strokePolyline(ctx, sampleLine(cam, -span, gy, span, gy, step), "rgba(120,150,190,0.18)");
  }

  // Trail, in the lime accent, with a soft glow.
  const pts: Array<[number, number] | null> = trail.map(([lng, lat]) => {
    const [x, y] = toLocal(cam, lng, lat);
    return project(cam, x, y, heightAt(x, y) + 12);
  });
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(200,241,53,0.20)";
  ctx.lineWidth = 18;
  strokeSegments(ctx, pts);
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 5;
  strokeSegments(ctx, pts);
}

function sampleLine(
  cam: Camera,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
): Array<[number, number] | null> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  const out: Array<[number, number] | null> = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    out.push(project(cam, x, y, heightAt(x, y)));
  }
  return out;
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number] | null>,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  strokeSegments(ctx, pts);
}

/** Draws only runs of consecutive on-screen points, so clipped spans don't smear. */
function strokeSegments(ctx: CanvasRenderingContext2D, pts: Array<[number, number] | null>) {
  ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
    pen = true;
  }
  ctx.stroke();
}
