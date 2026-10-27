import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accounts, profiles } from "../db/index.js";
import type { AuthenticatedSession } from "../lib/session.js";

const SESSION: AuthenticatedSession = {
  sessionId: "session-1",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "profile-1",
    accountId: "account-1",
    type: "human",
    name: "Existing",
    preferredLocale: "en-US",
  },
};

/** The rows `loadIdentity` resolves for the session above. */
const ACCOUNT_ROW = {
  id: "account-1",
  email: "user@example.com",
  onboardingCompletedAt: null as Date | null,
};

const PROFILE_ROW = {
  id: "profile-1",
  accountId: "account-1",
  type: "human" as const,
  name: "Existing",
  avatarUrl: null as string | null,
  preferredLocale: "en-US",
  publicHandle: null as string | null,
  publicProfileEnabled: false,
  publicTopOfMindEnabled: false,
};

const dbState = vi.hoisted(() => ({ db: {} as any }));
const wakeReading = vi.hoisted(() => vi.fn(async () => undefined));
const refreshReading = vi.hoisted(() => vi.fn(async () => ({ jobId: 'reading-job', requestVersion: 1n })));
vi.mock('../lib/queue.js', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/queue.js')>(), enqueueTopOfMindRefresh: refreshReading, wakeCommittedBackgroundJobs: wakeReading,
}));

const erasureState = vi.hoisted(() => ({
  erase: vi.fn(async (_accountId: string, _deps: { db: unknown }) => undefined),
}));

vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: () => Promise<void>) => {
      const authorization = c.req.header("Authorization");
      if (!authorization?.toLowerCase().startsWith("bearer ")) {
        return c.json({ error: "Authentication required" }, 401);
      }
      c.set("session", SESSION);
      c.set("sessionToken", authorization.slice(7).trim());
      await next();
    },
  };
});

vi.mock("../lib/db.js", () => ({
  getDb: () => dbState.db,
}));

vi.mock("../lib/account-erasure.js", () => ({
  eraseAccount: erasureState.erase,
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_COOKIE_NAME: "waka_session",
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  buildSessionClearCookie: () => "waka_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  buildSessionCookie: () => "waka_session=test; Path=/; HttpOnly; SameSite=Lax",
  hashPassword: vi.fn(async () => "hashed-password"),
  signSessionToken: vi.fn(async () => "signed-token"),
  verifyPassword: vi.fn(async () => true),
  verifySessionToken: vi.fn(async () => null),
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: vi.fn(async () => undefined),
  revokeSessionByToken: vi.fn(async () => undefined),
  hashSessionToken: vi.fn(async () => "hashed-token"),
}));

import { authRoutes } from "./auth.js";

function app() {
  const hono = new Hono();
  hono.route("/api/auth", authRoutes);
  return hono;
}

/**
 * `selects` is consumed in call order: the identity read first, then the
 * handle-availability check when one runs. Writes are recorded in `setCalls`
 * tagged with their table, since a profile edit can touch both tables.
 */
function makeDb(input: {
  selects?: unknown[][];
  updatedProfile?: unknown;
  updatedAccount?: unknown;
  failWithCode?: string;
} = {}) {
  const selects = [...(input.selects ?? [])];
  const select = vi.fn((fields?: Record<string, unknown>) => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const isLocaleLock = fields && Object.keys(fields).length === 1 && fields.preferredLocale;
      const rows = isLocaleLock ? [{ preferredLocale: PROFILE_ROW.preferredLocale }] : selects.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.limit = vi.fn(async () => rows);
      result.for = vi.fn(async () => rows);
      return result;
    });
    return chain;
  });

  const setCalls: Array<{ table: unknown; values: any }> = [];
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: any) => {
      setCalls.push({ table, values });
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (input.failWithCode) {
              throw Object.assign(new Error("constraint"), { code: input.failWithCode });
            }
            return table === accounts
              ? [input.updatedAccount ?? ACCOUNT_ROW]
              : [input.updatedProfile ?? PROFILE_ROW];
          }),
        })),
      };
    }),
  }));

  const db: any = { select, update, setCalls };
  db.transaction = vi.fn(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  return db;
}

/** The identity read every authenticated handler starts from. */
function identity(overrides: { account?: unknown; profile?: unknown } = {}) {
  return [
    {
      account: { ...ACCOUNT_ROW, ...(overrides.account ?? {}) },
      profile: { ...PROFILE_ROW, ...(overrides.profile ?? {}) },
    },
  ];
}

function authorized(body: unknown, method: string) {
  return {
    method,
    body: JSON.stringify(body),
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
  };
}

beforeEach(() => {
  delete process.env.WAKA_ADMIN_EMAILS;
  delete process.env.WAKA_ADMIN_ALLOWLIST;
  dbState.db = makeDb({ selects: [identity()] });
  vi.clearAllMocks();
});

describe("GET /api/auth/me", () => {
  it("returns the account and the profile the session acts as", async () => {
    dbState.db = makeDb({ selects: [identity()] });

    const response = await app().request("/api/auth/me", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      account: { id: "account-1", email: "user@example.com", isAdmin: false },
      profile: { id: "profile-1", type: "human", name: "Existing" },
    });
  });

  it("marks allowlisted accounts as admins", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com, user@example.com";
    dbState.db = makeDb({ selects: [identity()] });

    const response = await app().request("/api/auth/me", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      account: { email: "user@example.com", isAdmin: true },
    });
  });

  it("401s when the acting profile no longer exists", async () => {
    dbState.db = makeDb({ selects: [[]] });

    const response = await app().request("/api/auth/me", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/auth/me/preferences", () => {
  it('requests a manual reread when the selected language changes', async () => {
    refreshReading.mockClear();
    dbState.db = makeDb({ selects: [identity({ profile: { preferredLocale: 'ko-KR' } })] });
    const response = await app().request('/api/auth/me/preferences', authorized({ preferredLocale: 'ko-KR' }, 'PATCH'));
    expect(response.status).toBe(200);
    expect(refreshReading).toHaveBeenCalledWith('profile-1', 'manual', dbState.db);
    expect(wakeReading).toHaveBeenCalledWith([{ id: 'reading-job', profileId: 'profile-1', requestVersion: '1' }]);
  });
  it("writes the locale onto the acting profile", async () => {
    const db = makeDb({
      selects: [identity({ profile: { preferredLocale: "en-US" } })],
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/preferences",
      authorized({ preferredLocale: "en-US" }, "PATCH"),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls).toHaveLength(1);
    expect(db.setCalls[0]!.table).toBe(profiles);
    expect(db.setCalls[0]!.values).toMatchObject({ preferredLocale: "en-US" });
    await expect(response.json()).resolves.toMatchObject({
      profile: { preferredLocale: "en-US" },
    });
  });
});

describe("PATCH /api/auth/me/profile", () => {
  it('also requests a reread when a profile edit changes the language', async () => {
    refreshReading.mockClear();
    dbState.db = makeDb({ selects: [identity()], updatedProfile: { ...PROFILE_ROW, preferredLocale: 'ko-KR' } });
    const response = await app().request('/api/auth/me/profile', authorized({ name: 'Existing', preferredLocale: 'ko-KR' }, 'PATCH'));
    expect(response.status).toBe(200);
    expect(refreshReading).toHaveBeenCalledWith('profile-1', 'manual', dbState.db);
    expect(wakeReading).toHaveBeenCalledWith([{ id: 'reading-job', profileId: 'profile-1', requestVersion: '1' }]);
  });
  it("requires authentication", async () => {
    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Mina", preferredLocale: "en-US" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects invalid profile payloads", async () => {
    const response = await app().request(
      "/api/auth/me/profile",
      authorized({ name: "", preferredLocale: "fr-FR", extra: true }, "PATCH"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid profile payload",
      details: {
        name: ["Display name is required"],
        preferredLocale: expect.any(Array),
      },
    });
  });

  it("persists display names containing spaces", async () => {
    const db = makeDb({
      selects: [identity()],
      updatedProfile: { ...PROFILE_ROW, name: "Mina Park" },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized({ name: " Mina Park ", preferredLocale: "en-US" }, "PATCH"),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls[0]!.values).toMatchObject({ name: "Mina Park" });
    await expect(response.json()).resolves.toMatchObject({
      profile: { name: "Mina Park" },
    });
  });

  /**
   * ═══ A RENAME DOES NOT TOUCH THE PUBLIC PAGE ═══════════════════════════
   *
   * SECURITY REVIEW 2026-10-11, FINDING 4. This endpoint is deliberately two
   * different things at once, and the asymmetry is the whole safety argument
   * for moving the public-page controls into the settings panel:
   *
   *   - `name` and `preferredLocale` are a REPLACE. `profileSchema` requires
   *     both, so a caller always states them and the stated value wins.
   *   - `publicHandle`, `publicProfileEnabled` and `publicTopOfMindEnabled`
   *     are a MERGE — `parsed.data.x ?? current.profile.x` in
   *     `auth-me.ts:211-232`. Omitting them means "leave them", not "clear
   *     them".
   *
   * The merge is what makes `SettingsPanel`'s rename path safe. That path
   * sends `{ name, preferredLocale }` and nothing else, and the `set()` call
   * below it writes all five columns unconditionally — so if the three
   * public fields were read from `parsed.data` directly instead of through
   * `??`, every rename would write `publicHandle: null,
   * publicProfileEnabled: false, publicTopOfMindEnabled: false` and silently
   * take somebody's public page down. Not fail. Take it down, and return 200.
   *
   * WHY THIS TEST EXISTS WHEN THE BEHAVIOUR IS ALREADY CORRECT. Nothing held
   * it in place. Every other case in this describe that touches the public
   * fields SUPPLIES them, so the merge branch is never exercised; and the one
   * rename-only case — "persists display names containing spaces" above —
   * asserts `toMatchObject({ name: "Mina Park" })`, which by construction
   * passes while `publicHandle: null` sits in the same `values` object. The
   * review's words: "a future editor 'simplifying' `profileHandler` to plain
   * assignment would turn every rename into a silent public-page shutdown
   * and the suite would stay green." Verified by doing exactly that — see the
   * before/after in the finding's report; replacing the three `??` with
   * `parsed.data.*` fails this case and nothing else in the file.
   *
   * WHY `toMatchObject` IS RIGHT HERE and wrong above. The assertion now
   * NAMES the fields that have to survive, so extra keys in `values` are
   * genuinely irrelevant rather than conveniently ignored. The exact-equality
   * alternative would couple this case to `updatedAt` and to every column
   * added to the profile row later, and would start failing for reasons that
   * have nothing to do with the public page.
   *
   * WHAT THIS MOCKS, AND WHY (gate G6): the database, through `makeDb` — the
   * subject is the VALUES this handler hands to `set()`, and a fake db is the
   * only way to read them. The route, the schema, the merge and the
   * transaction are all real. A db test would assert the round-trip instead
   * and would not notice a handler that writes the right row for the wrong
   * reason.
   */
  it("leaves the public page alone when a rename does not mention it", async () => {
    const live = {
      publicHandle: "mina",
      publicProfileEnabled: true,
      publicTopOfMindEnabled: true,
    };
    const db = makeDb({
      selects: [identity({ profile: live })],
      updatedProfile: { ...PROFILE_ROW, ...live, name: "Mina Park" },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      /* EXACTLY WHAT THE PANEL'S RENAME SENDS. No public fields, not even
         as nulls — `SettingsPanel` posts these two keys and stops. */
      authorized({ name: "Mina Park", preferredLocale: "ko-KR" }, "PATCH"),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls).toHaveLength(1);
    expect(db.setCalls[0]!.table).toBe(profiles);
    /* THE THREE THAT MUST SURVIVE, named one by one. */
    expect(db.setCalls[0]!.values).toMatchObject({
      name: "Mina Park",
      preferredLocale: "ko-KR",
      publicHandle: "mina",
      publicProfileEnabled: true,
      publicTopOfMindEnabled: true,
    });
    /* And the response the client writes back into its session agrees, so a
       correct write cannot be followed by a stale panel that shows the page
       as off. */
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        name: "Mina Park",
        publicHandle: "mina",
        publicProfileEnabled: true,
        publicTopOfMindEnabled: true,
      },
    });
  });

  /**
   * THE OTHER HALF OF THE MERGE, which is just as load-bearing and is the
   * reason `publicHandle` is read with an `=== undefined` check rather than
   * `??`: an EXPLICIT `null` must clear the handle. "Leave it alone" and
   * "take it down" have to be distinguishable, and `??` alone cannot tell
   * `null` from absent — so a `??` on the handle would make the public page
   * impossible to retract, which is the privacy failure in the opposite
   * direction. Asserted here so a later tidy-up that unifies the three reads
   * into one `??` fails on this case instead of only on the one above.
   */
  it("clears the public page when the caller explicitly says null", async () => {
    const db = makeDb({
      selects: [
        identity({
          profile: {
            publicHandle: "mina",
            publicProfileEnabled: false,
            publicTopOfMindEnabled: false,
          },
        }),
      ],
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: "Mina Park", preferredLocale: "en-US", publicHandle: null },
        "PATCH",
      ),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls[0]!.values).toMatchObject({ publicHandle: null });
  });

  it("stamps onboarding on the account while the display identity stays on the profile", async () => {
    const completedAt = new Date("2026-06-20T10:15:30.000Z");
    const db = makeDb({
      selects: [identity()],
      updatedProfile: { ...PROFILE_ROW, name: "Mina Lee", preferredLocale: "en-US" },
      updatedAccount: { ...ACCOUNT_ROW, onboardingCompletedAt: completedAt },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: " Mina Lee ", preferredLocale: "en-US", completeOnboarding: true },
        "PATCH",
      ),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls[0]!.table).toBe(profiles);
    expect(db.setCalls[0]!.values).toMatchObject({
      name: "Mina Lee",
      preferredLocale: "en-US",
      updatedAt: expect.any(Date),
    });
    expect(db.setCalls[1]!.table).toBe(accounts);
    expect(db.setCalls[1]!.values).toMatchObject({
      onboardingCompletedAt: expect.any(Date),
    });
    await expect(response.json()).resolves.toMatchObject({
      account: { onboardingCompletedAt: completedAt.toISOString() },
      profile: { name: "Mina Lee", preferredLocale: "en-US" },
    });
  });

  it("keeps an existing onboarding completion timestamp stable", async () => {
    const existingCompletedAt = new Date("2026-06-19T08:00:00.000Z");
    const db = makeDb({
      selects: [identity({ account: { onboardingCompletedAt: existingCompletedAt } })],
      updatedProfile: { ...PROFILE_ROW, name: "Mina" },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: "Mina", preferredLocale: "en-US", completeOnboarding: true },
        "PATCH",
      ),
    );

    expect(response.status).toBe(200);
    // Only the profile is written: the stamp is already set and never moves.
    expect(db.setCalls).toHaveLength(1);
    expect(db.setCalls[0]!.table).toBe(profiles);
    await expect(response.json()).resolves.toMatchObject({
      account: { onboardingCompletedAt: existingCompletedAt.toISOString() },
    });
  });

  it("normalizes and persists hyphenated public handle settings", async () => {
    const db = makeDb({
      // Identity, then the availability check finding nobody else on it.
      selects: [identity(), []],
      updatedProfile: {
        ...PROFILE_ROW,
        name: "Mina",
        publicHandle: "mixed-case_handle",
        publicProfileEnabled: true,
        publicTopOfMindEnabled: true,
      },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        {
          name: "Mina",
          preferredLocale: "en-US",
          publicHandle: "@Mixed-Case_Handle",
          publicProfileEnabled: true,
          publicTopOfMindEnabled: true,
        },
        "PATCH",
      ),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls[0]!.values).toMatchObject({
      publicHandle: "mixed-case_handle",
      publicProfileEnabled: true,
      publicTopOfMindEnabled: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        publicHandle: "mixed-case_handle",
        publicProfileEnabled: true,
        publicTopOfMindEnabled: true,
      },
    });
  });

  it("requires a public handle before enabling public sharing", async () => {
    const db = makeDb({ selects: [identity()] });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        {
          name: "Mina",
          preferredLocale: "en-US",
          publicHandle: "",
          publicProfileEnabled: true,
        },
        "PATCH",
      ),
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      details: { publicHandle: ["Choose a public handle first"] },
    });
  });

  it("rejects public handles containing spaces", async () => {
    const db = makeDb({ selects: [identity()] });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: "Mina Park", preferredLocale: "en-US", publicHandle: "bad handle" },
        "PATCH",
      ),
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid public handle",
      details: {
        publicHandle: [
          "Handle must be 3-24 letters, numbers, hyphens, or underscores with no spaces",
        ],
      },
    });
  });

  it("reports a field conflict when another profile already holds the handle", async () => {
    const db = makeDb({ selects: [identity(), [{ id: "profile-2" }]] });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: "Mina Park", preferredLocale: "en-US", publicHandle: "@Taken-Handle" },
        "PATCH",
      ),
    );

    expect(response.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "That public handle is already taken",
      details: { publicHandle: ["That public handle is already taken"] },
    });
  });

  it("reports the same conflict when the unique index catches a racing claim", async () => {
    const db = makeDb({ selects: [identity(), []], failWithCode: "23505" });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: "Mina Park", preferredLocale: "en-US", publicHandle: "@Taken-Handle" },
        "PATCH",
      ),
    );

    expect(response.status).toBe(409);
    expect(db.setCalls[0]!.values).toMatchObject({ publicHandle: "taken-handle" });
    await expect(response.json()).resolves.toMatchObject({
      error: "That public handle is already taken",
    });
  });
});

describe("DELETE /api/auth/me", () => {
  it("requires authentication", async () => {
    const response = await app().request("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("requires the literal DELETE confirmation", async () => {
    const response = await app().request(
      "/api/auth/me",
      authorized({ confirmation: "delete" }, "DELETE"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid delete confirmation",
      details: { confirmation: expect.any(Array) },
    });
  });

  it("erases the whole account, not just the acting profile, and clears the cookie", async () => {
    const db = makeDb();
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me",
      authorized({ confirmation: "DELETE" }, "DELETE"),
    );

    expect(response.status).toBe(200);
    expect(erasureState.erase).toHaveBeenCalledWith(SESSION.account.id, { db });
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("POST /api/auth/logout", () => {
  it("succeeds without a session so a stale cookie can always be cleared", async () => {
    const response = await app().request("/api/auth/logout", { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
