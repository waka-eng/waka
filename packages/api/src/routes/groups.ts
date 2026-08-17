/**
 * `/api/groups` — groups, their wall of shared signals, and the top of mind
 * they co-edit.
 *
 * A group is where layer 2 crosses between people. Members share **signals**
 * to it; the group's single top-of-mind artifact is generated from those
 * shared statements; members change that artifact together through proposals
 * and affirmations.
 *
 * This file is the HTTP surface only — the schemas a request is checked
 * against, the two gates in front of every handler, and the handlers
 * themselves. The reads and writes each handler calls live beside it, one
 * file per concern, so an authorization question has one short file to be
 * answered in rather than seventeen hundred lines to be found in:
 *
 *   `groups-membership.ts`   who is in a room, and the join code that lets
 *                            them in — the answer to "may I?"
 *   `groups-field.ts`        a room's ground: layer 1, and the ONLY read of
 *                            layer 1 anywhere in the group module
 *   `groups-wall.ts`         a room's wall: the signals members shared in
 *   `groups-top-of-mind.ts`  the artifact a room co-owns, and its refresh
 *   `groups-proposals.ts`    proposals, affirmations, and what carries
 *
 * Two authorization rules run in front of everything:
 *
 *   1. **Human profiles only.** Membership is between people; an agent
 *      profile's memory is its own stack, not a seat at someone's table. The
 *      gate is one middleware so no handler can forget it, and it answers 403
 *      because the caller is authenticated and the refusal is about who they
 *      are, not about what exists.
 *   2. **Membership first.** Every group-scoped handler resolves the caller's
 *      membership before reading anything, and a non-member gets 404 rather
 *      than 403 — "you may not see this group" would confirm the id names a
 *      real one. Owner-only actions answer 403 to a member who is simply not
 *      the owner, who already knows the group exists.
 *
 * The loaders in the files above take an already-authorized group id. They
 * are exported so the worker and tests can reach them, but they are not a
 * second authorization layer: the gate in the handler is the one that
 * decides.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  groupProposalKindValues,
  groupProposalStatusValues,
  type RefreshGroupTopOfMindPayload,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { loadGroupField } from "./groups-field.js";
import {
  createGroupForProfile,
  deleteGroup,
  joinGroupByCode,
  leaveGroup,
  listGroupMembers,
  listGroupsForProfile,
  loadGroupMembership,
  removeGroupMember,
  renameGroup,
} from "./groups-membership.js";
import {
  affirmGroupProposal,
  createGroupProposal,
  declineGroupProposal,
  listGroupProposals,
  DEFAULT_PROPOSAL_LIMIT,
  MAX_PROPOSAL_LIMIT,
} from "./groups-proposals.js";
import {
  enqueueGroupTopOfMindRefresh,
  loadGroupTopOfMind,
} from "./groups-top-of-mind.js";
import { loadGroupWall } from "./groups-wall.js";

const createGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const renameGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const joinGroupSchema = z
  .object({ joinCode: z.string().trim().min(4, "Join code is required").max(64) })
  .strict();

const groupParamsSchema = z.object({ groupId: z.string().uuid() }).strict();

const memberParamsSchema = z
  .object({ groupId: z.string().uuid(), memberProfileId: z.string().uuid() })
  .strict();

const proposalParamsSchema = z
  .object({ groupId: z.string().uuid(), proposalId: z.string().uuid() })
  .strict();

const createProposalSchema = z
  .object({
    kind: z.enum(groupProposalKindValues),
    entryId: z.string().uuid().optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    rationale: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const listProposalsQuerySchema = z
  .object({
    status: z.enum(groupProposalStatusValues).optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_PROPOSAL_LIMIT))
      .optional(),
  })
  .strict();

/**
 * Groups are between people.
 *
 * An agent profile owns its own three-layer stack; it does not take a seat at
 * a human's table. Enforced once, in front of every handler, because the rule
 * is about the caller rather than about any particular group — and a rule
 * re-implemented per route is a rule that will be missing from one of them.
 */
export const humanProfilesOnly: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Groups are between people, not agent profiles" }, 403);
  }
  await next();
};

export interface GroupsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  loadMembership?: typeof loadGroupMembership;
  listGroups?: typeof listGroupsForProfile;
  createGroup?: typeof createGroupForProfile;
  joinGroup?: typeof joinGroupByCode;
  leaveGroupFn?: typeof leaveGroup;
  deleteGroupFn?: typeof deleteGroup;
  renameGroupFn?: typeof renameGroup;
  removeMemberFn?: typeof removeGroupMember;
  listMembers?: typeof listGroupMembers;
  loadField?: typeof loadGroupField;
  loadWall?: typeof loadGroupWall;
  loadTopOfMind?: typeof loadGroupTopOfMind;
  enqueueRefresh?: typeof enqueueGroupTopOfMindRefresh;
  listProposals?: typeof listGroupProposals;
  createProposal?: typeof createGroupProposal;
  affirmProposal?: typeof affirmGroupProposal;
  declineProposal?: typeof declineGroupProposal;
}

export function createGroupsRoutes(deps: GroupsRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadMembership = deps.loadMembership ?? loadGroupMembership;
  const listGroups = deps.listGroups ?? listGroupsForProfile;
  const createGroup = deps.createGroup ?? createGroupForProfile;
  const joinGroup = deps.joinGroup ?? joinGroupByCode;
  const leaveGroupFn = deps.leaveGroupFn ?? leaveGroup;
  const deleteGroupFn = deps.deleteGroupFn ?? deleteGroup;
  const renameGroupFn = deps.renameGroupFn ?? renameGroup;
  const removeMemberFn = deps.removeMemberFn ?? removeGroupMember;
  const listMembers = deps.listMembers ?? listGroupMembers;
  const loadField = deps.loadField ?? loadGroupField;
  const loadWall = deps.loadWall ?? loadGroupWall;
  const loadTopOfMind = deps.loadTopOfMind ?? loadGroupTopOfMind;
  const enqueueRefresh = deps.enqueueRefresh ?? enqueueGroupTopOfMindRefresh;
  const listProposals = deps.listProposals ?? listGroupProposals;
  const createProposal = deps.createProposal ?? createGroupProposal;
  const affirmProposal = deps.affirmProposal ?? affirmGroupProposal;
  const declineProposal = deps.declineProposal ?? declineGroupProposal;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanProfilesOnly);

  /** A membership change is new material for the group's next synthesis. */
  const requestRefresh = async (
    groupId: string,
    profileId: string,
    reason: RefreshGroupTopOfMindPayload["reason"],
  ): Promise<void> => {
    try {
      await enqueueRefresh(getDatabase(), {
        groupId,
        requestedByProfileId: profileId,
        reason,
      });
    } catch (err) {
      // A refresh that could not be queued must not fail the action that
      // caused it: the membership change already happened.
      console.warn("[groups] group top of mind refresh could not be queued", {
        groupId,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const readJsonBody = async (c: {
    req: { json: () => Promise<unknown> };
  }): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    try {
      return { ok: true, value: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  // GET /api/groups — the groups the caller belongs to.
  routes.get("/", async (c) => {
    const session = c.get("session");
    const groupList = await listGroups(getDatabase(), session.profile.id);
    return c.json({ groups: groupList });
  });

  // POST /api/groups — create a group; the caller takes the owner seat.
  routes.post("/", async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = createGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid group payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const group = await createGroup(getDatabase(), {
      profileId: session.profile.id,
      name: parsed.data.name,
    });
    return c.json({ group }, 201);
  });

  // POST /api/groups/join — join by shareable code.
  routes.post("/join", async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = joinGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid join payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    /*
     * JOINING IS NOT GATED ON A PROVEN EMAIL ADDRESS, AND RE-ADDING THAT GATE
     * NEEDS A WORKING MAIL PROVIDER FIRST.
     *
     * This handler used to answer 403 `email_not_verified` until the account
     * had proven its address. Nothing ever sent the link — the transport was
     * left as an unimplemented interface — so the proof was unobtainable and
     * every account that predated the gate could join nothing at all. The
     * owner dropped the requirement rather than wire a provider or bless the
     * existing accounts. The full reasoning is in
     * drizzle/migrations/0010_the_address_stays_unproven.sql.
     *
     * The join code is what a join stands on now: it is a bearer credential,
     * rotated on removal (groups-membership.ts). Google sign-in still refuses
     * an unverified `email_verified` claim (auth-google.ts) — that is Google
     * attesting the address, not this product asking for proof, and it is a
     * separate defence that did not go away with this one.
     */
    const result = await joinGroup(getDatabase(), {
      profileId: session.profile.id,
      joinCode: parsed.data.joinCode,
    });
    if (!result.ok) {
      return c.json({ error: "No group matches that join code" }, 404);
    }
    if (!result.alreadyMember) {
      await requestRefresh(result.group.id, session.profile.id, "membership_changed");
    }
    return c.json({ group: result.group, alreadyMember: result.alreadyMember });
  });

  // POST /api/groups/:groupId/leave
  routes.post("/:groupId/leave", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const result = await leaveGroupFn(getDatabase(), {
      profileId: session.profile.id,
      groupId,
    });
    if (!result.ok) return c.json({ error: "Group not found" }, 404);
    await requestRefresh(groupId, session.profile.id, "membership_changed");
    return c.json({ ok: true });
  });

  // DELETE /api/groups/:groupId — owner closes the group.
  routes.delete("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can delete it" }, 403);
    }

    await deleteGroupFn(getDatabase(), groupId);
    return c.json({ ok: true });
  });

  // PATCH /api/groups/:groupId — rename. Owner only.
  routes.patch("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = renameGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid group name", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can rename it" }, 403);
    }

    const group = await renameGroupFn(getDatabase(), {
      groupId,
      name: parsed.data.name,
    });
    if (!group) return c.json({ error: "Group not found" }, 404);
    return c.json({ group });
  });

  // DELETE /api/groups/:groupId/members/:memberProfileId — owner removes someone.
  routes.delete("/:groupId/members/:memberProfileId", async (c) => {
    const parsedParams = memberParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or member id" }, 400);
    const session = c.get("session");
    const { groupId, memberProfileId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can remove someone" }, 403);
    }
    // Removing yourself is either leaving or deleting, and both already exist.
    if (memberProfileId === session.profile.id) {
      return c.json({ error: "Leave the group instead of removing yourself" }, 400);
    }

    const removed = await removeMemberFn(getDatabase(), { groupId, memberProfileId });
    if (!removed) return c.json({ error: "That person is not in this group" }, 404);
    await requestRefresh(groupId, session.profile.id, "membership_changed");
    return c.json({ ok: true });
  });

  // GET /api/groups/:groupId/members
  routes.get("/:groupId/members", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const members = await listMembers(getDatabase(), groupId);
    return c.json({ members });
  });

  // GET /api/groups/:groupId/wall — members' shared signals.
  routes.get("/:groupId/wall", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const wall = await loadWall(getDatabase(), groupId);
    // Serialized field by field rather than spread: the wall is the boundary
    // between two people's memory, and a loader that one day selects a column
    // more must not be able to publish it by accident.
    return c.json({
      wall: wall.map((shared) => ({
        signalId: shared.signalId,
        statement: shared.statement,
        confidence: shared.confidence,
        ownerProfileId: shared.ownerProfileId,
        ownerName: shared.ownerName,
        sharedAt: shared.sharedAt,
      })),
    });
  });


  /**
   * GET /api/groups/:groupId/field — the room's ground.
   *
   * Every PUBLIC capture belonging to every member of this room, newest last,
   * each carrying whose it is and whether that profile is a person or an
   * agent. This is the first endpoint in the product that returns layer 1
   * across an account boundary, so the predicate is written to be read: a row
   * appears only if its author is currently in this room AND its author
   * marked it public. Neither half is inferred, and the visibility column
   * defaults to private, so the failure mode of any bug upstream is an empty
   * field rather than somebody else's memory.
   *
   * Leaving a room therefore withdraws your memories from it with no cleanup
   * step — there is no copy of them anywhere else to chase.
   */
  routes.get("/:groupId/field", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;
    const db = getDatabase();

    const membership = await loadMembership(db, {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const rows = await loadField(db, groupId);

    // Serialized field by field, for the same reason the wall is: this is the
    // boundary between two people's memory, and a loader that one day selects
    // a column more must not be able to publish it by accident.
    return c.json({
      field: rows.map((row) => ({
        id: row.id,
        text: row.text,
        kind: row.kind,
        source: row.source,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ownerProfileId: row.ownerProfileId,
        ownerName: row.ownerName,
        ownerType: row.ownerType,
      })),
    });
  });

  // GET /api/groups/:groupId/top-of-mind
  routes.get("/:groupId/top-of-mind", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const view = await loadTopOfMind(getDatabase(), groupId);
    // Serialized field by field for the same reason as the wall: this is a
    // read across an account boundary, and it must publish exactly the fields
    // it means to, not whatever a loader's select list grows into.
    return c.json({
      topOfMind: view.topOfMind
        ? {
            id: view.topOfMind.id,
            version: view.topOfMind.version,
            status: view.topOfMind.status,
            reason: view.topOfMind.reason,
            createdAt: view.topOfMind.createdAt,
          }
        : null,
      entries: view.entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        lockedAt: entry.lockedAt,
        pinnedAt: entry.pinnedAt,
        sortOrder: entry.sortOrder,
        createdAt: entry.createdAt,
        contributors: entry.contributors.map((contributor) => ({
          profileId: contributor.profileId,
          name: contributor.name,
        })),
      })),
    });
  });

  // POST /api/groups/:groupId/top-of-mind/refresh — ask for the next version.
  routes.post("/:groupId/top-of-mind/refresh", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const queued = await enqueueRefresh(getDatabase(), {
      groupId,
      requestedByProfileId: session.profile.id,
      reason: "manual",
    });
    // 202 either way: synthesis is a model pass that finishes after this
    // response, and the caller's next read is what shows the result.
    return c.json(
      {
        queued: Boolean(queued),
        jobId: queued?.jobId ?? null,
        alreadyQueued: queued?.alreadyQueued ?? false,
      },
      202,
    );
  });

  // GET /api/groups/:groupId/proposals
  routes.get("/:groupId/proposals", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const parsedQuery = listProposalsQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid query", details: parsedQuery.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const proposals = await listProposals(getDatabase(), {
      groupId,
      viewerProfileId: session.profile.id,
      ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
      limit: parsedQuery.data.limit ?? DEFAULT_PROPOSAL_LIMIT,
    });
    return c.json({ proposals });
  });

  // POST /api/groups/:groupId/proposals
  routes.post("/:groupId/proposals", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = createProposalSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid proposal payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await createProposal(getDatabase(), {
      groupId,
      profileId: session.profile.id,
      kind: parsed.data.kind,
      ...(parsed.data.entryId ? { entryId: parsed.data.entryId } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.rationale ? { rationale: parsed.data.rationale } : {}),
    });
    if (!result.ok) {
      return result.reason === "entry_not_found"
        ? c.json({ error: "That entry is not part of this group's top of mind" }, 404)
        : c.json({ error: "A proposal must match the shape of its kind" }, 400);
    }
    return c.json({ proposal: result.proposal }, 201);
  });

  // POST /api/groups/:groupId/proposals/:proposalId/affirm
  routes.post("/:groupId/proposals/:proposalId/affirm", async (c) => {
    const parsedParams = proposalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or proposal id" }, 400);
    const session = c.get("session");
    const { groupId, proposalId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await affirmProposal(getDatabase(), {
      groupId,
      proposalId,
      profileId: session.profile.id,
    });
    if (!result.ok) {
      return result.reason === "already_resolved"
        ? c.json({ error: "That proposal has already been settled" }, 409)
        : c.json({ error: "Proposal not found" }, 404);
    }
    if (result.accepted) {
      await requestRefresh(groupId, session.profile.id, "proposal_accepted");
    }
    return c.json({ proposal: result.proposal, accepted: result.accepted });
  });

  // POST /api/groups/:groupId/proposals/:proposalId/decline
  routes.post("/:groupId/proposals/:proposalId/decline", async (c) => {
    const parsedParams = proposalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or proposal id" }, 400);
    const session = c.get("session");
    const { groupId, proposalId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await declineProposal(getDatabase(), {
      groupId,
      proposalId,
      profileId: session.profile.id,
    });
    if (!result.ok) {
      return result.reason === "already_resolved"
        ? c.json({ error: "That proposal has already been settled" }, 409)
        : c.json({ error: "Proposal not found" }, 404);
    }
    return c.json({ proposal: result.proposal });
  });

  return routes;
}

export const groupsRoutes = createGroupsRoutes();
