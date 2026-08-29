/**
 * HTTP handlers for the keeper's standing keys — issue, list, revoke.
 *
 * The mirror of `routes/agent-keys.ts` with the binding reversed: these keys
 * act as the account's HUMAN profile, scoped down to keep-and-recall (see
 * `lib/keeper-key-auth.ts`). Every route here is `humanSessionsOnly`, and
 * that guard also refuses keyScoped sessions — so a keeper key cannot mint,
 * list, or revoke keys. Issuing and revoking the person's own credentials is
 * the person at a browser, nothing less.
 *
 * No profileId in the issue body, deliberately: a keeper key is always for
 * the session's own human profile. There is nothing to choose, so nothing
 * is asked.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import { keeperKeys } from "../db/index.js";
import { getDb } from "../lib/db.js";
import {
  KEEPER_KEY_DISPLAY_CHARS,
  mintKeeperKey,
} from "../lib/keeper-key-auth.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";

/** Same ceiling an agent gets; a person with five live keys has five machines. */
export const MAX_KEEPER_KEYS = 5;

const issueSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export interface KeeperKeyView {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface KeeperKeyRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createKeeperKeyRoutes(deps: KeeperKeyRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);

  // POST /api/keeper-keys — issue one. The only response the secret rides in.
  routes.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = issueSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json(
        { error: "Invalid key request", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const db = getDatabase();
    const session = c.get("session");

    const live = await db
      .select({ id: keeperKeys.id })
      .from(keeperKeys)
      .where(and(eq(keeperKeys.profileId, session.profile.id), isNull(keeperKeys.revokedAt)));
    if (live.length >= MAX_KEEPER_KEYS) {
      return c.json({ error: `You may hold ${MAX_KEEPER_KEYS} keys` }, 409);
    }

    const minted = await mintKeeperKey();
    const [row] = await db
      .insert(keeperKeys)
      .values({
        profileId: session.profile.id,
        tokenHash: minted.tokenHash,
        prefix: minted.prefix,
        label: parsed.data.label ?? null,
      })
      .returning({ id: keeperKeys.id, createdAt: keeperKeys.createdAt });

    return c.json(
      {
        key: {
          id: row!.id,
          profileId: session.profile.id,
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

  // GET /api/keeper-keys — the person's keys, newest first.
  routes.get("/", async (c) => {
    const db = getDatabase();
    const session = c.get("session");
    const rows = await db
      .select({
        id: keeperKeys.id,
        profileId: keeperKeys.profileId,
        prefix: keeperKeys.prefix,
        label: keeperKeys.label,
        createdAt: keeperKeys.createdAt,
        lastUsedAt: keeperKeys.lastUsedAt,
        revokedAt: keeperKeys.revokedAt,
      })
      .from(keeperKeys)
      .where(eq(keeperKeys.profileId, session.profile.id))
      .orderBy(desc(keeperKeys.createdAt));

    const keys: KeeperKeyView[] = rows.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      prefix: row.prefix.slice(0, KEEPER_KEY_DISPLAY_CHARS),
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
    return c.json({ keys });
  });

  // DELETE /api/keeper-keys/:keyId — revoke. A timestamp, never a delete.
  routes.delete("/:keyId", async (c) => {
    const keyId = c.req.param("keyId");
    if (!z.string().uuid().safeParse(keyId).success) {
      return c.json({ error: "Invalid key id" }, 400);
    }
    const db = getDatabase();
    const session = c.get("session");

    const [row] = await db
      .update(keeperKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(keeperKeys.id, keyId),
          eq(keeperKeys.profileId, session.profile.id),
          isNull(keeperKeys.revokedAt),
        ),
      )
      .returning({ id: keeperKeys.id });
    if (!row) return c.json({ error: "Key not found" }, 404);
    return c.json({ ok: true });
  });

  return routes;
}

export const keeperKeyRoutes = createKeeperKeyRoutes();
