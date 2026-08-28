/**
 * `/api/agent-grants` — the hand on the sibling door.
 *
 * goal: no-quiet-corners, Phase 6 (register item 5). The explicit,
 * human-granted, revocable pairing that lets one agent session read a
 * sibling agent's memory. Human-session-only on every verb: granting is
 * the account holder's decision, and so is closing the door again.
 *
 * Grants list beside credentials and behave like them: read live on every
 * request (`lib/sibling-grants.ts`), so revocation takes effect on the
 * very next request. Revocation is a timestamp, not a delete — who could
 * read whom, and when that ended, is a record this goal keeps.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { agentReadGrants, profiles } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";

type WakaDb = ReturnType<typeof getDb>;

const createGrantSchema = z
  .object({
    granteeProfileId: z.string().uuid("granteeProfileId must be a uuid"),
    targetProfileId: z.string().uuid("targetProfileId must be a uuid"),
  })
  .strict();

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

  routes.post("/", async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    const parsed = createGrantSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid grant", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const { granteeProfileId, targetProfileId } = parsed.data;
    if (granteeProfileId === targetProfileId) {
      return c.json({ error: "An agent needs no grant to read itself" }, 400);
    }

    const db = getDatabase();
    const session = c.get("session");
    const agents = await accountAgentIds(db, session.profile.accountId);
    // Both sides must be the account's own agents. The human profile is
    // never a grant target (the matrix already serves that case) and a
    // foreign profile answers exactly like one that does not exist.
    if (!agents.has(granteeProfileId) || !agents.has(targetProfileId)) {
      return c.json({ error: "Profile not found" }, 404);
    }

    const [existing] = await db
      .select()
      .from(agentReadGrants)
      .where(
        and(
          eq(agentReadGrants.granteeProfileId, granteeProfileId),
          eq(agentReadGrants.targetProfileId, targetProfileId),
          isNull(agentReadGrants.revokedAt),
        ),
      )
      .limit(1);
    if (existing) return c.json({ grant: toView(existing) }, 200);

    const [created] = await db
      .insert(agentReadGrants)
      .values({
        granteeProfileId,
        targetProfileId,
        grantedByProfileId: session.profile.id,
      })
      .returning();
    return c.json({ grant: toView(created!) }, 201);
  });

  /** Close the door: revoked, effective on the next request, kept as record. */
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
