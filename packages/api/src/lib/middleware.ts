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

import { looksLikeAgentKey, lookupAgentKeySession } from "./agent-key-auth.js";
import { looksLikeKeeperKey, lookupKeeperKeySession } from "./keeper-key-auth.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth.js";
import { type AuthenticatedSession, lookupSession } from "./session.js";
import type { getDb } from "./db.js";

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
function readToken(c: Context): { token: string; source: "header" | "cookie" } | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return { token, source: "header" };
  }

  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken && cookieToken.length > 0) return { token: cookieToken, source: "cookie" };

  return null;
}

/** Shared by both middlewares so they cannot drift. */
async function resolveSessionFromToken(token: string): Promise<AuthenticatedSession | null> {
  /* An agent's standing key, told apart by its prefix rather than by trying
     the JWT verify and falling through — the shapes are disjoint, so the
     cheap check routes the credential without spending a signature check.
     The session it yields is agent-bound: the whole access matrix below and
     `humanSessionsOnly` apply to it unchanged (2026-08-17 meeting: per-agent
     keys are a way IN, never a wider set of powers once in). */
  const decoded = await verifySessionToken(token);
  if (!decoded?.sub) return null;
  return lookupSession(token);
}

/**
 * WHAT A KEEPER KEY MAY ASK FOR AT ALL — a positive list, enforced at the
 * one place every authed request passes, rather than a refusal remembered
 * in each route. The matrix still guards the same session underneath (a
 * `?profile=` toward anyone else is denied there), but the matrix's own
 * self-profile short-circuits live in the route resolvers, so a chokepoint
 * is what makes "keep and recall, nothing else" a fact rather than a
 * convention. Exported pure, so the list is a unit test away.
 */
export function keeperKeyMayPass(method: string, path: string): boolean {
  /* `/api/harvest` is the keeper key's other way in (2026-10-15): the
     person's own collector proposes sentences there for the person to
     decide on at a browser. Proposing only — the decision routes under it
     are `humanSessionsOnly`, which refuses this key. */
  if (method === "POST") return path === "/api/inspirations" || path === "/api/harvest";
  if (method !== "GET") return false;
  return [
    "/api/inspirations",
    "/api/signals",
    "/api/recall",
    "/api/top-of-mind",
    "/api/principles",
    "/api/principles.md",
    "/api/weather",
    "/api/weather.md",
    "/api/experiences",
    "/api/graph",
  ].some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const read = readToken(c);
  if (!read) {
    return c.json({ error: "Authentication required" }, 401);
  }
  /* AN AGENT'S STANDING KEY RIDES THE HEADER, NEVER THE COOKIE. The prefix
     routes it to the key lookup without spending a signature check; the
     source check is the security half. A cookie is attached by the browser
     to whatever asks — accepting a key there would let a page that can set
     cookies fix a victim's browser to an attacker's agent, and every keep
     the victim made would land in the attacker's stack. A server-to-server
     credential has no business in a browser channel, so the shape is simply
     not a credential there. */
  const session = looksLikeAgentKey(read.token)
    ? read.source === "header"
      ? await lookupAgentKeySession(read.token)
      : null
    : looksLikeKeeperKey(read.token)
      ? read.source === "header"
        ? await lookupKeeperKeySession(read.token)
        : null
      : await resolveSessionFromToken(read.token);
  if (!session) {
    return c.json({ error: "Authentication required" }, 401);
  }
  if (session.keyScoped && !keeperKeyMayPass(c.req.method, c.req.path)) {
    return c.json(
      { error: "Beyond this key's scope — a keeper key keeps and recalls; the rest needs you at a browser" },
      403,
    );
  }
  c.set("session", session);
  c.set("sessionToken", read.token);
  await next();
};

/**
 * THIS IS A PERSON'S DECISION, NOT AN AGENT'S.
 *
 * `docs/data-model.md` restricts an agent-bound session to its own
 * profile (2026-10-22 isolation ruling) — never the
 * power to act on the ACCOUNT. Every owner surface honours that (profiles.ts, sessions.ts,
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
 *
 * THE DUPLICATION WAS NOT THE PROBLEM; THE HALF THAT GOT DROPPED WAS. Nine
 * handlers across five route files wrote `session.profile.type !== "human"`
 * inline and not one of them wrote `|| session.keyScoped`, because the
 * predicate reads complete without it. It is not. A keeper key resolves to a
 * session whose profile IS the human — `keeper-key-auth.ts` joins on
 * `profiles.type = 'human'` by design and marks the session `keyScoped` —
 * so every hand-rolled copy looked at a standing credential sitting in an
 * MCP config file on disk, read "human", and waved it through to add a
 * profile, rename one, delete one, enumerate the account's live connections,
 * end any of them, download the whole archive, take a seat in a room, and
 * merge the person's signals. Each of those is precisely the class of act
 * the 2026-08-29 ruling put behind "the person at a browser".
 *
 * None of it was reachable, and that is the thinnest kind of safe: the only
 * thing in front of those nine was `keeperKeyMayPass` — ONE positive list,
 * in ONE middleware, naming ten GET prefixes and two POSTs. A defence whose
 * whole strength is an allowlist nobody has widened yet is a defence that
 * ends the first time someone widens it, and the widening will look like a
 * one-line product change rather than like granting a config file the power
 * to delete profiles. Depth is the point: the gate at the door AND the gate
 * on the route, so the two have to fail together.
 *
 * So all nine call this now, and `human-only-gate.test.ts` fails the build if
 * a tenth writes the predicate by hand. A route may still test a session's
 * profile type inline when the refusal is conditional rather than the whole
 * door (`inspirations-capture.ts` refuses only conversation-sourced saves) —
 * the gate asks for `keyScoped` in the same breath, which is the half that
 * was missing every time.
 */
export const humanSessionsOnly: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = c.get("session");
  /* A keeper key IS the human, and still may not decide for the account: a
     standing credential in a config file on disk does not get to delete the
     account, mint keys, or open grants. Those need the person at a browser. */
  if (session.profile.type !== "human" || session.keyScoped) {
    return c.json(
      { error: "This is the account holder's decision and cannot be made by an agent session" },
      403,
    );
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

export type ProfileAccessVerdict = "allowed" | "denied";

/**
 * May this session perform `operation` on `target`?
 *
 * - A session acting as its own profile may do anything to it.
 * - A **human**-profile session is the account's admin: full access to every
 *   profile the account owns, including its agents' memories.
 * - An **agent**-profile session reads and writes only its bound profile.
 *   Human memory, siblings and historical read grants cannot widen it.
 * - Nothing reaches across accounts, ever.
 */
export function resolveProfileAccess(
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): ProfileAccessVerdict {
  if (target.accountId !== session.profile.accountId) return "denied";
  /* A keeper key (2026-08-29): the person's standing MCP credential is
     deliberately LESS than the person — read and capture on its own
     profile, nothing anywhere else. Checked before the human-admin rule,
     which must never apply to a key sitting in a config file. */
  if (session.keyScoped) {
    return target.id === session.profile.id && operation !== "write"
      ? "allowed"
      : "denied";
  }
  if (target.id === session.profile.id) return "allowed";
  if (session.profile.type === "human") return "allowed";
  return "denied";
}

/** The handler form, retaining the async route contract. */
export async function profileAccessError(
  _db: Pick<ReturnType<typeof getDb>, "select">,
  session: AuthenticatedSession,
  target: ProfileAccessTarget,
  operation: ProfileOperation,
): Promise<{ error: string } | null> {
  return resolveProfileAccess(session, target, operation) === "allowed"
    ? null : { error: "Not permitted for this profile" };
}
