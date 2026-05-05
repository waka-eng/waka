/**
 * Auth route test suite — covers POST /auth/signup and POST /auth/login.
 *
 * Surface under test
 * ------------------
 * The Seed contract requires the auth flow to:
 *
 *   1. Hash passwords with bcrypt before persistence (no plaintext).
 *   2. Issue a session JWT + httpOnly cookie on success.
 *   3. Return shape-stable validation errors on bad input.
 *   4. Reject duplicate-email signups with 409.
 *   5. Reject wrong credentials on login with 401.
 *
 * These tests exercise the real Hono application via `app.request(...)` so
 * the path includes the signup/login handlers, the bcrypt + JWT primitives in
 * `lib/auth.ts`, and the server-side `sessions` row insert in `lib/session.ts`.
 * The DB endpoint is the live Neon instance pinned by `DB_CONNECTION_URL` —
 * same target as `sst dev` — and we keep tests hermetic by:
 *
 *   - using RFC-6761 `@example.test` emails generated per-test, so concurrent
 *     workers never collide on the unique index.
 *   - tracking every user id we insert and DELETEing them in `afterEach`
 *     (CASCADE reaps any session rows automatically).
 *
 * Why not vitest-mocked DB?
 * -------------------------
 * Mocking Drizzle here would replace the most failure-prone parts of the
 * real flow (the unique-index race, the cascade behaviour, the bcrypt hash
 * shape) with hand-written stubs that drift from production. Round-tripping
 * through Postgres is the only way to know the migration + schema actually
 * supports the contract these tests assert.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

import { sessions, users } from "../src/db/index.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  hashPassword,
  verifySessionToken,
} from "../src/lib/auth.js";
import { getDb } from "../src/lib/db.js";
import { hashSessionToken } from "../src/lib/session.js";
import { app } from "../src/index.js";

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

/**
 * Every user id inserted during the suite. Populated by helpers that hit
 * `/auth/signup` (which is the only path that creates rows in these tests),
 * and drained by `afterEach` so a failed assertion never leaks a row into
 * the shared schema. ON DELETE CASCADE on `sessions.user_id` cleans up
 * any associated session rows along with the user.
 */
const insertedUserIds = new Set<string>();

/**
 * Helper that records an inserted user for end-of-test cleanup AND returns
 * the id, so call-sites can write `const id = trackUser(body.user.id)` in
 * one line.
 */
function trackUser(id: string): string {
  insertedUserIds.add(id);
  return id;
}

afterEach(async () => {
  if (insertedUserIds.size === 0) return;
  const ids = [...insertedUserIds];
  insertedUserIds.clear();
  // Single round-trip; CASCADE on FK reaps sessions.
  await getDb().delete(users).where(inArray(users.id, ids));
});

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

/**
 * Build a unique-but-recognisable signup payload. The email tail is process+
 * time-randomised so two parallel workers never collide. Default password is
 * 12 chars (signup floor is 8) so the same payload is re-usable for login.
 */
function makeSignupPayload(overrides: Partial<{
  email: string;
  password: string;
  name: string;
}> = {}) {
  const tail = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: overrides.email ?? `auth-test-${tail}@example.test`,
    password: overrides.password ?? "supersecret123",
    name: overrides.name ?? "Auth Test",
  };
}

/**
 * Read the `waka_session=...` value from a `Set-Cookie` header, or throw if
 * the header is missing/malformed. We assert on shape here so a regression
 * in `buildSessionCookie` (e.g. dropping the cookie name) surfaces as the
 * specific failure rather than a misleading downstream "token undefined".
 */
function extractSessionCookieValue(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error("Set-Cookie header is missing");
  }
  const match = setCookie.match(/waka_session=([^;]+)/);
  if (!match || !match[1]) {
    throw new Error(`Set-Cookie missing waka_session: ${setCookie}`);
  }
  return match[1];
}

/**
 * Convenience: signup helper used by login tests so they can be expressed
 * as "given a user with this password, log in works/fails".
 */
async function signupUser(
  payload: ReturnType<typeof makeSignupPayload>,
): Promise<{ id: string; email: string; name: string; token: string }> {
  const res = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };
  trackUser(body.user.id);
  return { ...body.user, token: body.token };
}

// ---------------------------------------------------------------------------
// Pre-flight: env was loaded by test/setup.ts so getDb() is usable.
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Defensive — `setup.ts` already throws on missing values, but a developer
  // running `vitest --no-config` would skip that and end up with very
  // confusing "fetch failed" errors. Keep this here as a second line of
  // defence for the auth surface specifically.
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();
});

afterAll(async () => {
  // Belt-and-braces: if a test failed mid-flight before its cleanup ran,
  // ensure no rows are left behind on the shared Neon schema.
  if (insertedUserIds.size > 0) {
    const ids = [...insertedUserIds];
    insertedUserIds.clear();
    await getDb()
      .delete(users)
      .where(inArray(users.id, ids))
      .catch(() => {
        // Suite is exiting; surfacing this as a hard failure would only mask
        // the original test failure. Best-effort cleanup is correct here.
      });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/signup
// ---------------------------------------------------------------------------

describe("POST /auth/signup", () => {
  it("creates a new user, hashes the password, returns a token + cookie", async () => {
    const payload = makeSignupPayload();
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // 1. Status + envelope.
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string };
      token: string;
    };
    expect(body.user.email).toBe(payload.email.toLowerCase());
    expect(body.user.name).toBe(payload.name);
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.token).toBeTruthy();
    trackUser(body.user.id);

    // 2. Set-Cookie carries the same token, with the production-grade flags.
    const setCookie = res.headers.get("set-cookie");
    const cookieValue = extractSessionCookieValue(setCookie);
    expect(cookieValue).toBe(body.token);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);

    // 3. Token decodes back to the inserted user.
    const decoded = await verifySessionToken(body.token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe(body.user.id);
    expect(decoded?.email).toBe(body.user.email);

    // 4. DB row exists, password is bcrypt-hashed (NOT plaintext), and a
    //    session row backs the token.
    const db = getDb();
    const dbRows = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, body.user.id));
    expect(dbRows).toHaveLength(1);
    const stored = dbRows[0]!;
    expect(stored.email).toBe(payload.email.toLowerCase());
    expect(stored.passwordHash).toBeTruthy();
    // Plaintext must NOT have been persisted.
    expect(stored.passwordHash).not.toBe(payload.password);
    // bcrypt hashes start with $2a$, $2b$, or $2y$ followed by the cost factor.
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    // The hash MUST round-trip with the original plaintext.
    const matches = await bcrypt.compare(
      payload.password,
      stored.passwordHash!,
    );
    expect(matches).toBe(true);

    const tokenHash = await hashSessionToken(body.token);
    const sessionRows = await db
      .select({ id: sessions.id, userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]!.userId).toBe(body.user.id);
  });

  it("normalises email to lowercase + trims whitespace before persisting", async () => {
    const payload = makeSignupPayload({
      email: `  Mixed-Case-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}@Example.Test  `,
    });
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string };
    };
    trackUser(body.user.id);
    expect(body.user.email).toBe(payload.email.trim().toLowerCase());
  });

  it("rejects an invalid email with 400 + per-field errors", async () => {
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "supersecret123" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details?: { email?: string[]; password?: string[] };
    };
    expect(body.error).toMatch(/invalid signup payload/i);
    expect(body.details?.email?.[0]).toMatch(/email/i);
  });

  it("rejects a too-short password with 400 + per-field errors", async () => {
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `short-${Date.now()}@example.test`,
        password: "short",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      details?: { password?: string[] };
    };
    expect(body.details?.password?.[0]).toMatch(/8/);
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "<<not json>>",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
  });

  it("rejects a duplicate email with 409", async () => {
    const payload = makeSignupPayload();
    const first = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { user: { id: string } };
    trackUser(firstBody.user.id);

    const dup = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { error: string };
    expect(dupBody.error).toMatch(/already exists/i);
  });

  it("treats email case as canonicalised when checking for duplicates", async () => {
    const tail = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const lower = `dupe-case-${tail}@example.test`;
    const upper = `DUPE-CASE-${tail}@EXAMPLE.TEST`;

    const first = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lower, password: "supersecret123" }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { user: { id: string } };
    trackUser(firstBody.user.id);

    const dup = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: upper, password: "supersecret123" }),
    });
    expect(dup.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe("POST /auth/login", () => {
  it("returns 200 + token + cookie for a valid email/password pair", async () => {
    const payload = makeSignupPayload();
    const created = await signupUser(payload);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string };
      token: string;
    };
    expect(body.user.id).toBe(created.id);
    expect(body.user.email).toBe(payload.email.toLowerCase());
    expect(body.user.name).toBe(payload.name);
    expect(body.token).toBeTruthy();
    // Login must mint a NEW token rather than echoing whatever the signup
    // round-trip handed back. Two distinct tokens means two distinct
    // session rows, which is the correct revocability story (logging out
    // of one tab must not log the other out).
    expect(body.token).not.toBe(created.token);

    const setCookie = res.headers.get("set-cookie");
    const cookieValue = extractSessionCookieValue(setCookie);
    expect(cookieValue).toBe(body.token);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);

    const decoded = await verifySessionToken(body.token);
    expect(decoded?.sub).toBe(created.id);
    expect(decoded?.email).toBe(payload.email.toLowerCase());

    // Server-side session row exists for the freshly minted token.
    const tokenHash = await hashSessionToken(body.token);
    const sessionRows = await getDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    expect(sessionRows).toHaveLength(1);
  });

  it("normalises email case on lookup so login is case-insensitive", async () => {
    const payload = makeSignupPayload();
    await signupUser(payload);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: payload.email.toUpperCase(),
        password: payload.password,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 for a wrong password (and does NOT mint a session row)", async () => {
    const payload = makeSignupPayload();
    await signupUser(payload);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: payload.email,
        password: `${payload.password}-wrong`,
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/incorrect/i);

    // No Set-Cookie issued on failure.
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie ?? "").not.toContain(`${SESSION_COOKIE_NAME}=`);

    // No accidental session-row spam: still only the row from signup.
    const db = getDb();
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, payload.email.toLowerCase()));
    expect(userRows).toHaveLength(1);
    const sessionRowsForUser = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userRows[0]!.id));
    expect(sessionRowsForUser).toHaveLength(1);
  });

  it("returns the same generic 401 for an unknown email (no enumeration)", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `does-not-exist-${Date.now()}@example.test`,
        password: "supersecret123",
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/incorrect/i);
  });

  it("returns 401 for an OAuth-only account (no passwordHash)", async () => {
    // Insert an OAuth-only row directly — there is no signup endpoint that
    // creates a password-less account, so we go via Drizzle to set up the
    // fixture. The cleanup tracker handles teardown.
    const db = getDb();
    const tail = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const email = `oauth-only-${tail}@example.test`;
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        passwordHash: null,
        googleSub: `9${"0".repeat(20)}-${tail}`.slice(0, 32),
        name: "OAuth Only",
      })
      .returning({ id: users.id });
    trackUser(inserted!.id);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "supersecret123" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/incorrect/i);
  });

  it("rejects a missing email with 400 + per-field errors", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "", password: "supersecret123" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      details?: { email?: string[] };
    };
    expect(body.details?.email?.[0]).toMatch(/required/i);
  });

  it("rejects a missing password with 400 + per-field errors", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `noop-${Date.now()}@example.test`,
        password: "",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      details?: { password?: string[] };
    };
    expect(body.details?.password?.[0]).toMatch(/required/i);
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "<<not json>>",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: password hashing primitives
// ---------------------------------------------------------------------------

/**
 * `hashPassword` / `verifyPassword` underpin both routes. Test them at the
 * unit level too so a regression in the cost factor or the bcrypt variant
 * is caught even if the route-level tests happen to pass for unrelated
 * reasons.
 */
describe("password hashing", () => {
  it("hashes a plaintext password to a bcrypt $2-prefixed string", async () => {
    const hash = await hashPassword("supersecret123");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).not.toContain("supersecret123");
  });

  it("produces distinct hashes for the same plaintext (random salt)", async () => {
    const a = await hashPassword("supersecret123");
    const b = await hashPassword("supersecret123");
    expect(a).not.toBe(b);
  });

  it("verifies the original plaintext against the hash", async () => {
    const hash = await hashPassword("supersecret123");
    await expect(bcrypt.compare("supersecret123", hash)).resolves.toBe(true);
    await expect(bcrypt.compare("supersecret124", hash)).resolves.toBe(false);
  });
});
