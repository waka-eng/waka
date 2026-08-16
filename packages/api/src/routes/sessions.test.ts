import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeUserAgent, type AuthenticatedSession } from "../lib/session.js";

const HUMAN_SESSION: AuthenticatedSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: "account-1",
    type: "human",
    name: "Mina",
    preferredLocale: "en-US",
  },
};

const AGENT_SESSION: AuthenticatedSession = {
  ...HUMAN_SESSION,
  sessionId: "22222222-2222-4222-8222-222222222222",
  profile: { ...HUMAN_SESSION.profile, type: "agent", name: "Scout" },
};

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    deviceLabel: "agis-Mac-mini.local",
    createdAt: new Date("2026-08-16T04:00:00.000Z"),
    lastSeenAt: new Date("2026-08-16T06:00:00.000Z"),
    expiresAt: new Date("2026-09-15T04:00:00.000Z"),
    profileId: HUMAN_SESSION.profile.id,
    profileName: "Mina",
    profileType: "human",
    ...overrides,
  };
}

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  session: undefined as any,
}));

vi.mock("../lib/db.js", () => ({ getDb: () => mockState.db }));

vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      c.set("session", mockState.session);
      await next();
    },
  };
});

import { sessionsRoutes } from "./sessions.js";

function createApp() {
  const app = new Hono();
  app.route("/api/sessions", sessionsRoutes);
  return app;
}

function makeDb(selects: unknown[][] = []) {
  const deleteWhere = vi.fn(async () => undefined);
  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selects.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.orderBy = vi.fn(async () => rows);
      result.limit = vi.fn(async () => rows);
      return result;
    });
    return chain;
  });
  return { select, delete: vi.fn(() => ({ where: deleteWhere })), deleteWhere };
}

beforeEach(() => {
  mockState.session = HUMAN_SESSION;
  mockState.db = makeDb();
});

describe("GET /api/sessions", () => {
  it("lists connections without ever exposing a token", async () => {
    mockState.db = makeDb([[sessionRow(), sessionRow({ id: "44444444-4444-4444-8444-444444444444", deviceLabel: null })]]);

    const res = await createApp().request("/api/sessions");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions).toHaveLength(2);
    // The row carries a hash, never a token; neither may reach a client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("token");
    expect(body.sessions[0]).toMatchObject({
      deviceLabel: "agis-Mac-mini.local",
      profile: { name: "Mina", type: "human" },
    });
  });

  /** So a client can say "this device" instead of inviting a guess. */
  it("marks which connection is making the request", async () => {
    mockState.db = makeDb([
      [sessionRow({ id: HUMAN_SESSION.sessionId }), sessionRow({ id: "55555555-5555-4555-8555-555555555555" })],
    ]);

    const res = await createApp().request("/api/sessions");
    const body = (await res.json()) as { sessions: Array<{ id: string; current: boolean }> };

    expect(body.sessions.find((s) => s.id === HUMAN_SESSION.sessionId)?.current).toBe(true);
    expect(body.sessions.find((s) => s.id !== HUMAN_SESSION.sessionId)?.current).toBe(false);
  });

  /**
   * An agent that could enumerate its owner's connections would be reporting
   * on the person rather than remembering for them.
   */
  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;
    const res = await createApp().request("/api/sessions");
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("ends a connection the account owns", async () => {
    const target = "33333333-3333-4333-8333-333333333333";
    mockState.db = makeDb([[{ id: target }]]);

    const res = await createApp().request(`/api/sessions/${target}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: target, endedCurrent: false });
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
  });

  /** Cutting off the device in your hand is a logout, not an error. */
  it("allows ending the current connection and says so", async () => {
    mockState.db = makeDb([[{ id: HUMAN_SESSION.sessionId }]]);

    const res = await createApp().request(`/api/sessions/${HUMAN_SESSION.sessionId}`, {
      method: "DELETE",
    });
    expect(await res.json()).toMatchObject({ endedCurrent: true });
  });

  /** Another account's id and a nonexistent one must answer alike. */
  it("answers 404 for a connection outside the account", async () => {
    mockState.db = makeDb([[]]);
    const res = await createApp().request("/api/sessions/66666666-6666-4666-8666-666666666666", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(mockState.db.deleteWhere).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id rather than casting it", async () => {
    const res = await createApp().request("/api/sessions/not-a-uuid", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;
    const res = await createApp().request(`/api/sessions/${HUMAN_SESSION.sessionId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Chrome on macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0", "Edge on Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox on Linux"],
  ])("names a familiar browser", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  /** A label is for recognising your own laptop, not for guessing. */
  it.each([[""], [null], [undefined], ["curl/8.4.0"]])(
    "falls back to a plain label for %j",
    (ua) => {
      expect(describeUserAgent(ua as string | null | undefined)).toBe("Browser");
    },
  );

  it("keeps Chrome from being read as Safari", () => {
    const chrome = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
    expect(describeUserAgent(chrome)).not.toContain("Safari");
  });
});
