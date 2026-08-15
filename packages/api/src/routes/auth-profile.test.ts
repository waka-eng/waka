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
  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selects.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.limit = vi.fn(async () => rows);
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
  it("writes the locale onto the acting profile", async () => {
    const db = makeDb({
      selects: [identity({ profile: { preferredLocale: "ko-KR" } })],
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/preferences",
      authorized({ preferredLocale: "ko-KR" }, "PATCH"),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls).toHaveLength(1);
    expect(db.setCalls[0]!.table).toBe(profiles);
    expect(db.setCalls[0]!.values).toMatchObject({ preferredLocale: "ko-KR" });
    await expect(response.json()).resolves.toMatchObject({
      profile: { preferredLocale: "ko-KR" },
    });
  });
});

describe("PATCH /api/auth/me/profile", () => {
  it("requires authentication", async () => {
    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Mina", preferredLocale: "ko-KR" }),
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

  it("stamps onboarding on the account while the display identity stays on the profile", async () => {
    const completedAt = new Date("2026-06-20T10:15:30.000Z");
    const db = makeDb({
      selects: [identity()],
      updatedProfile: { ...PROFILE_ROW, name: "Mina Lee", preferredLocale: "ko-KR" },
      updatedAccount: { ...ACCOUNT_ROW, onboardingCompletedAt: completedAt },
    });
    dbState.db = db;

    const response = await app().request(
      "/api/auth/me/profile",
      authorized(
        { name: " Mina Lee ", preferredLocale: "ko-KR", completeOnboarding: true },
        "PATCH",
      ),
    );

    expect(response.status).toBe(200);
    expect(db.setCalls[0]!.table).toBe(profiles);
    expect(db.setCalls[0]!.values).toMatchObject({
      name: "Mina Lee",
      preferredLocale: "ko-KR",
      updatedAt: expect.any(Date),
    });
    expect(db.setCalls[1]!.table).toBe(accounts);
    expect(db.setCalls[1]!.values).toMatchObject({
      onboardingCompletedAt: expect.any(Date),
    });
    await expect(response.json()).resolves.toMatchObject({
      account: { onboardingCompletedAt: completedAt.toISOString() },
      profile: { name: "Mina Lee", preferredLocale: "ko-KR" },
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
