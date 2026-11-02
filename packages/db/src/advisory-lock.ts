import type { Pool } from "pg";

/**
 * Runs `fn` while holding a Postgres session advisory lock, so workers on different
 * instances serialize work that has one shared row (a user's memory, for example).
 * The lock lives on one checked-out connection, so it is taken and released on that
 * connection even when `fn` uses a different client.
 */
export async function withPostgresAdvisoryLock<T>(
  pool: Pool,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}