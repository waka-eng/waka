/**
 * Authentication routes.
 *
 * Currently exposes:
 *   - POST /api/auth/signup : create an email+password account, mint a session
 *                         JWT, and return it both in the response body and
 *                         as an httpOnly cookie.
 *
 * Future routes (login, logout, OAuth callback) will live in this same
 * router so the prefix mounting stays in one place.
 *
 * Validation is performed with zod against a single schema object so the
 * "what the body must look like" contract is co-located with the route.
 * Database access goes through the lazy `getDb()` singleton; password
 * handling and session minting go through `lib/auth.ts`.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { users } from "../db/index.js";
import {
  buildSessionClearCookie,
  buildSessionCookie,
  hashPassword,
  signSessionToken,
  verifyPassword,
} from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { DEFAULT_LOCALE, normalizeSupportedLocale, supportedLocaleSchema } from "../lib/locales.js";
import {
  type AuthEnv,
  requireAuth,
} from "../lib/middleware.js";
import {
  createSessionRow,
  revokeSessionByToken,
} from "../lib/session.js";
import { googleAuthRoutes, handleGoogleCallback } from "./auth-google.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Signup request schema.
 *
 *   - `email`: trimmed, lower-cased, must be a valid RFC-ish email. We
 *     normalise on the way in so two users cannot both register
 *     "Foo@bar.com" and "foo@bar.com".
 *   - `password`: minimum 8 chars. We deliberately keep this floor low —
 *     the hard work is done by bcrypt on the server, and adding character-
 *     class rules tends to push users toward predictable patterns.
 *   - `name`: optional display name; falls back to "" so the column's NOT
 *     NULL DEFAULT '' constraint is honoured.
 */
const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address")
    .max(254, "Email is too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  name: z
    .string()
    .trim()
    .max(120, "Name is too long")
    .optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Login request schema.
 *
 *   - `email`: trimmed + lower-cased on the way in so the lookup matches
 *     the row's normalised storage form regardless of how the user typed
 *     it. We deliberately do NOT enforce `.email()` here — the server
 *     resolves the row by exact equality, and a malformed input will simply
 *     not match anything (returning the same generic 401 as wrong password).
 *     Keeping the schema lenient prevents leaking "this looked syntactically
 *     bad" vs. "we couldn't find this user" to the caller.
 *   - `password`: present + non-empty. We do NOT enforce a minimum length
 *     on the login form — a user whose existing account predates a tighter
 *     policy must still be able to sign in. The server's bcrypt comparison
 *     is the single arbiter of "valid credential".
 */
const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(254, "Email is too long"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(200, "Password is too long"),
});

export type LoginInput = z.infer<typeof loginSchema>;

const preferencesSchema = z
  .object({
    preferredLocale: supportedLocaleSchema,
  })
  .strict();

export type PreferencesInput = z.infer<typeof preferencesSchema>;

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

/**
 * POST /api/auth/signup
 *
 * Flow:
 *   1. Parse + validate JSON body with zod. Return 400 on schema failure.
 *   2. Check if a user with this email already exists. Return 409 if so —
 *      this is intentionally explicit because for B2C signup the
 *      enumeration risk is acceptable and the UX of "this email is taken"
 *      is materially better than a generic error.
 *   3. Hash the password with bcrypt.
 *   4. Insert the new user row, returning id + email.
 *   5. Mint a session JWT, set the httpOnly session cookie, and return the
 *      user record + token in the JSON body so non-cookie clients (CLI,
 *      tests) can authenticate as well.
 */
authRoutes.post("/signup", async (c) => {
  // 1. Parse body. We tolerate non-JSON gracefully so a misbehaving client
  //    gets a 400 with a message rather than an unhandled exception.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = signupSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid signup payload",
        // zod's `flatten()` gives a stable shape the frontend can render
        // directly under the relevant input field.
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const { email, password, name } = parsed.data;
  const db = getDb();

  // 2. Email uniqueness check. We do this BEFORE hashing the password so we
  //    don't burn ~100ms of bcrypt CPU on a duplicate request. The DB also
  //    has a unique index as a safety net in case two requests race.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  // 3. Hash. Awaited so we surface bcrypt errors as 500s, not silent failures.
  const passwordHash = await hashPassword(password);

  // 4. Insert. We rely on the unique index to catch the rare race where two
  //    concurrent signups slip past the SELECT above; Postgres throws
  //    `23505` (unique_violation) which we map to the same 409.
  let inserted: { id: string; email: string; name: string; preferredLocale: string };
  try {
    const rows = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name ?? "",
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        preferredLocale: users.preferredLocale,
      });
    inserted = rows[0]!;
  } catch (err) {
    // postgres.js exposes the SQLSTATE on `err.code`. `23505` = unique
    // violation. Anything else is a genuine 500.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return c.json(
        { error: "An account with this email already exists" },
        409,
      );
    }
    throw err;
  }

  // 5. Mint session token + cookie. Both are returned so the client can
  //    pick whichever transport fits its environment.
  const token = await signSessionToken({
    userId: inserted.id,
    email: inserted.email,
  });

  // 5b. Persist a server-side session row keyed by SHA-256(token). This
  //     is what makes the JWT revocable: /api/auth/logout deletes this row
  //     and the auth middleware then refuses the cookie even though the
  //     JWT itself is still cryptographically valid.
  await createSessionRow({ userId: inserted.id, token });

  c.header("Set-Cookie", buildSessionCookie(token));

  return c.json(
    {
      user: {
        id: inserted.id,
        email: inserted.email,
        name: inserted.name,
        preferredLocale: normalizeSupportedLocale(inserted.preferredLocale),
      },
      token,
    },
    201,
  );
});

/**
 * POST /api/auth/login
 *
 * Authenticate an existing email+password account.
 *
 * Flow:
 *   1. Parse + validate JSON body. 400 on schema failure.
 *   2. Look up the user by normalised email. If no row OR the row has no
 *      passwordHash (Google-OAuth-only account), return a generic 401 — we
 *      deliberately surface ONE error code for "no such user", "wrong
 *      password", and "OAuth-only account" so the response is not a user
 *      enumeration oracle.
 *   3. bcrypt-compare the supplied password against the stored hash. The
 *      comparison is constant-time inside bcryptjs, so a wrong-password
 *       401 takes the same wall-clock time as a right-password 200. Note
 *      that the no-user branch above DOES short-circuit faster — that
 *      timing channel is acceptable for an unauthenticated B2C product
 *      where the email-uniqueness signal is already exposed by /signup
 *      (which returns 409 on duplicate).
 *   4. On match, mint a session JWT, persist the server-side session row
 *      (so /api/auth/logout can revoke it), set the httpOnly cookie, and
 *      return the user record + token in the JSON body — same shape as
 *      /api/auth/signup so the SPA's auth context handles both responses
 *      with one code path.
 */
authRoutes.post("/login", async (c) => {
  // 1. Parse body.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = loginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid login payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const { email, password } = parsed.data;
  const db = getDb();

  // 2. Lookup. Single round-trip: select id + email + name + passwordHash so
  //    we can both verify and return the user record without a second query.
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      preferredLocale: users.preferredLocale,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const candidate = rows[0];
  // Generic 401 for any of: no user, OAuth-only user (no passwordHash),
  // or password mismatch. Same body so a caller cannot distinguish.
  const genericFailure = () =>
    c.json({ error: "Incorrect email or password" }, 401);

  if (!candidate || !candidate.passwordHash) {
    return genericFailure();
  }

  // 3. Verify. `verifyPassword` is exception-safe — a malformed hash
  //    yields false rather than throwing, so a row with a corrupt hash
  //    surfaces as the same generic 401.
  const ok = await verifyPassword(password, candidate.passwordHash);
  if (!ok) {
    return genericFailure();
  }

  // 4. Mint session.
  const token = await signSessionToken({
    userId: candidate.id,
    email: candidate.email,
  });
  await createSessionRow({ userId: candidate.id, token });
  c.header("Set-Cookie", buildSessionCookie(token));

  return c.json(
    {
      user: {
        id: candidate.id,
        email: candidate.email,
        name: candidate.name,
        preferredLocale: normalizeSupportedLocale(candidate.preferredLocale),
      },
      token,
    },
    200,
  );
});

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user. Used by the SPA on boot to
 * decide whether to render the home view or bounce to /login. Returns
 * 401 (not 200 with `user: null`) when unauthenticated so the frontend
 * can branch with a single status check.
 *
 * Response shape mirrors the user object returned by /api/auth/signup so the
 * SPA's user store has one canonical type.
 */
authRoutes.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      preferredLocale: user.preferredLocale,
    },
  });
});

authRoutes.patch("/me/preferences", requireAuth, async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = preferencesSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid preferences payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const currentUser = c.get("user");
  const [updated] = await getDb()
    .update(users)
    .set({
      preferredLocale: parsed.data.preferredLocale,
      updatedAt: new Date(),
    })
    .where(eq(users.id, currentUser.id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      preferredLocale: users.preferredLocale,
    });

  const user = updated ?? { ...currentUser, preferredLocale: DEFAULT_LOCALE };
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      preferredLocale: normalizeSupportedLocale(user.preferredLocale),
    },
  });
});

/**
 * POST /api/auth/logout
 *
 * Idempotent — safe to call multiple times, safe to call without a
 * cookie. We:
 *   1. Clear the session row in Postgres so any other tab still holding
 *      the same JWT immediately stops authenticating.
 *   2. Emit a Max-Age=0 Set-Cookie so the browser drops the cookie.
 *
 * We return 200 with `{ ok: true }` rather than 204 so JSON-only clients
 * (the SPA) don't have to special-case "empty body".
 *
 * Note: we do NOT use `requireAuth` here. A user with an already-expired
 * cookie should still be able to "log out" (and have it succeed) so the
 * UI doesn't get stuck — clearing a stale cookie is precisely the
 * recovery action.
 */
authRoutes.post("/logout", async (c) => {
  // We have to read the cookie ourselves since requireAuth is not in
  // play. Authorization header is also accepted to mirror the auth
  // middleware's transport rules and keep CLI / smoke tests symmetric.
  const authHeader = c.req.header("Authorization");
  let token: string | null = null;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const candidate = authHeader.slice(7).trim();
    if (candidate.length > 0) token = candidate;
  }
  if (!token) {
    // Inline cookie parse so we don't need a fresh import — keeps this
    // handler self-contained.
    const raw = c.req.header("Cookie") ?? "";
    for (const part of raw.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "waka_session") {
        token = rest.join("=");
        break;
      }
    }
  }

  if (token) {
    // Best-effort: a missing row (already-logged-out, stale cookie) is
    // not an error.
    await revokeSessionByToken(token);
  }

  c.header("Set-Cookie", buildSessionClearCookie());
  return c.json({ ok: true });
});
