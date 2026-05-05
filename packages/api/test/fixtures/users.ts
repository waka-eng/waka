/**
 * User test fixtures.
 *
 * Two flavours, both exported:
 *
 *   1. Pure data factories (`userFactory`, `userInsertFactory`)
 *      — Build well-formed `NewUser` payloads without touching the DB.
 *        Useful for unit tests that exercise validation / hashing logic
 *        without provisioning a row, and for tests that want to compose
 *        their own `db.insert(users).values(...)` call.
 *
 *   2. Persistence helpers (`createUserFixture`, `createGoogleUserFixture`)
 *      — Insert a row into the supplied `TestDatabase.db` (or any
 *        `PostgresJsDatabase<typeof schema>`) and return the live row PLUS
 *        a ready-to-use session JWT, so a spec can immediately hit a
 *        protected route as that user via:
 *
 *          await app.request("/inspirations", {
 *            headers: { Authorization: `Bearer ${user.token}` },
 *          });
 *
 * Why both? The pure factory keeps "happy-path payload" assembly DRY across
 * unit tests; the persistence helper bundles the session-row creation that
 * `requireAuth` needs (see `lib/middleware.ts` + `lib/session.ts`) so that
 * route-level integration tests get a single one-liner setup.
 *
 * Determinism + isolation
 * -----------------------
 * Each fixture call generates a unique email by mixing a per-process
 * monotonic counter with `randomBytes`. Two parallel test files calling
 * `createUserFixture()` against the same Postgres schema will never collide
 * on the email unique index. The deterministic prefix (`waka-test-…`) makes
 * stray rows obvious during human triage if a teardown is skipped.
 *
 * Why the JWT goes through the real `signSessionToken` + `createSessionRow`
 * -----------------------------------------------------------------------
 * The auth middleware does NOT trust the JWT in isolation — it joins
 * `sessions` ⨝ `users` and demands a live, non-expired session row keyed
 * by SHA-256(token). A fixture that minted a JWT but skipped
 * `createSessionRow` would produce tokens that pass `verifySessionToken`
 * but fail at the middleware, leading to confusing 401s in tests. We
 * therefore exercise the same path the real signup handler does so the
 * fixture's `token` is a drop-in cookie / Authorization header value.
 */

import { randomBytes } from "node:crypto";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  type NewUser,
  type User,
  users,
} from "../../src/db/index.js";
import { hashPassword, signSessionToken } from "../../src/lib/auth.js";

import * as schema from "../../src/db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Drizzle handle accepted by every persistence helper. Matches the type
 * `createTestDatabase()` (test/helpers/db.ts) returns under `.db`, but is
 * structurally any postgres-js Drizzle client over our schema — so a spec
 * that wants to use the production singleton (`getDb()`) can pass that too.
 */
export type FixtureDb = PostgresJsDatabase<typeof schema>;

/**
 * Pure-data input for a user row, with every field defaulted to a sensible
 * value but everything overridable. The factory returns this shape so a
 * test can mutate one field (e.g. force `googleSub: "fixed-sub"`) without
 * having to spell out the rest.
 */
export interface UserFactoryOverrides extends Partial<NewUser> {
  /**
   * Plaintext password to hash. Distinct from `passwordHash` so callers can
   * specify either — helpful when a test wants the bcrypt comparison to
   * succeed with a known plaintext.
   *
   * If both `password` and `passwordHash` are supplied, `passwordHash` wins
   * (it's the lower-level field; the user explicitly asked for that hash).
   * If neither is supplied, a default plaintext is hashed.
   */
  password?: string;
}

/**
 * Result returned by `createUserFixture` / `createGoogleUserFixture`.
 *
 *  - `user`     : the freshly-inserted `users` row (post-defaults applied).
 *  - `password` : the plaintext password the row was hashed against. Only
 *                 set for email/password fixtures (undefined for OAuth).
 *  - `token`    : a fully-valid session JWT for the user. Pair with
 *                 `Authorization: Bearer ${token}` on `app.request`.
 *  - `tokenCookie` : the `Cookie: waka_session=...` header value, ready
 *                 to drop into `app.request({ headers: { Cookie } })` for
 *                 cookie-flow tests.
 */
export interface UserFixture {
  user: User;
  password?: string;
  token: string;
  tokenCookie: string;
}

// ---------------------------------------------------------------------------
// Determinism: unique-email generator
// ---------------------------------------------------------------------------

/**
 * Per-process monotonic counter. Combined with `randomBytes(4)` to produce
 * an email tail that's unique across both serial calls in a single file
 * AND parallel calls across vitest workers (which each have their own
 * process and so each have their own counter).
 */
let userCounter = 0;

/**
 * Build a unique-but-recognisable test email. Format:
 *   waka-test-user-<counter>-<hex8>@example.test
 *
 * `example.test` is RFC 6761 reserved — it can never be deliverable mail —
 * which keeps us safe even if a test row leaks to a service that tries to
 * email it.
 */
function generateTestEmail(prefix = "user"): string {
  userCounter += 1;
  const tail = randomBytes(4).toString("hex");
  return `waka-test-${prefix}-${userCounter}-${tail}@example.test`;
}

/**
 * Build a unique-but-recognisable Google OIDC subject. Real subs are
 * 21-digit numerics; we emit a 20-digit random digit string prefixed with
 * "9" so we don't collide with any plausible real value space.
 */
function generateTestGoogleSub(): string {
  // 12 random bytes → 24 hex chars → take 19 digits-ish and prefix.
  const tail = randomBytes(8).toString("hex").replace(/[a-f]/gi, "0");
  return `9${tail.slice(0, 19).padEnd(19, "0")}`;
}

// ---------------------------------------------------------------------------
// Pure data factories
// ---------------------------------------------------------------------------

/**
 * Build a `NewUser` insert payload with sensible defaults. Pure — does NOT
 * touch the database. Useful for unit tests that exercise validation logic
 * or that want to compose their own `db.insert(...)` call.
 *
 *   const payload = userInsertFactory({ name: "Ada" });
 *   await db.insert(users).values(payload);
 *
 * `passwordHash` defaults to the bcrypt of `DEFAULT_TEST_PASSWORD`. If the
 * caller wants a different plaintext, they should compute the hash
 * themselves (via `hashPassword`) — this function is sync to keep the unit
 * test ergonomics simple.
 */
export const DEFAULT_TEST_PASSWORD = "supersecret123";

/**
 * Bcrypt hash of {@link DEFAULT_TEST_PASSWORD}, computed once at module
 * load via top-level await. We compute it (rather than hard-coding a
 * pre-baked string) to keep the invariant
 *
 *   verifyPassword(DEFAULT_TEST_PASSWORD, DEFAULT_TEST_PASSWORD_HASH) === true
 *
 * unfalsifiable across bcryptjs version bumps. The cost factor matches the
 * one `lib/auth.ts:hashPassword` uses, so the resulting hash is
 * indistinguishable from one minted by the production signup handler.
 *
 * Top-level await is supported because the package is authored as ESM
 * (`"type": "module"` in package.json) and vitest's transformer respects
 * that. If a non-ESM consumer ever imports this file the runtime will
 * raise a clear ERR_REQUIRE_ASYNC_MODULE — which is the desired loud
 * failure rather than a silent stale-hash bug.
 */
const DEFAULT_TEST_PASSWORD_HASH = await hashPassword(DEFAULT_TEST_PASSWORD);

/**
 * Synchronous pure-data factory. Returns a `NewUser` insert payload.
 *
 * If `password` is supplied (without `passwordHash`), the caller must use
 * the async {@link userFactory} instead — this sync variant cannot hash on
 * the fly.
 */
export function userInsertFactory(
  overrides: Omit<UserFactoryOverrides, "password"> = {},
): NewUser {
  const email = overrides.email ?? generateTestEmail();
  const name = overrides.name ?? "Test User";
  return {
    email,
    name,
    passwordHash: overrides.passwordHash ?? DEFAULT_TEST_PASSWORD_HASH,
    googleSub: overrides.googleSub ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    ...overrides,
  };
}

/**
 * Async pure-data factory. Same as {@link userInsertFactory} but accepts a
 * `password` plaintext and bcrypt-hashes it. Use this when a test needs
 * `verifyPassword(plaintext, row.passwordHash)` to succeed against a
 * specific plaintext other than `DEFAULT_TEST_PASSWORD`.
 */
export async function userFactory(
  overrides: UserFactoryOverrides = {},
): Promise<NewUser> {
  const { password, passwordHash, ...rest } = overrides;
  let resolvedHash = passwordHash;
  if (!resolvedHash && password !== undefined) {
    resolvedHash = await hashPassword(password);
  }
  return userInsertFactory({ ...rest, passwordHash: resolvedHash });
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Insert an email/password user, mint a real session JWT + session row, and
 * return the fixture. This is the standard one-liner for protected-route
 * integration tests:
 *
 *   const alice = await createUserFixture(testDb.db);
 *   const res = await app.request("/inspirations", {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *       Authorization: `Bearer ${alice.token}`,
 *     },
 *     body: JSON.stringify({ text: "..." }),
 *   });
 *
 * `password` defaults to {@link DEFAULT_TEST_PASSWORD} so a follow-up
 * login-flow test can call `/auth/login` with the same plaintext and
 * succeed.
 *
 * IMPORTANT: this helper assumes `process.env.JWT_SECRET` (or
 * `AUTH_SECRET`) is set — see `test/setup.ts`. If neither is present,
 * `signSessionToken` throws loudly, which is the desired tripwire.
 */
export async function createUserFixture(
  db: FixtureDb,
  overrides: UserFactoryOverrides = {},
): Promise<UserFixture> {
  const password = overrides.password ?? DEFAULT_TEST_PASSWORD;
  const payload = await userFactory({
    ...overrides,
    // Force the password we'll return so the caller can reuse it. If the
    // caller supplied an explicit passwordHash, honour that and leave
    // `password` undefined in the result (the hash is not reversible).
    password: overrides.passwordHash ? undefined : password,
  });

  const [inserted] = await db.insert(users).values(payload).returning();
  if (!inserted) {
    throw new Error("createUserFixture: insert returned no rows");
  }

  const token = await signSessionToken({
    userId: inserted.id,
    email: inserted.email,
  });

  // Mirror the production signup path so the JWT is actually accepted by
  // `requireAuth`. We use the *production* getDb() target here only if the
  // caller passed it in via `db`; the session row is written through the
  // same connection the fixture inserted users on so test-schema isolation
  // is preserved. createSessionRow internally calls getDb() which uses the
  // process-global singleton — see note below.
  await createSessionRowOnDb(db, inserted.id, token);

  return {
    user: inserted,
    password: overrides.passwordHash ? undefined : password,
    token,
    tokenCookie: `waka_session=${token}`,
  };
}

/**
 * Insert a Google-OAuth-only user (no password) and return the fixture.
 * Mirrors the post-OAuth-callback path in `routes/auth-google.ts`: the
 * row has `passwordHash = null`, a populated `googleSub`, and an
 * `avatarUrl`. Use this when a test needs to assert that an OAuth-only
 * account can sign session-required requests.
 */
export async function createGoogleUserFixture(
  db: FixtureDb,
  overrides: UserFactoryOverrides = {},
): Promise<UserFixture> {
  const payload = await userFactory({
    ...overrides,
    passwordHash: overrides.passwordHash ?? null,
    googleSub: overrides.googleSub ?? generateTestGoogleSub(),
    avatarUrl:
      overrides.avatarUrl ?? "https://lh3.googleusercontent.com/a/test-avatar",
    name: overrides.name ?? "Google Test User",
    email: overrides.email ?? generateTestEmail("google"),
  });

  const [inserted] = await db.insert(users).values(payload).returning();
  if (!inserted) {
    throw new Error("createGoogleUserFixture: insert returned no rows");
  }

  const token = await signSessionToken({
    userId: inserted.id,
    email: inserted.email,
  });
  await createSessionRowOnDb(db, inserted.id, token);

  return {
    user: inserted,
    password: undefined,
    token,
    tokenCookie: `waka_session=${token}`,
  };
}

// ---------------------------------------------------------------------------
// Internal: schema-correct session-row insertion
// ---------------------------------------------------------------------------

/**
 * Why we don't just call `createSessionRow` from `lib/session.ts`:
 *
 * `createSessionRow` reaches for `getDb()` — the process-global Neon
 * connection — which is bound to the `public` schema. The whole point of
 * `createTestDatabase()` is to redirect writes to a per-suite isolated
 * schema. Routing through `getDb()` would write the session row to
 * `public.sessions` while the user lives in `waka_test_xyz.users`, and the
 * subsequent middleware lookup would inner-join across schemas and find
 * nothing.
 *
 * To keep the fixture schema-correct we replicate the body of
 * `createSessionRow` against the supplied `FixtureDb`. The implementation
 * is intentionally short — it is the same SHA-256 + INSERT pair as in
 * production — but it MUST stay in lock-step with the production version.
 * If `createSessionRow` ever grows new columns / side-effects, mirror them
 * here too.
 */
async function createSessionRowOnDb(
  db: FixtureDb,
  userId: string,
  token: string,
): Promise<void> {
  // Lazy import to avoid a circular: lib/session imports getDb which would
  // try to read DB_CONNECTION_URL at module-eval time in some test envs.
  // Importing the schema directly + the hash helper sidesteps that.
  const { sessions } = schema;
  const { hashSessionToken } = await import("../../src/lib/session.js");
  const { SESSION_TTL_SECONDS } = await import("../../src/lib/auth.js");

  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Re-exports — convenience for callers that want everything in one import
// ---------------------------------------------------------------------------

export { users };
export type { NewUser, User };
