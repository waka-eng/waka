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
import { hasLiveSiblingGrant } from "./sibling-grants.js";

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
  /** Who the target is — the sibling rule turns on it. */
  type: "human" | "agent";
}

/**
 * Narrow a profiles row to an ACCOUNT-HELD target, or nothing.
 *
 * A room's mind (`type = 'group'`, null account — 2026-08-24) is a profile
 * that no session can be and no personal route may act on: it belongs to a
 * room, and rooms are reached through the group routes with their own
 * membership gate. Every place that loads a profile as an access target
 * passes through here, so a mind resolves to "no such profile" everywhere
 * by one rule instead of by nine remembered checks.
 */
export function asAccountProfile<
  T extends { accountId: string | null; type: "human" | "agent" | "group" },
>(row: T): (T & { accountId: string; type: "human" | "agent" }) | null {
  if (row.accountId === null || row.type === "group") return null;
  return row as T & { accountId: string; type: "human" | "agent" };
}

export type ProfileAccessVerdict = "allowed" | "denied" | "sibling_grant_required";

/**
 * May this session perform `operation` on `target`?
 *
 * - A session acting as its own profile may do anything to it.
 * - A **human**-profile session is the account's admin: full access to every
 *   profile the account owns, including its agents' memories.
 * - An **agent**-profile session may read and capture into the account's
 *   human profile — that is the conditioning-and-relaying case — but may
 *   never curate, edit, or delete the human's memory.
 * - An **agent** session reaching for a SIBLING agent's memory needs an
 *   explicit, human-granted, revocable grant — the matrix answers
 *   `sibling_grant_required` and `profileAccessError` reads the live grant
 *   rows. The open default retired with `goals/no-quiet-corners.md`
 *   Phase 6 (the flip is founder-ruled, 2026-08-23, signed in
 *   docs/data-model.md's decision log): no flag, no dark machinery.
 * - Nothing reaches across accounts, ever.
 */
export function resolveProfileAccess(
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): ProfileAccessVerdict {
  if (target.accountId !== session.profile.accountId) return "denied";
  if (target.id === session.profile.id) return "allowed";
  if (session.profile.type === "human") return "allowed";
  // Agent session, some other profile in the same account.
  if (operation === "write") return "denied";
  if (target.type === "human") return "allowed";
  return "sibling_grant_required";
}

/**
 * The handler form: null on success, or the 403 body to return. Async since
 * the sibling flip — a `sibling_grant_required` verdict is answered from
 * the live grant rows, read now rather than cached, so revocation takes
 * effect on the very next request.
 */
export async function profileAccessError(
  db: Parameters<typeof hasLiveSiblingGrant>[0],
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): Promise<{ error: string } | null> {
  const verdict = resolveProfileAccess(session, target, operation);
  if (verdict === "allowed") return null;
  if (verdict === "sibling_grant_required") {
    const granted = await hasLiveSiblingGrant(db, {
      granteeProfileId: session.profile.id,
      targetProfileId: target.id,
    });
    if (granted) return null;
    return {
      error:
        "No grant to read this agent's memory — the account holder can open that door",
    };
  }
  return { error: "Not permitted for this profile" };
}
