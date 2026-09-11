/**
 * Test-only helper: decides whether a MongoDB is reachable and prepares a
 * clean database. Imported by the db/jobs integration suites, which skip
 * themselves (loudly) rather than pretend to pass when there is no database.
 */
import { MongoClient } from "mongodb";

import { athletes, closeDb, ensureIndexes, getDb, jobs } from "./client";

export const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017";

let checked: boolean | undefined;

/** True if TEST_MONGODB_URI accepts a connection. Result is cached. */
export async function mongoAvailable(): Promise<boolean> {
  if (checked !== undefined) return checked;
  const client = new MongoClient(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.db("admin").command({ ping: 1 });
    checked = true;
  } catch {
    console.warn(
      `\n[db tests] SKIPPED: no MongoDB at ${TEST_MONGODB_URI.replace(/\/\/.*@/, "//<redacted>@")}.\n` +
        "  Start one, e.g.:\n" +
        "    docker run -d --name stravinator-mongo -p 27017:27017 mongo:7\n" +
        "  or set TEST_MONGODB_URI (or MONGODB_URI) to an existing deployment.\n",
    );
    checked = false;
  } finally {
    await client.close();
  }
  return checked;
}

/**
 * Points the shared client at a throwaway database and creates the indexes.
 *
 * Each suite gets its own database so vitest can run test files in parallel
 * without one file's cleanup wiping another's fixtures.
 */
export async function setupTestDb(name: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe database name: ${name}`);
  process.env.MONGODB_URI = TEST_MONGODB_URI;
  process.env.MONGODB_DB = `stravinator_${name}`;
  await getDb().dropDatabase();
  await ensureIndexes();
}

export async function truncateAll(): Promise<void> {
  await Promise.all([jobs().deleteMany({}), athletes().deleteMany({})]);
}

export async function teardownTestDb(): Promise<void> {
  await getDb().dropDatabase();
  await closeDb();
}

let athleteSeq = 0;

/** Jobs belong to an athlete, so tests mint one per call. */
export async function seedAthlete(): Promise<string> {
  const id = `athlete-${++athleteSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  await athletes().insertOne({
    _id: id,
    name: "Test Athlete",
    avatarUrl: null,
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: new Date(now.getTime() + 6 * 3600 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Forces a job's lease into the past, simulating a crashed worker. */
export async function expireLease(jobId: string): Promise<void> {
  await jobs().updateOne({ _id: jobId }, { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } });
}

export async function readLease(jobId: string): Promise<Date | null> {
  const doc = await jobs().findOne({ _id: jobId }, { projection: { leaseExpiresAt: 1 } });
  return doc?.leaseExpiresAt ?? null;
}

export async function readRunAfter(jobId: string): Promise<Date> {
  const doc = await jobs().findOne({ _id: jobId }, { projection: { runAfter: 1 } });
  if (!doc) throw new Error(`no job ${jobId}`);
  return doc.runAfter;
}
