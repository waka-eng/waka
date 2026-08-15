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
  ...HUMAN_SESSION,
  sessionId: "session-2",
  profile: { ...HUMAN_SESSION.profile, id: "profile-agent", type: "agent", name: "Scout" },
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-agent",
    accountId: "account-1",
    type: "agent",
    name: "Scout",
    avatarUrl: null,
    preferredLocale: "en-US",
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
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

import { profilesRoutes } from "./profiles.js";

function createApp() {
  const app = new Hono();
  app.route("/api/profiles", profilesRoutes);
  return app;
}

function makeDb(options: { selects?: unknown[][]; returning?: unknown[][] } = {}) {
  const selects = options.selects ?? [];
  const returning = options.returning ?? [];

  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selects.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.orderBy = vi.fn(async () => rows);
      result.limit = vi.fn(async () => rows);
      return result;
    });
    chain.orderBy = vi.fn(async () => selects.shift() ?? []);
    return chain;
  });

  const insertValues = vi.fn(() => ({
    returning: vi.fn(async () => returning.shift() ?? []),
  }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(() => ({
    returning: vi.fn(async () => returning.shift() ?? []),
  }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }));

  const deleteWhere = vi.fn(() => ({
    returning: vi.fn(async () => returning.shift() ?? []),
  }));
  const del = vi.fn(() => ({ where: deleteWhere }));

  return { select, insert, insertValues, update, delete: del, deleteWhere };
}

function jsonRequest(path: string, method: string, body?: unknown) {
  return createApp().request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.session = HUMAN_SESSION;
  mockState.db = makeDb();
});

describe("GET /api/profiles", () => {
  it("lists the account's profiles for either kind of session", async () => {
    mockState.db = makeDb({ selects: [[profileRow({ id: "profile-human", type: "human" })]] });

    const res = await createApp().request("/api/profiles");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: Array<{ id: string }> };
    expect(body.profiles).toHaveLength(1);
  });

  it("is readable by an agent session — it needs to know what it may reach", async () => {
    mockState.session = AGENT_SESSION;
    mockState.db = makeDb({ selects: [[profileRow()]] });

    const res = await createApp().request("/api/profiles");

    expect(res.status).toBe(200);
  });
});

describe("POST /api/profiles", () => {
  it("creates an agent profile for the account owner", async () => {
    mockState.db = makeDb({ selects: [[{ count: 0 }]], returning: [[profileRow()]] });

    const res = await jsonRequest("/api/profiles", "POST", { name: "Scout" });

    expect(res.status).toBe(201);
    const created = mockState.db.insertValues.mock.calls[0]![0] as {
      type: string;
      accountId: string;
    };
    expect(created.type).toBe("agent");
    expect(created.accountId).toBe("account-1");
  });

  /**
   * An agent that could mint itself new memories would be administering the
   * account rather than working inside it.
   */
  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;

    const res = await jsonRequest("/api/profiles", "POST", { name: "Another" });

    expect(res.status).toBe(403);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("refuses once the account is at its agent-profile cap", async () => {
    mockState.db = makeDb({ selects: [[{ count: 8 }]] });

    const res = await jsonRequest("/api/profiles", "POST", { name: "Nine" });

    expect(res.status).toBe(409);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty or unnamed profile", async () => {
    const res = await jsonRequest("/api/profiles", "POST", { name: "   " });

    expect(res.status).toBe(400);
  });

  it("rejects unknown fields rather than silently dropping them", async () => {
    const res = await jsonRequest("/api/profiles", "POST", {
      name: "Scout",
      type: "human",
    });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/profiles/:profileId", () => {
  it("removes an agent profile", async () => {
    mockState.db = makeDb({ returning: [[{ id: "profile-agent" }]] });

    const res = await createApp().request("/api/profiles/profile-agent", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
  });

  /**
   * The delete is scoped to agent rows in SQL, so a human profile simply is
   * not found — the account keeps the memory it was built around.
   */
  it("will not remove the human profile", async () => {
    mockState.db = makeDb({ returning: [[]] });

    const res = await createApp().request("/api/profiles/profile-human", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });

  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;

    const res = await createApp().request("/api/profiles/profile-agent", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(mockState.db.delete).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/profiles/:profileId", () => {
  it("renames a profile the account owns", async () => {
    mockState.db = makeDb({ returning: [[profileRow({ name: "Renamed" })]] });

    const res = await jsonRequest("/api/profiles/profile-agent", "PATCH", {
      name: "Renamed",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { name: string } };
    expect(body.profile.name).toBe("Renamed");
  });

  it("404s for a profile in another account", async () => {
    mockState.db = makeDb({ returning: [[]] });

    const res = await jsonRequest("/api/profiles/someone-elses", "PATCH", {
      name: "Nope",
    });

    expect(res.status).toBe(404);
  });

  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;

    const res = await jsonRequest("/api/profiles/profile-agent", "PATCH", {
      name: "Nope",
    });

    expect(res.status).toBe(403);
  });
});
