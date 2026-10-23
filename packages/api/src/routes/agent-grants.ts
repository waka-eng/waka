/** Historical read-grant records. Agent sessions are now isolated to their
 * own profile. Account owners can list/revoke old records, but creating a
 * cross-profile grant is retired and no record grants memory access. */

import { asc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { agentReadGrants, profiles } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";

type WakaDb = ReturnType<typeof getDb>;

const grantParamsSchema = z.object({
  grantId: z.string().uuid("grantId must be a uuid"),
});

export interface AgentGrantView {
  id: string;
  granteeProfileId: string;
  targetProfileId: string;
  grantedByProfileId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface AgentGrantRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

async function accountAgentIds(db: WakaDb, accountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: profiles.id, type: profiles.type })
    .from(profiles)
    .where(eq(profiles.accountId, accountId));
  return new Set(rows.filter((row) => row.type === "agent").map((row) => row.id));
}

const toView = (row: typeof agentReadGrants.$inferSelect): AgentGrantView => ({
  id: row.id,
  granteeProfileId: row.granteeProfileId,
  targetProfileId: row.targetProfileId,
  grantedByProfileId: row.grantedByProfileId,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
});

export function createAgentGrantRoutes(deps: AgentGrantRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);

  /** Every grant in the account — live and revoked, the whole record. */
  routes.get("/", async (c) => {
    const db = getDatabase();
    const agents = await accountAgentIds(db, c.get("session").profile.accountId);
    if (agents.size === 0) return c.json({ grants: [] }, 200);
    const rows = await db
      .select()
      .from(agentReadGrants)
      .orderBy(asc(agentReadGrants.createdAt), asc(agentReadGrants.id));
    return c.json(
      { grants: rows.filter((row) => agents.has(row.granteeProfileId)).map(toView) },
      200,
    );
  });

  // Historical grants can be listed or revoked; new grants cannot bypass profile isolation.
  routes.post("/", c => c.json({ error: "Agent connections access only their own profile; cross-profile grants are retired" }, 410));

  routes.delete("/:grantId", async (c) => {
    const params = grantParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Grant not found" }, 404);

    const db = getDatabase();
    const agents = await accountAgentIds(db, c.get("session").profile.accountId);
    const [row] = await db
      .select()
      .from(agentReadGrants)
      .where(eq(agentReadGrants.id, params.data.grantId))
      .limit(1);
    if (!row || !agents.has(row.granteeProfileId)) {
      return c.json({ error: "Grant not found" }, 404);
    }
    if (row.revokedAt) return c.json({ grant: toView(row) }, 200);

    const [revoked] = await db
      .update(agentReadGrants)
      .set({ revokedAt: new Date() })
      .where(eq(agentReadGrants.id, row.id))
      .returning();
    return c.json({ grant: toView(revoked!) }, 200);
  });

  return routes;
}
