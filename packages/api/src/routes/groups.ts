/**
 * `/api/groups` — Group Top of Mind boards (US-052).
 *
 * Every handler requires a valid session (mounted once at the router level).
 * Group-scoped reads verify membership inside the service layer and 404 when
 * the caller is not a member, so a non-member can never see a group's board.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { getDb } from "../lib/db.js";
import {
  createGroupForUser,
  deleteGroup,
  joinGroupByCode,
  leaveGroup,
  listGroupTopOfMind,
  listGroupsForUser,
  refreshGroupTopOfMind,
  removeGroupMember,
  renameGroup,
} from "../lib/group-top-of-mind.js";
import {
  getGroupCombinationReading,
  refreshGroupCombinationReading,
} from "../lib/group-combination-reading.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { boardAsOf, loadRoomTimeline } from "../lib/room-timeline.js";

const DEFAULT_GROUP_TOP_OF_MIND_LIMIT = 5;
const MAX_GROUP_TOP_OF_MIND_LIMIT = 20;

const createGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const joinGroupSchema = z
  .object({ joinCode: z.string().trim().min(4, "Join code is required").max(64) })
  .strict();

const groupParamsSchema = z.object({ groupId: z.string().uuid() }).strict();

const memberParamsSchema = z
  .object({ groupId: z.string().uuid(), memberUserId: z.string().uuid() })
  .strict();

const renameGroupSchema = z
  .object({ name: z.string().trim().min(1, "Room name is required").max(120) })
  .strict();

const timelineQuerySchema = z
  .object({
    /**
     * Where on the rail to resolve the board. Absent means now.
     *
     * Parsed strictly: a timestamp we cannot read must be an error, not a
     * silent fallback to the present, or a broken deep link would quietly show
     * today's board and look correct.
     */
    at: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict();

const listNotesQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_GROUP_TOP_OF_MIND_LIMIT))
      .optional(),
  })
  .strict();

export interface GroupsRouteDependencies {
  getDatabase?: typeof getDb;
  listGroups?: typeof listGroupsForUser;
  createGroup?: typeof createGroupForUser;
  joinGroup?: typeof joinGroupByCode;
  leaveGroupFn?: typeof leaveGroup;
  deleteGroupFn?: typeof deleteGroup;
  renameGroupFn?: typeof renameGroup;
  removeMemberFn?: typeof removeGroupMember;
  listGroupNotes?: typeof listGroupTopOfMind;
  refreshGroupNotes?: typeof refreshGroupTopOfMind;
  getReading?: typeof getGroupCombinationReading;
  refreshReading?: typeof refreshGroupCombinationReading;
  loadTimeline?: typeof loadRoomTimeline;
  loadBoardAsOf?: typeof boardAsOf;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createGroupsRoutes(
  deps: GroupsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listGroups = deps.listGroups ?? listGroupsForUser;
  const createGroup = deps.createGroup ?? createGroupForUser;
  const joinGroup = deps.joinGroup ?? joinGroupByCode;
  const leaveGroupFn = deps.leaveGroupFn ?? leaveGroup;
  const deleteGroupFn = deps.deleteGroupFn ?? deleteGroup;
  const renameGroupFn = deps.renameGroupFn ?? renameGroup;
  const removeMemberFn = deps.removeMemberFn ?? removeGroupMember;
  const listGroupNotes = deps.listGroupNotes ?? listGroupTopOfMind;
  const refreshGroupNotes = deps.refreshGroupNotes ?? refreshGroupTopOfMind;
  const getCombinationReading = deps.getReading ?? getGroupCombinationReading;
  const refreshCombinationReading = deps.refreshReading ?? refreshGroupCombinationReading;
  const loadTimeline = deps.loadTimeline ?? loadRoomTimeline;
  const loadBoardAsOf = deps.loadBoardAsOf ?? boardAsOf;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  // GET /api/groups — the boards the signed-in user belongs to.
  routes.get("/", async (c) => {
    const user = c.get("user");
    const boards = await listGroups(getDatabase(), user.id);
    return c.json({ groups: boards });
  });

  // POST /api/groups — create a board; caller becomes owner.
  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = createGroupSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid group payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const user = c.get("user");
    const group = await createGroup(getDatabase(), {
      userId: user.id,
      name: parsed.data.name,
    });
    return c.json({ group }, 201);
  });

  // POST /api/groups/join — join by shareable code.
  routes.post("/join", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = joinGroupSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid join payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const user = c.get("user");
    const result = await joinGroup(getDatabase(), {
      userId: user.id,
      joinCode: parsed.data.joinCode,
    });
    if (!result.ok) {
      return c.json({ error: "No group matches that join code" }, 404);
    }
    return c.json({ group: result.group, alreadyMember: result.alreadyMember });
  });

  // POST /api/groups/:groupId/leave
  routes.post("/:groupId/leave", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const user = c.get("user");
    const result = await leaveGroupFn(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
    });
    return c.json({ ok: result.ok });
  });

  // DELETE /api/groups/:groupId — owner deletes the board outright.
  routes.delete("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const user = c.get("user");
    const result = await deleteGroupFn(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
    });
    if (!result.ok) {
      // A non-member gets the same answer as for a group that never existed —
      // whether a given id is a real board is not theirs to learn. A member who
      // is not the owner already knows it exists, so they get the real reason.
      return result.reason === "not_owner"
        ? c.json({ error: "Only the room's owner can delete it" }, 403)
        : c.json({ error: "Group not found" }, 404);
    }
    return c.json({ ok: true });
  });

  /**
   * Owner-only mutations answer alike: 403 when a member is simply not the
   * owner, 404 when the caller is not in the room at all, so an id is never
   * confirmed to exist for someone who cannot see it.
   */
  const ownerActionFailure = (
    reason: "not_found" | "not_owner" | "invalid",
    notOwnerMessage: string,
  ): { error: string; status: 400 | 403 | 404 } => {
    if (reason === "invalid") return { error: "Invalid request", status: 400 };
    if (reason === "not_owner") return { error: notOwnerMessage, status: 403 };
    return { error: "Group not found", status: 404 };
  };

  // PATCH /api/groups/:groupId — rename the room. Owner only.
  routes.patch("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = renameGroupSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid room name", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const user = c.get("user");
    const result = await renameGroupFn(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      name: parsed.data.name,
    });
    if (!result.ok) {
      const failure = ownerActionFailure(result.reason, "Only the room's owner can rename it");
      return c.json({ error: failure.error }, failure.status);
    }
    return c.json({ ok: true });
  });

  // DELETE /api/groups/:groupId/members/:memberUserId — owner removes someone.
  routes.delete("/:groupId/members/:memberUserId", async (c) => {
    const parsedParams = memberParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group or member id" }, 400);
    }
    const user = c.get("user");
    const result = await removeMemberFn(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      memberUserId: parsedParams.data.memberUserId,
    });
    if (!result.ok) {
      const failure = ownerActionFailure(
        result.reason,
        "Only the room's owner can remove someone",
      );
      return c.json({ error: failure.error }, failure.status);
    }
    return c.json({ ok: true });
  });

  // GET /api/groups/:groupId/top-of-mind — synthesized group board.
  routes.get("/:groupId/top-of-mind", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const parsedQuery = listNotesQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid query", details: parsedQuery.error.flatten().fieldErrors },
        400,
      );
    }
    const user = c.get("user");
    const result = await listGroupNotes(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      limit: parsedQuery.data.limit ?? DEFAULT_GROUP_TOP_OF_MIND_LIMIT,
      preferredLocale: user.preferredLocale,
    });
    if (!result) {
      return c.json({ error: "Group not found" }, 404);
    }
    return c.json(result);
  });

  // POST /api/groups/:groupId/top-of-mind/refresh — regenerate the board from
  // the current shared pool.
  routes.post("/:groupId/top-of-mind/refresh", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const user = c.get("user");
    const result = await refreshGroupNotes(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      limit: DEFAULT_GROUP_TOP_OF_MIND_LIMIT,
      preferredLocale: user.preferredLocale,
    });
    if (!result) {
      return c.json({ error: "Group not found" }, 404);
    }
    return c.json(result);
  });

  /**
   * GET /api/groups/:groupId/reading — what this combination is after.
   *
   * Reads only what is stored: a wall opening must never buy a model call.
   * `null` is a real answer meaning nothing has been read yet, and is
   * different from a 404, which means the room is not the caller's to see.
   */
  routes.get("/:groupId/reading", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const user = c.get("user");
    const result = await getCombinationReading(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      preferredLocale: user.preferredLocale,
    });
    if (!result) {
      return c.json({ error: "Group not found" }, 404);
    }
    return c.json({ reading: result.reading });
  });

  // POST /api/groups/:groupId/reading/refresh — read the combination again.
  // Costs a model call only when the shared material has actually moved.
  routes.post("/:groupId/reading/refresh", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const user = c.get("user");
    const reading = await refreshCombinationReading(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      preferredLocale: user.preferredLocale,
    });
    if (!reading) {
      return c.json({ error: "Group not found" }, 404);
    }
    return c.json({ reading });
  });

  /**
   * GET /api/groups/:groupId/timeline — what this room did, oldest first.
   *
   * With `?at=<ISO timestamp>` it also returns the board as it stood at that
   * instant, so a position on the rail is addressable and deep-linkable rather
   * than a piece of client state that vanishes on reload.
   */
  routes.get("/:groupId/timeline", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Invalid group id" }, 400);
    }
    const parsedQuery = timelineQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid query", details: parsedQuery.error.flatten().fieldErrors },
        400,
      );
    }
    const user = c.get("user");

    /**
     * A caller asking for one past board already has the room's life.
     *
     * Resolving a scrub used to re-read every note and every membership event
     * to rebuild an event list the client was about to discard — the rail moved
     * instantly and the wall arrived a beat later. `at` is the signal that this
     * is a travel request rather than a first load, so the timeline is only
     * built when it is actually being asked for.
     *
     * `boardAsOf` gates on membership itself, so dropping the timeline read
     * drops no authorization with it: a non-member still gets the same 404 a
     * missing room would give them.
     */
    const wantsTimeline = parsedQuery.data.at === undefined;

    const board = await loadBoardAsOf(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
      at: parsedQuery.data.at,
    });
    if (!board) {
      return c.json({ error: "Group not found" }, 404);
    }

    if (!wantsTimeline) return c.json({ timeline: null, board });

    const timeline = await loadTimeline(getDatabase(), {
      userId: user.id,
      groupId: parsedParams.data.groupId,
    });
    if (!timeline) {
      return c.json({ error: "Group not found" }, 404);
    }
    return c.json({ timeline, board });
  });

  return routes;
}

export const groupsRoutes = createGroupsRoutes();
