"use client";

import { useEffect, useRef } from "react";
import "./DotMatrix.css";

export interface DotMatrixProps {
  /** The figure to render, e.g. "14.2", "4:52", "64%". */
  text: string;
  /** Accessible reading of the figure. Falls back to `text`. */
  label?: string;
  /** Rendered height. `hero` is the 88px card figure, `mid` the 62px one. */
  size?: "hero" | "mid";
  className?: string;
}

/**
 * Dot-matrix numerals: rasterise a real glyph on an offscreen canvas, then
 * resample it onto a dot grid. Keeps the LED look of the approved design while
 * behaving like type (it re-flows with the font and the container width).
 *
 * Client-only: needs canvas, devicePixelRatio and a resize observer.
 */
export function DotMatrix({ text, label, size = "hero", className }: DotMatrixProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let frame = 0;
    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w <= 1 || h <= 1) return;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // offscreen: draw the glyphs solid
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      const fontSize = Math.round(h * 0.92);
      octx.font = `600 ${fontSize}px ${getComputedStyle(canvas).fontFamily}`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillStyle = "#fff";
      octx.fillText(text, w / 2, h / 2 + fontSize * 0.02);

      const data = octx.getImageData(0, 0, w, h).data;

      // resample onto a dot grid
      const step = Math.max(4, Math.round(h / 16));
      const r = step * 0.3;
      ctx.fillStyle = "#fff";
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          const i = (Math.round(y) * w + Math.round(x)) * 4;
          if (data[i + 3] > 128) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };

    schedule();

    // repaint once webfonts land, so the glyph metrics are the real ones
    if (document.fonts?.ready) {
      void document.fonts.ready.then(schedule).catch(() => {});
    }

    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [text, size]);

  return (
    <canvas
      ref={ref}
      className={["matrix", size === "mid" ? "matrix-mid" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={label ?? text}
    />
  );
}
