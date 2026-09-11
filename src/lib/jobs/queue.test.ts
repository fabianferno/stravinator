import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  expireLease,
  mongoAvailable,
  readLease,
  readRunAfter,
  seedAthlete,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from "@/lib/db/testdb";
import type { ActivityStats, CameraKeyframe, LngLat } from "@/lib/types";

import {
  MAX_ATTEMPTS,
  claim,
  complete,
  enqueue,
  fail,
  getJob,
  getJobArtifacts,
  heartbeat,
  listJobsForAthlete,
  requeueForRateLimit,
  setStatus,
} from "./queue";

const available = await mongoAvailable();

describe.skipIf(!available)("jobs/queue", () => {
  let athleteId: string;

  beforeAll(async () => {
    await setupTestDb("test_queue_suite");
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await truncateAll();
    athleteId = await seedAthlete();
  });

  describe("enqueue", () => {
    it("creates a queued job with zeroed progress", async () => {
      const job = await enqueue(athleteId, "12345");
      expect(job.status).toBe("queued");
      expect(job.athleteId).toBe(athleteId);
      expect(job.activityId).toBe("12345");
      expect(job.progress).toBe(0);
      expect(job.framesDone).toBe(0);
      expect(job.attempts).toBe(0);
      expect(job.videoUrl).toBeNull();
      expect(job.error).toBeNull();
      expect(job.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("claim", () => {
    it("returns null when nothing is queued", async () => {
      expect(await claim("w1", 60)).toBeNull();
    });

    it("claims a queued job, increments attempts and takes a lease", async () => {
      const queued = await enqueue(athleteId, "1");
      const claimed = await claim("w1", 60);
      expect(claimed?.id).toBe(queued.id);
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.status).toBe("fetching");

      const lease = await readLease(queued.id);
      expect(lease).not.toBeNull();
      expect(lease!.getTime()).toBeGreaterThan(Date.now());
    });

    it("claims in creation order", async () => {
      const first = await enqueue(athleteId, "1");
      const second = await enqueue(athleteId, "2");
      expect((await claim("w1", 60))?.id).toBe(first.id);
      expect((await claim("w2", 60))?.id).toBe(second.id);
    });

    // The reason this module exists: two workers must never render the same job.
    it("never hands the same job to two concurrent workers", async () => {
      const job = await enqueue(athleteId, "1");
      const results = await Promise.all([claim("w1", 60), claim("w2", 60)]);
      const ids = results.filter(Boolean).map((j) => j!.id);
      expect(ids).toEqual([job.id]);
      expect(results.filter((r) => r === null)).toHaveLength(1);

      const stored = await getJob(job.id);
      expect(stored?.attempts).toBe(1);
    });

    it("gives eight concurrent workers eight distinct jobs, never a duplicate", async () => {
      const enqueued = await Promise.all(
        Array.from({ length: 8 }, (_, i) => enqueue(athleteId, `a${i}`)),
      );
      const claimed = await Promise.all(
        Array.from({ length: 8 }, (_, i) => claim(`w${i}`, 60)),
      );
      const ids = claimed.map((j) => j?.id);
      expect(ids.filter(Boolean)).toHaveLength(8);
      expect(new Set(ids).size).toBe(8);
      expect(new Set(ids)).toEqual(new Set(enqueued.map((j) => j.id)));
    });

    it("does NOT reclaim a job whose lease is still live", async () => {
      await enqueue(athleteId, "1");
      const claimed = await claim("w1", 600);
      expect(claimed).not.toBeNull();
      expect(await claim("w2", 600)).toBeNull();
    });

    // A crashed worker's job must come back, or the athlete waits forever.
    it("DOES reclaim a job whose lease has expired, incrementing attempts", async () => {
      const job = await enqueue(athleteId, "1");
      const first = await claim("w1", 600);
      await setStatus(job.id, "rendering", { progress: 0.4 });
      await expireLease(job.id);

      const second = await claim("w2", 600);
      expect(second?.id).toBe(first!.id);
      expect(second?.attempts).toBe(2);
    });

    it("does not reclaim terminal jobs", async () => {
      const done = await enqueue(athleteId, "1");
      await claim("w1", 600);
      await complete(done.id, "https://cdn/x.mp4");
      await expireLease(done.id);
      expect(await claim("w2", 600)).toBeNull();
    });

    it("skips a queued job whose backoff has not elapsed", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      await requeueForRateLimit(job.id, 900);
      expect(await claim("w2", 600)).toBeNull();
    });
  });

  describe("heartbeat", () => {
    it("extends the lease so a long render is not stolen", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 1);
      const before = await readLease(job.id);

      expect(await heartbeat(job.id, "w1", 600)).toBe(true);
      const after = await readLease(job.id);
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());

      // Even though the original 1s lease has now passed, the job is protected.
      expect(await claim("w2", 60)).toBeNull();
    });

    it("refuses a heartbeat from a worker that no longer owns the job", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      await expireLease(job.id);
      await claim("w2", 600);

      expect(await heartbeat(job.id, "w1", 600)).toBe(false);
      expect(await heartbeat(job.id, "w2", 600)).toBe(true);
    });

    it("refuses a heartbeat on a completed job", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      await complete(job.id, "https://cdn/x.mp4");
      expect(await heartbeat(job.id, "w1", 600)).toBe(false);
    });
  });

  describe("setStatus", () => {
    it("persists progress and framesDone across transitions", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);

      await setStatus(job.id, "smoothing", { progress: 0.2 });
      expect((await getJob(job.id))?.status).toBe("smoothing");

      const rendering = await setStatus(job.id, "rendering", {
        progress: 0.55,
        framesDone: 330,
        frameCount: 600,
      });
      expect(rendering?.status).toBe("rendering");
      expect(rendering?.progress).toBeCloseTo(0.55, 6);
      expect(rendering?.framesDone).toBe(330);
      expect(rendering?.frameCount).toBe(600);

      const reread = await getJob(job.id);
      expect(reread?.progress).toBeCloseTo(0.55, 6);
      expect(reread?.framesDone).toBe(330);
      expect(reread?.frameCount).toBe(600);
    });

    it("leaves untouched fields alone when the patch is partial", async () => {
      const job = await enqueue(athleteId, "1");
      await setStatus(job.id, "rendering", { progress: 0.3, framesDone: 100, frameCount: 300 });
      await setStatus(job.id, "encoding", { progress: 0.9 });
      const reread = await getJob(job.id);
      expect(reread?.framesDone).toBe(100);
      expect(reread?.frameCount).toBe(300);
      expect(reread?.progress).toBeCloseTo(0.9, 6);
    });

    it("round-trips keyframes, stats and route through jsonb", async () => {
      const job = await enqueue(athleteId, "1");
      const keyframes: CameraKeyframe[] = [
        { center: [-0.1, 51.5], bearing: 12.5, pitch: 60, zoom: 15, elevation: 30, progress: 0 },
        { center: [-0.2, 51.6], bearing: 370 % 360, pitch: 60, zoom: 15, elevation: 42, progress: 1 },
      ];
      const stats: ActivityStats = {
        name: "Morning Run",
        date: "2026-08-08T06:30:00Z",
        distance: 10120,
        paceSecPerKm: 312,
        elevationGain: 88,
        movingTime: 3160,
      };
      const route: LngLat[] = [
        [-0.1, 51.5],
        [-0.15, 51.55],
        [-0.2, 51.6],
      ];

      await setStatus(job.id, "smoothing", { keyframes, stats, route });
      const artifacts = await getJobArtifacts(job.id);
      expect(artifacts?.keyframes).toEqual(keyframes);
      expect(artifacts?.stats).toEqual(stats);
      expect(artifacts?.route).toEqual(route);
    });

    it("returns null for an unknown job", async () => {
      expect(
        await setStatus("00000000-0000-0000-0000-000000000000", "rendering"),
      ).toBeNull();
    });
  });

  describe("complete", () => {
    it("marks done, stores the url, clears the lease", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      const done = await complete(job.id, "https://cdn.example/v.mp4");
      expect(done?.status).toBe("done");
      expect(done?.videoUrl).toBe("https://cdn.example/v.mp4");
      expect(done?.progress).toBe(1);
      expect(await readLease(job.id)).toBeNull();
    });
  });

  describe("fail", () => {
    it("returns the job to queued while attempts remain", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      const failed = await fail(job.id, "Mapbox tiles did not load. Retrying.");
      expect(failed?.status).toBe("queued");
      expect(failed?.attempts).toBe(1);
      expect(failed?.error).toBe("Mapbox tiles did not load. Retrying.");
      expect(await readLease(job.id)).toBeNull();
    });

    it("retries up to the cap, then fails terminally with a user-facing reason", async () => {
      const job = await enqueue(athleteId, "1");
      const statuses: string[] = [];
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const claimed = await claim(`w${i}`, 600);
        expect(claimed, `attempt ${i + 1} should be claimable`).not.toBeNull();
        expect(claimed?.attempts).toBe(i + 1);
        const after = await fail(job.id, "We could not render this activity.");
        statuses.push(after!.status);
      }
      expect(statuses).toEqual(["queued", "queued", "failed"]);

      const final = await getJob(job.id);
      expect(final?.status).toBe("failed");
      expect(final?.attempts).toBe(MAX_ATTEMPTS);
      expect(final?.error).toBe("We could not render this activity.");
      // Terminally failed: no worker picks it up again.
      expect(await claim("w-final", 600)).toBeNull();
    });

    it("resets progress on a retry but preserves it on terminal failure", async () => {
      const job = await enqueue(athleteId, "1");
      await claim("w1", 600);
      await setStatus(job.id, "rendering", { progress: 0.7, framesDone: 420 });
      const retried = await fail(job.id, "Worker crashed.");
      expect(retried?.progress).toBe(0);
      expect(retried?.framesDone).toBe(0);
    });
  });

  describe("requeueForRateLimit", () => {
    it("requeues with backoff WITHOUT consuming an attempt", async () => {
      const job = await enqueue(athleteId, "1");
      const claimed = await claim("w1", 600);
      expect(claimed?.attempts).toBe(1);

      const requeued = await requeueForRateLimit(job.id, 300);
      expect(requeued?.status).toBe("queued");
      expect(requeued?.attempts).toBe(0);
      expect(requeued?.error).toBeNull();
      expect((await readRunAfter(job.id)).getTime()).toBeGreaterThan(Date.now() + 250_000);
    });

    it("never burns the retry budget however often Strava throttles", async () => {
      const job = await enqueue(athleteId, "1");
      for (let i = 0; i < 5; i++) {
        await claim("w1", 600);
        await requeueForRateLimit(job.id, 0);
      }
      expect((await getJob(job.id))?.attempts).toBe(0);
      // Still fully retryable afterwards.
      const claimed = await claim("w1", 600);
      expect(claimed?.attempts).toBe(1);
    });
  });

  describe("reads", () => {
    it("getJob returns null for an unknown id", async () => {
      expect(await getJob("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("listJobsForAthlete returns only that athlete's jobs, newest first", async () => {
      const other = await seedAthlete();
      const a = await enqueue(athleteId, "1");
      const b = await enqueue(athleteId, "2");
      await enqueue(other, "3");

      const jobs = await listJobsForAthlete(athleteId);
      expect(jobs.map((j) => j.id)).toEqual([b.id, a.id]);
      expect(await listJobsForAthlete("nobody")).toEqual([]);
    });
  });
});
