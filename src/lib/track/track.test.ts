import { describe, expect, it } from "vitest";
import { OUTPUT, angleDelta, type RawTrack } from "../types";
import {
  buildCameraPath,
  frameCountFor,
  progressIndices,
  routeFrom,
  toStats,
  PITCH,
  ZOOM,
  MAX_TURN_RATE_DEG_PER_FRAME,
} from "./index";
import { variance, smoothAltitude, medianFilter, gaussianSmooth } from "./altitude";
import {
  unwrapAngles,
  slewLimit,
  smoothBearings,
  wrapAngles,
} from "./bearing";
import {
  cleanPoints,
  resampleByDistance,
  intervalFor,
  routeLength,
  smoothPositions,
} from "./resample";
import { buildSpline, sampleUniform, catmullRom } from "./spline";
import { bearingFromXY, haversine, makeProjector, normalizeBearing } from "./geo";
import { DEGENERATE_FIXTURES, RENDERABLE_FIXTURES, loadFixture } from "./fixtures";

const finite = (n: number) => Number.isFinite(n);

function diffs(series: number[]): number[] {
  return series.slice(1).map((v, i) => v - series[i]);
}

// ---------------------------------------------------------------- geo --------

describe("geo", () => {
  it("measures a known distance", () => {
    // 1 degree of latitude is ~111 km.
    expect(haversine(0, 0, 0, 1)).toBeGreaterThan(110_000);
    expect(haversine(0, 0, 0, 1)).toBeLessThan(112_000);
  });

  it("round-trips through the local metre projection", () => {
    const proj = makeProjector(-0.1278, 51.5074);
    const xy = proj.toXY(-0.12, 51.51);
    const back = proj.toLngLat(xy);
    expect(back.lng).toBeCloseTo(-0.12, 9);
    expect(back.lat).toBeCloseTo(51.51, 9);
  });

  it("bearings are clockwise from north", () => {
    expect(bearingFromXY(0, 1)).toBeCloseTo(0);
    expect(bearingFromXY(1, 0)).toBeCloseTo(90);
    expect(bearingFromXY(0, -1)).toBeCloseTo(180);
    expect(bearingFromXY(-1, 0)).toBeCloseTo(270);
  });

  it("normalizes into [0, 360)", () => {
    expect(normalizeBearing(-1)).toBeCloseTo(359);
    expect(normalizeBearing(720.5)).toBeCloseTo(0.5);
  });
});

// ------------------------------------------------------------ resample -------

describe("resample", () => {
  it("drops consecutive duplicate fixes (tunnel behaviour)", () => {
    const p = (lng: number, lat: number) => ({ lng, lat, ele: 0, t: 0, dist: 0, vel: 0 });
    const cleaned = cleanPoints([p(0, 0), p(0, 0), p(0, 0), p(0, 0.001)]);
    expect(cleaned).toHaveLength(2);
  });

  it("throws on fewer than two distinct points", () => {
    const p = { lng: 0, lat: 0, ele: 0, t: 0, dist: 0, vel: 0 };
    expect(() => resampleByDistance([p, { ...p }])).toThrow(/at least 2 distinct/);
    expect(() => resampleByDistance([])).toThrow(/at least 2 distinct/);
  });

  it("spaces output by distance, not by time", () => {
    // Same geometry, but the second half is sampled 10x more densely in time
    // (the athlete slowed down). Spatial resampling must not care.
    const mk = (n: number, from: number, to: number) =>
      Array.from({ length: n }, (_, i) => ({
        lng: 0,
        lat: from + ((to - from) * i) / (n - 1),
        ele: 0,
        t: i,
        dist: 0,
        vel: 1,
      }));
    const fast = [...mk(20, 0, 0.005), ...mk(20, 0.005, 0.01)];
    const slow = [...mk(20, 0, 0.005), ...mk(200, 0.005, 0.01)];
    const a = resampleByDistance(fast, 10);
    const b = resampleByDistance(slow, 10);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    // Every step but the last is exactly the interval; the last lands on the
    // final fix and is therefore the remainder.
    for (let i = 1; i < a.length - 1; i++) {
      expect(a[i].dist - a[i - 1].dist).toBeCloseTo(10, 6);
    }
  });

  it("picks a bounded interval", () => {
    expect(intervalFor(10)).toBe(5);
    expect(intervalFor(1_000_000)).toBe(25);
    expect(intervalFor(10_000)).toBeCloseTo(10);
  });

  it("bridges a GPS dropout instead of teleporting", () => {
    const track = loadFixture("gps-dropout");
    const route = resampleByDistance(track.points, 10);
    for (let i = 1; i < route.length; i++) {
      const step = haversine(
        route[i - 1].lng,
        route[i - 1].lat,
        route[i].lng,
        route[i].lat,
      );
      expect(step).toBeLessThan(11);
    }
  });
});

// -------------------------------------------------------------- spline ------

describe("spline", () => {
  it("passes through its control points", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 1, y: 0 };
    const p2 = { x: 2, y: 1 };
    const p3 = { x: 3, y: 1 };
    expect(catmullRom(p0, p1, p2, p3, 0)).toEqual({ x: 1, y: 0 });
    const end = catmullRom(p0, p1, p2, p3, 1);
    expect(end.x).toBeCloseTo(2, 6);
    expect(end.y).toBeCloseTo(1, 6);
  });

  it("samples uniformly in arc length", () => {
    const track = loadFixture("clean-loop");
    const spline = buildSpline(smoothPositions(resampleByDistance(track.points)));
    const s = sampleUniform(spline, 200);
    expect(s).toHaveLength(200);
    const steps = diffs(s.map((x) => x.s));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const step of steps) expect(Math.abs(step - mean)).toBeLessThan(1e-6);
    // Physical spacing must be near-constant too, which is the point of the
    // arc-length parameterization.
    const phys = s.slice(1).map((x, i) => Math.hypot(x.p.x - s[i].p.x, x.p.y - s[i].p.y));
    const pmean = phys.reduce((a, b) => a + b, 0) / phys.length;
    for (const d of phys) expect(Math.abs(d - pmean) / pmean).toBeLessThan(0.05);
  });

  it("produces unit tangents", () => {
    const track = loadFixture("switchbacks");
    const spline = buildSpline(smoothPositions(resampleByDistance(track.points)));
    for (const s of sampleUniform(spline, 100)) {
      expect(Math.hypot(s.t.x, s.t.y)).toBeCloseTo(1, 6);
    }
  });

  it("throws on too few points or a bad sample count", () => {
    expect(() => buildSpline([{ lng: 0, lat: 0, ele: 0, dist: 0 }])).toThrow(/at least 2/);
    const spline = buildSpline(smoothPositions(resampleByDistance(loadFixture("clean-loop").points)));
    expect(() => sampleUniform(spline, 0)).toThrow(/positive integer/);
  });
});

// ------------------------------------------------------------ altitude ------

describe("altitude", () => {
  it("median filter rejects an isolated spike outright", () => {
    const s = [10, 10, 10, 900, 10, 10, 10];
    expect(medianFilter(s, 5)).toEqual([10, 10, 10, 10, 10, 10, 10]);
  });

  it("gaussian smoothing preserves a constant series", () => {
    expect(gaussianSmooth([5, 5, 5, 5, 5], 2).every((v) => Math.abs(v - 5) < 1e-9)).toBe(true);
  });

  it("collapses spikes and stays inside the raw envelope", () => {
    const raw = loadFixture("altitude-spikes").points.map((p) => p.ele);
    const smoothed = smoothAltitude(raw);
    expect(smoothed).toHaveLength(raw.length);
    const lo = Math.min(...raw);
    const hi = Math.max(...raw);
    for (const v of smoothed) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
    expect(variance(smoothed)).toBeLessThan(variance(raw) * 0.5);
  });

  it("survives non-finite samples", () => {
    const out = smoothAltitude([10, NaN, 12, Infinity, 11]);
    expect(out.every(finite)).toBe(true);
  });
});

// ------------------------------------------------------------- bearing ------

describe("bearing", () => {
  it("unwraps a north crossing as a small positive step", () => {
    const u = unwrapAngles([359, 1, 3]);
    expect(u[1] - u[0]).toBeCloseTo(2);
    expect(u[2] - u[1]).toBeCloseTo(2);
  });

  it("unwraps a long negative sweep without wrapping back", () => {
    const raw = Array.from({ length: 40 }, (_, i) => normalizeBearing(-i * 20));
    const u = unwrapAngles(raw);
    for (const d of diffs(u)) expect(d).toBeCloseTo(-20);
    expect(wrapAngles(u).map(normalizeBearing)).toEqual(raw.map(normalizeBearing));
  });

  it("slew limiting caps the per-step change", () => {
    const out = slewLimit([0, 100, 200, 200], 4);
    expect(out).toEqual([0, 4, 8, 12]);
  });

  it("a naive filter on wrapped angles would spin; ours does not", () => {
    // Heading hovers around due north, crossing 0/360 repeatedly.
    const raw = [358, 2, 359, 1, 357, 3, 0, 359, 1, 2];
    const out = smoothBearings(raw, { sigma: 3 });
    for (const v of out) {
      const off = Math.abs(angleDelta(0, v));
      expect(off).toBeLessThan(6);
    }
  });

  it("output never yaws faster than the documented threshold", () => {
    const raw = Array.from({ length: 300 }, (_, i) => (i < 150 ? 10 : 190));
    const out = smoothBearings(raw);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(angleDelta(out[i - 1], out[i]))).toBeLessThanOrEqual(
        MAX_TURN_RATE_DEG_PER_FRAME + 1e-9,
      );
    }
  });
});

// ------------------------------------------------------ frameCountFor -------

describe("frameCountFor", () => {
  const withDistance = (distance: number): RawTrack => ({
    ...loadFixture("clean-loop"),
    distance,
  });

  it("clamps to the 20-40 s window at 30 fps", () => {
    expect(frameCountFor(withDistance(100))).toBe(OUTPUT.minDurationSec * OUTPUT.fps);
    expect(frameCountFor(withDistance(500_000))).toBe(
      OUTPUT.maxDurationSec * OUTPUT.fps,
    );
  });

  it("scales monotonically with route length", () => {
    const lengths = [1_000, 5_000, 10_000, 15_000, 25_000];
    const counts = lengths.map((d) => frameCountFor(withDistance(d)));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[2]).toBeGreaterThan(counts[0]);
  });

  it("throws on an empty track", () => {
    expect(() => frameCountFor(loadFixture("empty"))).toThrow(/empty/);
  });
});

// ---------------------------------------------------- buildCameraPath -------

describe("buildCameraPath: degenerate input fails loudly", () => {
  it.each(DEGENERATE_FIXTURES)("%s throws", (name) => {
    const track = loadFixture(name);
    expect(() => buildCameraPath(track, 600)).toThrow(Error);
  });

  it("rejects a bad frameCount", () => {
    const track = loadFixture("clean-loop");
    expect(() => buildCameraPath(track, 0)).toThrow(/frameCount/);
    expect(() => buildCameraPath(track, 1)).toThrow(/frameCount/);
    expect(() => buildCameraPath(track, -30)).toThrow(/frameCount/);
    expect(() => buildCameraPath(track, 12.5)).toThrow(/frameCount/);
  });

  it("rejects a malformed track", () => {
    expect(() => buildCameraPath(undefined as unknown as RawTrack, 600)).toThrow();
    expect(() =>
      buildCameraPath({ points: null } as unknown as RawTrack, 600),
    ).toThrow(/must be an array/);
  });
});

describe.each(RENDERABLE_FIXTURES)("buildCameraPath over %s", (name) => {
  const track = loadFixture(name);
  const frameCount = frameCountFor(track);
  const frames = buildCameraPath(track, frameCount);

  it("returns exactly frameCount keyframes", () => {
    expect(frames).toHaveLength(frameCount);
    expect(frameCount).toBeGreaterThanOrEqual(OUTPUT.minDurationSec * OUTPUT.fps);
    expect(frameCount).toBeLessThanOrEqual(OUTPUT.maxDurationSec * OUTPUT.fps);
  });

  it("honours an arbitrary explicit frameCount", () => {
    expect(buildCameraPath(track, 137)).toHaveLength(137);
    expect(buildCameraPath(track, 2)).toHaveLength(2);
  });

  it("emits no NaN or Infinity in any field", () => {
    for (const f of frames) {
      expect(finite(f.center[0])).toBe(true);
      expect(finite(f.center[1])).toBe(true);
      expect(finite(f.bearing)).toBe(true);
      expect(finite(f.pitch)).toBe(true);
      expect(finite(f.zoom)).toBe(true);
      expect(finite(f.elevation)).toBe(true);
      expect(finite(f.progress)).toBe(true);
    }
  });

  it("progress runs 0 -> 1, monotonically non-decreasing", () => {
    expect(frames[0].progress).toBe(0);
    expect(frames[frames.length - 1].progress).toBe(1);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].progress).toBeGreaterThanOrEqual(frames[i - 1].progress);
    }
  });

  it("bearings are in [0, 360) and continuous within the yaw threshold", () => {
    // Threshold justification: MAX_TURN_RATE_DEG_PER_FRAME = 4 deg/frame is
    // 120 deg/s at 30 fps. Faster than that reads as a whip-pan on a phone.
    // Compared with angleDelta, because the emitted value is wrapped and a
    // 359 -> 1 step is a legal 2 deg turn.
    for (const f of frames) {
      expect(f.bearing).toBeGreaterThanOrEqual(0);
      expect(f.bearing).toBeLessThan(360);
    }
    for (let i = 1; i < frames.length; i++) {
      expect(Math.abs(angleDelta(frames[i - 1].bearing, frames[i].bearing))).toBeLessThanOrEqual(
        MAX_TURN_RATE_DEG_PER_FRAME + 1e-9,
      );
    }
  });

  it("keeps every center inside the raw track's bounding box (plus slack)", () => {
    const lngs = track.points.map((p) => p.lng);
    const lats = track.points.map((p) => p.lat);
    const slack = 0.002; // ~200 m, allows for spline overshoot on hairpins
    for (const f of frames) {
      expect(f.center[0]).toBeGreaterThanOrEqual(Math.min(...lngs) - slack);
      expect(f.center[0]).toBeLessThanOrEqual(Math.max(...lngs) + slack);
      expect(f.center[1]).toBeGreaterThanOrEqual(Math.min(...lats) - slack);
      expect(f.center[1]).toBeLessThanOrEqual(Math.max(...lats) + slack);
    }
  });

  it("smoothed elevation is quieter than raw and inside the raw envelope", () => {
    const raw = track.points.map((p) => p.ele);
    const lo = Math.min(...raw);
    const hi = Math.max(...raw);
    const smoothed = frames.map((f) => f.elevation);
    for (const v of smoothed) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(v).toBeLessThanOrEqual(hi + 1e-6);
    }
    // Compare ROUGHNESS (variance of the sample-to-sample change), resampled to
    // the same length, rather than total variance: total variance measures the
    // hill, which we want to keep. Roughness measures the sensor noise, which
    // is the thing smoothing exists to remove.
    const rawAtFrames = frames.map(
      (_, i) => raw[Math.round((i / (frames.length - 1)) * (raw.length - 1))],
    );
    expect(variance(diffs(smoothed))).toBeLessThan(variance(diffs(rawAtFrames)) * 0.25);
  });

  it("camera framing constants are applied uniformly", () => {
    for (const f of frames) {
      expect(f.pitch).toBe(PITCH);
      expect(f.zoom).toBe(ZOOM);
    }
    expect(PITCH).toBeGreaterThanOrEqual(60);
    expect(PITCH).toBeLessThanOrEqual(70);
    expect(ZOOM).toBeGreaterThanOrEqual(14);
    expect(ZOOM).toBeLessThanOrEqual(15);
  });

  it("advances at a near-constant distance per frame", () => {
    const steps = frames
      .slice(1)
      .map((f, i) =>
        haversine(frames[i].center[0], frames[i].center[1], f.center[0], f.center[1]),
      );
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(mean).toBeGreaterThan(0);
    // Measured as ground distance between consecutive centers. This is a proxy
    // for arc length and it under-reads at a path reversal: at an out-and-back
    // turnaround the camera covers a full frame of arc while barely moving in
    // a straight line. Arc-length uniformity itself is asserted exactly in the
    // spline suite, so here we allow a 1% tail of reversal frames.
    const outliers = steps.filter((s) => Math.abs(s - mean) / mean >= 0.15);
    expect(outliers.length).toBeLessThanOrEqual(Math.ceil(steps.length * 0.01));
  });

  it("is deterministic", () => {
    expect(buildCameraPath(track, frameCount)).toEqual(frames);
  });
});

// ------------------------------------------------- stats / route helpers ----

describe("toStats", () => {
  it("derives pace in seconds per km", () => {
    const track = loadFixture("clean-loop");
    const stats = toStats(track);
    expect(stats.name).toBe(track.name);
    expect(stats.date).toBe(track.startDate);
    expect(stats.distance).toBeGreaterThan(0);
    expect(stats.paceSecPerKm).toBeCloseTo(track.movingTime / (track.distance / 1000), 3);
    expect(finite(stats.paceSecPerKm)).toBe(true);
  });

  it("guards against zero distance and zero time", () => {
    const track = { ...loadFixture("clean-loop"), distance: 0, movingTime: 0 };
    // distance falls back to the measured route, but time is zero -> no pace
    expect(toStats(track).paceSecPerKm).toBe(0);
    const noDist = { ...loadFixture("clean-loop"), distance: 0, points: [] as never[] };
    expect(() => toStats(noDist as unknown as RawTrack)).toThrow(/empty/);
  });

  it("throws on an empty track", () => {
    expect(() => toStats(loadFixture("empty"))).toThrow(/empty/);
  });
});

describe("routeFrom", () => {
  it("returns lng/lat pairs in Mapbox order", () => {
    const track = loadFixture("clean-loop");
    const route = routeFrom(track);
    expect(route.length).toBeGreaterThan(1);
    expect(route[0][0]).toBeCloseTo(track.points[0].lng);
    expect(route[0][1]).toBeCloseTo(track.points[0].lat);
    expect(routeLength(route.map(([lng, lat]) => ({ lng, lat })))).toBeGreaterThan(0);
  });

  it("throws on an empty track", () => {
    expect(() => routeFrom(loadFixture("empty"))).toThrow(/empty/);
  });
});

describe.each(RENDERABLE_FIXTURES)("progressIndices over %s", (name) => {
  const track = loadFixture(name);
  const frames = buildCameraPath(track, frameCountFor(track));
  const idx = progressIndices(track, frames);
  const route = routeFrom(track);

  it("has one index per keyframe", () => {
    expect(idx).toHaveLength(frames.length);
  });

  it("starts at 0 and ends on the last route vertex", () => {
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(route.length - 1);
  });

  it("is non-decreasing and in range", () => {
    for (let i = 0; i < idx.length; i++) {
      expect(Number.isInteger(idx[i])).toBe(true);
      expect(idx[i]).toBeGreaterThanOrEqual(0);
      expect(idx[i]).toBeLessThan(route.length);
      if (i > 0) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    }
  });
});

describe("progressIndices edge cases", () => {
  it("returns an empty array for no keyframes", () => {
    expect(progressIndices(loadFixture("clean-loop"), [])).toEqual([]);
  });
});
