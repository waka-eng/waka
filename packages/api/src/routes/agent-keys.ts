/**
 * `/api/agent-keys` — issuing and revoking an agent's standing credential.
 *
 * Meeting decision, 2026-08-17: per-agent names and API keys. The HTTP
 * surface is deliberately small — issue, list, revoke — and HUMAN-ONLY at
 * the door: a key that could mint keys is a credential that survives its own
 * revocation, so `humanSessionsOnly` stands in front of every handler, the
 * same posture as account erasure and for the same reason.
 *
 * The secret appears in exactly one response — the 201 that creates it —
 * and never again: the row keeps only the hash and a display prefix. A list
 * is therefore safe to show anywhere the account owner is.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { agentKeys, profiles } from "../db/index.js";
import { AGENT_KEY_DISPLAY_CHARS, mintAgentKey } from "../lib/agent-key-auth.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";

type WakaDb = ReturnType<typeof getDb>;

const createKeySchema = z
  .object({
    profileId: z.string().uuid("profileId must be a uuid"),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const keyParamsSchema = z.object({ keyId: z.string().uuid("keyId must be a uuid") });

/** How many live keys one agent profile may hold. Rotation needs two. */
export const MAX_KEYS_PER_AGENT = 5;

export interface AgentKeyView {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentKeyRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createAgentKeyRoutes(deps: AgentKeyRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);

  /** The agent profile, if the acting account holds it. */
  async function ownedAgent(db: Pick<WakaDb, "select">, accountId: string, profileId: string) {
    const [row] = await db
      .select({ id: profiles.id, name: profiles.name })
      .from(profiles)
      .where(
        and(
          eq(profiles.id, profileId),
          eq(profiles.accountId, accountId),
          eq(profiles.type, "agent"),
        ),
      )
      .limit(1).for("update");
    return row ?? null;
  }

  // POST /api/agent-keys — issue one. The only response the secret rides in.
  routes.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid key request", details: validationDetails(parsed.error) },
        400,
      );
    }

    const db = getDatabase();
    const session = c.get("session");
    return db.transaction(async (tx) => {
      const agent = await ownedAgent(tx, session.profile.accountId, parsed.data.profileId);
      if (!agent) return c.json({ error: "Agent profile not found" }, 404);

      const live = await tx
        .select({ id: agentKeys.id })
        .from(agentKeys)
        .where(and(eq(agentKeys.profileId, agent.id), isNull(agentKeys.revokedAt)));
      if (live.length >= MAX_KEYS_PER_AGENT) {
        return c.json({ error: `An agent may hold ${MAX_KEYS_PER_AGENT} keys` }, 409);
      }

      const minted = await mintAgentKey();
      const [row] = await tx
        .insert(agentKeys)
        .values({
          profileId: agent.id,
          tokenHash: minted.tokenHash,
          prefix: minted.prefix,
          label: parsed.data.label ?? null,
        })
        .returning({ id: agentKeys.id, createdAt: agentKeys.createdAt });

      return c.json(
        {
          key: {
            id: row!.id,
            profileId: agent.id,
            /** shown this once; the row keeps only the hash */
            secret: minted.secret,
            prefix: minted.prefix,
            label: parsed.data.label ?? null,
            createdAt: row!.createdAt.toISOString(),
          },
        },
        201,
      );
    });
  });

  // GET /api/agent-keys — every key on the account's agents, newest first.
  routes.get("/", async (c) => {
    const db = getDatabase();
    const session = c.get("session");
    const rows = await db
      .select({
        id: agentKeys.id,
        profileId: agentKeys.profileId,
        prefix: agentKeys.prefix,
        label: agentKeys.label,
        createdAt: agentKeys.createdAt,
        lastUsedAt: agentKeys.lastUsedAt,
        revokedAt: agentKeys.revokedAt,
      })
      .from(agentKeys)
      .innerJoin(profiles, eq(profiles.id, agentKeys.profileId))
      .where(
        and(eq(profiles.accountId, session.profile.accountId), eq(profiles.type, "agent")),
      )
      .orderBy(desc(agentKeys.createdAt));

    const keys: AgentKeyView[] = rows.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      prefix: row.prefix.slice(0, AGENT_KEY_DISPLAY_CHARS),
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
    return c.json({ keys });
  });

  // DELETE /api/agent-keys/:keyId — revoke. A timestamp, never a delete.
  routes.delete("/:keyId", async (c) => {
    const parsed = keyParamsSchema.safeParse(c.req.param());
    if (!parsed.success) return c.json({ error: "Invalid key id" }, 400);

    const db = getDatabase();
    const session = c.get("session");
    const revoked = await db
      .update(agentKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentKeys.id, parsed.data.keyId),
          /* only a key on one of THIS account's profiles — the same wall the
             list read builds with a join, spelled as a subquery because
             UPDATE has no join to lean on */
          inArray(
            agentKeys.profileId,
            db
              .select({ id: profiles.id })
              .from(profiles)
              .where(eq(profiles.accountId, session.profile.accountId)),
          ),
        ),
      )
      .returning({ id: agentKeys.id });
    if (revoked.length === 0) return c.json({ error: "Key not found" }, 404);
    return c.json({ revoked: true, keyId: parsed.data.keyId });
  });

  return routes;
}

export const agentKeyRoutes = createAgentKeyRoutes();
