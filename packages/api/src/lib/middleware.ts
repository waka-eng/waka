/**
 * Hono auth middleware.
 *
 * Two flavours, both backed by the same lookup logic:
 *
 *   - `requireAuth`  : 401s any request that does not carry a valid,
 *                      live session. Use this on every protected route
 *                      (inspirations, attachments, /auth/me, …).
 *   - `optionalAuth` : populates `c.var.user` if a session is valid but
 *                      lets the request through unchanged otherwise.
 *                      Useful for endpoints that personalise output but
 *                      are still readable when logged out.
 *
 * The middleware does three things in order:
 *   1. Read `waka_session` cookie (or `Authorization: Bearer <token>`,
 *      so server-to-server scripts and the smoke tests can authenticate
 *      without a cookie jar).
 *   2. Verify the JWT signature/expiry — cheap, no DB hit.
 *   3. Look up the matching `sessions` row to confirm the token is
 *      still revocable-not-revoked and join through to `users`.
 *
 * Steps 2 and 3 are both required: without (2) any random string would
 * trigger a DB hit; without (3) we couldn't invalidate a session before
 * its `exp` claim.
 *
 * Why expose the user via `c.set("user", ...)` rather than a request
 * argument? Hono's middleware contract uses the per-request `Variables`
 * map for downstream handlers, and typing it via `MiddlewareEnv` below
 * lets handlers do `c.get("user")` with full IntelliSense.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth.js";
import {
  type AuthenticatedUser,
  lookupSessionUser,
} from "./session.js";

/**
 * Hono environment shape exposed by these middlewares. Mount with
 *   const app = new Hono<AuthEnv>();
 * (or a subset) so `c.get("user")` is typed.
 */
export interface AuthEnv {
  Variables: {
    user: AuthenticatedUser;
    sessionToken: string;
  };
}

/**
 * Pull the token from a Hono context. Order of precedence:
 *   1. `Authorization: Bearer <jwt>` — explicit header, always wins.
 *   2. `waka_session` cookie — the browser path.
 *
 * Returns `null` when neither is present so the middleware can decide
 * whether absence is a 401 or "fall through".
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

/**
 * Verify a token end-to-end and return the user, or null on any failure.
 * Shared by `requireAuth` and `optionalAuth` so the two cannot drift.
 */
async function resolveUserFromToken(
  token: string,
): Promise<AuthenticatedUser | null> {
  // Cheap signature/expiry check. Anything malformed gets thrown away
  // before we burn a DB round-trip on it.
  const decoded = await verifySessionToken(token);
  if (!decoded?.sub) return null;

  // Server-side row lookup. Confirms the JWT is still revocable-not-revoked
  // AND joins through to a (still-existing) user row.
  return lookupSessionUser(token);
}

/**
 * Middleware that 401s when there is no valid session.
 *
 * On success:
 *   - `c.set("user", AuthenticatedUser)`
 *   - `c.set("sessionToken", string)`  (so logout doesn't have to re-parse)
 */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = readToken(c);
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const user = await resolveUserFromToken(token);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("user", user);
  c.set("sessionToken", token);
  await next();
};

/**
 * Middleware that populates `c.var.user` when possible but lets the
 * request through either way. Useful for "if you happen to be logged in,
 * personalise the response" endpoints.
 */
export const optionalAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = readToken(c);
  if (token) {
    const user = await resolveUserFromToken(token);
    if (user) {
      c.set("user", user);
      c.set("sessionToken", token);
    }
  }
  await next();
};
