/**
 * Auth primitives shared across API routes.
 *
 * Responsibilities:
 *   - Hash passwords with bcrypt (cost factor 10) so plaintext is never
 *     persisted. We use bcryptjs (pure JS) instead of native bcrypt to keep
 *     the Lambda bundle portable across architectures.
 *   - Mint and verify session JWTs signed with JWT_SECRET. The JWT carries
 *     just the user id and email; the rest is loaded server-side per request
 *     to avoid stale token data.
 *   - Standardise the session cookie name and attributes so the login,
 *     signup, and protected handlers stay in lock-step.
 *
 * Why JWT *and* a cookie? The JWT is the credential, the cookie is the
 * delivery mechanism. Browsers see an httpOnly Secure cookie they cannot
 * read from JS; the API verifies the JWT inside it on every request. This
 * is the same pattern SST OpenAuth uses, so swapping in OpenAuth later only
 * needs to replace `signSessionToken` / `verifySessionToken` — every caller
 * keeps working.
 */

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { sign, verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

/**
 * HMAC-SHA256 is the canonical symmetric JWT algorithm. We pin it here so
 * `verify` cannot be tricked into accepting a token signed with `none` or
 * a weaker algorithm.
 */
const JWT_ALG = "HS256" as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cookie name that carries the session JWT. Shared between signup, login,
 * logout, and the auth middleware so they cannot drift apart.
 */
export const SESSION_COOKIE_NAME = "waka_session";

/**
 * Session lifetime: 30 days. Long enough that users don't get logged out
 * mid-week, short enough that a leaked token has a finite blast radius.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * bcrypt cost factor. 10 is the industry default — ~100ms on a modern CPU,
 * which is fast enough for an interactive signup but slow enough to make
 * brute-force expensive.
 */
const BCRYPT_COST = 10;

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password with bcrypt. The returned string already includes
 * the salt and cost factor, so it is the only thing that needs to be stored.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Compare a plaintext password against a previously stored bcrypt hash.
 * Returns false (never throws) on mismatch or malformed input so callers can
 * use a single "invalid credentials" error path.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session JWT
// ---------------------------------------------------------------------------

/**
 * Session JWT payload. Extends JWTPayload's index signature so the Hono
 * `sign`/`verify` helpers accept it without unsafe casts.
 */
export interface SessionPayload extends JWTPayload {
  /** users.id (uuid) */
  sub: string;
  /** users.email (denormalised so middleware can log/identify without a DB hit) */
  email: string;
  /** Issued-at (seconds since epoch) */
  iat: number;
  /** Expires-at (seconds since epoch) */
  exp: number;
  /**
   * JWT ID — random per-mint nonce. Without this, two tokens minted for the
   * same user inside the same wall-clock second (e.g. signup followed by an
   * immediate login round-trip) would be byte-identical, and the
   * SHA-256(token) used as the `sessions.token_hash` PK would conflict on
   * insert. The `jti` is purely for uniqueness — it carries no meaning the
   * server reads back — but it MUST be cryptographically random so two
   * concurrent signups can't collide either.
   */
  jti: string;
}

/**
 * Resolve the JWT signing secret. We read JWT_SECRET first (the canonical
 * name used by sst.config.ts when binding the SST Secret) and fall back to
 * AUTH_SECRET so local `tsx` runs without the SST resource binding still
 * work. Throws loudly if neither is set — silently signing with an empty
 * secret would be a critical security bug.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET (or AUTH_SECRET) is not set. Configure it in .env or via SST Resource binding before issuing sessions.",
    );
  }
  return secret;
}

/**
 * Sign a session token for the given user. The returned string is a
 * compact-form JWT ready to drop into the session cookie.
 */
export async function signSessionToken(input: {
  userId: string;
  email: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: input.userId,
    email: input.email,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    // 16 bytes = 128 bits of entropy — overkill for the uniqueness the
    // `sessions.token_hash` index needs, but cheap and future-proof if we
    // ever add a "list active sessions" UI keyed by jti.
    jti: randomBytes(16).toString("hex"),
  };
  return sign(payload, getJwtSecret(), JWT_ALG);
}

/**
 * Verify and decode a session token. Returns the payload on success, or
 * null on any failure (invalid signature, expired, malformed). Callers
 * should treat null as "unauthenticated" without leaking the reason.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const decoded = (await verify(
      token,
      getJwtSecret(),
      JWT_ALG,
    )) as SessionPayload;
    return decoded;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export interface SessionCookieOptions {
  /**
   * When true (default in production), set Secure so the cookie is only sent
   * over HTTPS. Disabled automatically when NODE_ENV !== "production" so the
   * `sst dev` localhost flow over http:// still works.
   */
  secure?: boolean;
}

/**
 * Build a Set-Cookie value carrying the session JWT. Centralising this here
 * means signup, login, and OAuth callback all emit identical cookie
 * attributes — diverging would create subtle "logged in on one path, not
 * the other" bugs.
 */
export function buildSessionCookie(
  token: string,
  options: SessionCookieOptions = {},
): string {
  const isProd = process.env.NODE_ENV === "production";
  const secure = options.secure ?? isProd;

  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build a Set-Cookie value that immediately clears the session cookie.
 *
 * We MUST mirror Path / HttpOnly / SameSite / Secure from `buildSessionCookie`
 * — browsers consider those attributes part of the cookie's identity, and a
 * "delete" cookie that differs on Path or SameSite leaves the original sitting
 * in the cookie jar. The standard kill-switch is `Max-Age=0` plus an empty
 * value, which the spec defines as "remove this cookie now".
 */
export function buildSessionClearCookie(
  options: SessionCookieOptions = {},
): string {
  const isProd = process.env.NODE_ENV === "production";
  const secure = options.secure ?? isProd;

  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
