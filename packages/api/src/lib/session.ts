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

import { and, eq, gt, lt } from "drizzle-orm";

import { accounts, profiles, sessions, type ProfileType } from "../db/index.js";
import { SESSION_TTL_SECONDS } from "./auth.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";

const SESSION_ACTIVITY_INTERVAL_MS = 60_000;

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
/**
 * A short, honest name for the machine behind a browser login.
 *
 * The CLI flow names itself (a hostname, or `--device`); a browser cannot, so
 * this reads the coarsest facts out of the User-Agent — the browser family
 * and the platform — and stops there. It is a label for a person recognising
 * their own laptop in a list, not fingerprinting: no version, no build, and
 * anything unrecognised is simply "Browser" rather than a guess.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Browser";

  // Order matters: Edge and Chrome both claim Safari, Chrome claims Safari.
  const browser =
    /\bEdg\//.test(ua) ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(ua) ? "Opera"
    : /\bFirefox\//.test(ua) ? "Firefox"
    : /\bChrome\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : null;

  const platform =
    /\biPhone\b|\biPad\b|\biPod\b/.test(ua) ? "iOS"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? "macOS"
    : /\bWindows\b/.test(ua) ? "Windows"
    : /\bLinux\b/.test(ua) ? "Linux"
    : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "Browser";
}

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
  /**
   * Set only by a KEEPER KEY lookup (`waka_keeper_`, 2026-08-29): a standing
   * credential the person holds so their own MCP/CLI can keep and recall.
   * A scoped session reads and captures its OWN profile and does nothing
   * else — not the account's other profiles, not curation, not account
   * decisions. The browser session and the loopback login never set this,
   * so their powers are exactly what they were. Absent means unscoped.
   */
  keyScoped?: true;
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
      lastSeenAt: sessions.lastSeenAt,
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

  // Activity is informational: one touch per minute avoids a row write on
  // every poll or parallel page read. Authorization above is always fresh.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - SESSION_ACTIVITY_INTERVAL_MS);
  if (row.lastSeenAt < staleBefore) {
    void db
      .update(sessions)
      .set({ lastSeenAt: now })
      // Recheck in SQL so simultaneous stale reads only update the row once.
      .where(and(eq(sessions.id, row.sessionId), lt(sessions.lastSeenAt, staleBefore)))
      .catch(() => {
        // A best-effort activity write must not turn authentication into a 500.
      });
  }

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
