/**
 * Authentication routes.
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
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { accounts, profiles, type ProfileType } from "../db/index.js";
import { eraseAccount } from "../lib/account-erasure.js";
import { isAdminUser } from "../lib/admin-auth.js";
import {
  buildSessionClearCookie,
  buildSessionCookie,
  hashPassword,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
} from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { DEFAULT_LOCALE, normalizeSupportedLocale, supportedLocaleSchema } from "../lib/locales.js";
import { type AuthEnv, humanSessionsOnly, requireAuth } from "../lib/middleware.js";
import {
  isPublicHandleTaken,
  normalizePublicHandle,
  validatePublicHandle,
} from "../lib/public-handles.js";
import { issueVerification } from "../lib/email-verification.js";
import { createSessionRow, describeUserAgent, revokeSessionByToken } from "../lib/session.js";
import { cliAuthRoutes } from "./auth-cli.js";
import { googleAuthRoutes, handleGoogleCallback } from "./auth-google.js";

type WakaDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Signup request schema.
 *
 *   - `email`: trimmed, lower-cased, must be a valid RFC-ish email. We
 *     normalise on the way in so two people cannot both register
 *     "Foo@bar.com" and "foo@bar.com".
 *   - `password`: minimum 8 chars. We deliberately keep this floor low —
 *     the hard work is done by bcrypt on the server, and adding character-
 *     class rules tends to push users toward predictable patterns.
 *   - `name`: optional display name for the human profile; falls back to ""
 *     so the column's NOT NULL DEFAULT '' constraint is honoured.
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
    .max(120, "Display name is too long")
    .optional(),
  preferredLocale: supportedLocaleSchema.optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Login request schema.
 *
 *   - `email`: trimmed + lower-cased on the way in so the lookup matches
 *     the row's normalised storage form regardless of how it was typed. We
 *     deliberately do NOT enforce `.email()` here — the server resolves the
 *     row by exact equality, and a malformed input simply matches nothing
 *     (returning the same generic 401 as a wrong password). Keeping the
 *     schema lenient prevents leaking "this looked syntactically bad" vs.
 *     "we couldn't find this account" to the caller.
 *   - `password`: present + non-empty. We do NOT enforce a minimum length
 *     on the login form — an account that predates a tighter policy must
 *     still be able to sign in. The server's bcrypt comparison is the single
 *     arbiter of "valid credential".
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

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(120, "Display name is too long");

const profileSchema = z
  .object({
    name: displayNameSchema,
    preferredLocale: supportedLocaleSchema,
    completeOnboarding: z.boolean().optional(),
    publicHandle: z.string().trim().max(24, "Handle is too long").nullable().optional(),
    publicProfileEnabled: z.boolean().optional(),
    publicTopOfMindEnabled: z.boolean().optional(),
  })
  .strict();

export type ProfileInput = z.infer<typeof profileSchema>;

const deleteAccountSchema = z
  .object({
    confirmation: z.literal("DELETE"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Row shapes and serialization
// ---------------------------------------------------------------------------

/** Columns of the auth identity. Reused by every query that answers /me. */
const accountColumns = {
  id: accounts.id,
  email: accounts.email,
  onboardingCompletedAt: accounts.onboardingCompletedAt,
} as const;

/** Columns of the profile a session acts as. */
const profileColumns = {
  id: profiles.id,
  accountId: profiles.accountId,
  type: profiles.type,
  name: profiles.name,
  avatarUrl: profiles.avatarUrl,
  preferredLocale: profiles.preferredLocale,
  publicHandle: profiles.publicHandle,
  publicProfileEnabled: profiles.publicProfileEnabled,
  publicTopOfMindEnabled: profiles.publicTopOfMindEnabled,
} as const;

export interface AccountRow {
  id: string;
  email: string;
  onboardingCompletedAt: Date | null;
}

export interface ProfileRow {
  id: string;
  accountId: string;
  type: ProfileType;
  name: string;
  avatarUrl: string | null;
  preferredLocale: string;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
}

function serializeAccount(account: AccountRow) {
  return {
    id: account.id,
    email: account.email,
    onboardingCompletedAt: account.onboardingCompletedAt?.toISOString() ?? null,
    isAdmin: isAdminUser({ email: account.email }),
  };
}

function serializeProfile(profile: ProfileRow) {
  return {
    id: profile.id,
    accountId: profile.accountId,
    type: profile.type,
    name: profile.name,
    avatarUrl: profile.avatarUrl ?? null,
    preferredLocale: normalizeSupportedLocale(profile.preferredLocale),
    publicHandle: profile.publicHandle ?? null,
    publicProfileEnabled: profile.publicProfileEnabled === true,
    publicTopOfMindEnabled: profile.publicTopOfMindEnabled === true,
  };
}

/**
 * The answer to "who am I": the account that signed in, and the profile this
 * session acts as. Read fresh rather than served from the session, because
 * the session carries only what authorization needs — the display identity
 * can change under it at any time.
 */
async function loadIdentity(
  db: WakaDb,
  profileId: string,
): Promise<{ account: AccountRow; profile: ProfileRow } | null> {
  const [row] = await db
    .select({ account: accountColumns, profile: profileColumns })
    .from(profiles)
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(eq(profiles.id, profileId))
    .limit(1);

  return row ?? null;
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

/**
 * POST /api/auth/signup
 *
 * Flow:
 *   1. Parse + validate JSON body with zod. Return 400 on schema failure.
 *   2. Check whether this email is taken. Return 409 if so — intentionally
 *      explicit, because for B2C signup the enumeration risk is acceptable
 *      and "this email is taken" is materially better UX than a generic
 *      error.
 *   3. Hash the password with bcrypt.
 *   4. Insert the account and its human profile in one transaction.
 *   5. Mint a session bound to that profile, set the httpOnly cookie, and
 *      return the identity + token in the body so non-cookie clients (CLI,
 *      tests) can authenticate too.
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

  const { email, password, name, preferredLocale } = parsed.data;
  const db = getDb();

  // 2. Email uniqueness check. We do this BEFORE hashing the password so we
  //    don't burn ~100ms of bcrypt CPU on a duplicate request. The unique
  //    index below is still the arbiter in case two requests race.
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  // 3. Hash. Awaited so we surface bcrypt errors as 500s, not silent failures.
  const passwordHash = await hashPassword(password);

  // 4. Insert both rows together. A name supplied at signup is the whole of
  //    onboarding, so the account is stamped complete in the same write.
  let created: { account: AccountRow; profile: ProfileRow };
  try {
    created = await db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({
          email,
          passwordHash,
          onboardingCompletedAt: name?.trim() ? new Date() : null,
        })
        .returning(accountColumns);

      const [profile] = await tx
        .insert(profiles)
        .values({
          accountId: account!.id,
          type: "human",
          name: name ?? "",
          preferredLocale: preferredLocale ?? DEFAULT_LOCALE,
        })
        .returning(profileColumns);

      return { account: account!, profile: profile! };
    });
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

  // 4b. Ask them to prove the address. Nothing until now ever did, which is
  //     how someone could hold an account on an email they did not own — see
  //     lib/email-verification.ts. A send failure must not undo a signup that
  //     already succeeded, so it is caught: the account exists, the person is
  //     signed in, and they can ask for the link again.
  try {
    await issueVerification(getDb(), {
      accountId: created.account.id,
      email: created.account.email,
      baseUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
    });
  } catch (err) {
    console.error("[signup] could not issue an email verification link", err);
  }

  // 5. Mint a session bound to the human profile. Both cookie and body carry
  //    it so the client can pick whichever transport fits its environment.
  const token = await signSessionToken({
    profileId: created.profile.id,
    email: created.account.email,
  });

  // 5b. Persist a server-side session row keyed by SHA-256(token). This is
  //     what makes the JWT revocable: /api/auth/logout deletes this row and
  //     the auth middleware then refuses the cookie even though the JWT
  //     itself is still cryptographically valid.
  await createSessionRow({
    profileId: created.profile.id,
    token,
    deviceLabel: describeUserAgent(c.req.header("user-agent")),
  });

  c.header("Set-Cookie", buildSessionCookie(token));

  return c.json(
    {
      account: serializeAccount(created.account),
      profile: serializeProfile(created.profile),
      token,
    },
    201,
  );
});

/**
 * POST /api/auth/login
 *
 * Flow:
 *   1. Parse + validate JSON body. 400 on schema failure.
 *   2. Look up the account and its human profile by normalised email. If
 *      there is no row OR the row has no passwordHash (a Google-only
 *      account), return a generic 401 — one error code for "no such
 *      account", "wrong password", and "OAuth-only account" so the response
 *      is not a user-enumeration oracle.
 *   3. bcrypt-compare the supplied password. The comparison is constant-time
 *      inside bcryptjs, so a wrong-password 401 takes the same wall-clock
 *      time as a right-password 200. The no-account branch above DOES
 *      short-circuit faster — that timing channel is acceptable for a B2C
 *      product where /signup already exposes the same signal via its 409.
 *   4. On match, mint a session bound to the human profile, persist the row
 *      so logout can revoke it, set the cookie, and answer in the same shape
 *      as /signup so one client code path handles both.
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

  // 2. Lookup. The browser signs in as the human profile, and the partial
  //    unique index guarantees there is at most one of those per account, so
  //    the join resolves the whole identity in a single round-trip.
  const rows = await db
    .select({
      account: accountColumns,
      profile: profileColumns,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    .innerJoin(
      profiles,
      and(eq(profiles.accountId, accounts.id), eq(profiles.type, "human")),
    )
    .where(eq(accounts.email, email))
    .limit(1);

  const candidate = rows[0];
  // Generic 401 for any of: no account, OAuth-only account (no
  // passwordHash), or password mismatch. Same body so a caller cannot
  // distinguish.
  const genericFailure = () =>
    c.json({ error: "Incorrect email or password" }, 401);

  if (!candidate || !candidate.passwordHash) {
    return genericFailure();
  }

  // 3. Verify. `verifyPassword` is exception-safe — a malformed hash yields
  //    false rather than throwing, so a corrupt hash surfaces as the same
  //    generic 401.
  const ok = await verifyPassword(password, candidate.passwordHash);
  if (!ok) {
    return genericFailure();
  }

  // 4. Mint session.
  const token = await signSessionToken({
    profileId: candidate.profile.id,
    email: candidate.account.email,
  });
  await createSessionRow({
    profileId: candidate.profile.id,
    token,
    deviceLabel: describeUserAgent(c.req.header("user-agent")),
  });
  c.header("Set-Cookie", buildSessionCookie(token));

  return c.json(
    {
      account: serializeAccount(candidate.account),
      profile: serializeProfile(candidate.profile),
      token,
    },
    200,
  );
});

/**
 * GET /api/auth/me
 *
 * The account that signed in plus the profile this session acts as. Used by
 * the SPA on boot to decide whether to render the home view or bounce to
 * /login, which is why it answers 401 rather than 200-with-null when
 * unauthenticated: one status check settles it.
 */
authRoutes.get("/me", requireAuth, async (c) => {
  const session = c.get("session");
  const identity = await loadIdentity(getDb(), session.profile.id);
  if (!identity) {
    // The profile was erased between the session lookup and this read.
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json({
    account: serializeAccount(identity.account),
    profile: serializeProfile(identity.profile),
  });
});

/**
 * PATCH /api/auth/me/preferences
 *
 * Locale is a property of the memory, not of the login: generation is
 * locale-aware and generation is per-profile, so this writes the acting
 * profile.
 */
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

  const session = c.get("session");
  const db = getDb();

  const updated = await db
    .update(profiles)
    .set({
      preferredLocale: parsed.data.preferredLocale,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, session.profile.id))
    .returning({ id: profiles.id });

  // RETURNING cannot reach across the join, so the answer is read back
  // through the one query that assembles the whole identity.
  const identity = updated.length > 0 ? await loadIdentity(db, session.profile.id) : null;
  if (!identity) {
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json({
    account: serializeAccount(identity.account),
    profile: serializeProfile(identity.profile),
  });
});

/**
 * PATCH /api/auth/me/profile
 *
 * Display identity and the public surface, both of which belong to the
 * acting profile. `completeOnboarding` is the one field that reaches the
 * account row — onboarding happens once per login, not once per profile — so
 * the two writes share a transaction.
 */
/*
 * humanSessionsOnly, for the same reason account erasure has it: publishing a
 * handle, switching the profile public, and exposing its top of mind are the
 * account holder's decisions about their own visibility to the open internet.
 * An agent credential is reachable by prompt injection, and this route was
 * requireAuth alone — so text an agent was told to write could be published,
 * under a handle an agent chose, readable by anyone with no session at all.
 */
authRoutes.patch("/me/profile", requireAuth, humanSessionsOnly, async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = profileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid profile payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const session = c.get("session");
  const db = getDb();

  const current = await loadIdentity(db, session.profile.id);
  if (!current) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const normalizedHandle =
    parsed.data.publicHandle === undefined
      ? current.profile.publicHandle
      : parsed.data.publicHandle
        ? normalizePublicHandle(parsed.data.publicHandle)
        : null;
  if (normalizedHandle) {
    const handleError = validatePublicHandle(normalizedHandle);
    if (handleError) {
      return c.json(
        {
          error: "Invalid public handle",
          details: { publicHandle: [handleError] },
        },
        400,
      );
    }
  }

  const publicProfileEnabled =
    parsed.data.publicProfileEnabled ?? current.profile.publicProfileEnabled;
  const publicTopOfMindEnabled =
    parsed.data.publicTopOfMindEnabled ?? current.profile.publicTopOfMindEnabled;
  if ((publicProfileEnabled || publicTopOfMindEnabled) && !normalizedHandle) {
    return c.json(
      {
        error: "Public handle is required before enabling a public profile",
        details: { publicHandle: ["Choose a public handle first"] },
      },
      400,
    );
  }

  // A field-level error reads better than a bare constraint violation. The
  // unique index still guards the race between this read and the write, and
  // its 23505 lands on the same response below.
  if (normalizedHandle && normalizedHandle !== current.profile.publicHandle) {
    const taken = await isPublicHandleTaken({
      handle: normalizedHandle,
      claimingProfileId: current.profile.id,
      db,
    });
    if (taken) {
      return c.json(
        {
          error: "That public handle is already taken",
          details: { publicHandle: ["That public handle is already taken"] },
        },
        409,
      );
    }
  }

  const now = new Date();
  const completeOnboarding =
    parsed.data.completeOnboarding === true &&
    current.account.onboardingCompletedAt === null;

  let account = current.account;
  let profile = current.profile;
  try {
    const written = await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          name: parsed.data.name,
          preferredLocale: parsed.data.preferredLocale,
          publicHandle: normalizedHandle,
          publicProfileEnabled,
          publicTopOfMindEnabled,
          updatedAt: now,
        })
        .where(eq(profiles.id, current.profile.id))
        .returning(profileColumns);

      if (!completeOnboarding) {
        return { account: null, profile: updatedProfile };
      }

      const [updatedAccount] = await tx
        .update(accounts)
        .set({ onboardingCompletedAt: now, updatedAt: now })
        .where(eq(accounts.id, current.account.id))
        .returning(accountColumns);

      return { account: updatedAccount, profile: updatedProfile };
    });

    account = written.account ?? account;
    profile = written.profile ?? profile;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return c.json(
        {
          error: "That public handle is already taken",
          details: { publicHandle: ["That public handle is already taken"] },
        },
        409,
      );
    }
    throw err;
  }

  return c.json({
    account: serializeAccount(account),
    profile: serializeProfile(profile),
  });
});

/**
 * DELETE /api/auth/me
 *
 * Erases the whole account: every profile it owns and every layer of memory
 * under them. The confirmation literal is required because this has no undo.
 */
authRoutes.delete("/me", requireAuth, humanSessionsOnly, async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = deleteAccountSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid delete confirmation",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const session = c.get("session");
  await eraseAccount(session.account.id, { db: getDb() });
  c.header("Set-Cookie", buildSessionClearCookie());
  return c.json({ ok: true });
});

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
authRoutes.post("/logout", async (c) => {
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
});
