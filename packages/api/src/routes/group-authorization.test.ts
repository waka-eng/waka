/**
 * The group boundary: who gets in, and what can come out.
 *
 * `groups.test.ts` proves the endpoints do their jobs. This file proves the
 * three rules that make a group safe to be in, and each is asserted in the
 * shape that could actually fail:
 *
 *   1. **A non-member is turned away before anything is read.** Asserting a
 *      404 alone would pass on a route that read the whole wall and then
 *      forgot to send it. So the content loaders are stubs that fail the test
 *      if they are ever reached.
 *   2. **An agent-bound session has no seat at all.** Same standard: the
 *      refusal has to happen before the membership lookup, not after it.
 *   3. **No inspiration text can leave through a group.** Asserted against a
 *      loader that deliberately over-selects — the route must publish the
 *      fields it means to and nothing else — and against the module's own
 *      source, which must not reference layer 1 at any point.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";
import {
  createGroupsRoutes,
  type GroupMembership,
  type GroupSummary,
  type GroupTopOfMindView,
  type GroupsRouteDependencies,
  type GroupWallSignal,
} from "./groups.js";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const humanProfileId = "00000000-0000-4000-8000-000000000001";
const agentProfileId = "00000000-0000-4000-8000-000000000002";
const otherProfileId = "00000000-0000-4000-8000-000000000003";
const groupId = "00000000-0000-4000-8000-000000000101";
const proposalId = "00000000-0000-4000-8000-000000000301";
const signalId = "00000000-0000-4000-8000-000000000401";

/** A raw capture. If this string reaches a group response, the test failed. */
const RAW_CAPTURE = "the bench in the window at my mother's house";

const humanSession: AuthenticatedSession = {
  sessionId: "00000000-0000-4000-8000-0000000000f1",
  account: { id: accountId, email: "ada@example.com" },
  profile: {
    id: humanProfileId,
    accountId,
    type: "human",
    name: "Ada",
    preferredLocale: "en-US",
  },
};

const agentSession: AuthenticatedSession = {
  ...humanSession,
  sessionId: "00000000-0000-4000-8000-0000000000f2",
  profile: {
    id: agentProfileId,
    accountId,
    type: "agent",
    name: "Claude",
    preferredLocale: "en-US",
  },
};

function sessionMiddleware(as: AuthenticatedSession) {
  return async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("session", as);
    await next();
  };
}

/** Every dependency that reads or writes group content, wired to explode. */
function unreachableDependencies(): GroupsRouteDependencies {
  const unreachable = (name: string) =>
    vi.fn(async () => {
      throw new Error(`${name} must not run for a caller without a seat`);
    });
  return {
    listGroups: unreachable("listGroups") as never,
    createGroup: unreachable("createGroup") as never,
    joinGroup: unreachable("joinGroup") as never,
    leaveGroupFn: unreachable("leaveGroup") as never,
    deleteGroupFn: unreachable("deleteGroup") as never,
    renameGroupFn: unreachable("renameGroup") as never,
    removeMemberFn: unreachable("removeGroupMember") as never,
    listMembers: unreachable("listGroupMembers") as never,
    loadWall: unreachable("loadGroupWall") as never,
    loadTopOfMind: unreachable("loadGroupTopOfMind") as never,
    enqueueRefresh: unreachable("enqueueGroupTopOfMindRefresh") as never,
    listProposals: unreachable("listGroupProposals") as never,
    createProposal: unreachable("createGroupProposal") as never,
    affirmProposal: unreachable("affirmGroupProposal") as never,
    declineProposal: unreachable("declineGroupProposal") as never,
  };
}

function mount(deps: GroupsRouteDependencies, as: AuthenticatedSession) {
  const app = new Hono();
  app.route(
    "/api/groups",
    createGroupsRoutes({
      getDatabase: (() => ({})) as GroupsRouteDependencies["getDatabase"],
      authMiddleware: sessionMiddleware(as) as never,
      ...deps,
    }),
  );
  return app;
}

/** Every group-scoped surface, in the form a caller would reach it. */
const groupScopedRequests: Array<[string, string, RequestInit]> = [
  ["the roster", `/api/groups/${groupId}/members`, { method: "GET" }],
  ["the wall", `/api/groups/${groupId}/wall`, { method: "GET" }],
  ["the top of mind", `/api/groups/${groupId}/top-of-mind`, { method: "GET" }],
  [
    "a refresh",
    `/api/groups/${groupId}/top-of-mind/refresh`,
    { method: "POST" },
  ],
  ["the proposals", `/api/groups/${groupId}/proposals`, { method: "GET" }],
  [
    "a new proposal",
    `/api/groups/${groupId}/proposals`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "add_entry", body: "let me in" }),
    },
  ],
  [
    "an affirmation",
    `/api/groups/${groupId}/proposals/${proposalId}/affirm`,
    { method: "POST" },
  ],
  [
    "a decline",
    `/api/groups/${groupId}/proposals/${proposalId}/decline`,
    { method: "POST" },
  ],
  ["a rename", `/api/groups/${groupId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "mine now" }),
  }],
  ["a deletion", `/api/groups/${groupId}`, { method: "DELETE" }],
  [
    "a removal",
    `/api/groups/${groupId}/members/${otherProfileId}`,
    { method: "DELETE" },
  ],
];

describe("a non-member", () => {
  it.each(groupScopedRequests)(
    "cannot reach %s, and nothing is read on the way to being told so",
    async (_label, path, init) => {
      const app = mount(
        { ...unreachableDependencies(), loadMembership: vi.fn(async () => null) },
        humanSession,
      );

      const response = await app.request(path, init);

      // 404, not 403: "you may not see this" would confirm the id names a
      // real group, which is the one fact a non-member must not learn.
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Group not found" });
    },
  );

  it("is turned away by the membership check itself, not by an empty result", async () => {
    const loadMembership = vi.fn(async () => null);
    const app = mount(
      { ...unreachableDependencies(), loadMembership },
      humanSession,
    );

    await app.request(`/api/groups/${groupId}/wall`);

    expect(loadMembership).toHaveBeenCalledWith({}, {
      groupId,
      profileId: humanProfileId,
    });
  });
});

describe("an agent-bound session", () => {
  const membership: GroupMembership = {
    groupId,
    profileId: agentProfileId,
    role: "owner",
  };

  /**
   * Membership is between people. An agent profile owns its own stack, so it
   * has no business at a human's table — and a membership lookup that would
   * have said "owner" is the point: the refusal cannot depend on the agent
   * happening not to be in the group.
   */
  it.each([
    ["listing groups", "/api/groups", { method: "GET" }],
    [
      "creating one",
      "/api/groups",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ours" }),
      },
    ],
    [
      "joining one",
      "/api/groups/join",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: "ABCD2345" }),
      },
    ],
    ...groupScopedRequests.map(
      ([label, path, init]) => [label, path, init] as [string, string, RequestInit],
    ),
  ])("is refused %s", async (_label, path, init) => {
    const loadMembership = vi.fn(async () => membership);
    const app = mount(
      { ...unreachableDependencies(), loadMembership },
      agentSession,
    );

    const response = await app.request(path, init);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Groups are between people, not agent profiles",
    });
    // Refused for who it is, before anyone asks whether it has a seat.
    expect(loadMembership).not.toHaveBeenCalled();
  });
});

describe("what a group can publish", () => {
  const membership: GroupMembership = {
    groupId,
    profileId: humanProfileId,
    role: "member",
  };

  /**
   * A loader that reaches too far.
   *
   * The privacy rule cannot rest on every future query being written
   * correctly, so the route is the second line: it names the fields it
   * publishes, and a row carrying more than that is simply not asked for.
   */
  const overSelectedWallRow = {
    signalId,
    statement: "Rooms that instruct without speaking",
    confidence: 72,
    ownerProfileId: otherProfileId,
    ownerName: "Grace",
    sharedAt: "2026-08-10T00:00:00.000Z",
    inspirationText: RAW_CAPTURE,
    quote: RAW_CAPTURE,
    evidenceReason: RAW_CAPTURE,
  };

  const overSelectedTopOfMind = {
    topOfMind: {
      id: "00000000-0000-4000-8000-000000000501",
      version: 1,
      status: "live" as const,
      reason: "initial" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
      sourceInspirations: [RAW_CAPTURE],
    },
    entries: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        type: "pattern" as const,
        body: "You both keep circling instruction without speech.",
        belief: null,
        prompt: null,
        lockedAt: null,
        pinnedAt: null,
        sortOrder: 0,
        createdAt: "2026-08-12T00:00:00.000Z",
        contributors: [{ profileId: otherProfileId, name: "Grace", quote: RAW_CAPTURE }],
        evidence: RAW_CAPTURE,
      },
    ],
  };

  function mountWithLeakyLoaders() {
    return mount(
      {
        loadMembership: vi.fn(async () => membership),
        loadWall: vi.fn(async () => [overSelectedWallRow as GroupWallSignal]),
        loadTopOfMind: vi.fn(
          async () => overSelectedTopOfMind as unknown as GroupTopOfMindView,
        ),
      },
      humanSession,
    );
  }

  it("shows the pattern on the wall and nothing underneath it", async () => {
    const response = await mountWithLeakyLoaders().request(
      `/api/groups/${groupId}/wall`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { wall: Array<Record<string, unknown>> };
    expect(Object.keys(body.wall[0]!).sort()).toEqual([
      "confidence",
      "ownerName",
      "ownerProfileId",
      "sharedAt",
      "signalId",
      "statement",
    ]);
    // No field for the capture behind the statement, under any name.
    expect(body.wall[0]).not.toHaveProperty("inspirationText");
    expect(body.wall[0]).not.toHaveProperty("quote");
    expect(body.wall[0]).not.toHaveProperty("evidenceReason");
  });

  it("attributes a group entry to a member without carrying their evidence", async () => {
    const response = await mountWithLeakyLoaders().request(
      `/api/groups/${groupId}/top-of-mind`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = body.entries[0]!;
    expect(entry).not.toHaveProperty("evidence");
    expect(entry.contributors).toEqual([
      { profileId: otherProfileId, name: "Grace" },
    ]);
  });

  it.each([
    [`/api/groups/${groupId}/wall`],
    [`/api/groups/${groupId}/top-of-mind`],
  ])("never lets a raw capture through %s", async (path) => {
    const response = await mountWithLeakyLoaders().request(path);
    await expect(response.text()).resolves.not.toContain(RAW_CAPTURE);
  });
});

describe("the group module itself", () => {
  /**
   * The guarantee one layer below the responses.
   *
   * Serializing carefully protects today's queries; this protects tomorrow's.
   * An inspiration never crosses an account boundary, so a group query has no
   * legitimate reason to name layer 1 at all — and a join written by someone
   * who has not read the canon is exactly how that rule gets broken.
   */
  /**
   * This asserted that the group module never touches layer 1 at all. That
   * invariant is gone on purpose: a room's field is built from its members'
   * memories now, so groups.ts reads `inspirations` by design.
   *
   * What replaces it is the property that actually protects anyone — every
   * read of layer 1 from this module is gated on the author having marked the
   * capture public. "Does not read it" was easy to check and is no longer
   * true; "cannot read a private one" is the thing worth guarding, and it is
   * the assertion that would have caught the mistake this test exists for.
   *
   * Evidence is still off limits. A signal's evidence names the exact spans
   * of the memories behind it, and nothing in a room has ever been allowed to
   * see those — sharing a statement has never shipped its grounds.
   */
  it("reads layer 1 only through the public-visibility gate", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./groups.ts", import.meta.url)),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // Evidence and its join key stay out entirely.
    expect(code).not.toMatch(/\bsignalEvidence\b/);
    expect(code).not.toMatch(/\binspirationId\b/);

    // Every statement that touches `inspirations` must also carry the gate.
    const readsLayer1 = /\binspirations\b/.test(code);
    if (readsLayer1) {
      expect(code).toMatch(/eq\(\s*inspirations\.visibility\s*,\s*"public"\s*\)/);
      // ...and the gate must not be the only mention while some other query
      // quietly selects from the table without it.
      const gates = code.match(/eq\(\s*inspirations\.visibility\s*,\s*"public"\s*\)/g) ?? [];
      const froms = code.match(/\.from\(\s*inspirations\s*\)/g) ?? [];
      expect(gates.length).toBeGreaterThanOrEqual(froms.length);
    }
  });
});

describe("a member of one group is not a member of another", () => {
  it("gets the seat it asked about, not whichever it holds", async () => {
    const loadMembership = vi.fn(async () => null);
    const otherGroupId = "00000000-0000-4000-8000-000000000102";
    const groups: GroupSummary[] = [
      {
        id: groupId,
        name: "builders",
        joinCode: "ABCD2345",
        role: "owner",
        memberCount: 2,
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ];
    const app = mount(
      {
        loadMembership,
        listGroups: vi.fn(async () => groups),
        loadWall: vi.fn(async () => {
          throw new Error("the wall of a group the caller is not in must not load");
        }) as never,
      },
      humanSession,
    );

    const own = await app.request("/api/groups");
    await expect(own.json()).resolves.toEqual({ groups });

    const response = await app.request(`/api/groups/${otherGroupId}/wall`);
    expect(response.status).toBe(404);
    expect(loadMembership).toHaveBeenCalledWith({}, {
      groupId: otherGroupId,
      profileId: humanProfileId,
    });
  });
});
