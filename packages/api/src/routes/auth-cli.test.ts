import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_USER = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  avatarUrl: null,
  preferredLocale: "en-US",
  onboardingCompletedAt: null,
  publicHandle: null,
  publicProfileEnabled: false,
  publicTopOfMindEnabled: false,
};

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  createSessionRow: vi.fn(async () => undefined),
  signSessionToken: vi.fn(async () => "signed-session-token"),
  authenticated: true,
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => mockState.db,
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  signSessionToken: mockState.signSessionToken,
}));

// hashSessionToken is a pure SHA-256 helper with no I/O — keep the real
// implementation so a code minted by /start and looked up by /exchange
// hash to the same value. Only createSessionRow (a DB write) is stubbed.
vi.mock("../lib/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/session.js")>();
  return {
    ...actual,
    createSessionRow: mockState.createSessionRow,
  };
});

vi.mock("../lib/middleware.js", () => ({
  requireAuth: async (c: any, next: any) => {
    if (!mockState.authenticated) {
      return c.json({ error: "Authentication required" }, 401);
    }
    c.set("user", FAKE_USER);
    await next();
  },
}));

import { hashSessionToken } from "../lib/session.js";
import { cliAuthRoutes } from "./auth-cli.js";

function createApp() {
  const app = new Hono();
  app.route("/api/auth/cli", cliAuthRoutes);
  return app;
}

/** Mirrors auth-google.test.ts's makeDb: a queue of canned `select` results,
 * consumed in call order, plus spies for insert/delete. */
function makeDb(selectResults: unknown[][] = []) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectResults.shift() ?? []),
      })),
    })),
  }));
  const insertValues = vi.fn(async (_values: unknown) => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn(async () => undefined);
  const del = vi.fn(() => ({ where: deleteWhere }));
  return { select, insert, insertValues, delete: del, deleteWhere };
}

beforeEach(() => {
  mockState.createSessionRow.mockClear();
  mockState.signSessionToken.mockClear();
  mockState.authenticated = true;
  mockState.db = makeDb([]);
});

describe("GET /api/auth/cli/start", () => {
  it("401s when the browser has no live WAKA session", async () => {
    mockState.authenticated = false;

    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback&state=abc",
      { redirect: "manual" },
    );

    expect(res.status).toBe(401);
  });

  it("rejects a non-loopback callback", async () => {
    const res = await createApp().request(
      "/api/auth/cli/start?callback=https://evil.example/callback&state=abc",
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("rejects a same-origin (non-loopback) callback", async () => {
    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://waka.example/callback&state=abc",
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
  });

  it("requires state", async () => {
    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback",
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
  });

  it("mints a one-time code, stores its hash, and redirects to the loopback callback", async () => {
    const db = makeDb([]);
    mockState.db = db;

    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback&state=my-state",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://127.0.0.1:5555");
    expect(location.pathname).toBe("/callback");
    expect(location.searchParams.get("state")).toBe("my-state");

    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insertValues).toHaveBeenCalledTimes(1);
    const stored = db.insertValues.mock.calls[0]![0] as {
      userId: string;
      codeHash: string;
      expiresAt: Date;
    };
    expect(stored.userId).toBe(FAKE_USER.id);
    expect(stored.codeHash).toBe(await hashSessionToken(code!));
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts http://localhost as well as http://127.0.0.1", async () => {
    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://localhost:5555/callback&state=abc",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
  });
});

describe("POST /api/auth/cli/exchange", () => {
  function exchangeRequest(code: string) {
    return createApp().request("/api/auth/cli/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  }

  it("rejects an unknown or already-used code without touching sessions", async () => {
    mockState.db = makeDb([[]]);

    const res = await exchangeRequest("nonexistent-code");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid or already-used/i);
    expect(mockState.db.deleteWhere).not.toHaveBeenCalled();
    expect(mockState.signSessionToken).not.toHaveBeenCalled();
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });

  it("deletes an expired code (single-use even on failure) and refuses to mint a session", async () => {
    const expiredRow = {
      id: "code-row-1",
      userId: FAKE_USER.id,
      expiresAt: new Date(Date.now() - 1000),
    };
    mockState.db = makeDb([[expiredRow]]);

    const res = await exchangeRequest("some-code");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/expired/i);
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).not.toHaveBeenCalled();
  });

  it("exchanges a valid code for a brand-new, independently-tracked session", async () => {
    const validRow = {
      id: "code-row-2",
      userId: FAKE_USER.id,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockState.db = makeDb([
      [validRow],
      [{ id: FAKE_USER.id, email: FAKE_USER.email }],
    ]);

    const res = await exchangeRequest("valid-code");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { email: string } };
    expect(body.token).toBe("signed-session-token");
    expect(body.user).toEqual({ email: FAKE_USER.email });
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).toHaveBeenCalledWith({
      userId: FAKE_USER.id,
      email: FAKE_USER.email,
    });
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      userId: FAKE_USER.id,
      token: "signed-session-token",
    });
  });

  it("rejects a code reused a second time", async () => {
    const validRow = {
      id: "code-row-3",
      userId: FAKE_USER.id,
      expiresAt: new Date(Date.now() + 60_000),
    };
    // First exchange succeeds; the second sees an empty result because the
    // row was already deleted by the first call.
    mockState.db = makeDb([
      [validRow],
      [{ id: FAKE_USER.id, email: FAKE_USER.email }],
      [],
    ]);

    const first = await exchangeRequest("valid-code");
    expect(first.status).toBe(200);

    const second = await exchangeRequest("valid-code");
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/invalid or already-used/i);
  });
});
