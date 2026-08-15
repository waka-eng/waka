import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";

const HUMAN_SESSION: AuthenticatedSession = {
  sessionId: "session-1",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "profile-human",
    accountId: "account-1",
    type: "human",
    name: "Mina",
    preferredLocale: "en-US",
  },
};

const AGENT_SESSION: AuthenticatedSession = {
  sessionId: "session-2",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "profile-agent",
    accountId: "account-1",
    type: "agent",
    name: "Scout",
    preferredLocale: "en-US",
  },
};

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  createSessionRow: vi.fn(async () => undefined),
  signSessionToken: vi.fn(async () => "signed-session-token"),
  session: undefined as any,
  authenticated: true,
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => mockState.db,
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_COOKIE_NAME: "waka_session",
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  signSessionToken: mockState.signSessionToken,
  verifySessionToken: vi.fn(async () => null),
}));

// hashSessionToken is a pure SHA-256 helper with no I/O — keep the real
// implementation so a code minted by /start and looked up by /exchange hash
// to the same value. Only createSessionRow (a DB write) is stubbed.
vi.mock("../lib/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/session.js")>();
  return {
    ...actual,
    createSessionRow: mockState.createSessionRow,
  };
});

// The access matrix stays real: this route's whole job on the /start side is
// deciding which profile a credential may be minted for.
vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      if (!mockState.authenticated) {
        return c.json({ error: "Authentication required" }, 401);
      }
      c.set("session", mockState.session);
      c.set("sessionToken", "browser-token");
      await next();
    },
  };
});

import { hashSessionToken } from "../lib/session.js";
import { cliAuthRoutes } from "./auth-cli.js";

function createApp() {
  const app = new Hono();
  app.route("/api/auth/cli", cliAuthRoutes);
  return app;
}

/**
 * A queue of canned `select` results consumed in call order, plus spies for
 * insert/delete. `.where()` resolves directly and also carries `.limit()`, so
 * one mock serves both query shapes in this file.
 */
function makeDb(selectResults: unknown[][] = []) {
  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selectResults.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.limit = vi.fn(async () => rows);
      return result;
    });
    return chain;
  });
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
  mockState.session = HUMAN_SESSION;
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
      profileId: string;
      codeHash: string;
      deviceLabel: string | null;
      expiresAt: Date;
    };
    // The plaintext code never reaches the database.
    expect(stored.codeHash).toBe(await hashSessionToken(code!));
    expect(stored.codeHash).not.toBe(code);
    expect(stored.profileId).toBe(HUMAN_SESSION.profile.id);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts http://localhost as well as http://127.0.0.1", async () => {
    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://localhost:5555/callback&state=abc",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
  });

  it("binds the code to a named profile of the same account", async () => {
    const db = makeDb([
      [
        { id: "profile-human", accountId: "account-1", name: "Mina" },
        { id: "profile-agent", accountId: "account-1", name: "Scout" },
      ],
    ]);
    mockState.db = db;

    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback&state=abc&profile=scout&device=claude-code",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const stored = db.insertValues.mock.calls[0]![0] as {
      profileId: string;
      deviceLabel: string | null;
    };
    expect(stored.profileId).toBe("profile-agent");
    expect(stored.deviceLabel).toBe("claude-code");
  });

  it("rejects a profile the account does not own", async () => {
    const db = makeDb([[{ id: "profile-human", accountId: "account-1", name: "Mina" }]]);
    mockState.db = db;

    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback&state=abc&profile=someone-else",
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("refuses to let an agent session mint a credential for the human profile", async () => {
    mockState.session = AGENT_SESSION;
    const db = makeDb([
      [
        { id: "profile-human", accountId: "account-1", name: "Mina" },
        { id: "profile-agent", accountId: "account-1", name: "Scout" },
      ],
    ]);
    mockState.db = db;

    const res = await createApp().request(
      "/api/auth/cli/start?callback=http://127.0.0.1:5555/callback&state=abc&profile=Mina",
      { redirect: "manual" },
    );

    expect(res.status).toBe(403);
    expect(db.insert).not.toHaveBeenCalled();
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
    mockState.db = makeDb([
      [
        {
          id: "code-row-1",
          profileId: "profile-agent",
          deviceLabel: null,
          expiresAt: new Date(Date.now() - 1000),
        },
      ],
    ]);

    const res = await exchangeRequest("some-code");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/expired/i);
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).not.toHaveBeenCalled();
  });

  it("exchanges a valid code for a session bound to the code's profile", async () => {
    mockState.db = makeDb([
      [
        {
          id: "code-row-2",
          profileId: "profile-agent",
          deviceLabel: "claude-code",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [{ id: "profile-agent", email: "user@example.com" }],
    ]);

    const res = await exchangeRequest("valid-code");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      expiresAt: string;
      user: { email: string };
    };
    expect(body.token).toBe("signed-session-token");
    expect(body.user).toEqual({ email: "user@example.com" });
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).toHaveBeenCalledWith({
      profileId: "profile-agent",
      email: "user@example.com",
    });
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      profileId: "profile-agent",
      token: "signed-session-token",
      deviceLabel: "claude-code",
    });
  });

  it("refuses a code whose profile is gone", async () => {
    mockState.db = makeDb([
      [
        {
          id: "code-row-3",
          profileId: "profile-erased",
          deviceLabel: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [],
    ]);

    const res = await exchangeRequest("valid-code");

    expect(res.status).toBe(400);
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });

  it("rejects a code reused a second time", async () => {
    // The first exchange succeeds; the second sees an empty result because
    // the row was already deleted by the first call.
    mockState.db = makeDb([
      [
        {
          id: "code-row-4",
          profileId: "profile-human",
          deviceLabel: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [{ id: "profile-human", email: "user@example.com" }],
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
