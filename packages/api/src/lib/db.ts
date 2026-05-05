/**
 * Lazy Drizzle client.
 *
 * We instantiate a single `postgres` connection pool and Drizzle instance the
 * first time they are requested, then reuse them for the lifetime of the
 * process. On Lambda, this means the same client survives across warm
 * invocations of the same container (which is what we want — connection
 * setup against Neon over TLS is the slowest part of cold start).
 *
 * Why `postgres` (the `postgres.js` driver) rather than `pg`?
 *   - Native `Uint8Array` / `bigint` support without manual parser tweaks.
 *   - Smaller bundle, faster cold starts.
 *   - `drizzle-orm/postgres-js` is the path drizzle-kit uses in our config.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/index.js";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Read the Neon connection string. We accept the same env name used by
 * drizzle-kit (DB_CONNECTION_URL) so local `tsx` runs and Lambda runs share
 * the same configuration surface. Throws loudly if missing — failing fast
 * on misconfiguration is better than silently writing to the wrong place.
 */
function getConnectionString(): string {
  const url = process.env.DB_CONNECTION_URL;
  if (!url) {
    throw new Error(
      "DB_CONNECTION_URL is not set. Configure it in .env or via the SST Resource binding before opening a DB connection.",
    );
  }
  return url;
}

/**
 * Return the singleton Drizzle client. Safe to call from any handler — the
 * pool is created at most once per process.
 */
export function getDb() {
  if (cachedDb) return cachedDb;

  // `prepare: false` keeps the driver compatible with Neon's pgbouncer
  // pooler in transaction mode. Lambda never reuses a single connection
  // long enough for prepared-statement caching to pay off anyway.
  const sql = postgres(getConnectionString(), {
    prepare: false,
    // 1 connection is plenty inside a single Lambda invocation; Neon's
    // pooler handles fan-in across concurrent invocations for us.
    max: 1,
  });

  cachedDb = drizzle(sql, { schema });
  return cachedDb;
}
