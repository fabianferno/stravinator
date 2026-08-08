import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Next.js dev recompiles modules on every edit, which would otherwise leak a new
 * Pool (and its sockets) per reload. Cache the pool on globalThis so hot reload
 * reuses one.
 */
const GLOBAL_KEY = Symbol.for("stravinator.pg.pool");

type PoolHolder = { [GLOBAL_KEY]?: Pool };

export function getPool(): Pool {
  const holder = globalThis as unknown as PoolHolder;
  const existing = holder[GLOBAL_KEY];
  if (existing) return existing;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  // Without a listener, an idle-client error crashes the process.
  pool.on("error", (err) => {
    console.error("[db] idle client error", err);
  });

  holder[GLOBAL_KEY] = pool;
  return pool;
}

function needsSsl(connectionString: string): boolean {
  if (/sslmode=disable/.test(connectionString)) return false;
  if (/sslmode=require/.test(connectionString)) return true;
  return /\.(neon\.tech|supabase\.co|render\.com|amazonaws\.com)/.test(connectionString);
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/** Runs `fn` inside a transaction, rolling back on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the connection is already broken; nothing useful to do
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Closes the cached pool. For tests and worker shutdown only. */
export async function closePool(): Promise<void> {
  const holder = globalThis as unknown as PoolHolder;
  const pool = holder[GLOBAL_KEY];
  if (!pool) return;
  delete holder[GLOBAL_KEY];
  await pool.end();
}
