/**
 * Hono auth middleware and the cross-profile access matrix.
 *
 * `requireAuth` resolves the caller's session in three steps: read the token
 * (bearer header wins over cookie), verify the JWT (cheap, no DB), then look
 * up the session row (revocation, and the profile binding). Both the verify
 * and the lookup are required: without the first, any random string costs a
 * database round-trip; without the second, nothing could be revoked before
 * its `exp`.
 *
 * The matrix below is the whole of "what may an agent do to my memory?".
 * It is enforced server-side, keyed only off facts the server controls —
 * the session's bound profile and the target's owner — so a caller cannot
 * talk its way into someone else's stack by asserting anything.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth.js";
import { type AuthenticatedSession, lookupSession } from "./session.js";

export interface AuthEnv {
  Variables: {
    session: AuthenticatedSession;
    sessionToken: string;
  };
}

/**
 * Bearer header first (server-to-server, waka-mcp), cookie second (the
 * browser). Null when neither is present, so the caller decides whether
 * absence is a 401 or a fall-through.
 */
function readToken(c: Context): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }

  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken && cookieToken.length > 0) return cookieToken;

  return null;
}

/** Shared by both middlewares so they cannot drift. */
async function resolveSessionFromToken(token: string): Promise<AuthenticatedSession | null> {
  const decoded = await verifySessionToken(token);
  if (!decoded?.sub) return null;
  return lookupSession(token);
}

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = readToken(c);
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const session = await resolveSessionFromToken(token);
  if (!session) {
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("session", session);
  c.set("sessionToken", token);
  await next();
};

/**
 * THIS IS A PERSON'S DECISION, NOT AN AGENT'S.
 *
 * `docs/data-model.md` grants an agent-bound session read + capture on the
 * human profile and full access only to its own — never the power to act on
 * the ACCOUNT. Every owner surface honours that (profiles.ts, sessions.ts,
 * groups.ts) except the one that cannot be undone: `DELETE /api/auth/me` was
 * mounted on `requireAuth` alone and never read `session.profile.type`, so a
 * credential minted through the documented CLI/MCP loopback login — bound to
 * an agent profile, held by a process, and reachable by prompt injection
 * through anything that agent reads — could erase the whole account. Every
 * profile, every inspiration, every signal, the top of mind, the S3 objects.
 * No soft delete, no re-auth, no email. The only barrier was a confirmation
 * literal the agent can read in the source.
 *
 * It lives here rather than in groups.ts (where the same predicate was written
 * for a narrower reason) so that the next account-level route reaches for it
 * without knowing about groups.
 */
export const humanSessionsOnly: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json(
      { error: "This is the account holder's decision and cannot be made by an agent session" },
      403,
    );
  }
  await next();
};

export const optionalAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = readToken(c);
  if (token) {
    const session = await resolveSessionFromToken(token);
    if (session) {
      c.set("session", session);
      c.set("sessionToken", token);
    }
  }
  await next();
};

// ---------------------------------------------------------------------------
// The access matrix
// ---------------------------------------------------------------------------

/**
 * What a caller wants to do with a profile's memory:
 *   - read    : list/inspect inspirations, signals, the top of mind
 *   - capture : add an inspiration
 *   - write   : everything else — curate signals, edit entries, share,
 *               delete, administer
 */
export type ProfileOperation = "read" | "capture" | "write";

export interface ProfileAccessTarget {
  id: string;
  accountId: string;
}

/**
 * May this session perform `operation` on `target`?
 *
 * - A session acting as its own profile may do anything to it.
 * - A **human**-profile session is the account's admin: full access to every
 *   profile the account owns, including its agents' memories.
 * - An **agent**-profile session may read and capture into the account's
 *   human profile — that is the conditioning-and-relaying case — but may
 *   never curate, edit, or delete the human's memory.
 * - Nothing reaches across accounts, ever.
 */
export function resolveProfileAccess(
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): boolean {
  if (target.accountId !== session.profile.accountId) return false;
  if (target.id === session.profile.id) return true;
  if (session.profile.type === "human") return true;
  // Agent session, some other profile in the same account.
  return operation === "read" || operation === "capture";
}

/**
 * Throwing form for handlers: returns nothing on success, or the 403 body to
 * return. Kept as a value rather than an exception so handlers stay explicit
 * about their failure responses.
 */
export function profileAccessError(
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): { error: string } | null {
  return resolveProfileAccess(session, target, operation)
    ? null
    : { error: "Not permitted for this profile" };
}
