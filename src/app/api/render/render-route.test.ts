/**
 * Integration test for the seam between the worker and the render payload
 * route.
 *
 * This is the one boundary neither the scene nor the worker could test alone:
 * the scene fetches its payload from inside the headless page, so the auth
 * header has to be attached at the browser context. That wiring was missing at
 * first and nothing caught it — the smoke test uses the fixture path, which
 * never touches this route. Hence this test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresAvailable,
  seedAthlete,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from "@/lib/db/testdb";
import { enqueue, setStatus } from "@/lib/jobs";
import type { ActivityStats, CameraKeyframe, LngLat } from "@/lib/types";

const available = await postgresAvailable();

const WORKER_TOKEN = "test-worker-token";

const STATS: ActivityStats = {
  name: "Le Brévent — morning climb",
  date: "2026-07-19T06:12:00Z",
  distance: 5800,
  paceSecPerKm: 312,
  elevationGain: 685,
  movingTime: 1810,
};

const ROUTE: LngLat[] = [
  [6.8489, 45.9237],
  [6.8495, 45.9241],
  [6.8502, 45.9248],
  [6.8511, 45.9255],
];

function keyframes(n: number): CameraKeyframe[] {
  return Array.from({ length: n }, (_, i) => ({
    center: ROUTE[0],
    bearing: 12,
    pitch: 65,
    zoom: 14.5,
    elevation: 1200,
    progress: n === 1 ? 0 : i / (n - 1),
  }));
}

async function get(jobId: string, token?: string) {
  const { GET } = await import("./[jobId]/route");
  const req = new Request(`http://localhost/api/render/${jobId}`, {
    headers: token ? { "x-worker-token": token } : {},
  });
  return GET(req, { params: Promise.resolve({ jobId }) });
}

describe.skipIf(!available)("GET /api/render/[jobId]", () => {
  let athleteId: string;

  beforeAll(async () => {
    await setupTestDb("render_route_test");
    process.env.WORKER_TOKEN = WORKER_TOKEN;
  });
  afterAll(teardownTestDb);

  beforeEach(async () => {
    await truncateAll();
    athleteId = await seedAthlete();
  });

  async function preparedJob(frames = 4) {
    const job = await enqueue(athleteId, "12345");
    await setStatus(job.id, "rendering", {
      keyframes: keyframes(frames),
      stats: STATS,
      route: ROUTE,
      frameCount: frames,
    });
    return job.id;
  }

  it("serves the payload to a worker presenting the token", async () => {
    const jobId = await preparedJob();
    const res = await get(jobId, WORKER_TOKEN);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toBe(jobId);
    expect(body.stats.name).toBe(STATS.name);
    expect(body.keyframes).toHaveLength(4);
    expect(body.route).toEqual(ROUTE);
  });

  it("rejects a request with no token", async () => {
    const jobId = await preparedJob();
    expect((await get(jobId)).status).toBe(403);
  });

  it("rejects a request with the wrong token", async () => {
    const jobId = await preparedJob();
    expect((await get(jobId, "not-the-token")).status).toBe(403);
  });

  it("refuses to serve anything when WORKER_TOKEN is unset", async () => {
    const jobId = await preparedJob();
    delete process.env.WORKER_TOKEN;
    // Fail closed: an unconfigured deployment must not become an open endpoint.
    expect((await get(jobId, WORKER_TOKEN)).status).toBe(403);
    process.env.WORKER_TOKEN = WORKER_TOKEN;
  });

  it("404s for a job that does not exist", async () => {
    expect((await get("00000000-0000-0000-0000-000000000000", WORKER_TOKEN)).status).toBe(404);
  });

  it("409s for a job whose keyframes have not been computed yet", async () => {
    const job = await enqueue(athleteId, "12345");
    expect((await get(job.id, WORKER_TOKEN)).status).toBe(409);
  });

  // The scene draws the route line up to this index each frame. If it ran past
  // the end the line would reference a point that does not exist; if it never
  // reached the end the route would finish visibly incomplete.
  it("derives a route progress index that spans the whole route", async () => {
    const jobId = await preparedJob(10);
    const body = await (await get(jobId, WORKER_TOKEN)).json();

    const idx: number[] = body.routeProgressIndex;
    expect(idx).toHaveLength(10);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(ROUTE.length - 1);
    expect(idx.every((v) => v >= 0 && v < ROUTE.length)).toBe(true);
    expect(idx.every((v, i) => i === 0 || v >= idx[i - 1])).toBe(true);
  });
});
