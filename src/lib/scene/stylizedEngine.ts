/**
 * Stylized scene engine — real elevation, deliberately non-photographic.
 *
 * WHY THIS EXISTS
 * ---------------
 * Satellite imagery is the expensive, licence-encumbered part of a flyover:
 * MapTiler forbids video as a derivative work, Google's Photorealistic 3D Tiles
 * cap video at 30 s promo clips, and Mapbox bills per tile. Elevation data, by
 * contrast, is openly licensed and cheap. So this engine keeps the real
 * mountain and throws the photograph away.
 *
 * Heights come from Mapterhorn's Terrarium-encoded global terrain tiles
 * (https://tiles.mapterhorn.com/tilejson.json), a build of national and
 * regional open elevation datasets — CC0, CC-BY-4.0, Datenlizenz Deutschland
 * and equivalents (https://mapterhorn.com/attribution). None restrict
 * derivative works or video. Required attribution, verbatim from their
 * TileJSON: "© Mapterhorn". No imagery, no vector basemap, no other vendor.
 *
 * THE LOOK
 * --------
 * The product's nocturnal identity (spec §8.1) rendered as a terrain: OLED
 * black ground, luminous contour-like ridge lines running across the view, and
 * the lime accent reserved entirely for the athlete's trail. Rows of terrain
 * are drawn far-to-near and filled beneath, so nearer ridges genuinely occlude
 * further ones and the trail disappears behind the hill it climbs — the shape
 * on screen is the athlete's actual mountain, not a decorative grid.
 *
 * `placeholderEngine.ts` is the ancestor of the projection maths here, but that
 * one invents its terrain from a sum of sines and is marked `isReal: false`.
 * This one is driven by real data and is a shippable look.
 *
 * DETERMINISM
 * -----------
 * Every tile is fetched and decoded before `ready` resolves; after that a frame
 * is a pure function of its index. No wall-clock, no animation, no ordering
 * dependence. The only clock is the failure guard on tile loading.
 */

import { LIME, nextPaint, trailFor, type SceneEngine, type SceneInput } from "./engine";
import { OUTPUT, type CameraKeyframe, type LngLat } from "@/lib/types";

export const MAPTERHORN_ATTRIBUTION = "© Mapterhorn";

const TILE_URL = (z: number, x: number, y: number) =>
  `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
const TILE_SIZE = 512;
/** ~13 m/px at alpine latitudes — a close match to the finest row spacing we draw. */
const DEM_ZOOM = 12;

const M_PER_DEG_LAT = 110574;
const FOV_Y = (40 * Math.PI) / 180;
const NEAR = 40;

/** How far ahead of the camera target terrain is drawn, in metres. */
const FAR = 15000;
/** Constant-ish on-screen row spacing: rows thin out with distance. */
const ROW_SPACING = 0.038;
/**
 * Vertical exaggeration. The camera sits low and close, so true-scale relief
 * reads as a gentle swell rather than as the mountain the athlete actually
 * climbed. This is the same lie `setTerrain({ exaggeration })` tells, and for
 * the same reason.
 */
const RELIEF_EXAGGERATION = 1.4;
/** Target horizontal sample spacing, in screen pixels. */
const COL_PIXELS = 2.4;

const SKY_TOP = "#000000";
const SKY_HORIZON = "#0B1226";
const GROUND_FILL = "#04050A";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createStylizedEngine(input: SceneInput): SceneEngine {
  const { container, keyframes, route, routeProgressIndex, frameTimeoutMs } = input;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT.width;
  canvas.height = OUTPUT.height;
  canvas.style.width = `${OUTPUT.width}px`;
  canvas.style.height = `${OUTPUT.height}px`;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false })!;

  let dem: Dem | null = null;

  const ready = (async () => {
    dem = await loadDem(coverageBounds(keyframes, route), frameTimeoutMs * 4);
  })();

  async function seek(frame: number): Promise<void> {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);
    if (!dem) throw new Error("stylized engine used before its elevation tiles loaded");
    draw(ctx, dem, kf, trailFor(route, routeProgressIndex[frame] ?? 1));
    await nextPaint();
  }

  return {
    ready,
    seek,
    destroy: () => canvas.remove(),
    // Real, openly licensed elevation for the athlete's actual route: this is a
    // shippable look, not a fallback, so the capture driver may encode it.
    isReal: true,
  };
}

// ---------------------------------------------------------------------------
// Elevation: Terrarium tiles -> bilinear sampler
// ---------------------------------------------------------------------------

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Everything the camera could possibly see: the route plus the far plane and
 * the camera's own set-back, padded. Computed once so the tile set is fixed
 * before the first frame — a tile arriving mid-capture would make frame i
 * depend on when it was requested.
 */
function coverageBounds(keyframes: CameraKeyframe[], route: LngLat[]): Bounds {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const [lng, lat] of [...route, ...keyframes.map((k) => k.center)]) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const padM = FAR + 6000;
  const midLat = (south + north) / 2;
  const padLat = padM / M_PER_DEG_LAT;
  const padLng = padM / (111320 * Math.cos((midLat * Math.PI) / 180));
  return {
    west: west - padLng,
    east: east + padLng,
    south: south - padLat,
    north: north + padLat,
  };
}

interface Dem {
  zoom: number;
  /** tile key `x/y` -> decoded elevations, metres, row-major TILE_SIZE². */
  tiles: Map<string, Float32Array>;
}

function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

async function loadDem(bounds: Bounds, budgetMs: number): Promise<Dem> {
  const z = DEM_ZOOM;
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(lngToTileX(bounds.west, z)));
  const x1 = Math.min(n - 1, Math.floor(lngToTileX(bounds.east, z)));
  const y0 = Math.max(0, Math.floor(latToTileY(bounds.north, z)));
  const y1 = Math.min(n - 1, Math.floor(latToTileY(bounds.south, z)));

  const jobs: Array<Promise<[string, Float32Array]>> = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(fetchTile(z, x, y).then((data) => [`${x}/${y}`, data] as [string, Float32Array]));
    }
  }

  // Wall-clock appears here and only here, as a failure guard. A half-loaded
  // DEM would put holes in the terrain, and a video with holes is worse than a
  // failed job (spec §7), so we reject rather than render what arrived in time.
  const all = Promise.all(jobs);
  const guarded = await Promise.race([
    all.then((entries) => ({ entries })),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`elevation tiles did not load within ${budgetMs}ms`)),
        budgetMs,
      ),
    ),
  ]);

  return { zoom: z, tiles: new Map(guarded.entries) };
}

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array> {
  const res = await fetch(TILE_URL(z, x, y), { cache: "force-cache" });
  if (!res.ok) throw new Error(`elevation tile ${z}/${x}/${y} failed: HTTP ${res.status}`);
  const blob = await res.blob();
  // No colour management, no premultiplication: the RGB triples *are* the
  // elevation, and any conversion would quietly corrupt the terrain.
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const off = document.createElement("canvas");
  off.width = TILE_SIZE;
  off.height = TILE_SIZE;
  const octx = off.getContext("2d", { alpha: false, willReadFrequently: true })!;
  octx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
  bitmap.close();
  const { data } = octx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);

  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Terrarium: elevation = (R * 256 + G + B / 256) - 32768
    out[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
  }
  return out;
}

/** Nearest-sample lookup in tile pixel space; NaN outside the loaded set. */
function texel(dem: Dem, px: number, py: number): number {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const tile = dem.tiles.get(`${tx}/${ty}`);
  if (!tile) return NaN;
  const ix = px - tx * TILE_SIZE;
  const iy = py - ty * TILE_SIZE;
  return tile[iy * TILE_SIZE + ix];
}

/** Bilinear elevation in metres. Returns NaN where no tile covers the point. */
function elevationAt(dem: Dem, lng: number, lat: number): number {
  const px = lngToTileX(lng, dem.zoom) * TILE_SIZE;
  const py = latToTileY(lat, dem.zoom) * TILE_SIZE;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const a = texel(dem, x0, y0);
  const b = texel(dem, x0 + 1, y0);
  const c = texel(dem, x0, y0 + 1);
  const d = texel(dem, x0 + 1, y0 + 1);
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return a;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// ---------------------------------------------------------------------------
// Camera — the same pinhole model as the placeholder, real heights
// ---------------------------------------------------------------------------

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

function makeCamera(kf: CameraKeyframe, dem: Dem): Camera {
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
    // The real ground under the camera, averaged over a small neighbourhood so
    // the camera does not inherit the DEM's pixel-scale noise. The keyframe's
    // own `elevation` cannot be used: it comes from the athlete's barometer or
    // from a synthetic fixture, and even a 100 m disagreement with the DEM
    // buries the camera inside the mountain.
    groundZ: groundHeight(dem, kf.center[0], lat, mPerDegLng),
  };
}

/**
 * Raise the camera until the ground between it and the middle distance is below
 * it. The keyframes were planned against a smoothed altitude series, not
 * against this DEM, so on a switchbacking climb the nominal camera can end up
 * inside the hillside — which paints the whole frame flat black. A pure
 * function of the frame's own camera and the DEM, so it stays deterministic.
 */
function liftAboveTerrain(cam: Camera, dem: Dem): void {
  const clearance = 140;
  let needed = -Infinity;
  // Densely sampled on purpose: a coarse grid makes the required clearance jump
  // as individual sample points cross a ridge, and that jump would read as the
  // camera bobbing between frames.
  for (let y = -cam.behind; y <= 2800; y += 90) {
    for (const x of [-500, -250, 0, 250, 500]) {
      const h = sample(cam, dem, x, y);
      if (h > needed) needed = h;
    }
  }
  const altitude = cam.groundZ + cam.above;
  if (needed + clearance > altitude) cam.above = needed + clearance - cam.groundZ;
}

/** Mean DEM height in a small disc around a point, in metres. */
function groundHeight(dem: Dem, lng: number, lat: number, mPerDegLng: number): number {
  const r = 180; // metres
  const dLng = r / mPerDegLng;
  const dLat = r / M_PER_DEG_LAT;
  const samples = [
    elevationAt(dem, lng, lat),
    elevationAt(dem, lng + dLng, lat),
    elevationAt(dem, lng - dLng, lat),
    elevationAt(dem, lng, lat + dLat),
    elevationAt(dem, lng, lat - dLat),
  ].filter((n) => !Number.isNaN(n));
  if (samples.length === 0) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** World metres relative to the camera target, rotated so +Y is the view bearing. */
function toLocal(cam: Camera, lng: number, lat: number): [number, number] {
  const east = (lng - cam.lng0) * cam.mPerDegLng;
  const north = (lat - cam.lat0) * M_PER_DEG_LAT;
  return [east * cam.cosB - north * cam.sinB, east * cam.sinB + north * cam.cosB];
}

/** Inverse of `toLocal`. */
function toLngLat(cam: Camera, x: number, y: number): [number, number] {
  const east = x * cam.cosB + y * cam.sinB;
  const north = -x * cam.sinB + y * cam.cosB;
  return [cam.lng0 + east / cam.mPerDegLng, cam.lat0 + north / M_PER_DEG_LAT];
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

function sample(cam: Camera, dem: Dem, x: number, y: number): number {
  const [lng, lat] = toLngLat(cam, x, y);
  const e = elevationAt(dem, lng, lat);
  if (Number.isNaN(e)) return cam.groundZ;
  // Exaggerate about the camera's own ground height, so the athlete's altitude
  // stays put and only the relief around them grows.
  return cam.groundZ + (e - cam.groundZ) * RELIEF_EXAGGERATION;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw(ctx: CanvasRenderingContext2D, dem: Dem, kf: CameraKeyframe, trail: LngLat[]) {
  const cam = makeCamera(kf, dem);
  liftAboveTerrain(cam, dem);
  const W = OUTPUT.width;
  const H = OUTPUT.height;

  // ---- sky ------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(0.55, "#05070F");
  sky.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ---- terrain rows, far to near --------------------------------------
  // Each row is filled below its profile, so a nearer ridge painted later
  // hides everything behind it. That is the hidden-line removal that makes
  // this read as a solid mountain rather than a see-through grid.
  const rows = rowDepths(cam);
  const trailSegs = trailSegments(cam, dem, trail);
  let segIdx = 0;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let r = 0; r < rows.length; r++) {
    const y = rows[r];
    drawRow(ctx, cam, dem, y);

    // Trail lives on the surface, so segments at this depth are painted
    // straight after their row and are then occluded by any nearer ridge.
    const nextY = r + 1 < rows.length ? rows[r + 1] : -Infinity;
    while (segIdx < trailSegs.length && trailSegs[segIdx].y > nextY) {
      drawTrailSegment(ctx, trailSegs[segIdx]);
      segIdx++;
    }
  }
  while (segIdx < trailSegs.length) {
    drawTrailSegment(ctx, trailSegs[segIdx]);
    segIdx++;
  }
}

/** Row distances, far to near, spaced so they land at even screen intervals. */
function rowDepths(cam: Camera): number[] {
  const out: number[] = [];
  const nearest = -cam.behind + 260;
  let y = FAR;
  while (y > nearest) {
    out.push(y);
    y -= Math.max(35, (y + cam.behind) * ROW_SPACING);
  }
  return out;
}

function drawRow(ctx: CanvasRenderingContext2D, cam: Camera, dem: Dem, y: number) {
  const depth = Math.max(NEAR, (y + cam.behind) * cam.sinP);
  const half = (depth / cam.focal) * (OUTPUT.width / 2) * 1.25 + 300;
  const step = Math.min(500, Math.max(14, (depth / cam.focal) * COL_PIXELS));

  const pts: Array<[number, number] | null> = [];
  let hi = -Infinity;
  let lo = Infinity;
  for (let x = -half; x <= half; x += step) {
    const z = sample(cam, dem, x, y);
    if (z > hi) hi = z;
    if (z < lo) lo = z;
    pts.push(project(cam, x, y, z));
  }

  // Fill under the profile with the OLED ground so this row occludes the ones
  // behind it, then lay the luminous edge on top.
  ctx.beginPath();
  let started = false;
  let firstX = 0;
  let lastX = 0;
  for (const p of pts) {
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p[0], p[1]);
      firstX = p[0];
      started = true;
    } else {
      ctx.lineTo(p[0], p[1]);
    }
    lastX = p[0];
  }
  if (!started) return;
  ctx.lineTo(lastX, OUTPUT.height + 40);
  ctx.lineTo(firstX, OUTPUT.height + 40);
  ctx.closePath();
  ctx.fillStyle = GROUND_FILL;
  ctx.fill();

  // Distance haze: far ridges sink towards the sky colour, near ones are
  // brightest. Height tints cool-white at altitude, indigo in the valleys.
  const t = clamp01((y + cam.behind) / (FAR + cam.behind));
  const alpha = 0.12 + 0.84 * (1 - t) ** 1.25;
  const warmth = clamp01((hi - lo) / 520);
  const edge = ridgeColor(warmth, alpha);

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
  // Wide, faint pass first: a cheap bloom that keeps the ridges from looking
  // like hairlines without paying for a canvas shadow on every row.
  ctx.strokeStyle = edge.glow;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = edge.core;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function ridgeColor(relief: number, alpha: number): { core: string; glow: string } {
  // Flat ground stays a cold slate; broken, high-relief ground picks up the
  // pale blue-white that reads as snow-line at night.
  const r = Math.round(104 + 128 * relief);
  const g = Math.round(142 + 106 * relief);
  const b = Math.round(178 + 72 * relief);
  return {
    core: `rgba(${r},${g},${b},${(alpha * 0.95).toFixed(3)})`,
    glow: `rgba(${r},${g},${b},${(alpha * 0.22).toFixed(3)})`,
  };
}

interface TrailSeg {
  /** local Y of the segment midpoint, for depth ordering */
  y: number;
  a: [number, number];
  b: [number, number];
}

function trailSegments(cam: Camera, dem: Dem, trail: LngLat[]): TrailSeg[] {
  const projected: Array<{ y: number; p: [number, number] | null }> = trail.map(([lng, lat]) => {
    const [x, y] = toLocal(cam, lng, lat);
    // Float the trail just above the surface so it is not z-fought by its own
    // terrain row.
    return { y, p: project(cam, x, y, sample(cam, dem, x, y) + 18) };
  });

  const segs: TrailSeg[] = [];
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1];
    const b = projected[i];
    if (!a.p || !b.p) continue;
    segs.push({ y: (a.y + b.y) / 2, a: a.p, b: b.p });
  }
  // Far to near, matching the row order.
  segs.sort((p, q) => q.y - p.y);
  return segs;
}

function drawTrailSegment(ctx: CanvasRenderingContext2D, seg: TrailSeg) {
  ctx.beginPath();
  ctx.moveTo(seg.a[0], seg.a[1]);
  ctx.lineTo(seg.b[0], seg.b[1]);
  ctx.strokeStyle = "rgba(200,241,53,0.16)";
  ctx.lineWidth = 22;
  ctx.stroke();
  ctx.strokeStyle = "rgba(200,241,53,0.34)";
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 4.5;
  ctx.stroke();
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
