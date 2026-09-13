"use client";

import { useEffect, useRef } from "react";

/**
 * Dot-matrix numerals, as approved in the design reference: a real glyph is
 * rasterised off-screen and resampled onto a dot grid, so the figures read as
 * an instrument panel rather than as a font.
 *
 * Redrawn only when `text` changes, and drawn from `text` alone — no time, no
 * randomness — so two frames showing "14.2" are pixel-identical.
 */
export default function DotMatrix({
  text,
  height,
  color = "#FFFFFF",
  dim = "rgba(255,255,255,0.10)",
  align = "left",
}: {
  text: string;
  /** CSS pixels; the canvas is sized to match at 1:1 (the stage is never scaled). */
  height: number;
  color?: string;
  dim?: string;
  /**
   * Where the glyphs sit on the grid. The HUD tiles read left-to-right like a
   * meter, so they keep `left`; a figure that stands alone on a card wants
   * `center`, or the unlit cells to its right make it look shoved aside.
   */
  align?: "left" | "center";
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = height;
    if (w === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // Rasterise the glyphs once, off-screen, then sample.
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.fillStyle = "#fff";
    octx.textBaseline = "middle";
    octx.textAlign = align;
    octx.font = `600 ${Math.round(h * 0.96)}px ${getComputedStyle(canvas).fontFamily}`;
    octx.fillText(text, align === "center" ? w / 2 : 0, h / 2);
    const src = octx.getImageData(0, 0, w, h).data;

    const pitch = Math.max(4, Math.round(h / 14));
    const radius = pitch * 0.36;
    for (let y = pitch / 2; y < h; y += pitch) {
      for (let x = pitch / 2; x < w; x += pitch) {
        const idx = ((y | 0) * w + (x | 0)) * 4 + 3;
        const on = src[idx] > 110;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = on ? color : dim;
        ctx.fill();
      }
    }
  }, [text, height, color, dim, align]);

  return (
    <canvas
      ref={ref}
      aria-label={text}
      style={{ display: "block", width: "100%", height: `${height}px` }}
    />
  );
}
