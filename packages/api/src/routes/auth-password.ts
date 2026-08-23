/**
 * Proving you own an address with a password: signing up, and signing in.
 *
 * These two handlers are one subject and are kept in one file on purpose. The
 * throttle that governs `/login` exists **because** `/signup` answers 409 for
 * an address that is already registered — that 409 is a deliberate B2C trade
 * (see the flow note above the handler) and it hands an attacker a confirmed
 * list of real addresses. Split across two files, the trade and the thing that
 * pays for it stop being visible together, and the next person to soften
 * either one would have no reason to look at the other.
 *
 * The same goes for the throttle's read and the password check it guards. The
 * budget is spent before the account lookup and before bcrypt, and every
 * failing path — including "no such account" — is charged. Anything that puts
 * distance between the refusal and the attempt is a change to the security
 * property, not a tidy-up.
 *
 * Both handlers finish the same way — sign a token, persist a revocable
 * session row, set the session cookie, re-mint the login-device cookie — and
 * that repetition is left standing rather than folded into a shared helper.
 * The two are not actually the same act: signup mints the device credential
 * for an address that has no history, login re-mints one whose lifetime is
 * measured from this login. A helper with a flag would have hidden that.
 *
 * The rule this file must not lose: every failing branch charges the throttle
 * first, and every response about an identity is built by
 * `auth-identity.ts` so nothing spreads a row into a body.
 */

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import { accounts, profiles } from "../db/index.js";
import {
  buildSessionCookie,
  hashPassword,
  signSessionToken,
  verifyPassword,
  wantsSecureCookie,
} from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import {
  buildLoginDeviceCookie,
  clearLoginFailures,
  judgeLoginThrottle,
  LOGIN_DEVICE_COOKIE_NAME,
  mintLoginDeviceCredential,
  readLoginDeviceCredential,
  readLoginThrottle,
  readRequestOrigin,
  recordLoginFailure,
  resolveLoginSource,
} from "../lib/login-throttle.js";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "../lib/locales.js";
import type { AuthEnv } from "../lib/middleware.js";
import { createSessionRow, describeUserAgent } from "../lib/session.js";
import {
  accountColumns,
  profileColumns,
  serializeAccount,
  serializeProfile,
  type AccountRow,
  type ProfileRow,
} from "./auth-identity.js";

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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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
export async function signupHandler(c: Context<AuthEnv>): Promise<Response> {
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

  // 4b. NO VERIFICATION LINK IS SENT, AND SIGNUP BELIEVES THE ADDRESS.
  //     Signup used to mint one here. The transport behind it was never
  //     implemented, so the link only ever reached a log line and the address
  //     stayed unprovable; the one thing that required proof — joining a group
  //     — was therefore closed to every account. The owner removed the
  //     requirement instead of wiring a provider. Sending mail from here again
  //     means choosing a provider and a sending domain first; the reasoning is
  //     in drizzle/migrations/0010_the_address_stays_unproven.sql.
  //
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

  /*
   * Recognise this browser from the moment the account exists.
   *
   * Choosing the password here is the same proof of ownership that supplying
   * it at /login is, and the login throttle's whole defence against being
   * aimed at a person is that their own browser carries a credential. Without
   * this, every brand-new account spends its first weeks as a browser nobody
   * has seen — which is exactly the state an attacker can hold someone in.
   */
  c.header(
    "Set-Cookie",
    buildLoginDeviceCookie(mintLoginDeviceCredential(created.account.email), {
      secure: wantsSecureCookie(),
    }),
    { append: true },
  );

  return c.json(
    {
      account: serializeAccount(created.account),
      profile: serializeProfile(created.profile),
      token,
    },
    201,
  );
}

/**
 * POST /api/auth/login
 *
 * Flow:
 *   1. Parse + validate JSON body. 400 on schema failure.
 *   2. Ask the throttle whether this attempt may spend a password check at
 *      all. Before the lookup, so a refusal costs neither a query nor bcrypt
 *      — the point of a limit is that the request stops being worth sending.
 *      See lib/login-throttle.ts for the budgets and, more importantly, for
 *      why they cannot be aimed at the person whose address is being guessed.
 *   3. Look up the account and its human profile by normalised email. If
 *      there is no row OR the row has no passwordHash (a Google-only
 *      account), return a generic 401 — one error code for "no such
 *      account", "wrong password", and "OAuth-only account" so the response
 *      is not a user-enumeration oracle.
 *   4. bcrypt-compare the supplied password. The comparison is constant-time
 *      inside bcryptjs, so a wrong-password 401 takes the same wall-clock
 *      time as a right-password 200. The no-account branch above DOES
 *      short-circuit faster — that timing channel is acceptable for a B2C
 *      product where /signup already exposes the same signal via its 409.
 *   5. On match, mint a session bound to the human profile, persist the row
 *      so logout can revoke it, set the cookie, and answer in the same shape
 *      as /signup so one client code path handles both.
 *
 * Every failing path charges the attempt to the throttle first, INCLUDING the
 * one where no such account exists. If only real accounts were counted, the
 * 429 would arrive for registered addresses and never for made-up ones, and
 * the limit meant to slow enumeration down would have become the oracle.
 */
export async function loginHandler(c: Context<AuthEnv>): Promise<Response> {
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
  const now = new Date();

  // 2. Throttle. The device credential is read against the address being
  //    tried, so a cookie earned on one account grants nothing on another.
  const deviceId = readLoginDeviceCredential(
    getCookie(c, LOGIN_DEVICE_COOKIE_NAME),
    email,
    { now },
  );
  const reading = await readLoginThrottle(
    db,
    {
      identifier: email,
      source: resolveLoginSource(readRequestOrigin(c)),
      deviceId,
    },
    { now },
  );
  const verdict = judgeLoginThrottle(reading);
  if (verdict.refused) {
    c.header("Retry-After", String(verdict.retryAfterSeconds));
    return c.json(
      {
        /* NO "or reset your password" HERE UNTIL THERE IS ONE.
           This sentence used to offer it. There is no reset route, no token
           table and no mail transport anywhere in this repo — so the one
           person guaranteed to read this line, someone locked out and
           anxious, was sent looking for a door that does not exist. Waiting
           is genuinely the only thing that works right now, and saying only
           that is kinder than naming an escape they cannot take.
           `docs/goals/everything-in-the-world.md` Phase 4 owns building the real
           one; this
           line changes back in the same diff that makes it true. */
        error: "Too many sign-in attempts. Wait a few minutes and try again.",
      },
      429,
    );
  }

  // 3. Lookup. The browser signs in as the human profile, and the partial
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
  const genericFailure = async () => {
    await recordLoginFailure(db, reading);
    return c.json({ error: "Incorrect email or password" }, 401);
  };

  if (!candidate || !candidate.passwordHash) {
    return genericFailure();
  }

  // 4. Verify. `verifyPassword` is exception-safe — a malformed hash yields
  //    false rather than throwing, so a corrupt hash surfaces as the same
  //    generic 401.
  const ok = await verifyPassword(password, candidate.passwordHash);
  if (!ok) {
    return genericFailure();
  }

  // 5. Mint session. The failures counted against this address stop mattering
  //    the moment somebody proves they know its password, so they are dropped
  //    rather than left to expire — otherwise the person who fumbled their way
  //    to the right password would still be serving out the window.
  await clearLoginFailures(db, reading);

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

  /*
   * Re-mint the device credential on every successful login rather than only
   * when one is missing. It is what stops a flood of failures from shutting
   * this browser out of this account, so it must not quietly age out from
   * under someone who signs in every week; and re-minting keeps its lifetime
   * measured from the last real login rather than from the first.
   */
  c.header(
    "Set-Cookie",
    buildLoginDeviceCookie(mintLoginDeviceCredential(email, { now }), {
      secure: wantsSecureCookie(),
    }),
    { append: true },
  );

  return c.json(
    {
      account: serializeAccount(candidate.account),
      profile: serializeProfile(candidate.profile),
      token,
    },
    200,
  );
}
