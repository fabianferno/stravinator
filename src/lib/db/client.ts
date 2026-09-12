import { MongoClient, type Collection, type Db } from "mongodb";
import type { ActivityStats, CameraKeyframe, JobStatus, LngLat } from "@/lib/types";

/**
 * Next.js dev recompiles modules on every edit, which would otherwise leak a new
 * MongoClient (and its sockets) per reload. Cache the client on globalThis so
 * hot reload reuses one.
 */
const GLOBAL_KEY = Symbol.for("stravinator.mongo.client");

type Holder = { [GLOBAL_KEY]?: { client: MongoClient; uri: string; dbName: string } };

/** Database name; the URI's path segment wins, then MONGODB_DB, then this. */
const DEFAULT_DB = "stravinator";

export interface AthleteDoc {
  /** Strava's numeric athlete id, kept as text so it never overflows a JS number. */
  _id: string;
  name: string;
  avatarUrl: string | null;
  accessToken: string;
  /** Strava ROTATES the refresh token on every refresh: the new one must be persisted. */
  refreshToken: string;
  tokenExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobDoc {
  _id: string;
  athleteId: string;
  activityId: string;
  status: JobStatus;
  progress: number;
  framesDone: number;
  frameCount: number;
  error: string | null;
  videoUrl: string | null;

  // queue bookkeeping
  attempts: number;
  workerId: string | null;
  leaseExpiresAt: Date | null;
  /** earliest time this job may be claimed; used for rate-limit backoff */
  runAfter: Date;

  // pipeline artifacts, persisted with the job (spec §5.5)
  keyframes: CameraKeyframe[] | null;
  stats: ActivityStats | null;
  route: LngLat[] | null;

  createdAt: Date;
  updatedAt: Date;
}

function resolve(): { uri: string; dbName: string } {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const path = new URL(uri).pathname.replace(/^\//, "");
  return { uri, dbName: path || process.env.MONGODB_DB || DEFAULT_DB };
}

export function getClient(): MongoClient {
  const holder = globalThis as unknown as Holder;
  const { uri, dbName } = resolve();
  const existing = holder[GLOBAL_KEY];
  if (existing && existing.uri === uri && existing.dbName === dbName) return existing.client;
  // The target changed underneath us (tests do this per suite): drop the old
  // client rather than keep talking to the wrong database.
  if (existing) void existing.client.close();

  const client = new MongoClient(uri, {
    maxPoolSize: Number(process.env.MONGO_POOL_MAX ?? 10),
    // Long enough to ride out a DNS or connection blip to Atlas mid-render;
    // the driver's retryable reads/writes handle the individual operations.
    serverSelectionTimeoutMS: 30_000,
  });
  holder[GLOBAL_KEY] = { client, uri, dbName };
  return client;
}

export function getDb(): Db {
  return getClient().db(resolve().dbName);
}

export const athletes = (): Collection<AthleteDoc> => getDb().collection<AthleteDoc>("athletes");
export const jobs = (): Collection<JobDoc> => getDb().collection<JobDoc>("jobs");

/**
 * Creates the indexes the queue relies on. Idempotent; run it on deploy
 * (`npm run migrate`) and before the integration suites.
 */
export async function ensureIndexes(): Promise<void> {
  // The claim query filters on status/runAfter/leaseExpiresAt and orders by createdAt.
  await jobs().createIndex({ status: 1, createdAt: 1 }, { name: "jobs_status_created_at_idx" });
  await jobs().createIndex({ athleteId: 1, createdAt: -1 }, { name: "jobs_athlete_created_at_idx" });
}

export async function closeDb(): Promise<void> {
  const holder = globalThis as unknown as Holder;
  const existing = holder[GLOBAL_KEY];
  if (!existing) return;
  delete holder[GLOBAL_KEY];
  await existing.client.close();
}
