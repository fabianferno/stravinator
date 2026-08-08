import { query, withTransaction } from "@/lib/db/pool";
import type { ActivityStats, CameraKeyframe, Job, JobStatus, LngLat } from "@/lib/types";

/** Crashed-worker retries are capped so a poison job cannot spin forever. */
export const MAX_ATTEMPTS = 3;

/** Lease length a worker takes by default; heartbeats extend it. */
export const DEFAULT_LEASE_SECONDS = 120;

/** Columns selected for every row that becomes a `Job`. */
const JOB_COLUMNS = `
  id, athlete_id, activity_id, status, progress, frames_done, frame_count,
  error, video_url, attempts, created_at, updated_at
`;

interface JobRow {
  id: string;
  athlete_id: string;
  activity_id: string;
  status: JobStatus;
  progress: string | number;
  frames_done: number;
  frame_count: number;
  error: string | null;
  video_url: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    activityId: row.activity_id,
    status: row.status,
    progress: Number(row.progress),
    framesDone: row.frames_done,
    frameCount: row.frame_count,
    error: row.error,
    videoUrl: row.video_url,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueue(athleteId: string, activityId: string): Promise<Job> {
  const { rows } = await query<JobRow>(
    `INSERT INTO jobs (athlete_id, activity_id, status)
     VALUES ($1, $2, 'queued')
     RETURNING ${JOB_COLUMNS}`,
    [athleteId, activityId],
  );
  return toJob(rows[0]);
}

/**
 * Atomically take one job for `workerId`, holding it for `leaseSeconds`.
 *
 * Claimable means: `queued` and past its backoff, OR in a mid-flight status
 * whose lease has expired — that second arm is what makes a crashed worker's
 * job recoverable. `FOR UPDATE SKIP LOCKED` lets concurrent workers pass over
 * each other's locked rows instead of serialising or double-claiming.
 */
export async function claim(workerId: string, leaseSeconds: number): Promise<Job | null> {
  return withTransaction(async (client) => {
    const { rows: candidates } = await client.query<{ id: string }>(
      `SELECT id FROM jobs
        WHERE (status = 'queued' AND run_after <= now())
           OR (status NOT IN ('queued', 'done', 'failed')
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= now())
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    if (candidates.length === 0) return null;

    const { rows } = await client.query<JobRow>(
      `UPDATE jobs
          SET status = 'fetching',
              worker_id = $2,
              attempts = attempts + 1,
              lease_expires_at = now() + make_interval(secs => $3::double precision),
              error = NULL,
              updated_at = now()
        WHERE id = $1
        RETURNING ${JOB_COLUMNS}`,
      [candidates[0].id, workerId, leaseSeconds],
    );
    return toJob(rows[0]);
  });
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
  const { rowCount } = await query(
    `UPDATE jobs
        SET lease_expires_at = now() + make_interval(secs => $3::double precision),
            updated_at = now()
      WHERE id = $1 AND worker_id = $2 AND status NOT IN ('queued', 'done', 'failed')`,
    [jobId, workerId, leaseSeconds],
  );
  return (rowCount ?? 0) > 0;
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
  const sets = ["status = $2", "updated_at = now()"];
  const params: unknown[] = [jobId, status];

  const push = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.progress !== undefined) push("progress", patch.progress);
  if (patch.framesDone !== undefined) push("frames_done", patch.framesDone);
  if (patch.frameCount !== undefined) push("frame_count", patch.frameCount);
  if (patch.keyframes !== undefined) push("keyframes", JSON.stringify(patch.keyframes));
  if (patch.stats !== undefined) push("stats", JSON.stringify(patch.stats));
  if (patch.route !== undefined) push("route", JSON.stringify(patch.route));

  const { rows } = await query<JobRow>(
    `UPDATE jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
    params,
  );
  return rows[0] ? toJob(rows[0]) : null;
}

/** Marks the job done and releases the lease. */
export async function complete(jobId: string, videoUrl: string): Promise<Job | null> {
  const { rows } = await query<JobRow>(
    `UPDATE jobs
        SET status = 'done', video_url = $2, progress = 1, error = NULL,
            worker_id = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1
      RETURNING ${JOB_COLUMNS}`,
    [jobId, videoUrl],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

/**
 * Records a failure. Under the attempt cap the job returns to `queued` for
 * another worker; once attempts are exhausted it is terminally `failed`.
 *
 * `reason` is shown to the athlete, so pass a user-facing sentence — not a
 * stack trace.
 */
export async function fail(jobId: string, reason: string): Promise<Job | null> {
  const { rows } = await query<JobRow>(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
            error = $2,
            progress = CASE WHEN attempts >= $3 THEN progress ELSE 0 END,
            frames_done = CASE WHEN attempts >= $3 THEN frames_done ELSE 0 END,
            worker_id = NULL,
            lease_expires_at = NULL,
            run_after = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING ${JOB_COLUMNS}`,
    [jobId, reason, MAX_ATTEMPTS],
  );
  return rows[0] ? toJob(rows[0]) : null;
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
  const { rows } = await query<JobRow>(
    `UPDATE jobs
        SET status = 'queued',
            attempts = GREATEST(attempts - 1, 0),
            worker_id = NULL,
            lease_expires_at = NULL,
            run_after = now() + make_interval(secs => $2::double precision),
            error = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING ${JOB_COLUMNS}`,
    [jobId, retryAfterSeconds],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function getJob(jobId: string): Promise<Job | null> {
  const { rows } = await query<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`, [jobId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobsForAthlete(athleteId: string): Promise<Job[]> {
  const { rows } = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE athlete_id = $1 ORDER BY created_at DESC`,
    [athleteId],
  );
  return rows.map(toJob);
}

/** The keyframes/stats/route the worker persisted, for the /render payload. */
export interface JobArtifacts {
  keyframes: CameraKeyframe[] | null;
  stats: ActivityStats | null;
  route: LngLat[] | null;
}

export async function getJobArtifacts(jobId: string): Promise<JobArtifacts | null> {
  const { rows } = await query<JobArtifacts>(
    "SELECT keyframes, stats, route FROM jobs WHERE id = $1",
    [jobId],
  );
  if (!rows[0]) return null;
  return { keyframes: rows[0].keyframes, stats: rows[0].stats, route: rows[0].route };
}

export type { Job, JobStatus };
