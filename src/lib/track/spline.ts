import type { RoutePoint } from "./resample";
import { makeProjector, type Projector, type XY } from "./geo";

/**
 * Catmull-Rom spline through the resampled route, arc-length parameterized.
 *
 * Resampling already made the control points equidistant, but a spline's
 * natural parameter `t` is still not proportional to distance travelled
 * (curvature stretches it). We therefore build a dense lookup table of
 * (cumulative length -> point) and sample by distance, so the camera glides at
 * a constant speed rather than accelerating through corners.
 */

/** Dense samples generated per control-point segment when building the LUT. */
export const SAMPLES_PER_SEGMENT = 12;

/**
 * Centripetal Catmull-Rom (alpha = 0.5). Uniform Catmull-Rom (alpha = 0) forms
 * cusps and self-intersections when control points bunch up, which is exactly
 * what a hairpin switchback looks like after resampling. Centripetal is the
 * standard fix and is provably loop-free.
 */
export const ALPHA = 0.5;

export interface SplineSample {
  /** position in the local metre frame */
  p: XY;
  /** unit tangent in the local metre frame */
  t: XY;
  /** cumulative arc length, metres */
  s: number;
  /** interpolated elevation, metres */
  ele: number;
}

export interface Spline {
  /** total arc length in metres */
  length: number;
  projector: Projector;
  /** sample at an arc-length position (clamped to [0, length]) */
  at(s: number): SplineSample;
}

function tj(ti: number, a: XY, b: XY): number {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return ti + Math.pow(d, ALPHA);
}

/** Centripetal Catmull-Rom interpolation between p1 and p2, u in [0,1]. */
export function catmullRom(p0: XY, p1: XY, p2: XY, p3: XY, u: number): XY {
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  // Degenerate knots (coincident control points) collapse to a lerp.
  if (!(t1 > t0) || !(t2 > t1) || !(t3 > t2)) {
    return { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u };
  }
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: XY, b: XY, ta: number, tb: number): XY => {
    const w = (tb - t) / (tb - ta);
    const v = (t - ta) / (tb - ta);
    return { x: a.x * w + b.x * v, y: a.y * w + b.y * v };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Build an arc-length parameterized spline through the route.
 * `eleOverride` lets the caller pass an already-smoothed altitude series
 * (same length as `route`) so altitude smoothing stays independent of position.
 */
export function buildSpline(route: RoutePoint[], eleOverride?: number[]): Spline {
  if (route.length < 2) {
    throw new Error(
      `track/spline: need at least 2 route points, got ${route.length}`,
    );
  }
  const projector = makeProjector(route[0].lng, route[0].lat);
  const pts: XY[] = route.map((r) => projector.toXY(r.lng, r.lat));
  const eles = eleOverride ?? route.map((r) => r.ele);
  if (eles.length !== route.length) {
    throw new Error("track/spline: elevation series length must match route");
  }

  // Phantom endpoints: reflect the first/last segment so the curve reaches the
  // real start and end instead of dropping them.
  const ctrl: XY[] = [
    { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y },
    ...pts,
    {
      x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x,
      y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y,
    },
  ];

  const samples: Array<{ p: XY; s: number; ele: number }> = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = ctrl[i];
    const p1 = ctrl[i + 1];
    const p2 = ctrl[i + 2];
    const p3 = ctrl[i + 3];
    for (let k = 0; k < SAMPLES_PER_SEGMENT; k++) {
      const u = k / SAMPLES_PER_SEGMENT;
      const p = catmullRom(p0, p1, p2, p3, u);
      const ele = eles[i] + (eles[i + 1] - eles[i]) * u;
      if (samples.length > 0) {
        const prev = samples[samples.length - 1];
        s += Math.hypot(p.x - prev.p.x, p.y - prev.p.y);
      }
      samples.push({ p, s, ele });
    }
  }
  // Final control point.
  {
    const p = pts[pts.length - 1];
    const prev = samples[samples.length - 1];
    s += Math.hypot(p.x - prev.p.x, p.y - prev.p.y);
    samples.push({ p, s, ele: eles[eles.length - 1] });
  }

  const length = samples[samples.length - 1].s;
  if (!(length > 0)) {
    throw new Error("track/spline: spline has zero arc length");
  }

  const tangentAt = (i: number): XY => {
    const a = samples[Math.max(0, i - 1)].p;
    const b = samples[Math.min(samples.length - 1, i + 1)].p;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let m = Math.hypot(dx, dy);
    if (m === 0) {
      // Fall back to the nearest non-degenerate neighbourhood.
      for (let w = 2; w < samples.length && m === 0; w++) {
        const a2 = samples[Math.max(0, i - w)].p;
        const b2 = samples[Math.min(samples.length - 1, i + w)].p;
        dx = b2.x - a2.x;
        dy = b2.y - a2.y;
        m = Math.hypot(dx, dy);
      }
    }
    if (m === 0) return { x: 0, y: 1 };
    return { x: dx / m, y: dy / m };
  };

  return {
    length,
    projector,
    at(query: number): SplineSample {
      const target = Math.min(length, Math.max(0, query));
      // Binary search the LUT.
      let lo = 0;
      let hi = samples.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].s <= target) lo = mid;
        else hi = mid;
      }
      const a = samples[lo];
      const b = samples[hi];
      const span = b.s - a.s;
      const u = span > 0 ? (target - a.s) / span : 0;
      const ta = tangentAt(lo);
      const tb = tangentAt(hi);
      let tx = ta.x + (tb.x - ta.x) * u;
      let ty = ta.y + (tb.y - ta.y) * u;
      const m = Math.hypot(tx, ty);
      if (m > 0) {
        tx /= m;
        ty /= m;
      } else {
        tx = ta.x;
        ty = ta.y;
      }
      return {
        p: { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u },
        t: { x: tx, y: ty },
        s: target,
        ele: a.ele + (b.ele - a.ele) * u,
      };
    },
  };
}

/** Sample `n` points spaced uniformly by arc length, inclusive of both ends. */
export function sampleUniform(spline: Spline, n: number): SplineSample[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`track/spline: sample count must be a positive integer, got ${n}`);
  }
  if (n === 1) return [spline.at(0)];
  const out: SplineSample[] = [];
  for (let i = 0; i < n; i++) {
    out.push(spline.at((spline.length * i) / (n - 1)));
  }
  return out;
}
