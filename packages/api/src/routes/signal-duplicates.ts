/**
 * The gardener's proposals, and the owner's answer.
 *
 *   GET  /api/signal-duplicates            — unresolved proposals, each pair
 *                                            with both statements, oldest
 *                                            first (the longest-waiting ask
 *                                            deserves the top of the list)
 *   POST /api/signal-duplicates/:id/resolve — {"act": "merge" | "keep_apart"}
 *
 * Own-profile only, human sessions only: a merge rewrites what the person's
 * memory says about them, which is exactly the class of act the access
 * matrix reserves for the person (an agent may read a sibling; it may not
 * reshape one). The route is the thin door — everything that moves lives in
 * `lib/signal-gardener.ts` and is tested there.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { signalDuplicates, signals } from "../db/index.js";
import { getDb } from "./../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { resolveSignalDuplicate } from "../lib/signal-gardener.js";
import { validationDetails } from "../lib/validation.js";
import { alias } from "drizzle-orm/pg-core";

const resolveSchema = z.object({
  act: z.enum(["merge", "keep_apart"]),
});

interface SignalDuplicatesRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
}

export function createSignalDuplicatesRoutes(
  deps: SignalDuplicatesRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const session = c.get("session");
    if (session.profile.type !== "human") {
      return c.json({ error: "Only the person resolves their own duplicates" }, 403);
    }
    const db = getDatabase();
    const aSignal = alias(signals, "a_signal");
    const bSignal = alias(signals, "b_signal");
    const rows = await db
      .select({
        id: signalDuplicates.id,
        similarity: signalDuplicates.similarity,
        createdAt: signalDuplicates.createdAt,
        aSignalId: signalDuplicates.aSignalId,
        bSignalId: signalDuplicates.bSignalId,
        aStatement: aSignal.statement,
        bStatement: bSignal.statement,
      })
      .from(signalDuplicates)
      .innerJoin(aSignal, eq(aSignal.id, signalDuplicates.aSignalId))
      .innerJoin(bSignal, eq(bSignal.id, signalDuplicates.bSignalId))
      .where(
        and(
          eq(signalDuplicates.profileId, session.profile.id),
          isNull(signalDuplicates.resolvedAt),
        ),
      )
      .orderBy(asc(signalDuplicates.createdAt));
    return c.json({
      duplicates: rows.map((row) => ({
        id: row.id,
        similarity: row.similarity,
        createdAt: row.createdAt.toISOString(),
        a: { signalId: row.aSignalId, statement: row.aStatement },
        b: { signalId: row.bSignalId, statement: row.bStatement },
      })),
    });
  });

  routes.post("/:id/resolve", async (c) => {
    const session = c.get("session");
    if (session.profile.type !== "human") {
      return c.json({ error: "Only the person resolves their own duplicates" }, 403);
    }
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = resolveSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid resolution", details: validationDetails(parsed.error) },
        400,
      );
    }
    const result = await resolveSignalDuplicate(getDatabase(), {
      profileId: session.profile.id,
      duplicateId: c.req.param("id"),
      act: parsed.data.act,
    });
    if (result.status === "not_found") {
      return c.json({ error: "Duplicate proposal not found" }, 404);
    }
    if (result.status === "already_resolved") {
      return c.json({ error: "This pair was already answered" }, 409);
    }
    return c.json({ resolution: result }, 200);
  });

  return routes;
}
