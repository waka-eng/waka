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
 * IS THIS DATABASE ON THIS MACHINE?
 *
 * The one question the TLS rule below turns on, and it is asked of the host
 * rather than of an environment name, because "am I in production" is a fact
 * the code can be lied to about and "is the socket leaving this box" is not.
 *
 * A unix socket path counts as local: the bytes never reach a network
 * interface, so there is nothing for TLS to protect. So does an absent
 * hostname — `postgres:///waka` and a bare `postgres://` resolve to localhost
 * in the driver, and a rule that guessed differently from the driver would be
 * guarding a connection that was never made.
 *
 * `::1` is spelled `[::1]` inside a URL, and `URL.hostname` hands back the
 * brackets, so both forms are listed. IPv6 loopback is the whole `::1/128`
 * block and only one address of it is named here — that is deliberate: the
 * list is what we are willing to exempt, not a parser for what loopback could
 * mean, and anything exotic enough to need more is better off being refused
 * and discussed.
 */
function isLocalHost(connectionString: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    /* Unparseable as a URL — the driver will reject it far more informatively
       than we can. Not local, so TLS is still required of it: an unreadable
       connection string is not a reason to relax the rule. */
    return false;
  }
  /* `URL` leaves a socket directory percent-encoded (`%2Fvar%2Frun%2F...`),
     which is how the driver is handed one — it decodes the host itself. Decode
     before looking for the separator, or a socket path reads as a hostname
     and gets TLS demanded of a connection that has no network to protect. */
  let decoded = hostname;
  try {
    decoded = decodeURIComponent(hostname);
  } catch {
    /* A stray `%` is not a socket path; judge the raw form. */
  }
  if (decoded === "" || decoded.includes("/")) return true;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(decoded.toLowerCase());
}

/**
 * TLS IS NOW A PROPERTY OF THE CODE, NOT OF THE DEPLOYMENT.
 *
 * The driver's default is `ssl: false`, and nothing here used to override it.
 * What kept production encrypted was the `?sslmode=require` on the Neon URL in
 * an SST secret — a string in a dashboard, one careless paste away from a
 * cleartext session carrying every inspiration, signal, and password hash the
 * account has. The failure is silent in the worst way: the connection works,
 * the app is fine, and the only evidence is on the wire. Nothing in the suite
 * could have noticed, because the suite connects to 127.0.0.1.
 *
 * So the rule moves into the code, where it can be read and tested: a
 * connection to any host that is not this machine is encrypted or it is not
 * made. Setting `ssl` in the options rather than rewriting the URL is what
 * makes it a rule — the driver prefers an explicit option over the URL's
 * `sslmode` (see `parseOptions`), so a URL that forgot TLS is upgraded instead
 * of obeyed.
 *
 * AND A URL THAT ASKS FOR CLEARTEXT IS AN ERROR, not something to quietly
 * overrule. `sslmode=disable` against a remote host is somebody's intent,
 * written down; honouring it leaks, and silently inverting it means the next
 * person debugging "why is TLS on, I turned it off" finds no answer anywhere.
 * Throwing puts the contradiction in front of whoever can resolve it.
 *
 * A stronger mode in the URL is left alone. `verify-full` checks the
 * certificate chain and hostname, which is more than this demands and
 * precisely the kind of tightening an operator should be able to do without
 * editing code. `require` is the floor, not the ceiling. The return type names
 * only the two the driver itself distinguishes — `verify-ca` and anything else
 * collapse to the floor rather than being passed through as a string the
 * driver would compare against nothing and treat as plain truthy, which looks
 * like honouring the setting while doing less than it says.
 *
 * THE LOCAL EXEMPTION, stated plainly because it is the part that will look
 * like a hole in a later audit: localhost and 127.0.0.1 connect without TLS.
 * The whole test suite and every local dev run talk to a Postgres on the same
 * machine with no certificate, and there is no attacker on a loopback
 * interface that TLS would keep out — anything that can read it already runs
 * as you. Requiring TLS there would buy nothing and would make the suite
 * unrunnable, which is how a security rule gets commented out wholesale
 * instead of narrowed.
 */
export function requiredTlsMode(connectionString: string): false | "require" | "verify-full" {
  if (isLocalHost(connectionString)) return false;

  let sslmode: string | null = null;
  try {
    const params = new URL(connectionString).searchParams;
    sslmode = params.get("sslmode") ?? params.get("ssl");
  } catch {
    /* isLocalHost already decided an unparseable string is remote. */
  }

  if (sslmode === "disable" || sslmode === "false") {
    throw new Error(
      "DB_CONNECTION_URL disables TLS for a host that is not this machine. " +
        "A remote Postgres connection carries every inspiration, signal, and " +
        "password hash in the account, so it is encrypted or it is not made. " +
        "Remove sslmode=disable, or point the URL at localhost.",
    );
  }

  /* An explicitly stronger mode is the operator's to choose; `require` is the
     floor this function exists to guarantee. */
  return sslmode === "verify-full" ? "verify-full" : "require";
}

/**
 * Return the singleton Drizzle client. Safe to call from any handler — the
 * pool is created at most once per process.
 */
export function getDb() {
  if (cachedDb) return cachedDb;

  const configuredPoolMax = Number.parseInt(process.env.WAKA_DB_POOL_MAX ?? "", 10);
  const poolMax = Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? Math.min(configuredPoolMax, 10)
    : process.env.AWS_LAMBDA_FUNCTION_NAME
      ? 1
      : 5;

  // `prepare: false` keeps the driver compatible with Neon's pgbouncer
  // pooler in transaction mode. Lambda remains deliberately single-connection
  // to avoid multiplying connections across concurrent invocations. The local
  // monolith also runs the background worker, so it needs a small pool: with
  // max=1, a room pass serialized every page read behind its own DB work.
  const connectionString = getConnectionString();
  const sql = postgres(connectionString, {
    prepare: false,
    max: poolMax,
    // See `requiredTlsMode`: false for a database on this machine, TLS
    // demanded of every other one, and a throw for a URL that asked for
    // cleartext across a network.
    ssl: requiredTlsMode(connectionString),
  });

  cachedDb = drizzle(sql, { schema });
  return cachedDb;
}
