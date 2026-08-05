/**
 * Google OAuth 2.0 routes (Authorization Code flow + PKCE).
 *
 * Mounted under /api/auth/google by the parent auth router. Two endpoints:
 *
 *   GET /api/auth/google/login
 *     Generates a one-time `state` value and a PKCE code_verifier/challenge
 *     pair, persists them as short-lived httpOnly cookies, and 302-redirects
 *     the visitor to Google's consent screen. The state cookie defends
 *     against CSRF/login-fixation; the PKCE pair defends against an attacker
 *     who steals the authorization `code` from the redirect URL.
 *
 *   GET /api/auth/google/callback
 *     Receives `?code=...&state=...` from Google, validates the state cookie
 *     matches, exchanges the code for tokens (passing the PKCE verifier),
 *     decodes and validates the ID token's iss/aud/exp claims, upserts the
 *     user row (linking by google_sub or email), mints our normal session
 *     JWT into the standard waka_session cookie, and 302-redirects the
 *     visitor back to the frontend home route.
 *
 * Why this lives in its own file
 * ------------------------------
 *   - Keeps password auth (signup/login) and OAuth auth in separate modules
 *     so the diff for each AC stays small and reviewable.
 *   - Makes it trivial to add a second OAuth provider later (GitHub, Apple,
 *     …) by mirroring this file under a sibling prefix.
 *
 * Why server-side state + PKCE for a server-side flow?
 *   - We're a confidential client (we have a client_secret), so PKCE is not
 *     strictly required. But Google now recommends it for all clients, and
 *     adding it is essentially free. It costs us one cookie and a SHA-256
 *     hash but materially raises the bar for code-interception attacks.
 *   - The state cookie is the canonical CSRF defense for OAuth — without
 *     it a malicious site could feed a victim a callback URL that signs
 *     them in as the attacker.
 */

import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { users } from "../db/index.js";
import {
  buildSessionCookie,
  signSessionToken,
} from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { createSessionRow } from "../lib/session.js";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
  getOAuthRedirectOrigin,
} from "../lib/google-oauth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Google's OAuth 2.0 authorization endpoint. Documented at
 * https://developers.google.com/identity/protocols/oauth2/web-server.
 */
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** Token-exchange endpoint paired with GOOGLE_AUTH_URL above. */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Acceptable values for the ID token's `iss` claim. Google issues both
 * forms (with and without the `https://` prefix); both are equivalent and
 * spelled out in the OpenID discovery document.
 */
const ALLOWED_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

/** Scopes we ask Google for. Anything beyond openid+email+profile is overreach. */
const OAUTH_SCOPES = ["openid", "email", "profile"];

/** Cookie that carries the random `state` between /login and /callback. */
const STATE_COOKIE_NAME = "waka_oauth_state";

/** Cookie that carries the PKCE code_verifier between /login and /callback. */
const PKCE_COOKIE_NAME = "waka_oauth_pkce";

/** Safe in-app destination preserved across the cross-origin OAuth round-trip. */
const RETURN_TO_COOKIE_NAME = "waka_oauth_return_to";

/**
 * Where the post-callback cookie is delivered to before we redirect the
 * browser back into the SPA. We send users to "/" by default — the SPA's
 * route guard will then either render the home view (authenticated) or
 * bounce back to /login (which would only happen if cookie-set somehow
 * failed, in which case the user sees the regular login form).
 */
const POST_LOGIN_PATH = "/";

function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2_048) return POST_LOGIN_PATH;
  if (!value.startsWith("/")) return POST_LOGIN_PATH;
  try {
    // Parsing against a fixed origin catches protocol-relative paths and the
    // backslash variant (`/\\host`) that URL parsers normalize into one. A
    // prefix-only check looks safe but can still become a cross-origin redirect.
    const internalOrigin = "https://waka.invalid";
    const target = new URL(value, internalOrigin);
    if (target.origin !== internalOrigin || target.pathname === "/login") {
      return POST_LOGIN_PATH;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return POST_LOGIN_PATH;
  }
}

/**
 * 10 minutes is the maximum window between the user clicking "Continue
 * with Google" and Google redirecting them back. Anything longer means the
 * tab was abandoned and a stale state cookie should not validate.
 */
const STATE_TTL_SECONDS = 10 * 60;

// ---------------------------------------------------------------------------
// Crypto helpers (state + PKCE)
// ---------------------------------------------------------------------------

/**
 * Base64url-encode a Uint8Array per RFC 7636 §4.1 (no padding, +/ → -_).
 * We avoid Node-only APIs so the same code path works in any web-crypto
 * runtime (Lambda, Cloudflare Workers, vitest under jsdom).
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // btoa is global in Node 18+ and in every browser-like runtime.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Cryptographically random URL-safe token. Used both for `state` and as
 * the PKCE code_verifier (where 32 bytes → 43 chars satisfies the spec's
 * 43..128 length window).
 */
function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * SHA-256(verifier) → base64url. This is the PKCE `code_challenge` we send
 * up front; Google later recomputes it from the verifier we POST during
 * the token exchange and rejects the request if they disagree.
 */
async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Cookie attribute helpers
// ---------------------------------------------------------------------------

/**
 * httpOnly + SameSite=Lax + short TTL. We deliberately do NOT use
 * SameSite=Strict because Google's redirect back to us is a top-level
 * navigation from accounts.google.com — Strict would drop the cookie and
 * the callback would fail with "missing state cookie".
 */
function tempCookieOptions(): {
  httpOnly: true;
  sameSite: "Lax";
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// ID token decoding
// ---------------------------------------------------------------------------

/**
 * Subset of Google ID token claims we actually use. Many more fields exist
 * (locale, hd, …) but we only consume the identity-defining ones.
 */
interface GoogleIdTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  /** Stable subject identifier — primary key for OAuth-linked accounts. */
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Decode the JWT payload. We do NOT verify the JWT signature here because
 * we received the token directly from Google's token endpoint over a TLS
 * connection authenticated with our client_secret — that channel is the
 * ground truth. Per Google's own guidance:
 *
 *   "If you get the ID token over a secure channel, e.g. by calling the
 *    token endpoint, it is generally safe to skip the validation steps"
 *
 * (https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken)
 *
 * What we DO validate (below in the callback) are the iss, aud, and exp
 * claims, which protect against confused-deputy and replay scenarios.
 */
function decodeIdToken(idToken: string): GoogleIdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed ID token: expected three dot-separated parts");
  }
  const payload = parts[1]!;
  // base64url → base64 (re-add padding so atob accepts it).
  const padded = payload
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json) as GoogleIdTokenClaims;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const googleAuthRoutes = new Hono();

/**
 * GET /api/auth/google/login
 *
 * Side effects:
 *   1. Mints a fresh `state` and a PKCE verifier+challenge pair.
 *   2. Sets the state and verifier as short-lived httpOnly cookies on the
 *      API origin so the matching /callback can read them back.
 *   3. 302-redirects to Google's authorization endpoint.
 *
 * Caller flow:
 *   <a href="${API_URL}/api/auth/google/login">Continue with Google</a>
 */
googleAuthRoutes.get("/login", async (c) => {
  const state = randomToken(32);
  const codeVerifier = randomToken(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  setCookie(c, STATE_COOKIE_NAME, state, tempCookieOptions());
  setCookie(c, PKCE_COOKIE_NAME, codeVerifier, tempCookieOptions());
  setCookie(
    c,
    RETURN_TO_COOKIE_NAME,
    safeReturnTo(c.req.query("returnTo")),
    tempCookieOptions(),
  );

  const redirectUri = getGoogleRedirectUri();

  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // `select_account` always shows the chooser even for users with one
    // session — surprising UX is safer than accidentally signing the
    // visitor in as a different existing Google account. `online` (vs
    // `offline`) since we never need a refresh token: we only use the ID
    // token once, then issue our own session.
    access_type: "online",
    prompt: "select_account",
    // include_granted_scopes lets future scope requests be incremental.
    include_granted_scopes: "true",
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
});

/**
 * GET /api/auth/google/callback
 *
 * Validates the `state` cookie, exchanges the `code` for tokens, verifies
 * the ID token's claims, upserts the user row, sets the session cookie,
 * and redirects to the SPA. On any failure we redirect to /login with an
 * `?error=...` query param rather than rendering a server error page so
 * the SPA can surface a friendly message in its own UI shell.
 */
export async function handleGoogleCallback(c: Context): Promise<Response> {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const stateFromUrl = url.searchParams.get("state");
  const errorFromGoogle = url.searchParams.get("error");

  // The frontend origin where /login lives. The SPA is served by the
  // StaticSite and is NOT necessarily on the same origin as the API.
  const webOrigin =
    process.env.PUBLIC_WEB_URL ??
    process.env.WEB_URL ??
    process.env.VITE_WEB_URL ??
    // Vite's default dev server matches the proxy target the SPA uses to
    // hit the API. If the SPA and API are co-served, this also works.
    "http://localhost:5173";
  const returnTo = safeReturnTo(getCookie(c, RETURN_TO_COOKIE_NAME));

  function failTo(reason: string): Response {
    // Best-effort cleanup so a stale state cookie doesn't poison a retry.
    deleteCookie(c, STATE_COOKIE_NAME, { path: "/" });
    deleteCookie(c, PKCE_COOKIE_NAME, { path: "/" });
    deleteCookie(c, RETURN_TO_COOKIE_NAME, { path: "/" });
    const target = new URL("/login", webOrigin);
    target.searchParams.set("error", reason);
    if (returnTo !== POST_LOGIN_PATH) target.searchParams.set("returnTo", returnTo);
    return c.redirect(target.toString(), 302);
  }

  if (errorFromGoogle) {
    // The user clicked "Cancel" on the consent screen, or Google rejected
    // the request (e.g. invalid_client). We never echo Google's error code
    // verbatim because it can leak internals to a curl-driven attacker.
    return failTo("oauth_denied");
  }

  if (!code || !stateFromUrl) {
    return failTo("missing_code");
  }

  const stateCookie = getCookie(c, STATE_COOKIE_NAME);
  const pkceCookie = getCookie(c, PKCE_COOKIE_NAME);
  if (!stateCookie || !pkceCookie) {
    // Cookies expired (10-min TTL) or this is a tampered/replayed callback.
    return failTo("state_expired");
  }
  if (stateCookie !== stateFromUrl) {
    return failTo("state_mismatch");
  }

  // -------------------------------------------------------------------------
  // Exchange the authorization code for tokens.
  // -------------------------------------------------------------------------

  const tokenBody = new URLSearchParams({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
    code_verifier: pkceCookie,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
  } catch {
    // Network error reaching Google. Treat as transient.
    return failTo("token_exchange_failed");
  }

  if (!tokenResponse.ok) {
    return failTo("token_exchange_failed");
  }

  let tokens: { id_token?: string; access_token?: string };
  try {
    tokens = (await tokenResponse.json()) as typeof tokens;
  } catch {
    return failTo("token_exchange_failed");
  }

  if (!tokens.id_token) {
    return failTo("token_exchange_failed");
  }

  // -------------------------------------------------------------------------
  // Validate ID token claims (iss, aud, exp). Signature verification is
  // skipped per Google's guidance for tokens received over the secure
  // server-side token-exchange channel.
  // -------------------------------------------------------------------------

  let claims: GoogleIdTokenClaims;
  try {
    claims = decodeIdToken(tokens.id_token);
  } catch {
    return failTo("invalid_id_token");
  }

  if (!ALLOWED_ISSUERS.has(claims.iss)) {
    return failTo("invalid_id_token");
  }
  if (claims.aud !== getGoogleClientId()) {
    return failTo("invalid_id_token");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) {
    return failTo("invalid_id_token");
  }
  if (!claims.sub) {
    return failTo("invalid_id_token");
  }
  if (!claims.email) {
    // openid+email scope guarantees this; if missing, something is very wrong.
    return failTo("invalid_id_token");
  }
  if (claims.email_verified !== true) {
    // Never link or create a WAKA account from an unverified email claim.
    // Google `sub` is stable, but our fallback/linking path below uses email
    // for account ownership, so the email must be provider-verified first.
    return failTo("unverified_email");
  }

  // -------------------------------------------------------------------------
  // Upsert the user row.
  //
  // Three cases to handle:
  //   1. We've seen this google_sub before  → log them in as that user.
  //   2. We've seen this email but no google_sub  → link the existing
  //      account so the user can later sign in with either method.
  //   3. Brand-new identity  → insert a new row.
  //
  // We do this in a single SELECT-then-mutate path rather than ON CONFLICT
  // because we may need to update either the `google_sub` (linking case)
  // or the `avatar_url` (refresh case) and both branches are easier to
  // reason about as explicit code.
  // -------------------------------------------------------------------------

  const normalizedEmail = claims.email.trim().toLowerCase();
  const db = getDb();

  let userRow: { id: string; email: string; name: string };

  // 1. Look up by google_sub first — this is the immutable identity key.
  const bySub = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.googleSub, claims.sub))
    .limit(1);

  if (bySub.length > 0) {
    // Refresh avatar (and name if we don't already have one) on every login.
    const found = bySub[0]!;
    const updated = await db
      .update(users)
      .set({
        avatarUrl: claims.picture ?? null,
        name:
          found.name && found.name.length > 0
            ? found.name
            : (claims.name ?? ""),
        updatedAt: new Date(),
      })
      .where(eq(users.id, found.id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
      });
    userRow = updated[0]!;
  } else {
    // 2. No google_sub match — look up by email so we can link an existing
    //    password-only account to this Google identity.
    const byEmail = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        googleSub: users.googleSub,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (byEmail.length > 0) {
      const found = byEmail[0]!;
      if (found.googleSub && found.googleSub !== claims.sub) {
        // The same email is already linked to a *different* Google account.
        // This should be impossible for real Google accounts (an email
        // uniquely identifies a Google sub) but we refuse to silently
        // overwrite the link rather than risk an account-takeover bug.
        return failTo("account_conflict");
      }
      const updated = await db
        .update(users)
        .set({
          googleSub: claims.sub,
          avatarUrl: claims.picture ?? null,
          name:
            found.name && found.name.length > 0
              ? found.name
              : (claims.name ?? ""),
          updatedAt: new Date(),
        })
        .where(eq(users.id, found.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
        });
      userRow = updated[0]!;
    } else {
      // 3. Brand-new identity — insert. Wrap the unique-violation case in
      //    case two callbacks raced past both lookups above.
      try {
        const inserted = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            // No password — this account is OAuth-only until the user sets one.
            passwordHash: null,
            googleSub: claims.sub,
            name: claims.name ?? "",
            avatarUrl: claims.picture ?? null,
          })
          .returning({
            id: users.id,
            email: users.email,
            name: users.name,
          });
        userRow = inserted[0]!;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          // The losing side of a race against a concurrent OAuth login by
          // the same identity. Re-read by google_sub and use whichever row
          // the winner inserted.
          const racedRow = await db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
            })
            .from(users)
            .where(eq(users.googleSub, claims.sub))
            .limit(1);
          if (racedRow.length === 0) {
            return failTo("upsert_failed");
          }
          userRow = racedRow[0]!;
        } else {
          throw err;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mint our own session JWT, drop it into the standard waka_session
  // cookie, clear the temp OAuth cookies, and bounce the browser back to
  // the SPA.
  // -------------------------------------------------------------------------

  const sessionToken = await signSessionToken({
    userId: userRow.id,
    email: userRow.email,
  });

  // Persist the matching server-side session row so `/api/auth/logout` can
  // revoke this exact session. Mirrors the post-signup write in
  // routes/auth.ts — both paths must produce the same row shape so the
  // middleware can't tell OAuth and password sessions apart.
  await createSessionRow({ userId: userRow.id, token: sessionToken });

  // Append, don't replace — we want both the session cookie and the
  // delete-temp-cookie headers to land in one response.
  c.header("Set-Cookie", buildSessionCookie(sessionToken), { append: true });
  deleteCookie(c, STATE_COOKIE_NAME, { path: "/" });
  deleteCookie(c, PKCE_COOKIE_NAME, { path: "/" });
  deleteCookie(c, RETURN_TO_COOKIE_NAME, { path: "/" });

  // Reference getOAuthRedirectOrigin() so a future audit catches the case
  // where the API and SPA are deliberately co-hosted (single origin) — we
  // would then prefer the API origin for the redirect base.
  void getOAuthRedirectOrigin;

  return c.redirect(new URL(returnTo, webOrigin).toString(), 302);
}

googleAuthRoutes.get("/callback", handleGoogleCallback);
