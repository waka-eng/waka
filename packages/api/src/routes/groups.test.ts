import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";
import {
  createGroupsRoutes,
  proposalShapeIsValid,
  type EnqueueGroupRefreshResult,
  type GroupMemberSummary,
  type GroupMembership,
  type GroupProposalView,
  carriesMajority,
  type GroupSummary,
  type GroupTopOfMindView,
  type GroupsRouteDependencies,
  type GroupWallSignal,
} from "./groups.js";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const profileId = "00000000-0000-4000-8000-000000000001";
const otherProfileId = "00000000-0000-4000-8000-000000000002";
const groupId = "00000000-0000-4000-8000-000000000101";
const entryId = "00000000-0000-4000-8000-000000000201";
const proposalId = "00000000-0000-4000-8000-000000000301";
const signalId = "00000000-0000-4000-8000-000000000401";

const session: AuthenticatedSession = {
  sessionId: "00000000-0000-4000-8000-0000000000f1",
  account: { id: accountId, email: "ada@example.com" },
  profile: {
    id: profileId,
    accountId,
    type: "human",
    name: "Ada",
    preferredLocale: "en-US",
  },
};

function sessionMiddleware(as: AuthenticatedSession = session) {
  return async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("session", as);
    await next();
  };
}

const ownerMembership: GroupMembership = { groupId, profileId, role: "owner" };
const plainMembership: GroupMembership = { groupId, profileId, role: "member" };

const groupSummary: GroupSummary = {
  id: groupId,
  name: "builders",
  joinCode: "ABCD2345",
  role: "owner",
  memberCount: 2,
  createdAt: "2026-07-07T00:00:00.000Z",
};

const wallSignal: GroupWallSignal = {
  signalId,
  statement: "Rooms that instruct without speaking",
  confidence: 72,
  ownerProfileId: otherProfileId,
  ownerName: "Grace",
  sharedAt: "2026-08-10T00:00:00.000Z",
};

const proposalView: GroupProposalView = {
  id: proposalId,
  kind: "edit_entry",
  status: "open",
  entryId,
  body: "Say it about instruction, not architecture.",
  rationale: "Both of us keep circling instruction.",
  proposedByProfileId: profileId,
  proposedByName: "Ada",
  affirmations: [
    { profileId, name: "Ada", createdAt: "2026-08-11T00:00:00.000Z" },
  ],
  viewerAffirmed: true,
  resolvedAt: null,
  createdAt: "2026-08-11T00:00:00.000Z",
};

function mountWith(
  deps: GroupsRouteDependencies = {},
  as: AuthenticatedSession = session,
) {
  const app = new Hono();
  app.route(
    "/api/groups",
    createGroupsRoutes({
      getDatabase: (() => ({})) as GroupsRouteDependencies["getDatabase"],
      authMiddleware: sessionMiddleware(as) as never,
      loadMembership: vi.fn(async () => ownerMembership),
      enqueueRefresh: vi.fn(async () => ({ jobId: "job-1", alreadyQueued: false })),
      ...deps,
    }),
  );
  return app;
}

describe("GET /api/groups", () => {
  it("lists the groups the caller belongs to", async () => {
    const listGroups = vi.fn(async () => [groupSummary]);
    const app = mountWith({ listGroups });

    const response = await app.request("/api/groups");

    expect(response.status).toBe(200);
    expect(listGroups).toHaveBeenCalledWith({}, profileId);
    await expect(response.json()).resolves.toEqual({ groups: [groupSummary] });
  });
});

describe("POST /api/groups", () => {
  it("creates a group and hands back its join code", async () => {
    const createGroup = vi.fn(async () => groupSummary);
    const app = mountWith({ createGroup });

    const response = await app.request("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "builders" }),
    });

    expect(response.status).toBe(201);
    expect(createGroup).toHaveBeenCalledWith({}, { profileId, name: "builders" });
    await expect(response.json()).resolves.toEqual({ group: groupSummary });
  });

  it("rejects a blank name before touching the database", async () => {
    const createGroup = vi.fn(async () => groupSummary);
    const app = mountWith({ createGroup });

    const response = await app.request("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(response.status).toBe(400);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("rejects unknown fields rather than silently dropping them", async () => {
    const createGroup = vi.fn(async () => groupSummary);
    const app = mountWith({ createGroup });

    const response = await app.request("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "builders", role: "owner" }),
    });

    expect(response.status).toBe(400);
    expect(createGroup).not.toHaveBeenCalled();
  });
});

describe("POST /api/groups/join", () => {
  it("joins by code and asks for a refresh, because the pool changed", async () => {
    const joinGroup = vi.fn(async () => ({
      ok: true as const,
      group: groupSummary,
      alreadyMember: false,
    }));
    const enqueueRefresh = vi.fn(async () => ({
      jobId: "job-1",
      alreadyQueued: false,
    }));
    const app = mountWith({ joinGroup, enqueueRefresh });

    const response = await app.request("/api/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode: "ABCD2345" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      group: groupSummary,
      alreadyMember: false,
    });
    expect(enqueueRefresh).toHaveBeenCalledWith(
      {},
      { groupId, requestedByProfileId: profileId, reason: "membership_changed" },
    );
  });

  it("stays silent for someone who is already in", async () => {
    const joinGroup = vi.fn(async () => ({
      ok: true as const,
      group: groupSummary,
      alreadyMember: true,
    }));
    const enqueueRefresh = vi.fn(async () => ({
      jobId: "job-1",
      alreadyQueued: false,
    }));
    const app = mountWith({ joinGroup, enqueueRefresh });

    const response = await app.request("/api/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode: "ABCD2345" }),
    });

    expect(response.status).toBe(200);
    expect(enqueueRefresh).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown code", async () => {
    const joinGroup = vi.fn(async () => ({ ok: false as const, reason: "not_found" as const }));
    const app = mountWith({ joinGroup });

    const response = await app.request("/api/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode: "NOPE0000" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/groups/:groupId/leave", () => {
  it("leaves and asks for a refresh", async () => {
    const leaveGroupFn = vi.fn(async () => ({ ok: true }));
    const enqueueRefresh = vi.fn(async () => ({ jobId: "job-1", alreadyQueued: false }));
    const app = mountWith({ leaveGroupFn, enqueueRefresh });

    const response = await app.request(`/api/groups/${groupId}/leave`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(leaveGroupFn).toHaveBeenCalledWith({}, { profileId, groupId });
    expect(enqueueRefresh).toHaveBeenCalledWith(
      {},
      { groupId, requestedByProfileId: profileId, reason: "membership_changed" },
    );
  });

  it("tells someone who was never in it nothing beyond not-found", async () => {
    const app = mountWith({ leaveGroupFn: vi.fn(async () => ({ ok: false })) });

    const response = await app.request(`/api/groups/${groupId}/leave`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/groups/:groupId", () => {
  it("lets the owner close the group", async () => {
    const deleteGroupFn = vi.fn(async () => undefined);
    const app = mountWith({ deleteGroupFn });

    const response = await app.request(`/api/groups/${groupId}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(deleteGroupFn).toHaveBeenCalledWith({}, groupId);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("refuses a member who does not own it, and says why", async () => {
    const deleteGroupFn = vi.fn(async () => undefined);
    const app = mountWith({
      loadMembership: vi.fn(async () => plainMembership),
      deleteGroupFn,
    });

    const response = await app.request(`/api/groups/${groupId}`, { method: "DELETE" });

    expect(response.status).toBe(403);
    expect(deleteGroupFn).not.toHaveBeenCalled();
  });

  it("rejects a malformed group id before any lookup", async () => {
    const loadMembership = vi.fn(async () => ownerMembership);
    const app = mountWith({ loadMembership });

    const response = await app.request("/api/groups/not-a-uuid", { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(loadMembership).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/groups/:groupId", () => {
  it("renames the group for its owner", async () => {
    const renameGroupFn = vi.fn(async () => ({ ...groupSummary, name: "the studio" }));
    const app = mountWith({ renameGroupFn });

    const response = await app.request(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "the studio" }),
    });

    expect(response.status).toBe(200);
    expect(renameGroupFn).toHaveBeenCalledWith({}, { groupId, name: "the studio" });
    await expect(response.json()).resolves.toMatchObject({ group: { name: "the studio" } });
  });

  it("refuses a member who does not own it", async () => {
    const renameGroupFn = vi.fn(async () => groupSummary);
    const app = mountWith({
      loadMembership: vi.fn(async () => plainMembership),
      renameGroupFn,
    });

    const response = await app.request(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "the studio" }),
    });

    expect(response.status).toBe(403);
    expect(renameGroupFn).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/groups/:groupId/members/:memberProfileId", () => {
  it("lets the owner remove someone else", async () => {
    const removeMemberFn = vi.fn(async () => true);
    const app = mountWith({ removeMemberFn });

    const response = await app.request(
      `/api/groups/${groupId}/members/${otherProfileId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(removeMemberFn).toHaveBeenCalledWith(
      {},
      { groupId, memberProfileId: otherProfileId },
    );
  });

  it("sends an owner removing themselves to leave or delete instead", async () => {
    const removeMemberFn = vi.fn(async () => true);
    const app = mountWith({ removeMemberFn });

    const response = await app.request(`/api/groups/${groupId}/members/${profileId}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(removeMemberFn).not.toHaveBeenCalled();
  });

  it("returns 404 when the named person is not in the group", async () => {
    const app = mountWith({ removeMemberFn: vi.fn(async () => false) });

    const response = await app.request(
      `/api/groups/${groupId}/members/${otherProfileId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /api/groups/:groupId/members", () => {
  it("returns the roster with display names and initials", async () => {
    const members: GroupMemberSummary[] = [
      {
        profileId,
        name: "Ada",
        initials: "A",
        type: "human",
        role: "owner",
        joinedAt: "2026-07-07T00:00:00.000Z",
      },
    ];
    const app = mountWith({ listMembers: vi.fn(async () => members) });

    const response = await app.request(`/api/groups/${groupId}/members`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ members });
  });
});

describe("GET /api/groups/:groupId/wall", () => {
  it("returns members' shared signals, statement and owner only", async () => {
    const loadWall = vi.fn(async () => [wallSignal]);
    const app = mountWith({ loadWall });

    const response = await app.request(`/api/groups/${groupId}/wall`);

    expect(response.status).toBe(200);
    expect(loadWall).toHaveBeenCalledWith({}, groupId);
    await expect(response.json()).resolves.toEqual({
      wall: [
        {
          signalId,
          statement: "Rooms that instruct without speaking",
          confidence: 72,
          ownerProfileId: otherProfileId,
          ownerName: "Grace",
          sharedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("GET /api/groups/:groupId/top-of-mind", () => {
  it("returns the live artifact with per-entry member attribution", async () => {
    const view: GroupTopOfMindView = {
      topOfMind: {
        id: "00000000-0000-4000-8000-000000000501",
        version: 2,
        status: "live",
        reason: "regenerated",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
      entries: [
        {
          id: entryId,
          type: "pattern",
          body: "You both keep circling instruction without speech.",
          belief: null,
          prompt: null,
          lockedAt: null,
          pinnedAt: null,
          sortOrder: 0,
          createdAt: "2026-08-12T00:00:00.000Z",
          contributors: [
            { profileId, name: "Ada" },
            { profileId: otherProfileId, name: "Grace" },
          ],
        },
      ],
    };
    const app = mountWith({ loadTopOfMind: vi.fn(async () => view) });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(view);
  });

  it("says the group has no artifact yet rather than 404ing a member", async () => {
    const app = mountWith({
      loadTopOfMind: vi.fn(async () => ({ topOfMind: null, entries: [] })),
    });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ topOfMind: null, entries: [] });
  });
});

describe("POST /api/groups/:groupId/top-of-mind/refresh", () => {
  it("queues a pass and answers 202 without waiting for it", async () => {
    const queued: EnqueueGroupRefreshResult = { jobId: "job-9", alreadyQueued: false };
    const enqueueRefresh = vi.fn(async () => queued);
    const app = mountWith({ enqueueRefresh });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind/refresh`, {
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(enqueueRefresh).toHaveBeenCalledWith(
      {},
      { groupId, requestedByProfileId: profileId, reason: "manual" },
    );
    await expect(response.json()).resolves.toEqual({
      queued: true,
      jobId: "job-9",
      alreadyQueued: false,
    });
  });

  it("joins the pass that is already running instead of buying a second one", async () => {
    const app = mountWith({
      enqueueRefresh: vi.fn(async () => ({ jobId: "job-9", alreadyQueued: true })),
    });

    const response = await app.request(`/api/groups/${groupId}/top-of-mind/refresh`, {
      method: "POST",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ alreadyQueued: true });
  });
});

describe("group co-editing", () => {
  it("lists the group's proposals with their affirmations", async () => {
    const listProposals = vi.fn(async () => [proposalView]);
    const app = mountWith({ listProposals });

    const response = await app.request(`/api/groups/${groupId}/proposals?status=open&limit=10`);

    expect(response.status).toBe(200);
    expect(listProposals).toHaveBeenCalledWith(
      {},
      { groupId, viewerProfileId: profileId, status: "open", limit: 10 },
    );
    await expect(response.json()).resolves.toEqual({ proposals: [proposalView] });
  });

  it("opens a proposal against an entry", async () => {
    const createProposal = vi.fn(async () => ({
      ok: true as const,
      proposal: proposalView,
    }));
    const app = mountWith({ createProposal });

    const response = await app.request(`/api/groups/${groupId}/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "edit_entry",
        entryId,
        body: "Say it about instruction, not architecture.",
        rationale: "Both of us keep circling instruction.",
      }),
    });

    expect(response.status).toBe(201);
    expect(createProposal).toHaveBeenCalledWith(
      {},
      {
        groupId,
        profileId,
        kind: "edit_entry",
        entryId,
        body: "Say it about instruction, not architecture.",
        rationale: "Both of us keep circling instruction.",
      },
    );
    await expect(response.json()).resolves.toEqual({ proposal: proposalView });
  });

  it("refuses a proposal aimed at an entry that is not this group's", async () => {
    const app = mountWith({
      createProposal: vi.fn(async () => ({
        ok: false as const,
        reason: "entry_not_found" as const,
      })),
    });

    const response = await app.request(`/api/groups/${groupId}/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "edit_entry", entryId, body: "elsewhere" }),
    });

    expect(response.status).toBe(404);
  });

  it("accepts a proposal a second member affirms, and asks for the next version", async () => {
    const affirmProposal = vi.fn(async () => ({
      ok: true as const,
      proposal: { ...proposalView, status: "accepted" as const },
      accepted: true,
    }));
    const enqueueRefresh = vi.fn(async () => ({ jobId: "job-2", alreadyQueued: false }));
    const app = mountWith({ affirmProposal, enqueueRefresh });

    const response = await app.request(
      `/api/groups/${groupId}/proposals/${proposalId}/affirm`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
    expect(enqueueRefresh).toHaveBeenCalledWith(
      {},
      { groupId, requestedByProfileId: profileId, reason: "proposal_accepted" },
    );
  });

  it("records an affirmation that is not yet enough without regenerating", async () => {
    const enqueueRefresh = vi.fn(async () => ({ jobId: "job-2", alreadyQueued: false }));
    const app = mountWith({
      affirmProposal: vi.fn(async () => ({
        ok: true as const,
        proposal: proposalView,
        accepted: false,
      })),
      enqueueRefresh,
    });

    const response = await app.request(
      `/api/groups/${groupId}/proposals/${proposalId}/affirm`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: false });
    expect(enqueueRefresh).not.toHaveBeenCalled();
  });

  it("answers 409 when the proposal has already been settled", async () => {
    const app = mountWith({
      affirmProposal: vi.fn(async () => ({
        ok: false as const,
        reason: "already_resolved" as const,
      })),
    });

    const response = await app.request(
      `/api/groups/${groupId}/proposals/${proposalId}/affirm`,
      { method: "POST" },
    );

    expect(response.status).toBe(409);
  });

  it("declines a proposal", async () => {
    const declineProposal = vi.fn(async () => ({
      ok: true as const,
      proposal: { ...proposalView, status: "declined" as const },
      accepted: false,
    }));
    const app = mountWith({ declineProposal });

    const response = await app.request(
      `/api/groups/${groupId}/proposals/${proposalId}/decline`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(declineProposal).toHaveBeenCalledWith(
      {},
      { groupId, proposalId, profileId },
    );
    await expect(response.json()).resolves.toMatchObject({
      proposal: { status: "declined" },
    });
  });
});

describe("proposalShapeIsValid", () => {
  it("holds each kind to the fields it means", () => {
    expect(proposalShapeIsValid({ kind: "add_entry", body: "a new line" })).toBe(true);
    expect(proposalShapeIsValid({ kind: "add_entry", body: "a new line", entryId })).toBe(
      false,
    );
    expect(proposalShapeIsValid({ kind: "edit_entry", entryId, body: "reworded" })).toBe(
      true,
    );
    expect(proposalShapeIsValid({ kind: "edit_entry", entryId })).toBe(false);
    expect(proposalShapeIsValid({ kind: "remove_entry", entryId })).toBe(true);
    expect(proposalShapeIsValid({ kind: "remove_entry", entryId, body: "why" })).toBe(false);
  });
});

/**
 * THE MAJORITY RULE ITSELF.
 *
 * Every existing test injects a mock `affirmProposal`, so the arithmetic that
 * decides whether a room has spoken was never executed by anything. The route
 * tests prove the route calls the function; they cannot prove the function is
 * right, and "364 passed" said nothing about the rule at all.
 *
 * The rule is one line — strictly more than half — so it is extracted and
 * tested directly rather than reached through a database. What matters is the
 * boundaries: an even room must not carry on a tie, and a room of one is
 * carried by its only member, which is the honest reading of "most of us"
 * when us is one.
 */
describe("a proposal carries on a majority of the room", () => {
  it("needs strictly more than half, so a tie does not carry", () => {
    expect(carriesMajority(2, 4)).toBe(false);
    expect(carriesMajority(3, 4)).toBe(true);
  });

  it("needs three of five — the four-of-us room", () => {
    expect(carriesMajority(2, 5)).toBe(false);
    expect(carriesMajority(3, 5)).toBe(true);
  });

  it("carries a room of one by its only member", () => {
    expect(carriesMajority(1, 1)).toBe(true);
    expect(carriesMajority(0, 1)).toBe(false);
  });

  it("never carries a room with no members", () => {
    expect(carriesMajority(0, 0)).toBe(false);
    expect(carriesMajority(3, 0)).toBe(false);
  });

  it("is unmoved by more affirmations than members", () => {
    expect(carriesMajority(9, 5)).toBe(true);
  });
});
