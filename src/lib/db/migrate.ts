import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPool, closePool } from "./pool";

/** Repo-root `migrations/`, resolved relative to this file (src/lib/db). */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

export interface AppliedMigration {
  name: string;
  appliedAt: Date;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  // Lexical order is the migration order; that's why files are zero-padded.
  return entries.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Forward-only migration runner. Each pending file runs inside its own
 * transaction together with its bookkeeping row, so a failure leaves the
 * database exactly as it was before that file.
 *
 * @returns the names of the migrations applied by this call, in order.
 */
export async function migrate(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const pool = getPool();
  await pool.query(CREATE_TABLE);

  const files = await listMigrationFiles(dir);
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return ran;
}

export async function appliedMigrations(): Promise<AppliedMigration[]> {
  const { rows } = await getPool().query<{ name: string; applied_at: Date }>(
    "SELECT name, applied_at FROM schema_migrations ORDER BY name",
  );
  return rows.map((r) => ({ name: r.name, appliedAt: r.applied_at }));
}

/** CLI entry: `npm run migrate`. */
export async function main(): Promise<void> {
  try {
    const ran = await migrate();
    if (ran.length === 0) console.log("[migrate] up to date");
    else for (const name of ran) console.log(`[migrate] applied ${name}`);
  } finally {
    await closePool();
  }
}

const stripExt = (p: string) => p.replace(/\.[tj]s$/, "");
const invokedDirectly =
  process.argv[1] !== undefined &&
  stripExt(path.resolve(process.argv[1])) === stripExt(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
