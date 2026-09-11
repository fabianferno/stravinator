import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { jobs, type JobDoc } from "@/lib/db/client";
import type { ActivityStats, CameraKeyframe, Job, JobStatus, LngLat } from "@/lib/types";

/** Crashed-worker retries are capped so a poison job cannot spin forever. */
export const MAX_ATTEMPTS = 3;

/** Lease length a worker takes by default; heartbeats extend it. */
export const DEFAULT_LEASE_SECONDS = 120;

/** The artifacts are large; every read that becomes a `Job` leaves them out. */
const JOB_PROJECTION = { keyframes: 0, stats: 0, route: 0 } as const;

type JobView = Omit<JobDoc, "keyframes" | "stats" | "route">;

function toJob(d: JobView): Job {
  return {
    id: d._id,
    athleteId: d.athleteId,
    activityId: d.activityId,
    status: d.status,
    progress: d.progress,
    framesDone: d.framesDone,
    frameCount: d.frameCount,
    error: d.error,
    videoUrl: d.videoUrl,
    attempts: d.attempts,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

const secondsFromNow = (s: number) => new Date(Date.now() + s * 1000);

export async function enqueue(athleteId: string, activityId: string): Promise<Job> {
  const now = new Date();
  const doc: JobDoc = {
    _id: randomUUID(),
    athleteId,
    activityId,
    status: "queued",
    progress: 0,
    framesDone: 0,
    frameCount: 0,
    error: null,
    videoUrl: null,
    attempts: 0,
    workerId: null,
    leaseExpiresAt: null,
    runAfter: now,
    keyframes: null,
    stats: null,
    route: null,
    createdAt: now,
    updatedAt: now,
  };
  await jobs().insertOne(doc);
  return toJob(doc);
}

/**
 * Atomically take one job for `workerId`, holding it for `leaseSeconds`.
 *
 * Claimable means: `queued` and past its backoff, OR in a mid-flight status
 * whose lease has expired — that second arm is what makes a crashed worker's
 * job recoverable. `findOneAndUpdate` matches and writes as one atomic step on
 * a single document, so two workers racing on the same job cannot both win:
 * the loser's filter no longer matches and it moves on to the next candidate.
 */
export async function claim(workerId: string, leaseSeconds: number): Promise<Job | null> {
  const now = new Date();
  const claimable: Filter<JobDoc> = {
    $or: [
      { status: "queued", runAfter: { $lte: now } },
      {
        status: { $nin: ["queued", "done", "failed"] },
        leaseExpiresAt: { $ne: null, $lte: now },
      },
    ],
  };
  const doc = await jobs().findOneAndUpdate(
    claimable,
    {
      $set: {
        status: "fetching",
        workerId,
        leaseExpiresAt: secondsFromNow(leaseSeconds),
        error: null,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after", projection: JOB_PROJECTION },
  );
  return doc ? toJob(doc) : null;
}

/**
 * Extends the lease. A long render must not be stolen mid-flight, so the worker
 * calls this periodically. Only the owning worker may heartbeat, and only while
 * the job is still active.
 *
 * @returns true if the lease was extended; false if the job was lost (reclaimed
 * by another worker, or already terminal) — the caller should abandon its work.
 */
export async function heartbeat(
  jobId: string,
  workerId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<boolean> {
  const { matchedCount } = await jobs().updateOne(
    { _id: jobId, workerId, status: { $nin: ["queued", "done", "failed"] } },
    { $set: { leaseExpiresAt: secondsFromNow(leaseSeconds), updatedAt: new Date() } },
  );
  return matchedCount > 0;
}

export interface StatusPatch {
  progress?: number;
  framesDone?: number;
  frameCount?: number;
  keyframes?: CameraKeyframe[];
  stats?: ActivityStats;
  route?: LngLat[];
}

/**
 * Moves a job to `status`, optionally persisting pipeline output in the same
 * write. Pipeline artifacts are stored on the job so a reclaiming worker (and
 * the /render page) can read them back.
 */
export async function setStatus(
  jobId: string,
  status: JobStatus,
  patch: StatusPatch = {},
): Promise<Job | null> {
  const $set: Partial<JobDoc> = { status, updatedAt: new Date() };
  if (patch.progress !== undefined) $set.progress = patch.progress;
  if (patch.framesDone !== undefined) $set.framesDone = patch.framesDone;
  if (patch.frameCount !== undefined) $set.frameCount = patch.frameCount;
  if (patch.keyframes !== undefined) $set.keyframes = patch.keyframes;
  if (patch.stats !== undefined) $set.stats = patch.stats;
  if (patch.route !== undefined) $set.route = patch.route;

  const doc = await jobs().findOneAndUpdate(
    { _id: jobId },
    { $set },
    { returnDocument: "after", projection: JOB_PROJECTION },
  );
  return doc ? toJob(doc) : null;
}

/** Marks the job done and releases the lease. */
export async function complete(jobId: string, videoUrl: string): Promise<Job | null> {
  const doc = await jobs().findOneAndUpdate(
    { _id: jobId },
    {
      $set: {
        status: "done",
        videoUrl,
        progress: 1,
        error: null,
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after", projection: JOB_PROJECTION },
  );
  return doc ? toJob(doc) : null;
}

/**
 * Records a failure. Under the attempt cap the job returns to `queued` for
 * another worker; once attempts are exhausted it is terminally `failed`.
 *
 * `reason` is shown to the athlete, so pass a user-facing sentence — not a
 * stack trace.
 */
export async function fail(jobId: string, reason: string): Promise<Job | null> {
  const now = new Date();
  const release = { error: reason, workerId: null, leaseExpiresAt: null, runAfter: now, updatedAt: now };
  // Two conditional writes rather than a read-then-write: whichever filter
  // matches the current attempt count wins, and the other is a no-op.
  const exhausted = await jobs().findOneAndUpdate(
    { _id: jobId, attempts: { $gte: MAX_ATTEMPTS } },
    { $set: { status: "failed", ...release } },
    { returnDocument: "after", projection: JOB_PROJECTION },
  );
  if (exhausted) return toJob(exhausted);

  const retried = await jobs().findOneAndUpdate(
    { _id: jobId, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: "queued", progress: 0, framesDone: 0, ...release } },
    { returnDocument: "after", projection: JOB_PROJECTION },
  );
  return retried ? toJob(retried) : null;
}

/**
 * Strava said 429. That is not the job's fault, so the attempt is given back:
 * `attempts` is decremented to undo the increment `claim` made, and the job
 * waits out `retryAfterSeconds` before becoming claimable again.
 */
export async function requeueForRateLimit(
  jobId: string,
  retryAfterSeconds: number,
): Promise<Job | null> {
  const doc = await jobs().findOneAndUpdate(
    { _id: jobId },
    [
      {
        $set: {
          status: "queued",
          attempts: { $max: [{ $subtract: ["$attempts", 1] }, 0] },
          workerId: null,
          leaseExpiresAt: null,
          runAfter: secondsFromNow(retryAfterSeconds),
          error: null,
          updatedAt: new Date(),
        },
      },
    ],
    { returnDocument: "after", projection: JOB_PROJECTION },
  );
  return doc ? toJob(doc) : null;
}

export async function getJob(jobId: string): Promise<Job | null> {
  const doc = await jobs().findOne({ _id: jobId }, { projection: JOB_PROJECTION });
  return doc ? toJob(doc) : null;
}

export async function listJobsForAthlete(athleteId: string): Promise<Job[]> {
  const docs = await jobs()
    .find({ athleteId }, { projection: JOB_PROJECTION })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toJob);
}

/** The keyframes/stats/route the worker persisted, for the /render payload. */
export interface JobArtifacts {
  keyframes: CameraKeyframe[] | null;
  stats: ActivityStats | null;
  route: LngLat[] | null;
}

export async function getJobArtifacts(jobId: string): Promise<JobArtifacts | null> {
  const doc = await jobs().findOne(
    { _id: jobId },
    { projection: { keyframes: 1, stats: 1, route: 1 } },
  );
  if (!doc) return null;
  return { keyframes: doc.keyframes ?? null, stats: doc.stats ?? null, route: doc.route ?? null };
}

export type { Job, JobStatus };
