/**
 * Authentication routes — the router, and the one route that needs no session.
 *
 *   - POST   /api/auth/signup           create an account + its human profile
 *   - POST   /api/auth/login            email + password
 *   - GET    /api/auth/me               the account and the acting profile
 *   - PATCH  /api/auth/me/preferences   locale, on the acting profile
 *   - PATCH  /api/auth/me/profile       display identity + public surface
 *   - DELETE /api/auth/me               erase the account and every profile
 *   - POST   /api/auth/logout           revoke this session
 *
 * Google OAuth and the CLI loopback flow mount under this same router so the
 * prefix lives in one place.
 *
 * **An account is the login; a profile owns the memory.** Signing up creates
 * both in one transaction — an account with no human profile could
 * authenticate but own nothing, so the two rows are never allowed to exist
 * apart. The session then binds to that profile, and everything a handler
 * reads or writes follows from the binding rather than from the account.
 *
 * Which is why the display identity a person edits here — name, avatar,
 * locale, public handle — lives on the profile: it is the memory's identity,
 * and an account can own several. Only the email, the credentials, and the
 * one-time onboarding stamp stay on the account.
 *
 * Where the rest of it lives
 * --------------------------
 * This was one 891-line file until the split, and the reason for splitting it
 * was not the line count. It is that this namespace's guards are the kind that
 * fail silently: drop `humanSessionsOnly` from a route and nothing stops
 * compiling, nothing stops passing, and an agent credential can publish under
 * a person's name. So the mounts below are written as one block, with every
 * middleware on the same page as every path, and the handler bodies are next
 * door:
 *
 *   `auth-identity.ts`  what an identity is, and every field of it that leaves
 *   `auth-password.ts`  POST /signup and POST /login, with the login throttle
 *   `auth-me.ts`        the four routes that act on the session you have
 *   `auth-google.ts`    the Google OAuth flow
 *   `auth-cli.ts`       the CLI loopback flow
 *
 * The middleware moved up here from the individual handlers, which is a real
 * trade: a guard is no longer three lines above the code it guards. It is
 * worth it because the failure that has actually happened in this repo is a
 * guard going missing, not a guard being misread, and a missing guard is
 * visible in a list of seven routes in a way it is never visible across seven
 * hundred lines.
 *
 * Signup and login are mounted WITHOUT `requireAuth` because they are how a
 * session is obtained; logout is mounted without it deliberately, and the
 * reason is written at the handler.
 */

import { Hono, type Context } from "hono";

import { buildSessionClearCookie, SESSION_COOKIE_NAME } from "../lib/auth.js";
import { type AuthEnv, humanSessionsOnly, requireAuth } from "../lib/middleware.js";
import { revokeSessionByToken } from "../lib/session.js";
import { cliAuthRoutes } from "./auth-cli.js";
import { googleAuthRoutes, handleGoogleCallback } from "./auth-google.js";
import {
  eraseAccountHandler,
  meHandler,
  preferencesHandler,
  profileHandler,
} from "./auth-me.js";
import { loginHandler, signupHandler } from "./auth-password.js";

/*
 * Re-exported so `@waka/api/routes/auth` — a declared entry point in this
 * package's `exports` map — still names every type it named before the split.
 * A subpath export is a promise to whoever imports it, and quietly dropping a
 * name from it is a break that no build in this repo would report.
 */
export type { AccountRow, ProfileRow } from "./auth-identity.js";
export type { PreferencesInput, ProfileInput } from "./auth-me.js";
export type { LoginInput, SignupInput } from "./auth-password.js";

/**
 * POST /api/auth/logout
 *
 * Idempotent — safe to call multiple times, safe to call without a cookie.
 * We:
 *   1. Delete the session row in Postgres so any other tab still holding the
 *      same JWT immediately stops authenticating.
 *   2. Emit a Max-Age=0 Set-Cookie so the browser drops the cookie.
 *
 * We return 200 with `{ ok: true }` rather than 204 so JSON-only clients
 * (the SPA) don't have to special-case "empty body".
 *
 * Note: we do NOT use `requireAuth` here. Someone holding an already-expired
 * cookie should still be able to "log out" successfully so the UI doesn't get
 * stuck — clearing a stale cookie is precisely the recovery action.
 */
async function logoutHandler(c: Context<AuthEnv>): Promise<Response> {
  // We read the credential ourselves since requireAuth is not in play. The
  // Authorization header is accepted too, mirroring the auth middleware's
  // transport rules so CLI and smoke tests stay symmetric.
  const authHeader = c.req.header("Authorization");
  let token: string | null = null;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const candidate = authHeader.slice(7).trim();
    if (candidate.length > 0) token = candidate;
  }
  if (!token) {
    // Inline cookie parse so this handler stays self-contained.
    const raw = c.req.header("Cookie") ?? "";
    for (const part of raw.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE_NAME) {
        token = rest.join("=");
        break;
      }
    }
  }

  if (token) {
    // Best-effort: a missing row (already logged out, stale cookie) is not an
    // error.
    await revokeSessionByToken(token);
  }

  c.header("Set-Cookie", buildSessionClearCookie());
  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const authRoutes = new Hono<AuthEnv>();

// Google OAuth initiation remains at /api/auth/google/login for the SPA, but
// the callback is also exposed at the historical NextAuth/Auth.js path
// /api/auth/callback/google so it matches the redirect URI that the shared
// Google OAuth client already has registered from kti-app.
authRoutes.route("/google", googleAuthRoutes);
authRoutes.get("/callback/google", handleGoogleCallback);
authRoutes.route("/cli", cliAuthRoutes);

/*
 * Every route in this namespace, with every guard in front of it, in
 * registration order. Hono matches in registration order, so this list is also
 * the resolution order — and it is the census a reader should be able to check
 * against `docs/goals` without opening another file.
 *
 * No session required, because these are how a session is obtained:
 */
authRoutes.post("/signup", signupHandler);
authRoutes.post("/login", loginHandler);

/* A session, acting as itself: */
authRoutes.get("/me", requireAuth, meHandler);
authRoutes.patch("/me/preferences", requireAuth, preferencesHandler);

/*
 * humanSessionsOnly, for the same reason account erasure has it: publishing a
 * handle, switching the profile public, and exposing its top of mind are the
 * account holder's decisions about their own visibility to the open internet.
 * An agent credential is reachable by prompt injection, and this route was
 * requireAuth alone — so text an agent was told to write could be published,
 * under a handle an agent chose, readable by anyone with no session at all.
 */
authRoutes.patch("/me/profile", requireAuth, humanSessionsOnly, profileHandler);
authRoutes.delete("/me", requireAuth, humanSessionsOnly, eraseAccountHandler);

/* Deliberately unguarded — the reason is written above logoutHandler. */
authRoutes.post("/logout", logoutHandler);
