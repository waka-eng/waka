import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createGroupsRoutes } from "./groups.js";
import type {
  GroupSummary,
  GroupTopOfMindRefreshResult,
  GroupTopOfMindResult,
} from "../lib/group-top-of-mind.js";

const user = { id: "00000000-0000-4000-8000-000000000001", preferredLocale: "en-US" };
const groupId = "00000000-0000-4000-8000-000000000101";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

const groupSummary: GroupSummary = {
  id: groupId,
  name: "builders",
  role: "owner",
  joinCode: "ABCD2345",
  memberCount: 2,
  createdAt: "2026-07-07T00:00:00.000Z",
};

function mountWith(deps: Parameters<typeof createGroupsRoutes>[0]) {
  const app = new Hono();
  app.route("/api/groups", createGroupsRoutes({ authMiddleware: authMiddleware(), ...deps }));
  return app;
}

describe("GET /api/groups", () => {
  it("lists the signed-in user's boards", async () => {
    const listGroups = vi.fn(async () => [groupSummary]);
    const app = mountWith({ getDatabase: () => ({}) as any, listGroups });

    const response = await app.request("/api/groups");

    expect(response.status).toBe(200);
    expect(listGroups).toHaveBeenCalledWith({}, user.id);
    await expect(response.json()).resolves.toEqual({ groups: [groupSummary] });
  });
});

describe("POST /api/groups", () => {
  it("creates a board and returns 201 with the owner's join code", async () => {
    const createGroup = vi.fn(async () => groupSummary);
    const app = mountWith({ getDatabase: () => ({}) as any, createGroup });

    const response = await app.request("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "builders" }),
    });

    expect(response.status).toBe(201);
    expect(createGroup).toHaveBeenCalledWith({}, { userId: user.id, name: "builders" });
    await expect(response.json()).resolves.toEqual({ group: groupSummary });
  });

  it("rejects an empty name with 400", async () => {
    const createGroup = vi.fn();
    const app = mountWith({ getDatabase: () => ({}) as any, createGroup });

    const response = await app.request("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(response.status).toBe(400);
    expect(createGroup).not.toHaveBeenCalled();
  });
});

describe("POST /api/groups/join", () => {
  it("joins by code", async () => {
    const joinGroup = vi.fn(async () => ({ ok: true as const, group: groupSummary, alreadyMember: false }));
    const app = mountWith({ getDatabase: () => ({}) as any, joinGroup });

    const response = await app.request("/api/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode: "ABCD2345" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ group: groupSummary, alreadyMember: false });
  });

  it("returns 404 for an unknown code", async () => {
    const joinGroup = vi.fn(async () => ({ ok: false as const, reason: "not_found" as const }));
    const app = mountWith({ getDatabase: () => ({}) as any, joinGroup });

    const response = await app.request("/api/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode: "NOPE0000" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/groups/:groupId", () => {
  it("deletes the room for its owner", async () => {
    const deleteGroupFn = vi.fn(async () => ({ ok: true }) as const);
    const app = mountWith({ getDatabase: () => ({}) as any, deleteGroupFn });

    const response = await app.request(`/api/groups/${groupId}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(deleteGroupFn).toHaveBeenCalledWith({}, { userId: user.id, groupId });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 403 for a member who does not own the room", async () => {
    const deleteGroupFn = vi.fn(
      async () => ({ ok: false, reason: "not_owner" }) as const,
    );
    const app = mountWith({ getDatabase: () => ({}) as any, deleteGroupFn });

    const response = await app.request(`/api/groups/${groupId}`, { method: "DELETE" });

    expect(response.status).toBe(403);
  });

  it("returns 404 for a non-member, so an id is not confirmed to exist", async () => {
    const deleteGroupFn = vi.fn(
      async () => ({ ok: false, reason: "not_found" }) as const,
    );
    const app = mountWith({ getDatabase: () => ({}) as any, deleteGroupFn });

    const response = await app.request(`/api/groups/${groupId}`, { method: "DELETE" });

    expect(response.status).toBe(404);
  });

  it("rejects a malformed group id before touching the service", async () => {
    const deleteGroupFn = vi.fn(async () => ({ ok: true }) as const);
    const app = mountWith({ getDatabase: () => ({}) as any, deleteGroupFn });

    const response = await app.request("/api/groups/not-a-uuid", { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(deleteGroupFn).not.toHaveBeenCalled();
  });
});

describe("GET /api/groups/:groupId/top-of-mind", () => {
  it("returns the synthesized board for a member", async () => {
    const result: GroupTopOfMindResult = { group: groupSummary, members: [], notes: [] };
    const listGroupNotes = vi.fn(async () => result);
    const app = mountWith({ getDatabase: () => ({}) as any, listGroupNotes });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind?limit=5`);

    expect(response.status).toBe(200);
    expect(listGroupNotes).toHaveBeenCalledWith(
      {},
      { userId: user.id, groupId, limit: 5, preferredLocale: "en-US" },
    );
    await expect(response.json()).resolves.toEqual(result);
  });

  it("returns 404 when the caller is not a member (service returns null)", async () => {
    const listGroupNotes = vi.fn(async () => null);
    const app = mountWith({ getDatabase: () => ({}) as any, listGroupNotes });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind`);

    expect(response.status).toBe(404);
  });
});

describe("POST /api/groups/:groupId/top-of-mind/refresh", () => {
  it("regenerates and returns the board for a member", async () => {
    const result: GroupTopOfMindRefreshResult = {
      group: groupSummary,
      members: [],
      notes: [],
      refreshed: true,
      nextEligibleAt: null,
    };
    const refreshGroupNotes = vi.fn(async () => result);
    const app = mountWith({ getDatabase: () => ({}) as any, refreshGroupNotes });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind/refresh`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(refreshGroupNotes).toHaveBeenCalledWith(
      {},
      { userId: user.id, groupId, limit: 5, preferredLocale: "en-US" },
    );
    await expect(response.json()).resolves.toEqual(result);
  });

  it("returns 404 for a non-member", async () => {
    const refreshGroupNotes = vi.fn(async () => null);
    const app = mountWith({ getDatabase: () => ({}) as any, refreshGroupNotes });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind/refresh`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /api/groups/:groupId/timeline", () => {
  /**
   * A first load needs the room's life; travelling does not. Rebuilding the
   * whole event list to answer a scrub is what made the wall arrive a beat
   * after the rail, and historical boards never change, so the client keeps
   * what it is given.
   */
  const board = { at: "2026-08-01T00:00:00.000Z", notes: [] };
  const timeline = { groupId: "g", formedAt: board.at, events: [] };

  it("carries the room's life on a first load", async () => {
    const loadTimeline = vi.fn(async () => timeline);
    const app = mountWith({
      getDatabase: () => ({}) as any,
      loadTimeline: loadTimeline as any,
      loadBoardAsOf: (async () => board) as any,
    });

    const response = await app.request(`/api/groups/${groupSummary.id}/timeline`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ timeline, board });
    expect(loadTimeline).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild it to answer a travel request", async () => {
    const loadTimeline = vi.fn(async () => timeline);
    const app = mountWith({
      getDatabase: () => ({}) as any,
      loadTimeline: loadTimeline as any,
      loadBoardAsOf: (async () => board) as any,
    });

    const response = await app.request(
      `/api/groups/${groupSummary.id}/timeline?at=2026-08-01T00%3A00%3A00.000Z`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ timeline: null, board });
    expect(loadTimeline).not.toHaveBeenCalled();
  });

  it("still tells a non-member nothing, travelling or not", async () => {
    // `boardAsOf` gates on membership itself, so dropping the timeline read
    // must not drop the authorization that used to come with it.
    const app = mountWith({
      getDatabase: () => ({}) as any,
      loadTimeline: (async () => null) as any,
      loadBoardAsOf: (async () => null) as any,
    });

    const response = await app.request(
      `/api/groups/${groupSummary.id}/timeline?at=2026-08-01T00%3A00%3A00.000Z`,
    );

    expect(response.status).toBe(404);
  });
});
