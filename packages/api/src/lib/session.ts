/**
 * Server-side session row management.
 *
 * Where this fits
 * ---------------
 * `lib/auth.ts` mints a JWT (the cookie value) and hands it back to the
 * route. This module is what makes that JWT *revocable*: every time a JWT
 * is issued we also persist a row in the `sessions` table keyed by the
 * SHA-256 hash of the JWT. The auth middleware looks up that row on every
 * request and treats "no row" / "expired row" the same as "not logged in".
 * `POST /auth/logout` simply deletes the row, which renders the JWT inert
 * even though it is still cryptographically valid.
 *
 * Why hash the token?
 *   A leaked DB dump must NOT be replayable as live sessions. We store
 *   only the hash; the only place the plaintext token lives is the
 *   browser's cookie jar.
 *
 * Why a separate module from auth.ts?
 *   auth.ts is "pure" primitives (no DB). Routes/middleware compose this
 *   module on top so a unit test can stub one half without booting the
 *   other. It also keeps the diff for Sub-AC 4 small and reviewable.
 */

import { and, eq, gt } from "drizzle-orm";

import { sessions, users } from "../db/index.js";
import { SESSION_TTL_SECONDS } from "./auth.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";

/**
 * SHA-256 hex digest of an opaque string. Web Crypto is available in every
 * runtime we target (Lambda Node 20, vitest, sst dev) so we avoid `node:crypto`
 * to keep this file isomorphic with the (unlikely-but-cheap) edge runtime.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Persist a server-side session row for the just-minted JWT. Call this
 * immediately after `signSessionToken` so the cookie the user gets is
 * already backed by a row when their next request lands.
 *
 * `expiresAt` is set to NOW + SESSION_TTL_SECONDS so we don't have to
 * decode the JWT to check expiry on every read — a cheap timestamp
 * comparison in Postgres does it for us.
 */
export async function createSessionRow(input: {
  userId: string;
  token: string;
  /**
   * Client kind minting this session. Defaults to "web" (browser flows);
   * the CLI loopback exchange passes "cli" so downstream writes can record
   * unforgeable provenance (see `signals.source`).
   */
  client?: SessionClient;
}): Promise<void> {
  const db = getDb();
  const tokenHash = await hashSessionToken(input.token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    userId: input.userId,
    tokenHash,
    expiresAt,
    client: input.client ?? "web",
  });
}

/**
 * Shape returned to authenticated handlers / middleware. Mirrors the
 * subset of the user row we want to expose without leaking
 * password_hash, google_sub, etc.
 */
/**
 * Kind of client a session belongs to. "web" covers every browser flow
 * (password + Google OAuth); "cli" is the waka-mcp loopback exchange.
 * Stored on `sessions.client` and surfaced per-request so handlers can
 * derive provenance without a second lookup.
 */
export type SessionClient = "web" | "cli";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  preferredLocale: SupportedLocale;
  onboardingCompletedAt: Date | null;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
  /** Which client kind minted the session behind this request. */
  sessionClient: SessionClient;
}

/**
 * Look up the user behind a session token.
 *
 *  - Hashes the token, joins sessions → users in one round-trip, and
 *    filters to live sessions only (`expires_at > now()`).
 *  - Returns `null` for ANY failure mode (missing row, expired row,
 *    deleted user). The caller MUST treat this as "unauthenticated"
 *    without surfacing the reason — leaking "your session expired" vs
 *    "your session was revoked" is rarely useful and slightly fingerprintable.
 *  - Best-effort updates `last_seen_at` so a future "active devices" UI
 *    has accurate timestamps. We don't await/block on the failure of that
 *    update — it is purely informational.
 */
export async function lookupSessionUser(
  token: string,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const db = getDb();

  const rows = await db
    .select({
      sessionId: sessions.id,
      sessionClient: sessions.client,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      preferredLocale: users.preferredLocale,
      onboardingCompletedAt: users.onboardingCompletedAt,
      publicHandle: users.publicHandle,
      publicProfileEnabled: users.publicProfileEnabled,
      publicTopOfMindEnabled: users.publicTopOfMindEnabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0]!;

  // Best-effort touch. We deliberately do not `await` errors — a write
  // failure here must not turn a successful read into a 500.
  void db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.sessionId))
    .catch(() => {
      // swallow: lastSeenAt is informational only
    });

  return {
    id: row.userId,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    onboardingCompletedAt: row.onboardingCompletedAt,
    publicHandle: row.publicHandle,
    publicProfileEnabled: row.publicProfileEnabled,
    publicTopOfMindEnabled: row.publicTopOfMindEnabled,
    // Anything unexpected in the column degrades to "web" — the safe,
    // pre-existing meaning — rather than crashing the auth path.
    sessionClient: row.sessionClient === "cli" ? "cli" : "web",
  };
}

/**
 * Delete the session row backing a token. Idempotent: deleting a row that
 * does not exist (already-logged-out, never-existed) is a no-op and
 * returns false. Returns true when at least one row was actually removed,
 * which the route handler can use to differentiate "real logout" from
 * "stale cookie cleanup" if it ever wants to.
 */
export async function revokeSessionByToken(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await hashSessionToken(token);
  const db = getDb();

  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .returning({ id: sessions.id });

  return deleted.length > 0;
}
