import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";

const HUMAN_SESSION: AuthenticatedSession = {
  sessionId: "session-1",
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
  sessionId: "session-2",
  profile: { ...HUMAN_SESSION.profile, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "agent", name: "Scout" },
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    accountId: "account-1",
    type: "agent",
    name: "Scout",
    avatarUrl: null,
    preferredLocale: "en-US",
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    ...overrides,
  };
}

const sweep = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../lib/attachment-sweep.js", () => ({sweepAttachmentObjects:sweep}));

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
      result.orderBy = vi.fn(() => result);
      result.for = vi.fn(async () => rows);
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

  const db = { select, insert, insertValues, update, delete: del, deleteWhere, transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)) };
  return db;
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
    mockState.db = makeDb({ selects: [[profileRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "human" })]] });

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
  it.each([0, 1, 3])("retires creation without touching an account with %i legacy agent stacks", async (count) => {
    mockState.db = makeDb({ selects: [[{ count }]] });
    const res = await jsonRequest("/api/profiles", "POST", { name: "Another" });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({code:'agent_profiles_retired'});
    expect(mockState.db.transaction).not.toHaveBeenCalled();
    expect(mockState.db.select).not.toHaveBeenCalled();
    expect(mockState.db.insert).not.toHaveBeenCalled();
    expect(mockState.db.update).not.toHaveBeenCalled();
    expect(mockState.db.delete).not.toHaveBeenCalled();
  });
  it("still refuses an agent session before the retired route", async () => {
    mockState.session = AGENT_SESSION;
    expect((await jsonRequest('/api/profiles', 'POST', {name:'Another'})).status).toBe(403);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/profiles/:profileId", () => {
  it("removes an agent profile", async () => {
    mockState.db = makeDb({ selects: [[{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }], [], []] });

    const res = await createApp().request("/api/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
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

    const res = await createApp().request("/api/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });

  it("refuses an agent session", async () => {
    mockState.session = AGENT_SESSION;

    const res = await createApp().request("/api/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(mockState.db.delete).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/profiles/:profileId", () => {
  it("renames a profile the account owns", async () => {
    mockState.db = makeDb({ returning: [[profileRow({ name: "Renamed" })]] });

    const res = await jsonRequest("/api/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "PATCH", {
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

    const res = await jsonRequest("/api/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "PATCH", {
      name: "Nope",
    });

    expect(res.status).toBe(403);
  });
});


it('sweeps both live and recoverable media when its owned agent is removed',async()=>{
  sweep.mockClear();
  mockState.db=makeDb({selects:[[{id:AGENT_SESSION.profile.id}],[{s3Key:'live/photo'}],[{attachments:[{s3Key:'deleted/audio'}]}],[],[]]});
  const response=await createApp().request(`/api/profiles/${AGENT_SESSION.profile.id}`,{method:'DELETE'});
  expect(response.status).toBe(200);
  expect(sweep).toHaveBeenCalledExactlyOnceWith(['live/photo','deleted/audio']);
});
