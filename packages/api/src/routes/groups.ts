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
  joinGroupByCode,
  leaveGroup,
  listGroupTopOfMind,
  listGroupsForUser,
  refreshGroupTopOfMind,
} from "../lib/group-top-of-mind.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";

const DEFAULT_GROUP_TOP_OF_MIND_LIMIT = 5;
const MAX_GROUP_TOP_OF_MIND_LIMIT = 20;

const createGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const joinGroupSchema = z
  .object({ joinCode: z.string().trim().min(4, "Join code is required").max(64) })
  .strict();

const groupParamsSchema = z.object({ groupId: z.string().uuid() }).strict();

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
  listGroupNotes?: typeof listGroupTopOfMind;
  refreshGroupNotes?: typeof refreshGroupTopOfMind;
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
  const listGroupNotes = deps.listGroupNotes ?? listGroupTopOfMind;
  const refreshGroupNotes = deps.refreshGroupNotes ?? refreshGroupTopOfMind;

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

  return routes;
}

export const groupsRoutes = createGroupsRoutes();
