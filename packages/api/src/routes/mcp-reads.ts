/**
 * GET /api/mcp-reads — what each key read of the account's memory, newest
 * first (see `lib/mcp-reads.ts`). Human sessions only: the log is the
 * owner's, and a key never reads the record of its own reading.
 *
 *   ?profile=<uuid>  one owned profile's log (the agent page asks for its agent)
 */
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../lib/db.js";
import { loadRecentMcpReads, ownedProfileIds, standingKey } from "../lib/mcp-reads.js";
import type { MiddlewareHandler } from "hono";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";

const querySchema = z.object({ profile: z.string().uuid().optional() }).strict();

export function createMcpReadRoutes(deps: { getDatabase?: typeof getDb; authMiddleware?: MiddlewareHandler<AuthEnv> } = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);
  /* A keeper key acts as its human, so `humanSessionsOnly` admits it: the
     record of a key's reading is never the key's to read. */
  routes.use("*", async (c, next) => {
    if (c.get("session").keyScoped || standingKey(c.get("session"))) return c.json({ error: "Not available to a key" }, 403);
    await next();
  });
  routes.get("/", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid query" }, 400);
    const db = getDatabase();
    const owned = await ownedProfileIds(db, c.get("session").profile.accountId);
    if (parsed.data.profile && !owned.includes(parsed.data.profile)) return c.json({ error: "Profile not found" }, 404);
    return c.json({ reads: await loadRecentMcpReads(db, parsed.data.profile ? [parsed.data.profile] : owned) });
  });
  return routes;
}
