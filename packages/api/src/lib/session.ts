/**
 * Server-side session rows and the profile binding they carry.
 *
 * The token in a cookie or bearer header is the credential; the row here is
 * what makes it revocable. Only the SHA-256 hash of the token is stored, so
 * a database dump cannot be replayed as live sessions.
 *
 * **Every session acts as exactly one profile.** The browser acts as the
 * account's human profile; a CLI/MCP session acts as whichever profile was
 * chosen at the loopback consent step. Authorization is derived from that
 * binding — see `resolveProfileAccess` in ./middleware.ts.
 */

import { and, eq, gt } from "drizzle-orm";

import { accounts, profiles, sessions, type ProfileType } from "../db/index.js";
import { SESSION_TTL_SECONDS } from "./auth.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";

/** SHA-256 hex digest via WebCrypto — available in Node 20 and on Lambda. */
export async function hashSessionToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Persist the session row for a just-minted token. Call immediately after
 * `signSessionToken` so the credential is backed by a row before the next
 * request lands.
 */
export async function createSessionRow(input: {
  profileId: string;
  token: string;
  /** Human-readable device label for a connected-devices view. */
  deviceLabel?: string | null;
}): Promise<void> {
  const db = getDb();
  const tokenHash = await hashSessionToken(input.token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    profileId: input.profileId,
    tokenHash,
    expiresAt,
    deviceLabel: input.deviceLabel ?? null,
  });
}

/**
 * The authenticated caller: which profile this session acts as, and which
 * account that profile belongs to. Handlers read `session.profile.id` as the
 * owner of anything they create.
 */
export interface AuthenticatedSession {
  sessionId: string;
  account: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    accountId: string;
    type: ProfileType;
    name: string;
    preferredLocale: SupportedLocale;
  };
}

/**
 * Resolve a token to its session, or null for any failure (missing row,
 * expired row, deleted profile). Callers must treat null as
 * "unauthenticated" without surfacing which — distinguishing "expired" from
 * "revoked" is rarely useful and slightly fingerprintable.
 */
export async function lookupSession(token: string): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const db = getDb();

  const rows = await db
    .select({
      sessionId: sessions.id,
      profileId: profiles.id,
      profileType: profiles.type,
      profileName: profiles.name,
      preferredLocale: profiles.preferredLocale,
      accountId: accounts.id,
      accountEmail: accounts.email,
    })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0]!;

  // Best-effort touch; a write failure here must not turn a successful read
  // into a 500.
  void db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.sessionId))
    .catch(() => {
      // swallow: lastSeenAt is informational only
    });

  return {
    sessionId: row.sessionId,
    account: { id: row.accountId, email: row.accountEmail },
    profile: {
      id: row.profileId,
      accountId: row.accountId,
      type: row.profileType,
      name: row.profileName,
      preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    },
  };
}

/**
 * Delete the session row backing a token. Idempotent — returns false when
 * there was nothing to remove (already logged out, stale cookie).
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
