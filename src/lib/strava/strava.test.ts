import { describe, expect, it } from "vitest";

import {
  MIN_DISTANCE_M,
  REFRESH_SKEW_SEC,
  STRAVA_SCOPE,
  StravaAuthError,
  StravaRateLimitError,
  buildAuthorizeUrl,
  checkEligibility,
  checkStreamEligibility,
  ensureFreshToken,
  exchangeCode,
  getActivity,
  getStreams,
  hasRotatedTokens,
  listActivities,
  needsRefresh,
  refreshToken,
  toActivitySummary,
  toRawTrack,
  withFreshToken,
  type StravaActivity,
  type StravaStreamSet,
  type StravaTokens,
} from "./index";
import { TEST_OAUTH_CONFIG, fakeFetch, loadFixture } from "./fixtures";

const gpsRun = loadFixture<StravaActivity>("activity-gps-run");
const treadmill = loadFixture<StravaActivity>("activity-treadmill-run");
const shortWalk = loadFixture<StravaActivity>("activity-short-walk");
const gpsStreams = loadFixture<StravaStreamSet>("streams-gps-run");
const mismatched = loadFixture<StravaStreamSet>("streams-mismatched");
const noLatlng = loadFixture<StravaStreamSet>("streams-no-latlng");
const auth401 = loadFixture("auth-401");
const rate429 = loadFixture("rate-limit-429");
const tokenExchange = loadFixture<{ access_token: string; refresh_token: string }>(
  "token-exchange",
);
const tokenRefresh = loadFixture<{ access_token: string; refresh_token: string }>(
  "token-refresh",
);

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);

function tokens(overrides: Partial<StravaTokens> = {}): StravaTokens {
  return {
    accessToken: "current-access",
    refreshToken: "current-refresh",
    expiresAt: nowSec + 6 * 3600,
    athleteId: "2284799",
    ...overrides,
  };
}

describe("oauth", () => {
  it("requests only own-activity scope", () => {
    const url = new URL(buildAuthorizeUrl("csrf-abc", TEST_OAUTH_CONFIG));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read,activity:read");
    expect(STRAVA_SCOPE).not.toContain("activity:read_all");
    expect(STRAVA_SCOPE).not.toContain("write");
    expect(url.searchParams.get("state")).toBe("csrf-abc");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(TEST_OAUTH_CONFIG.clientId);
  });

  it("refuses to build an authorize URL without state", () => {
    expect(() => buildAuthorizeUrl("", TEST_OAUTH_CONFIG)).toThrow(/state/);
  });

  it("exchanges a code for tokens and the athlete", async () => {
    const f = fakeFetch({ body: tokenExchange });
    const { tokens: t, athlete } = await exchangeCode("code-xyz", f.fetch, TEST_OAUTH_CONFIG);

    expect(t.accessToken).toBe(tokenExchange.access_token);
    expect(t.refreshToken).toBe(tokenExchange.refresh_token);
    expect(t.athleteId).toBe("2284799");
    expect(athlete?.id).toBe(2284799);
    expect(f.calls[0].form).toMatchObject({
      grant_type: "authorization_code",
      code: "code-xyz",
      client_secret: TEST_OAUTH_CONFIG.clientSecret,
    });
  });

  it("surfaces a 401 from the token endpoint as StravaAuthError", async () => {
    const f = fakeFetch({ status: 401, body: auth401 });
    await expect(refreshToken("dead", f.fetch, TEST_OAUTH_CONFIG)).rejects.toBeInstanceOf(
      StravaAuthError,
    );
  });
});

describe("token freshness", () => {
  it("does not refresh outside the skew window", async () => {
    const t = tokens({ expiresAt: nowSec + REFRESH_SKEW_SEC + 60 });
    expect(needsRefresh(t, { now: NOW })).toBe(false);

    const f = fakeFetch(); // any call at all would throw
    const fresh = await ensureFreshToken(t, { fetchImpl: f.fetch, now: NOW, config: TEST_OAUTH_CONFIG });

    expect(fresh.rotated).toBe(false);
    expect(fresh.tokens).toBe(t);
    expect(f.calls).toHaveLength(0);
  });

  it("refreshes inside the skew window and surfaces the rotated refresh token", async () => {
    const t = tokens({ expiresAt: nowSec + REFRESH_SKEW_SEC - 1 });
    expect(needsRefresh(t, { now: NOW })).toBe(true);

    const f = fakeFetch({ body: tokenRefresh });
    const fresh = await ensureFreshToken(t, { fetchImpl: f.fetch, now: NOW, config: TEST_OAUTH_CONFIG });

    expect(fresh.rotated).toBe(true);
    expect(fresh.tokens.accessToken).toBe(tokenRefresh.access_token);
    // Strava rotates the refresh token — this is the value callers MUST persist.
    expect(fresh.tokens.refreshToken).toBe(tokenRefresh.refresh_token);
    expect(fresh.tokens.refreshToken).not.toBe(t.refreshToken);
    expect(fresh.tokens.athleteId).toBe(t.athleteId);
    expect(f.calls[0].form).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "current-refresh",
    });
  });

  it("refreshes an already-expired token", async () => {
    const f = fakeFetch({ body: tokenRefresh });
    const fresh = await ensureFreshToken(tokens({ expiresAt: nowSec - 10 }), {
      fetchImpl: f.fetch,
      now: NOW,
      config: TEST_OAUTH_CONFIG,
    });
    expect(fresh.rotated).toBe(true);
  });

  it("withFreshToken passes the fresh access token through and returns the result", async () => {
    const f = fakeFetch({ body: tokenRefresh });
    const seen: string[] = [];
    const out = await withFreshToken(
      tokens({ expiresAt: nowSec + 60 }),
      async (accessToken) => {
        seen.push(accessToken);
        return "payload";
      },
      { fetchImpl: f.fetch, now: NOW, config: TEST_OAUTH_CONFIG },
    );

    expect(out.result).toBe("payload");
    expect(out.rotated).toBe(true);
    expect(seen).toEqual([tokenRefresh.access_token]);
  });

  it("withFreshToken retries once on a mid-flight 401, then gives up", async () => {
    const f = fakeFetch({ body: tokenRefresh });
    let attempts = 0;
    const out = await withFreshToken(
      tokens(),
      async () => {
        attempts++;
        if (attempts === 1) throw new StravaAuthError("expired early");
        return "recovered";
      },
      { fetchImpl: f.fetch, now: NOW, config: TEST_OAUTH_CONFIG },
    );

    expect(attempts).toBe(2);
    expect(out.result).toBe("recovered");
    expect(out.rotated).toBe(true);
  });

  it("attaches rotated tokens to a thrown error so they are never lost", async () => {
    const f = fakeFetch({ body: tokenRefresh }, { status: 401, body: auth401 });
    const err = await withFreshToken(
      tokens({ expiresAt: nowSec + 60 }),
      async () => {
        throw new StravaAuthError("still dead");
      },
      { fetchImpl: f.fetch, now: NOW, config: TEST_OAUTH_CONFIG },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(StravaAuthError);
    expect(hasRotatedTokens(err)).toBe(true);
    expect(err.rotatedTokens.refreshToken).toBe(tokenRefresh.refresh_token);
  });
});

describe("client", () => {
  it("lists activities with paging params and a bearer token", async () => {
    const f = fakeFetch({ body: [gpsRun, treadmill] });
    const out = await listActivities("tok", { page: 2, perPage: 50, fetchImpl: f.fetch });

    expect(out).toHaveLength(2);
    const url = new URL(f.calls[0].url);
    expect(url.pathname).toBe("/api/v3/athlete/activities");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("clamps per_page to Strava's maximum", async () => {
    const f = fakeFetch({ body: [] });
    await listActivities("tok", { perPage: 9999, fetchImpl: f.fetch });
    expect(new URL(f.calls[0].url).searchParams.get("per_page")).toBe("200");
  });

  it("requests exactly the five streams, keyed by type", async () => {
    const f = fakeFetch({ body: gpsStreams });
    await getStreams("tok", 12345678901, f.fetch);

    const url = new URL(f.calls[0].url);
    expect(url.pathname).toBe("/api/v3/activities/12345678901/streams");
    expect(url.searchParams.get("keys")).toBe(
      "latlng,altitude,time,distance,velocity_smooth",
    );
    expect(url.searchParams.get("key_by_type")).toBe("true");
  });

  it("maps 429 to StravaRateLimitError with retry timing", async () => {
    const f = fakeFetch({
      status: 429,
      body: rate429,
      headers: {
        "X-RateLimit-Limit": "100,1000",
        "X-RateLimit-Usage": "101,412",
        "Retry-After": "437",
      },
    });

    const err = await getActivity("tok", 1, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(StravaRateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(437);
    expect(err.retryAt.getTime()).toBeGreaterThan(Date.now());
    expect(err.limit).toEqual([100, 1000]);
    expect(err.usage).toEqual([101, 412]);
    expect(err.daily).toBe(false);
    expect(err.body).toEqual(rate429);
  });

  it("falls back to the 15-minute window when Retry-After is absent", async () => {
    const f = fakeFetch({ status: 429, body: rate429 });
    const err = await getActivity("tok", 1, f.fetch).catch((e) => e);

    expect(err).toBeInstanceOf(StravaRateLimitError);
    expect(err.retryAfterSec).toBeGreaterThan(0);
    expect(err.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it("flags a daily-quota exhaustion distinctly, with a much longer backoff", async () => {
    const f = fakeFetch({
      status: 429,
      body: rate429,
      headers: { "X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "12,1000" },
    });
    const err = await getActivity("tok", 1, f.fetch).catch((e) => e);

    expect(err.daily).toBe(true);
    expect(err.retryAfterSec).toBeGreaterThan(15 * 60);
  });

  it("maps 401 to StravaAuthError carrying Strava's body", async () => {
    const f = fakeFetch({ status: 401, body: auth401 });
    const err = await getActivity("tok", 1, f.fetch).catch((e) => e);

    expect(err).toBeInstanceOf(StravaAuthError);
    expect(err.body).toEqual(auth401);
    expect(err.message).toBe("Authorization Error");
  });
});

describe("eligibility", () => {
  it("flags a treadmill run as no-gps from the summary alone, with no streams call", async () => {
    // The fake fetch is scripted with zero responses: any HTTP call throws.
    const f = fakeFetch();

    expect(checkEligibility(treadmill)).toBe("no-gps");
    expect(toActivitySummary(treadmill).ineligible).toBe("no-gps");
    expect(f.calls).toHaveLength(0);

    // And a full picker page over mixed activities still makes no calls.
    const rows = [gpsRun, treadmill, shortWalk].map(toActivitySummary);
    expect(rows.map((r) => r.ineligible)).toEqual([null, "no-gps", "too-short"]);
    expect(f.calls).toHaveLength(0);
  });

  it("treats an empty start_latlng as no-gps even without the trainer flag", () => {
    expect(checkEligibility({ ...treadmill, trainer: false })).toBe("no-gps");
    expect(checkEligibility({ ...gpsRun, start_latlng: [] })).toBe("no-gps");
    expect(checkEligibility({ ...gpsRun, start_latlng: null })).toBe("no-gps");
    expect(checkEligibility({ ...gpsRun, start_latlng: [0, 0] })).toBe("no-gps");
    expect(checkEligibility({ ...gpsRun, manual: true })).toBe("no-gps");
  });

  it("rejects routes under the documented minimum distance", () => {
    expect(checkEligibility(shortWalk)).toBe("too-short");
    expect(checkEligibility({ ...gpsRun, distance: MIN_DISTANCE_M - 1 })).toBe("too-short");
    expect(checkEligibility({ ...gpsRun, distance: MIN_DISTANCE_M })).toBeNull();
  });

  it("prefers no-gps over too-short when both apply", () => {
    expect(checkEligibility({ ...treadmill, distance: 10 })).toBe("no-gps");
  });

  it("accepts a real GPS run", () => {
    expect(checkEligibility(gpsRun)).toBeNull();
  });

  it("reports no-stream when streams come back without latlng", () => {
    expect(checkStreamEligibility(noLatlng)).toBe("no-stream");
    expect(checkStreamEligibility({})).toBe("no-stream");
    expect(checkStreamEligibility(gpsStreams)).toBeNull();
  });
});

describe("normalize", () => {
  it("produces a RawTrack from a clean GPS run", () => {
    const track = toRawTrack(gpsRun, gpsStreams);

    expect(track.activityId).toBe("12345678901");
    expect(track.name).toBe(gpsRun.name);
    expect(track.sportType).toBe("Run");
    expect(track.distance).toBe(gpsRun.distance);
    expect(track.movingTime).toBe(gpsRun.moving_time);
    expect(track.elevationGain).toBe(gpsRun.total_elevation_gain);
    expect(track.points).toHaveLength(gpsStreams.latlng!.data.length);

    const [first] = track.points;
    // Strava sends [lat, lng]; the contract is Mapbox [lng, lat].
    expect(first.lat).toBe(gpsStreams.latlng!.data[0][0]);
    expect(first.lng).toBe(gpsStreams.latlng!.data[0][1]);
    expect(first.t).toBe(0);
    expect(first.dist).toBe(0);
    expect(first.ele).toBeCloseTo(gpsStreams.altitude!.data[0], 5);
    expect(track.points.every((p) => Number.isFinite(p.vel))).toBe(true);
    // Time and distance are monotonic — `track/` depends on this.
    for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThanOrEqual(track.points[i - 1].t);
      expect(track.points[i].dist).toBeGreaterThanOrEqual(track.points[i - 1].dist);
    }
  });

  it("uses local wall-clock start time without a misleading Z", () => {
    const track = toRawTrack(gpsRun, gpsStreams);
    expect(track.startDate).toBe("2026-07-14T07:02:11");
  });

  it("zips mismatched stream lengths to the shortest present, without throwing", () => {
    // latlng 40, altitude 60, time 55, velocity_smooth 10, distance absent.
    const track = toRawTrack(gpsRun, mismatched);

    expect(track.points).toHaveLength(10);
    expect(track.points.every((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))).toBe(
      true,
    );
    // `distance` is absent entirely, so it is derived from the coordinates
    // rather than truncating the track to zero points.
    expect(mismatched.distance).toBeUndefined();
    expect(track.points[0].dist).toBe(0);
    expect(track.points[9].dist).toBeGreaterThan(0);
    expect(track.points.every((p) => Number.isFinite(p.vel))).toBe(true);
    expect(track.points.every((p) => Number.isFinite(p.ele))).toBe(true);
  });

  it("returns an empty point list rather than throwing when latlng is missing", () => {
    expect(toRawTrack(treadmill, noLatlng).points).toEqual([]);
    expect(toRawTrack(treadmill, {}).points).toEqual([]);
  });

  it("drops junk coordinates instead of flying the camera to Null Island", () => {
    const dirty: StravaStreamSet = {
      latlng: {
        data: [
          [37.7694, -122.48614],
          null as unknown as [number, number],
          [999, 999],
          [37.7695, -122.48611],
        ],
      },
      altitude: { data: [10, 11, 12, 13] },
      time: { data: [0, 10, 20, 30] },
      distance: { data: [0, 20, 40, 60] },
      velocity_smooth: { data: [2, 2, 2, 2] },
    };
    const track = toRawTrack(gpsRun, dirty);
    expect(track.points).toHaveLength(2);
    expect(track.points.map((p) => p.t)).toEqual([0, 30]);
  });

  it("summarizes an activity for the picker", () => {
    const s = toActivitySummary(gpsRun);
    expect(s).toEqual({
      id: "12345678901",
      name: "Golden Gate Park morning loop",
      startDate: "2026-07-14T07:02:11",
      distance: 3545.2,
      movingTime: 590,
      elevationGain: 31.4,
      sportType: "Run",
      ineligible: null,
    });
  });
});
