/**
 * MapLibre GL implementation of the scene engine: real 3D terrain from openly
 * licensed elevation data, shaded relief, and the lime trail.
 *
 * WHY THIS EXISTS
 * ---------------
 * Mapbox permits video export with attribution, but it bills per tile and ties
 * the product to one vendor. This engine answers the question "do we actually
 * need photographic imagery?" by using only sources whose terms permit video:
 *
 *   - Elevation: Mapterhorn global terrain tiles (Terrarium encoding),
 *     https://tiles.mapterhorn.com/tilejson.json — the source used by
 *     MapLibre's own 3D-terrain example. Mapterhorn is a build of national and
 *     regional open elevation datasets; every contributing source is CC0,
 *     CC-BY-4.0, Datenlizenz Deutschland, or an equivalent open-government
 *     licence (see https://mapterhorn.com/attribution). None of them restrict
 *     derivative works or video. Required attribution string, taken verbatim
 *     from their TileJSON: "© Mapterhorn".
 *   - Basemap: none. There is deliberately no imagery or vector basemap here —
 *     a flat colour plus hillshade computed from the same open DEM. MapTiler's
 *     terms forbid video production as a derivative work and Google's
 *     Photorealistic 3D Tiles cap video at 30 s promo clips, so neither is
 *     wired up, and MapLibre demotiles (country polygons at z0–5) carry no
 *     useful detail at flyover zoom.
 *
 * DETERMINISM
 * -----------
 * Same rules as `cesiumEngine.ts`, because `/render` is a frame server,
 * not a map viewer: `jumpTo` only, `fadeDuration: 0`, every interaction handler
 * disabled, zero-duration style transitions, no wall-clock anywhere except the
 * failure guard in `waitSettled`, and a `seek` that rejects rather than
 * resolving on a half-loaded frame.
 */

import { Map as MaplibreMap, setNow, setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import { LIME, nextPaint, trailFor, type SceneEngine, type SceneInput } from "./engine";
import type { CameraKeyframe } from "@/lib/types";

const TRAIL_SOURCE = "route-trail";
const TERRAIN_SOURCE = "mapterhorn-dem";
const HILLSHADE_SOURCE = "mapterhorn-dem-shade";

/** Terrarium-encoded, openly licensed global DEM. See the licence note above. */
export const MAPTERHORN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
export const MAPTERHORN_ATTRIBUTION = "© Mapterhorn";

/**
 * Mapterhorn serves tiles past z16, but a terrain mesh gains nothing from
 * overzoom detail and every extra level is another round of requests that has
 * to settle before a frame can be screenshotted.
 */
const DEM_MAXZOOM = 14;

/**
 * MapLibre v6 ships its worker as a separate ES module and locates it from
 * `import.meta.url`. Once bundled by Next that is no longer an http(s) URL, so
 * MapLibre falls back to `new Worker("")` — a worker that loads the page itself,
 * never answers, and leaves every source "loading" forever with no error. The
 * symptom is a render page that simply never becomes ready.
 *
 * So we point it at a copy served from /public. `public/maplibre/` holds
 * `maplibre-gl-worker.mjs` plus the `maplibre-gl-shared.mjs` it imports, copied
 * verbatim from `node_modules/maplibre-gl/dist`. They must be re-copied when
 * maplibre-gl is upgraded.
 */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

function demSource(attribution: boolean) {
  return {
    type: "raster-dem" as const,
    tiles: [MAPTERHORN_TILES],
    encoding: "terrarium" as const,
    tileSize: 512,
    minzoom: 0,
    maxzoom: DEM_MAXZOOM,
    ...(attribution ? { attribution: MAPTERHORN_ATTRIBUTION } : {}),
  };
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: "stravinator-open-relief",
    // Zero-length transitions: a paint property easing between two values would
    // make frame i depend on how long frame i-1 was on screen.
    transition: { duration: 0, delay: 0 },
    sources: {
      // MapLibre asks for separate sources for terrain and hillshade — sharing
      // one makes the shading sample the mesh's own tile pyramid and lose
      // detail. They are the same tiles either way, and the browser cache means
      // the second source costs no extra network.
      [TERRAIN_SOURCE]: demSource(true),
      [HILLSHADE_SOURCE]: demSource(false),
    },
    layers: [
      {
        id: "ground",
        type: "background",
        paint: { "background-color": "#0A0D12" },
      },
      {
        // Shaded relief is the entire basemap. It is computed from the DEM we
        // are already loading, so it adds no licensing surface.
        id: "hillshade",
        type: "hillshade",
        source: HILLSHADE_SOURCE,
        paint: {
          "hillshade-exaggeration": 0.6,
          "hillshade-shadow-color": "#0D1622",
          "hillshade-highlight-color": "#93A9C6",
          "hillshade-accent-color": "#24344C",
          "hillshade-illumination-direction": 315,
          "hillshade-illumination-anchor": "map",
        },
      },
    ],
  };
}

export function createMaplibreEngine(input: SceneInput): SceneEngine {
  const { container, keyframes, route, routeProgressIndex, frameTimeoutMs } = input;
  const first = keyframes[0];

  setWorkerUrl(WORKER_URL);
  // Freeze MapLibre's internal clock. Nothing in the scene is animated, but
  // anything inside the library that consults `now()` must see the same value
  // for every frame or frame i stops being a pure function of i.
  setNow(0);

  const map = new MaplibreMap({
    container,
    style: baseStyle(),
    center: first.center,
    bearing: first.bearing,
    pitch: first.pitch,
    zoom: first.zoom,
    // No cross-fade: a tile part-way through fading in would make frame i a
    // function of elapsed time rather than of the frame index.
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    // MapLibre v6 moved the WebGL context flags here. `preserveDrawingBuffer`
    // keeps the canvas readable after compositing, as the Cesium engine does.
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
    refreshExpiredTiles: false,
    trackResize: false,
    // MapLibre's default cap is 60; the chase camera sits at 65.
    maxPitch: 85,
  });

  // Belt and braces: `interactive: false` already does this, but an explicit
  // disable survives someone flipping that flag later.
  for (const handler of [
    map.scrollZoom,
    map.boxZoom,
    map.dragRotate,
    map.dragPan,
    map.keyboard,
    map.doubleClickZoom,
    map.touchZoomRotate,
    map.touchPitch,
  ]) {
    handler?.disable();
  }

  const ready = new Promise<void>((resolve, reject) => {
    const onError = (e: unknown) => reject(asError(e));
    map.once("error", onError);
    map.once("style.load", () => {
      try {
        map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1.3 });
        // The camera's centre elevation is set explicitly per frame (see
        // `seek`), so it must not be clamped back down onto the ground.
        map.setCenterClampedToGround(false);
        map.setSky({
          "sky-color": "#050810",
          "horizon-color": "#26364F",
          "fog-color": "#0A0D12",
          "fog-ground-blend": 0.62,
          "horizon-fog-blend": 0.7,
          "sky-horizon-blend": 0.55,
          "atmosphere-blend": 0.9,
        });

        map.addSource(TRAIL_SOURCE, {
          type: "geojson",
          data: lineFeature(trailFor(route, routeProgressIndex[0] ?? 1)),
        });
        map.addLayer({
          id: "route-trail-glow",
          type: "line",
          source: TRAIL_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": LIME, "line-width": 22, "line-opacity": 0.26, "line-blur": 14 },
        });
        map.addLayer({
          id: "route-trail-core",
          type: "line",
          source: TRAIL_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": LIME, "line-width": 7 },
        });

        map.once("idle", () => {
          // Warm-up. MapLibre populates parts of its terrain and texture caches
          // on the first render, so the very first `seek` of a session paints
          // marginally differently from every later render of the same camera.
          // Rendering frame 0 twice here absorbs that one-time difference
          // before the capture driver takes its first screenshot.
          void (async () => {
            try {
              await seek(0);
              await seek(0);
              map.off("error", onError);
              resolve();
            } catch (e) {
              reject(asError(e));
            }
          })();
        });
      } catch (e) {
        reject(asError(e));
      }
    });
  });

  function applyCamera(frame: number, elevation?: number) {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);
    // jumpTo only. Any eased movement would make the rendered pixels a function
    // of elapsed time rather than of the frame index.
    map.jumpTo({
      center: kf.center,
      bearing: kf.bearing,
      pitch: kf.pitch,
      zoom: kf.zoom,
      ...(elevation === undefined ? {} : { elevation }),
    });
    const src = map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined;
    src?.setData(lineFeature(trailFor(route, routeProgressIndex[frame] ?? 1)));
  }

  async function seek(frame: number): Promise<void> {
    applyCamera(frame);
    await waitSettled(map, frameTimeoutMs, frame);

    // Keep the camera out of the hillside. At 68° of pitch the line of sight
    // runs a long way into the terrain ahead, and on a switchbacking climb the
    // nominal camera ends up inside the mountain — a frame of flat dark rock.
    // The lift is a pure function of this frame's camera and the DEM, so it
    // stays deterministic; the terrain query needs loaded tiles, hence it runs
    // after the settle.
    const elevation = cameraElevation(map, keyframes[frame]);
    if (elevation !== null) {
      applyCamera(frame, elevation);
      await waitSettled(map, frameTimeoutMs, frame);
    }

    await nextPaint();
    // One more full repaint after the tiles have settled. MapLibre prepares
    // parts of its DEM lazily (border backfill from neighbouring tiles lands
    // after `areTilesLoaded()` is already true), so the first render of a given
    // view can differ from a later re-render of the same view by a few levels
    // per channel. Repainting shrinks that window. It does NOT close it
    // entirely: re-seeking an already-rendered frame can still differ by up to
    // ~17/255 on a minority of pixels. Two full capture runs of the same job
    // agree, because both take the same first-render path for every frame —
    // but this is a real caveat of the MapLibre engine that the canvas-2D
    // stylized engine does not have.
    await new Promise<void>((resolve) => {
      map.once("render", () => resolve());
      map.triggerRepaint();
    });
    await nextPaint();
  }

  return {
    ready,
    seek,
    destroy: () => map.remove(),
    // Real elevation from a real source: this output is encodable.
    isReal: true,
  };
}

/**
 * Centre elevation that clears the ground between the camera and the middle
 * distance, or null when the terrain cannot be queried yet.
 */
function cameraElevation(map: MaplibreMap, kf: CameraKeyframe): number | null {
  const here = map.queryTerrainElevation(kf.center);
  if (here === null) return null;
  const rad = (kf.bearing * Math.PI) / 180;
  const mPerDegLat = 110574;
  const mPerDegLng = 111320 * Math.cos((kf.center[1] * Math.PI) / 180);
  let ahead = here;
  for (let d = 130; d <= 2600; d += 130) {
    const h = map.queryTerrainElevation([
      kf.center[0] + (d * Math.sin(rad)) / mPerDegLng,
      kf.center[1] + (d * Math.cos(rad)) / mPerDegLat,
    ]);
    if (h !== null && h > ahead) ahead = h;
  }
  // Headroom above the highest ground in the near view. Tuned on the fixture's
  // alpine climb: less clearance, or a shorter look-ahead, and the camera
  // clips through a ridge and the frame fills with the inside of the mesh.
  return Math.max(here, ahead + 180);
}

/**
 * Resolve only when the map is idle *and* every tile for the current view is
 * loaded. `idle` alone can fire while terrain tiles are still outstanding,
 * which is how you get a video full of flat grey holes. On timeout we reject —
 * never resolve optimistically, because a silently bad frame is unrecoverable
 * once encoded.
 */
function waitSettled(map: MaplibreMap, timeoutMs: number, frame: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("idle", onIdle);
      map.off("error", onError);
      if (err) reject(err);
      else resolve();
    };

    const onIdle = () => {
      if (settled) return;
      if (map.areTilesLoaded() && map.isStyleLoaded()) finish();
      // Otherwise keep listening: another `idle` follows once the outstanding
      // tile requests come back.
    };

    const onError = (e: unknown) => finish(asError(e));

    // Wall-clock is used here and only here, purely as a failure guard. It can
    // change whether a seek rejects; it can never change what a frame looks like.
    const timer = setTimeout(
      () => finish(new Error(`frame ${frame} did not settle within ${timeoutMs}ms`)),
      timeoutMs,
    );

    map.on("idle", onIdle);
    map.on("error", onError);

    // The jump may have required no new work at all, in which case no further
    // `idle` will fire — check the current state immediately.
    if (map.loaded() && map.areTilesLoaded() && map.isStyleLoaded()) finish();
  });
}

interface LineFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

function lineFeature(coords: [number, number][]): LineFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  const maybe = e as { error?: unknown; message?: string };
  if (maybe?.error instanceof Error) return maybe.error;
  return new Error(maybe?.message ?? String(e));
}
