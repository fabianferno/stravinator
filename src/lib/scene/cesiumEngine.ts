/**
 * CesiumJS implementation of the scene engine: Cesium World Terrain, Bing
 * aerial imagery (ion's default world imagery) (both streamed from Cesium ion), atmosphere, and the lime
 * trail that grows behind the camera.
 *
 * WHY CESIUM
 * ----------
 * It replaced Mapbox GL. Ion's terms allow rendering its terrain and imagery
 * into video with the attribution the HUD already burns into every frame, and
 * a single ion token covers both datasets.
 *
 * DETERMINISM
 * -----------
 * `/render` is a frame server, not a globe viewer. Everything time-dependent in
 * Cesium is switched off: `requestRenderMode` so nothing paints unless we ask,
 * a stopped clock pinned to one instant, no camera inertia, no input handlers,
 * no lighting or shadows, no tile fade-in. The camera is set with `lookAt` per
 * frame — never `flyTo` — and `seek` only resolves once the globe reports every
 * tile for the view loaded and a further render has been painted. On timeout it
 * rejects, because a frame with terrain holes is worse than a failed job.
 */

import {
  Cartesian3,
  Cartographic,
  Color,
  HeadingPitchRange,
  ImageryLayer,
  Ion,
  JulianDate,
  Matrix4,
  PerspectiveFrustum,
  PolylineGlowMaterialProperty,
  sampleTerrainMostDetailed,
  Terrain,
  type TerrainProvider,
  Viewer,
  type Entity,
} from "cesium";
import { LIME, nextPaint, trailFor, type SceneEngine, type SceneInput } from "./engine";
import { cameraRangeMetres, cesiumPitchRad, VERTICAL_FOV_RAD } from "./cesiumCamera";
import type { CameraKeyframe } from "@/lib/types";

/** Required by ion's terms for World Terrain + Bing imagery; burned into the HUD. */
export const CESIUM_ATTRIBUTION = ["© Cesium ion", "© Microsoft Bing", "© Maxar"] as const;

/** Where `scripts/copy-cesium-assets.mjs` puts the workers and shaders. */
const CESIUM_BASE_URL = "/cesium";

/** Metres the trail floats above the terrain so it never z-fights the mesh. */
const TRAIL_LIFT_M = 3;

/** Budget for the very first frame, which also loads the globe's coarse levels. */
const COLD_START_TIMEOUT_MS = 180_000;

/** One fixed instant for the whole render, so nothing in the scene can drift. */
const FROZEN_TIME = JulianDate.fromIso8601("2026-06-21T12:00:00Z");

export function createCesiumEngine(input: SceneInput, token: string): SceneEngine {
  const { container, keyframes, route, routeProgressIndex, frameTimeoutMs } = input;

  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
  Ion.defaultAccessToken = token;

  const terrain = Terrain.fromWorldTerrain();
  const viewer = new Viewer(container, {
    baseLayer: ImageryLayer.fromWorldImagery({}),
    terrain,
    // Paint only when asked. `maximumRenderTimeChange` keeps the simulation
    // clock from forcing a render on its own.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    shouldAnimate: false,
    // No chrome of any kind; the HUD is drawn by React around the canvas.
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    // Cesium's own credit strip is hidden; attribution is rendered by the HUD
    // so it is baked into the video rather than living in the DOM.
    creditContainer: document.createElement("div"),
    // The capture driver screenshots the page; keeping the buffer readable
    // also lets the canvas be read directly should we ever capture WebGL.
    contextOptions: { webgl: { preserveDrawingBuffer: true, antialias: false } },
  });

  const { scene, camera, clock } = viewer;

  clock.currentTime = FROZEN_TIME.clone();
  clock.shouldAnimate = false;

  // Anything that could nudge the camera between two screenshots.
  scene.screenSpaceCameraController.enableInputs = false;
  camera.frustum = (() => {
    const f = new PerspectiveFrustum();
    f.fov = VERTICAL_FOV_RAD;
    f.aspectRatio = container.clientWidth / container.clientHeight;
    f.near = 1;
    f.far = 5e7;
    return f;
  })();

  // Static look: no sun-position lighting, no shadows, no fog fade with time.
  scene.globe.enableLighting = false;
  scene.shadowMap.enabled = false;
  scene.globe.showGroundAtmosphere = true;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  // Tiles snap in rather than fade, so frame i cannot depend on how long
  // frame i-1 was on screen.
  scene.globe.imageryLayers.get(0).alpha = 1;
  scene.globe.tileCacheSize = 1000;
  // Load only what the view needs. Preloading neighbours and ancestors is a
  // viewer optimisation for smooth panning; here it just lengthens the queue
  // `tilesLoaded` has to drain before a frame counts as settled.
  scene.globe.preloadSiblings = false;
  scene.globe.preloadAncestors = false;
  scene.globe.depthTestAgainstTerrain = false;
  scene.fog.enabled = true;
  scene.fog.density = 0.00015;
  scene.highDynamicRange = false;

  // Route positions at terrain height. Sampled once, up front, from the
  // most-detailed terrain so the trail is a fixed polyline for the whole
  // render rather than something that depends on which tiles happen to be
  // loaded at frame i.
  let routeCartesian: Cartesian3[] = [];
  let glow: Entity | null = null;
  let core: Entity | null = null;

  const ready = (async () => {
    const provider = await new Promise<TerrainProvider>((resolve, reject) => {
      terrain.readyEvent.addEventListener((p: TerrainProvider) => resolve(p));
      terrain.errorEvent.addEventListener((e: unknown) => reject(asError(e)));
    });
    const carto = route.map(([lng, lat]) => Cartographic.fromDegrees(lng, lat));
    try {
      await sampleTerrainMostDetailed(provider, carto);
    } catch (e) {
      throw asError(e);
    }
    routeCartesian = carto.map((c) =>
      Cartesian3.fromRadians(c.longitude, c.latitude, (c.height ?? 0) + TRAIL_LIFT_M),
    );

    const lime = Color.fromCssColorString(LIME);
    glow = viewer.entities.add({
      polyline: {
        positions: trailPositions(routeProgressIndex[0] ?? 1),
        width: 24,
        material: new PolylineGlowMaterialProperty({ color: lime.withAlpha(0.55), glowPower: 0.35 }),
      },
    });
    core = viewer.entities.add({
      polyline: {
        positions: trailPositions(routeProgressIndex[0] ?? 1),
        width: 6,
        material: lime,
      },
    });

    // Warm-up: the first render of a session populates shader and texture
    // caches and can differ marginally from every later render of the same
    // camera. Seeking frame 0 twice absorbs that before the first screenshot.
    // The cold start also pulls the coarse levels of the whole globe, so it
    // gets a far longer budget than a normal frame-to-frame step.
    await seekWithin(0, COLD_START_TIMEOUT_MS);
    await seekWithin(0, frameTimeoutMs);
  })();

  function trailPositions(upTo: number): Cartesian3[] {
    const n = trailFor(route, upTo).length;
    return routeCartesian.slice(0, n);
  }

  function applyCamera(frame: number, targetHeight: number) {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);
    const [lng, lat] = kf.center;
    const target = Cartesian3.fromDegrees(lng, lat, targetHeight);
    camera.lookAt(
      target,
      new HeadingPitchRange(
        (kf.bearing * Math.PI) / 180,
        cesiumPitchRad(kf.pitch),
        cameraRangeMetres(kf.zoom, lat, container.clientHeight),
      ),
    );
    // `lookAt` leaves the camera locked to a transform at the target; release
    // it so the next frame's call starts from a clean world frame.
    camera.lookAtTransform(Matrix4.IDENTITY);

    const positions = trailPositions(routeProgressIndex[frame] ?? 1);
    if (glow?.polyline) glow.polyline.positions = positions as never;
    if (core?.polyline) core.polyline.positions = positions as never;
  }

  function seek(frame: number): Promise<void> {
    return seekWithin(frame, frameTimeoutMs);
  }

  async function seekWithin(frame: number, timeoutMs: number): Promise<void> {
    const kf = keyframes[frame];
    if (!kf) throw new Error(`frame ${frame} out of range (0..${keyframes.length - 1})`);

    applyCamera(frame, kf.elevation);
    await waitSettled(viewer, timeoutMs, frame);

    // Keep the camera out of the hillside: at 65° of pitch the line of sight
    // runs a long way into the terrain ahead, and on a switchbacking climb the
    // nominal camera can end up inside the mountain. The lift is a pure
    // function of this frame's camera and the DEM, so it stays deterministic;
    // it needs loaded tiles, hence it runs after the settle.
    const lifted = clearanceHeight(viewer, kf);
    if (lifted !== null && lifted > kf.elevation + 1) {
      applyCamera(frame, lifted);
      await waitSettled(viewer, timeoutMs, frame);
    }

    await nextPaint();
  }

  return {
    ready,
    seek,
    destroy: () => viewer.destroy(),
    isReal: true,
  };
}

/**
 * Target height that clears the highest ground between the camera and the
 * middle distance, or null when the terrain cannot be queried yet.
 */
function clearanceHeight(viewer: Viewer, kf: CameraKeyframe): number | null {
  const globe = viewer.scene.globe;
  const [lng, lat] = kf.center;
  const here = globe.getHeight(Cartographic.fromDegrees(lng, lat));
  if (here === undefined) return null;
  const rad = (kf.bearing * Math.PI) / 180;
  const mPerDegLat = 110574;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  let ahead = here;
  for (let d = 130; d <= 2600; d += 130) {
    const h = globe.getHeight(
      Cartographic.fromDegrees(lng + (d * Math.sin(rad)) / mPerDegLng, lat + (d * Math.cos(rad)) / mPerDegLat),
    );
    if (h !== undefined && h > ahead) ahead = h;
  }
  // Headroom above the highest ground in the near view — same clearance the
  // MapLibre engine settled on for the fixture's alpine climb.
  return Math.max(here, ahead + 180);
}

/**
 * Render until the globe reports every tile for the current view loaded, then
 * paint once more so the screenshot sees the settled state. Rejects on timeout;
 * never resolves optimistically.
 */
function waitSettled(viewer: Viewer, timeoutMs: number, frame: number): Promise<void> {
  const { scene } = viewer;
  return new Promise((resolve, reject) => {
    let done = false;
    let stableRenders = 0;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      remove();
      if (err) reject(err);
      else resolve();
    };

    const onPostRender = () => {
      if (done) return;
      if (scene.globe.tilesLoaded) {
        // Two consecutive fully-loaded renders: the first can still be the one
        // that *completed* loading, the second is guaranteed to have drawn it.
        stableRenders += 1;
        if (stableRenders >= 2) return finish();
      } else {
        stableRenders = 0;
      }
      scene.requestRender();
    };

    const onError = (_scene: unknown, e: unknown) => finish(asError(e));

    // Wall-clock is used here and only here, purely as a failure guard. It can
    // change whether a seek rejects; it can never change what a frame looks like.
    const timer = setTimeout(
      () => finish(new Error(`frame ${frame} did not settle within ${timeoutMs}ms`)),
      timeoutMs,
    );

    const remove = (() => {
      const a = scene.postRender.addEventListener(onPostRender);
      const b = scene.renderError.addEventListener(onError);
      return () => {
        a();
        b();
      };
    })();

    scene.requestRender();
  });
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  // Cesium's RequestErrorEvent stringifies to "Request has failed." — keep the
  // status and URL so a rejected tile is diagnosable from the job's error.
  const maybe = e as { message?: string; statusCode?: number; response?: unknown };
  if (maybe?.statusCode !== undefined) {
    const body = typeof maybe.response === "string" ? maybe.response.slice(0, 200) : "";
    return new Error(`ion request failed with HTTP ${maybe.statusCode} ${body}`.trim());
  }
  return new Error(maybe?.message ?? String(e));
}
