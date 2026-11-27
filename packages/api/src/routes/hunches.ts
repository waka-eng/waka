/**
 * /api/hunch — the creature's guess from the first saves, and the answer to it
 * (insight goal, phase 3, 2026-11-26). See `lib/hunches.ts`.
 *
 *   GET  /api/hunch?profile=…           the pending hunch, or null
 *   POST /api/hunch/:id/answer?profile=…  { answer: "yes" } | { answer: "not_quite", correction }
 *
 * Yes affirms the signals resting on the cited saves (the same verdict a
 * person files on a signal) and asks for the reading at once. Not quite keeps
 * what the person said instead and asks for a new hunch that honours it.
 */
import { and, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { hunches } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { readCurrentHunch, signalsBehind } from "../lib/hunches.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { enqueueHunchAfterCorrection, enqueueTopOfMindRefresh, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { createFeedbackForProfile } from "./feedback.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

const scopeQuerySchema = z.object({ profile: z.string().uuid("profile must be a uuid").optional() }).strict();
const answerSchema = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("yes") }).strict(),
  z.object({ answer: z.literal("not_quite"), correction: z.string().trim().min(1).max(600) }).strict(),
]);

export interface HunchRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  loadProfile?: typeof loadProfileTarget;
  affirm?: typeof createFeedbackForProfile;
}

export function createHunchRoutes(deps: HunchRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  const affirm = deps.affirm ?? createFeedbackForProfile;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const query = scopeQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid hunch query" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(db, c.get("session"), query.data.profile, "read", loadProfile);
    if (!scope.ok) return c.json(scope.body, scope.status);
    return c.json({ hunch: await readCurrentHunch(db, scope.profileId) });
  });

  routes.post("/:id/answer", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const id = z.string().uuid().safeParse(c.req.param("id"));
    const query = scopeQuerySchema.safeParse(c.req.query());
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
    const body = answerSchema.safeParse(raw);
    if (!id.success || !query.success || !body.success) return c.json({ error: "Invalid hunch answer" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(db, c.get("session"), query.data.profile, "write", loadProfile);
    if (!scope.ok) return c.json(scope.body, scope.status);
    const profileId = scope.profileId;
    const settled = await db.transaction(async (tx) => {
      const [row] = await tx.update(hunches)
        .set(body.data.answer === "yes" ? { status: "affirmed", updatedAt: sql`now()` }
          : { status: "declined", correction: body.data.correction, updatedAt: sql`now()` })
        .where(and(eq(hunches.id, id.data), eq(hunches.profileId, profileId), eq(hunches.status, "pending")))
        .returning({ id: hunches.id, inspirationIds: hunches.inspirationIds });
      if (!row) return null;
      if (body.data.answer === "yes") await enqueueTopOfMindRefresh(profileId, "manual", tx);
      else await enqueueHunchAfterCorrection(profileId, row.id, tx);
      return row;
    });
    if (!settled) return c.json({ error: "That hunch is no longer open" }, 409);
    /* Yes is the person agreeing with what the saves say: the signals resting
       on them get the same "true" a person files by hand, each in its own
       short transaction (a busy signal is skipped, not waited on). */
    if (body.data.answer === "yes") {
      for (const signalId of await signalsBehind(db, profileId, settled.inspirationIds)) {
        await affirm(db, { profileId, targetType: "signal", targetId: signalId, value: "true" }).catch(() => null);
      }
    }
    await wakeCommittedBackgroundJobs();
    return c.json({ status: body.data.answer === "yes" ? "affirmed" : "declined" }, 200);
  });

  return routes;
}

export const hunchRoutes = createHunchRoutes();
