/**
 * Altitude smoothing.
 *
 * Barometric and GPS altitude are markedly noisier than horizontal position:
 * GPS vertical error is roughly 1.5x the horizontal error, and barometric
 * altimeters drift with weather and spike when a sensor port is covered. So
 * the altitude series gets its own, much more aggressive treatment than the
 * route geometry — a two-stage despike-then-blur.
 *
 * Stage 1: a median filter. Median is the right despiker because a single
 * absurd sample (a 300 m spike inside a tunnel) is rejected outright rather
 * than being smeared over the neighbourhood the way a mean would smear it.
 *
 * Stage 2: a Gaussian blur, for the actual cinematic laziness. The camera
 * should rise and fall with the hill, not with the sensor.
 *
 * Finally the result is clamped into the raw [min, max] envelope so smoothing
 * can never invent terrain the athlete never stood on.
 */

/** Median window, in resampled route vertices. Odd. */
export const MEDIAN_WINDOW = 9;
/** Gaussian sigma, in resampled route vertices. */
export const GAUSSIAN_SIGMA = 6;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Sliding-window median with edge clamping. */
export function medianFilter(series: number[], window = MEDIAN_WINDOW): number[] {
  if (series.length === 0) return [];
  const half = Math.max(0, Math.floor(window / 2));
  if (half === 0) return [...series];
  return series.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(series.length - 1, i + half);
    return median(series.slice(lo, hi + 1));
  });
}

/** Normalized Gaussian kernel truncated at 3 sigma. */
export function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  return k.map((v) => v / sum);
}

/** Gaussian blur with edge clamping (no ramp-in artefacts at the ends). */
export function gaussianSmooth(series: number[], sigma = GAUSSIAN_SIGMA): number[] {
  if (series.length === 0) return [];
  if (!(sigma > 0)) return [...series];
  const k = gaussianKernel(sigma);
  const radius = (k.length - 1) / 2;
  return series.map((_, i) => {
    let acc = 0;
    for (let j = -radius; j <= radius; j++) {
      const idx = Math.min(series.length - 1, Math.max(0, i + j));
      acc += series[idx] * k[j + radius];
    }
    return acc;
  });
}

export interface AltitudeOptions {
  medianWindow?: number;
  sigma?: number;
}

/**
 * Full altitude pipeline. Non-finite samples are replaced by the last good
 * value (or the series mean) before filtering, so one bad reading cannot
 * poison the whole blur.
 */
export function smoothAltitude(series: number[], opts: AltitudeOptions = {}): number[] {
  if (series.length === 0) return [];
  const finite = series.filter((v) => Number.isFinite(v));
  const fallback = finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : 0;
  let last = finite.length ? finite[0] : fallback;
  const clean = series.map((v) => {
    if (Number.isFinite(v)) {
      last = v;
      return v;
    }
    return last;
  });

  const lo = Math.min(...clean);
  const hi = Math.max(...clean);

  const despiked = medianFilter(clean, opts.medianWindow ?? MEDIAN_WINDOW);
  const blurred = gaussianSmooth(despiked, opts.sigma ?? GAUSSIAN_SIGMA);
  return blurred.map((v) => Math.min(hi, Math.max(lo, v)));
}

export function variance(series: number[]): number {
  if (series.length === 0) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  return series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
}
