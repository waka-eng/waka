/**
 * Drizzle ORM runtime client.
 *
 * Builds a single Drizzle instance bound to the existing Neon Postgres
 * database, using the postgres-js driver. Every server-side caller (Hono
 * handlers, DB-backed background worker, vitest suite) imports `db` from this module —
 * we never instantiate the client inline. Centralizing the connection here
 * gives us:
 *
 *   - one Postgres pool per Lambda container (warm reuse across invocations)
 *   - a single place to thread the full Drizzle schema (relational queries)
 *   - a single place to read the connection URL from the environment
 *
 * Environment:
 *   The connection string is read from DB_CONNECTION_URL (project convention,
 *   matches drizzle.config.ts and .env). DATABASE_URL is also accepted as a
 *   fallback so the same module works under tooling that only sets the
 *   conventional name.
 *
 * Lambda notes:
 *   - We cap connections to 1 per process. Each Lambda execution environment
 *     is single-threaded for our purposes, and Neon's pooler endpoint already
 *     handles fan-out across many Lambda containers. A larger client-side
 *     pool would just burn idle connections.
 *   - `prepare: false` disables postgres-js prepared-statement caching. Neon's
 *     pooler is in transaction mode, which does not retain server-side
 *     prepared statements across pooled connections. Leaving prepare on would
 *     produce intermittent "prepared statement does not exist" errors.
 *   - `idle_timeout: 20` lets the socket close before Lambda freezes the
 *     container, avoiding stale-TCP errors on the next warm invoke.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./index";

/**
 * Resolve the Neon connection string from the environment.
 *
 * Throws at module load (not at first query) so misconfiguration surfaces
 * immediately during cold start instead of as an opaque NPE later.
 */
function resolveConnectionString(): string {
  const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DB_CONNECTION_URL (or DATABASE_URL) is not set. " +
        "Configure it in .env (local) or via SST Resource bindings (deployed).",
    );
  }
  return url;
}

/**
 * Module-level singleton. In Lambda, top-level `let` survives across warm
 * invocations of the same execution environment, giving us free connection
 * reuse without any per-handler bookkeeping.
 *
 * In dev (vitest, sst dev), the module is loaded once per process and the
 * same singleton is used until the process exits.
 */
let _sql: ReturnType<typeof postgres> | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(resolveConnectionString(), {
      // See block comment above re: Neon pooler + Lambda lifecycle.
      max: 1,
      prepare: false,
      idle_timeout: 20,
      // Neon requires TLS; the connection string already encodes
      // sslmode=require, but we set ssl explicitly so postgres-js does not
      // downgrade if the URL is rewritten by tooling.
      ssl: "require",
    });
  }
  return _sql;
}

/**
 * The Drizzle client. Pass the full schema barrel so `db.query.<table>` and
 * relational helpers work everywhere.
 *
 * Usage:
 *   import { db } from "@/db/client";
 *   const rows = await db.select().from(inspirations).where(...);
 */
export const db: ReturnType<typeof drizzle<typeof schema>> = (() => {
  if (!_db) {
    _db = drizzle(getSql(), { schema });
  }
  return _db;
})();

/**
 * Escape hatch for code that needs the raw postgres-js tag (e.g. ad-hoc
 * SQL-template diagnostics in tests). Prefer `db` for everything else.
 */
export const sqlClient: ReturnType<typeof postgres> = getSql();

/**
 * Gracefully tear down the underlying socket. Mostly useful for vitest's
 * afterAll hook so the test process can exit promptly. Lambda never calls
 * this — the runtime tears the container down for us.
 */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
    _db = undefined;
  }
}
