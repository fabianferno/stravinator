"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
// Mapbox's own stylesheet, scoped to this route rather than the app shell so
// the page-shell agent's globals.css stays untouched.
import "mapbox-gl/dist/mapbox-gl.css";

import { ATTRIBUTION, OUTPUT, type RenderPayload } from "@/lib/types";
import { loadPayload } from "@/lib/scene/payload";
import { createMapboxEngine } from "@/lib/scene/mapboxEngine";
import { createPlaceholderEngine } from "@/lib/scene/placeholderEngine";
import type { SceneEngine } from "@/lib/scene/engine";
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

  const mapHostRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<RenderPayload | null>(null);
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(false);

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

        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const input = {
          container: host,
          keyframes: data.keyframes,
          route: data.route,
          routeProgressIndex: data.routeProgressIndex,
          frameTimeoutMs: FRAME_TIMEOUT_MS,
        };

        if (token) {
          engine = createMapboxEngine(input, token);
        } else {
          // No token: draw the clearly-marked placeholder so the frame-stepping
          // contract stays testable. Never silently ship this as a video.
          console.warn(
            "[stravinator] NEXT_PUBLIC_MAPBOX_TOKEN is unset — rendering PLACEHOLDER terrain, not real map tiles.",
          );
          flushSync(() => setPlaceholder(true));
          engine = createPlaceholderEngine(input);
        }

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
  }, [jobId, fixture]);

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

      {placeholder && (
        <div className={styles.placeholderBadge}>
          Placeholder terrain — no Mapbox token
        </div>
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
        {ATTRIBUTION.map((a) => (
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
