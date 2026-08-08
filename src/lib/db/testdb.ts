/**
 * Test-only helper: decides whether a real Postgres is reachable and prepares a
 * clean schema. Imported by the db/jobs integration suites, which skip
 * themselves (loudly) rather than pretend to pass when there is no database.
 */
import { Client } from "pg";

import { migrate } from "./migrate";
import { closePool, query } from "./pool";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55432/stravinator_test?sslmode=disable";

let checked: boolean | undefined;

/** True if TEST_DATABASE_URL accepts a connection. Result is cached. */
export async function postgresAvailable(): Promise<boolean> {
  if (checked !== undefined) return checked;
  const client = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    checked = true;
  } catch {
    console.warn(
      `\n[db tests] SKIPPED: no Postgres at ${TEST_DATABASE_URL}.\n` +
        "  Start one, e.g.:\n" +
        "    docker run -d --name stravinator-pg -e POSTGRES_PASSWORD=postgres \\\n" +
        "      -e POSTGRES_DB=stravinator_test -p 55432:5432 postgres:16-alpine\n" +
        "  or set TEST_DATABASE_URL to an existing database.\n",
    );
    checked = false;
  }
  return checked;
}

/**
 * Points the shared pool at the test database and applies all migrations.
 *
 * Each suite gets its own Postgres schema so vitest can run test files in
 * parallel without one file's TRUNCATE wiping another's fixtures.
 */
export async function setupTestDb(schema = "public"): Promise<void> {
  if (schema !== "public") {
    const admin = new Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  await migrate();
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe schema name: ${name}`);
  return `"${name}"`;
}

export async function truncateAll(): Promise<void> {
  await query("TRUNCATE jobs, invites, athletes RESTART IDENTITY CASCADE");
}

export async function teardownTestDb(): Promise<void> {
  await closePool();
}

let athleteSeq = 0;

/** Jobs need a real athlete row (FK), so tests mint one per call. */
export async function seedAthlete(): Promise<string> {
  const id = `athlete-${++athleteSeq}-${Math.random().toString(36).slice(2, 8)}`;
  await query(
    `INSERT INTO athletes (id, name, avatar_url, access_token, refresh_token, token_expires_at)
     VALUES ($1, 'Test Athlete', NULL, 'access', 'refresh', now() + interval '6 hours')`,
    [id],
  );
  return id;
}

/** Forces a job's lease into the past, simulating a crashed worker. */
export async function expireLease(jobId: string): Promise<void> {
  await query("UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [
    jobId,
  ]);
}

export async function readLease(jobId: string): Promise<Date | null> {
  const { rows } = await query<{ lease_expires_at: Date | null }>(
    "SELECT lease_expires_at FROM jobs WHERE id = $1",
    [jobId],
  );
  return rows[0]?.lease_expires_at ?? null;
}

export async function readRunAfter(jobId: string): Promise<Date> {
  const { rows } = await query<{ run_after: Date }>("SELECT run_after FROM jobs WHERE id = $1", [
    jobId,
  ]);
  return rows[0].run_after;
}
