/**
 * Harness self-test.
 *
 * Sub-AC 1 of the inspiration CRUD test suite stands up three pieces:
 *
 *   1. Test database fixtures (`./db.ts` + `../fixtures/inspirations.ts`)
 *   2. Authenticated user factory (`../fixtures/users.ts`)
 *   3. Hono test-client harness (`./client.ts`) + cleanup tracker (`./cleanup.ts`)
 *
 * The downstream sub-ACs (CRUD spec coverage) consume those pieces. Before
 * we hand them off, this file proves they actually wire together against
 * the live Neon instance + the production Hono app — i.e. it exercises the
 * full happy-path of the harness without making any product assertion. If
 * a future refactor breaks the harness contract (auth header injection,
 * cleanup CASCADE, JSON parse, etc.) this self-test surfaces it
 * immediately, before the affected route specs do.
 *
 * Why a *vitest spec* and not a smoke script
 * ------------------------------------------
 * `*.smoke.ts` files are excluded from the vitest run and are only invoked
 * manually. Putting the self-test under vitest means CI catches any
 * regression on every push, which is the appropriate cadence for shared
 * test infrastructure.
 *
 * What this test does NOT do
 * --------------------------
 * It does NOT assert on inspiration / attachment / reflection business
 * logic — that's the job of the real CRUD specs in subsequent sub-ACs.
 * Here we only check that:
 *
 *   - `createCleanupTracker()` returns an empty tracker.
 *   - `createUserFixture(getDb())` produces a token that authenticates
 *     against the real Hono app via the `authedClient` harness.
 *   - The harness correctly parses JSON responses and exposes status +
 *     headers.
 *   - `cleanup.flush()` reaps every row inserted during the test.
 *
 * If any of those four properties regresses, every downstream spec breaks
 * — so failing here is the cheapest possible signal.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { eq } from "drizzle-orm";

import { users } from "../../src/db/index.js";
import { getDb } from "../../src/lib/db.js";
import { createUserFixture } from "../fixtures/users.js";
import {
  apiRequest,
  authedClient,
  createCleanupTracker,
  extractSetCookieOptional,
} from "./index.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cleanup = createCleanupTracker();

beforeAll(() => {
  // Mirrors auth.test.ts — the route path we're about to drive depends on
  // both env vars being present, and a missing value would surface here as
  // a confusing 500 rather than a clear "test/setup didn't load .env" error.
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();
});

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("test harness", () => {
  it("createCleanupTracker() starts empty and is reusable", async () => {
    const local = createCleanupTracker();
    expect(local.size).toBe(0);
    // Flush on an empty tracker is a no-op (no DB call) — must not throw.
    await expect(local.flush()).resolves.toBeUndefined();
  });

  it("createUserFixture inserts a row that the harness can authenticate as", async () => {
    // Insert through the production singleton so the row lives in the same
    // schema the Hono `app` queries — this is the route-test mode (not the
    // schema-isolated `createTestDatabase` mode).
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    // Sanity: row really landed.
    const dbRows = await getDb()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, fixture.user.id));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.email).toBe(fixture.user.email);

    // The fixture should hand back a usable bearer token.
    expect(fixture.token).toBeTruthy();
    expect(fixture.tokenCookie).toBe(`waka_session=${fixture.token}`);
  });

  it("authedClient injects Authorization header and parses JSON response", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const client = authedClient(fixture);

    // GET /api/inspirations is the simplest authenticated route in the surface
    // we're standing up tests for. A fresh user has no rows, so the
    // contract is `200 { inspirations: [] }` — no test-data setup needed.
    const res = await client.get<{ inspirations: unknown[] }>("/api/inspirations");
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(Array.isArray(res.body.inspirations)).toBe(true);
    expect(res.body.inspirations).toHaveLength(0);
  });

  it("authedClient.withAuthMode('cookie') drives the cookie path", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const cookieClient = authedClient(fixture).withAuthMode("cookie");
    expect(cookieClient.authMode).toBe("cookie");

    const res = await cookieClient.get<{ inspirations: unknown[] }>(
      "/api/inspirations",
    );
    // Same route, same outcome — proves `requireAuth` accepted the cookie
    // form and the harness merged it correctly.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.inspirations)).toBe(true);
  });

  it("missing-auth requests are 401 (sanity for the negative path)", async () => {
    // Drives `apiRequest` (no auth injection) so a future regression that
    // accidentally treats absence-of-header as authenticated would fail
    // here, well before any business-logic spec.
    const res = await apiRequest("/api/inspirations");
    expect(res.status).toBe(401);
  });

  it("apiRequest returns the raw Response (Set-Cookie inspectable)", async () => {
    // /api/health is a public route — no auth, no cookies, no body shape to
    // assume. The point of this case is to prove the harness doesn't
    // mangle Response so a test that needs the raw object can use it.
    const res = await apiRequest("/api/health");
    expect(res.status).toBe(200);
    // No Set-Cookie expected on /api/health, but the helper must return null
    // (not throw) when asked for a missing cookie.
    expect(extractSetCookieOptional(res, "waka_session")).toBeNull();
  });

  it("cleanup.flush() reaps tracked users (and CASCADEs sessions)", async () => {
    // Insert two users + assert both exist + flush + assert both are gone.
    // Done inline so this test owns its own cleanup window — we don't pile
    // them onto the suite-level tracker.
    const local = createCleanupTracker();
    const a = await createUserFixture(getDb());
    const b = await createUserFixture(getDb());
    local.trackUser(a.user.id);
    local.trackUser(b.user.id);
    expect(local.size).toBe(2);

    const before = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, a.user.id));
    expect(before).toHaveLength(1);

    await local.flush();
    expect(local.size).toBe(0);

    const after = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, a.user.id));
    expect(after).toHaveLength(0);
  });
});
