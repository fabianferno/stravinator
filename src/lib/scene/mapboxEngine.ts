/**
 * Mapbox GL implementation of the scene engine: 3D terrain, satellite imagery,
 * sky, and a lime trail that grows behind the camera.
 *
 * Everything here is written against one hard requirement — determinism. The map
 * is moved only with `jumpTo` (never `easeTo`/`flyTo`), tile cross-fading is
 * switched off, and every interaction handler is disabled so a stray event
 * cannot nudge the camera between two screenshots.
 */

import mapboxgl from "mapbox-gl";
import { LIME, nextPaint, trailFor, type SceneEngine, type SceneInput } from "./engine";

const TRAIL_SOURCE = "route-trail";
const DEM_SOURCE = "mapbox-dem";

export function createMapboxEngine(input: SceneInput, token: string): SceneEngine {
  const { container, keyframes, route, routeProgressIndex, frameTimeoutMs } = input;
  mapboxgl.accessToken = token;

  const first = keyframes[0];

  const map = new mapboxgl.Map({
    container,
    style: "mapbox://styles/mapbox/satellite-streets-v12",
    center: first.center,
    bearing: first.bearing,
    pitch: first.pitch,
    zoom: first.zoom,
    // No cross-fade: a tile half-way through fading in would make frame i depend
    // on how long frame i-1 was on screen, which is exactly what we cannot have.
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    // The capture driver screenshots the page, but keeping the buffer alive also
    // lets the canvas be read directly if we ever capture WebGL instead.
    preserveDrawingBuffer: true,
    // Frames are stepped by hand; nothing should re-render on a timer.
    refreshExpiredTiles: false,
    trackResize: false,
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
        map.addSource(DEM_SOURCE, {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: DEM_SOURCE, exaggeration: 1.3 });

        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0, 0],
            "sky-atmosphere-sun-intensity": 12,
          },
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
          paint: { "line-color": LIME, "line-width": 16, "line-opacity": 0.22, "line-blur": 12 },
        });
        map.addLayer({
          id: "route-trail-core",
          type: "line",
          source: TRAIL_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": LIME, "line-width": 5 },
        });

        map.once("idle", () => {
          map.off("error", onError);
          resolve();
        });
      } catch (e) {
        reject(asError(e));
      }
    });
  });

  function applyCamera(frame: number) {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);
    // jumpTo only. Any eased movement would make the rendered pixels a function
    // of elapsed time rather than of the frame index.
    map.jumpTo({
      center: kf.center,
      bearing: kf.bearing,
      pitch: kf.pitch,
      zoom: kf.zoom,
    });
    const src = map.getSource(TRAIL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    src?.setData(lineFeature(trailFor(route, routeProgressIndex[frame] ?? 1)));
  }

  async function seek(frame: number): Promise<void> {
    applyCamera(frame);
    await waitSettled(map, frameTimeoutMs, frame);
    await nextPaint();
  }

  return {
    ready,
    seek,
    destroy: () => map.remove(),
    isReal: true,
  };
}

/**
 * Resolve only when the map is idle *and* every tile for the current view is
 * loaded. `idle` alone can fire while terrain tiles are still outstanding, which
 * is how you end up with a video full of flat grey holes. On timeout we reject —
 * never resolve optimistically, because a silently bad frame is unrecoverable
 * once it is encoded.
 */
function waitSettled(map: mapboxgl.Map, timeoutMs: number, frame: number): Promise<void> {
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
