"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
// The engines' own stylesheets, scoped to this route rather than the app shell
// so the page-shell agent's globals.css stays untouched.
import "cesium/Build/Cesium/Widgets/widgets.css";
import "maplibre-gl/dist/maplibre-gl.css";

import { ATTRIBUTION, OUTPUT, type RenderPayload } from "@/lib/types";
import { loadPayload } from "@/lib/scene/payload";
import { CESIUM_ATTRIBUTION } from "@/lib/scene/cesiumCamera";
import { createMaplibreEngine, MAPTERHORN_ATTRIBUTION } from "@/lib/scene/maplibreEngine";
import { createStylizedEngine } from "@/lib/scene/stylizedEngine";
import { createPlaceholderEngine } from "@/lib/scene/placeholderEngine";
import type { SceneEngine, SceneInput } from "@/lib/scene/engine";
import { hudOpacity, introOpacity, outroOpacity } from "@/lib/scene/cards";
import {
  formatDate,
  formatDistanceKm,
  formatDuration,
  formatElevation,
  formatPace,
} from "@/lib/scene/format";
import DotMatrix from "./DotMatrix";
import styles from "./render.module.css";

/** A seek that hasn't settled by now is a failed frame, not a slow one. */
const FRAME_TIMEOUT_MS = 20_000;

/**
 * Which renderer paints the scene. Selected with `?engine=` so the owner can
 * compare visual directions from real frames rather than from descriptions.
 *
 *  - `cesium`      photographic aerial imagery on Cesium World Terrain (ion)
 *  - `maplibre`    open elevation + shaded relief, no imagery, no per-tile cost
 *  - `stylized`    open elevation drawn in the nocturnal identity
 *  - `placeholder` synthetic wireframe, not real data, never shippable
 */
const ENGINE_NAMES = ["cesium", "maplibre", "stylized", "placeholder"] as const;
type EngineName = (typeof ENGINE_NAMES)[number];

function parseEngine(raw: string | null): EngineName | null {
  if (!raw) return null;
  const match = ENGINE_NAMES.find((n) => n === raw);
  if (!match) {
    throw new Error(`unknown engine "${raw}" — expected one of ${ENGINE_NAMES.join(", ")}`);
  }
  return match;
}

/** Attribution is a licensing requirement, so it tracks the sources actually used. */
function attributionFor(engine: EngineName | null): readonly string[] {
  switch (engine) {
    // No imagery and no vector basemap: elevation is the only third-party
    // source in play, and Mapterhorn's TileJSON asks for exactly this string.
    case "maplibre":
    case "stylized":
      return ["Powered by Strava", MAPTERHORN_ATTRIBUTION];
    case "cesium":
      return ["Powered by Strava", ...CESIUM_ATTRIBUTION];
    default:
      return ATTRIBUTION;
  }
}

async function createEngine(
  engine: EngineName,
  input: SceneInput,
  token: string | undefined,
): Promise<SceneEngine> {
  switch (engine) {
    case "cesium":
      if (!token) {
        throw new Error("engine=cesium requires NEXT_PUBLIC_CESIUM_ION_TOKEN to be set");
      }
      // Loaded on demand: Cesium is browser-only and must stay out of the
      // server bundle (see cesiumEngine.ts).
      return (await import("@/lib/scene/cesiumEngine")).createCesiumEngine(input, token);
    case "maplibre":
      return createMaplibreEngine(input);
    case "stylized":
      return createStylizedEngine(input);
    case "placeholder":
      // Never silently ship this as a video; `isReal` is false and the capture
      // driver refuses it unless explicitly allowed.
      console.warn(
        "[stravinator] rendering PLACEHOLDER terrain — synthetic heights, not real elevation.",
      );
      return createPlaceholderEngine(input);
  }
}

/**
 * The capture driver's contract. `worker/capture.ts` declares the same three
 * members; they are intentionally non-optional there and here so that any drift
 * between producer and consumer shows up as a type error rather than as a
 * corrupt video.
 */
declare global {
  interface Window {
    /** Resolves once payload and scene are loaded and frame 0 is on screen. */
    sceneReady: Promise<void>;
    /** Total frames to step. Valid indices are 0..frameCount-1. */
    frameCount: number;
    /** Apply frame `i` and resolve only when it is ready to screenshot. */
    seekToFrame: (i: number) => Promise<void>;
    /** Diagnostics for the capture driver's logs. */
    sceneInfo?: { real: boolean; jobId: string; frameCount: number };
  }
}

export default function RenderScene() {
  const params = useSearchParams();
  const jobId = params.get("job");
  const fixture = params.get("fixture") === "1";
  const requestedEngine = params.get("engine");

  const mapHostRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<RenderPayload | null>(null);
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [engineName, setEngineName] = useState<EngineName | null>(null);

  // The stage is a fixed 1080x1920 surface, never responsive: the capture
  // driver sizes its viewport to match and screenshots the whole thing.
  useEffect(() => {
    const html = document.documentElement;
    html.style.background = "#050505";
    document.body.style.margin = "0";
    document.body.style.background = "#050505";
    document.body.style.overflow = "hidden";
  }, []);

  useEffect(() => {
    let engine: SceneEngine | null = null;
    let cancelled = false;

    // Held so `sceneReady` can be published synchronously, before the async work
    // finishes — the driver may be awaiting it the moment the page loads.
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const readyPromise = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    window.sceneReady = readyPromise;
    // Nothing should ever surface this as an unhandled rejection; the driver
    // gets the failure by awaiting `sceneReady` itself.
    readyPromise.catch(() => {});

    (async () => {
      try {
        const data = await loadPayload({ jobId, fixture });
        if (cancelled) return;

        // Render the HUD for frame 0 before the engine reads container size.
        flushSync(() => setPayload(data));

        const host = mapHostRef.current;
        if (!host) throw new Error("map host missing");

        const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        const input: SceneInput = {
          container: host,
          keyframes: data.keyframes,
          route: data.route,
          routeProgressIndex: data.routeProgressIndex,
          frameTimeoutMs: FRAME_TIMEOUT_MS,
        };

        // Cesium when an ion token is configured, the clearly-marked
        // placeholder when it is not. `?engine=` only ever overrides that
        // explicitly.
        const chosen = parseEngine(requestedEngine) ?? (token ? "cesium" : "placeholder");
        flushSync(() => setEngineName(chosen));
        engine = await createEngine(chosen, input, token);

        await engine.ready;
        if (cancelled) return;

        const seek = async (i: number) => {
          if (!engine) throw new Error("scene not ready");
          if (!Number.isInteger(i) || i < 0 || i >= data.keyframes.length) {
            throw new Error(`frame ${i} out of range (0..${data.keyframes.length - 1})`);
          }
          // flushSync so the HUD for frame i is committed to the DOM *before*
          // we start waiting on tiles — otherwise the screenshot could catch the
          // map at frame i and the HUD still at frame i-1.
          flushSync(() => setFrame(i));
          await engine.seek(i);
        };

        window.frameCount = data.keyframes.length;
        window.seekToFrame = seek;
        window.sceneInfo = {
          real: engine.isReal,
          jobId: data.jobId,
          frameCount: data.keyframes.length,
        };

        await seek(0);
        if (cancelled) return;
        document.body.dataset.sceneReady = "1";
        resolveReady();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (cancelled) return;
        setError(err.message);
        document.body.dataset.sceneError = err.message;
        rejectReady(err);
      }
    })();

    return () => {
      cancelled = true;
      engine?.destroy();
      // Tear the contract down so a stale `seekToFrame` from a previous mount
      // can never be driven against a destroyed engine.
      const w = window as unknown as Record<string, unknown>;
      delete w.seekToFrame;
      delete w.frameCount;
      delete w.sceneReady;
      delete w.sceneInfo;
    };
  }, [jobId, fixture, requestedEngine]);

  const frameCount = payload?.keyframes.length ?? 0;
  const stats = payload?.stats;
  const intro = introOpacity(frame);
  const outro = frameCount ? outroOpacity(frame, frameCount) : 0;
  const hud = frameCount ? hudOpacity(frame, frameCount) : 0;

  return (
    <div
      className={styles.stage}
      style={{ width: OUTPUT.width, height: OUTPUT.height }}
      data-frame={frame}
    >
      <div ref={mapHostRef} className={styles.map} />
      <div className={styles.vignette} aria-hidden />

      {engineName === "placeholder" && (
        <div className={styles.placeholderBadge}>Placeholder terrain — synthetic elevation</div>
      )}

      {error && (
        <div className={styles.error}>
          <div className={styles.errorTitle}>Scene failed</div>
          <div className={styles.errorBody}>{error}</div>
        </div>
      )}

      {stats && (
        <>
          {/* ---- HUD ---- */}
          <div className={styles.hud} style={{ opacity: hud }}>
            <header className={styles.head}>
              <div className={styles.eyebrow}>{formatDate(stats.date)}</div>
              <h1 className={styles.name}>{stats.name}</h1>
            </header>

            <div className={styles.stats}>
              <Stat label="Distance" unit="km" value={formatDistanceKm(stats.distance)} lime />
              <Stat label="Avg pace" unit="/km" value={formatPace(stats.paceSecPerKm)} />
              <Stat label="Elev gain" unit="m" value={formatElevation(stats.elevationGain)} />
            </div>
          </div>

          {/* ---- Intro card ---- */}
          <div
            className={styles.card}
            style={{ opacity: intro, visibility: intro > 0 ? "visible" : "hidden" }}
          >
            <div className={styles.cardInner}>
              <div className={styles.eyebrow}>Stravinator flyover</div>
              <h2 className={styles.cardTitle}>{stats.name}</h2>
              <div className={styles.cardMeta}>
                {formatDate(stats.date)} · {formatDistanceKm(stats.distance)} km ·{" "}
                {formatDuration(stats.movingTime)}
              </div>
            </div>
          </div>

          {/* ---- Outro card, carrying the Strava branding (spec §2.1) ---- */}
          <div
            className={styles.card}
            style={{ opacity: outro, visibility: outro > 0 ? "visible" : "hidden" }}
          >
            <div className={styles.cardInner}>
              <div className={styles.outroFigure}>
                <DotMatrix text={formatDistanceKm(stats.distance)} height={150} color="#C8F135" />
              </div>
              <div className={styles.outroUnit}>kilometres</div>
              <div className={styles.outroRow}>
                <span>{formatPace(stats.paceSecPerKm)} /km</span>
                <span>{formatElevation(stats.elevationGain)} m up</span>
                <span>{formatDuration(stats.movingTime)}</span>
              </div>
              <div className={styles.brand}>Powered by Strava</div>
            </div>
          </div>
        </>
      )}

      {/* Attribution sits outside every fading layer: it is a licensing
          requirement on EVERY frame (spec §2.2), not decoration. */}
      <div className={styles.attribution}>
        {attributionFor(engineName).map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  lime,
}: {
  label: string;
  value: string;
  unit: string;
  lime?: boolean;
}) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <DotMatrix text={value} height={82} color={lime ? "#C8F135" : "#FFFFFF"} />
      <div className={styles.statUnit}>{unit}</div>
    </div>
  );
}
