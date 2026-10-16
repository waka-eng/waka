/**
 * The deleted shelf — GET /deleted, POST /deleted/:id/restore,
 * DELETE /deleted/:id.
 *
 * What a person deleted stays here for thirty days (`DELETED_KEEP_DAYS`).
 * The copy is written by DELETE /:id in the same transaction as the delete;
 * see db/schema-deleted.ts for why it is a shelf beside the archive rather
 * than a flag inside it.
 *
 * Browser sessions only. The shelf is the person looking at what they threw
 * away, and an agent or a keeper key on disk has no business reading it or
 * bringing things back.
 */
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";

import { DELETED_KEEP_DAYS, deletedInspirations, inspirations, reflections } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, type AuthEnv } from "../lib/middleware.js";
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import { wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { uuidSchema } from "./inspirations-validation.js";

const DAY_MS = 86_400_000;

export function registerDeletedRoutes(routes: Hono<AuthEnv>, getDatabase: typeof getDb, now: () => Date = () => new Date()): void {
  routes.get("/deleted", humanSessionsOnly, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const db = getDatabase();
    const profileId = c.get("session").profile.id;
    const at = now();
    /* Lapse on read: past thirty days the copy goes for good. */
    await db.delete(deletedInspirations).where(and(eq(deletedInspirations.profileId, profileId),
      lt(deletedInspirations.deletedAt, new Date(at.getTime() - DELETED_KEEP_DAYS * DAY_MS))));
    const rows = await db.select({ id: deletedInspirations.id, text: deletedInspirations.text, kind: deletedInspirations.kind,
      hadPhoto: deletedInspirations.hadPhoto, keptAt: deletedInspirations.keptAt, deletedAt: deletedInspirations.deletedAt })
      .from(deletedInspirations).where(eq(deletedInspirations.profileId, profileId))
      .orderBy(desc(deletedInspirations.deletedAt), asc(deletedInspirations.id)).limit(200);
    return c.json({
      deleted: rows.map((row) => ({
        id: row.id,
        text: row.text,
        kind: row.kind,
        hadPhoto: row.hadPhoto,
        keptAt: row.keptAt.toISOString(),
        deletedAt: row.deletedAt.toISOString(),
        goneAt: new Date(row.deletedAt.getTime() + DELETED_KEEP_DAYS * DAY_MS).toISOString(),
      })),
    });
  });

  /* BACK. An ordinary save under the same id and the original date, then
     the reading runs again. Pressing it twice finds it already back. */
  routes.post("/deleted/:id/restore", humanSessionsOnly, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const id = uuidSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid inspiration id" }, 400);
    const db = getDatabase();
    const profileId = c.get("session").profile.id;
    const restored = await db.transaction(async (tx) => {
      /* Past its month a copy is gone, whether or not the list was read. */
      const [copy] = await tx.select().from(deletedInspirations)
        .where(and(eq(deletedInspirations.id, id.data), eq(deletedInspirations.profileId, profileId),
          gte(deletedInspirations.deletedAt, new Date(now().getTime() - DELETED_KEEP_DAYS * DAY_MS)))).for("update");
      if (!copy) {
        const [already] = await tx.select({ id: inspirations.id }).from(inspirations)
          .where(and(eq(inspirations.id, id.data), eq(inspirations.profileId, profileId)));
        return already ? "already" as const : null;
      }
      const at = now();
      await tx.insert(inspirations).values({ id: copy.id, profileId, text: copy.text, kind: copy.kind, category: copy.category,
        source: copy.source, visibility: copy.visibility, createdAt: copy.keptAt, updatedAt: at });
      if (copy.reflections.length) {
        await tx.insert(reflections).values(copy.reflections.map((reflection, index) => ({ profileId, inspirationId: copy.id,
          question: reflection.question, answer: reflection.answer, skipped: reflection.skipped,
          createdAt: new Date(at.getTime() + index) })));
      }
      await tx.delete(deletedInspirations).where(eq(deletedInspirations.id, copy.id));
      await requestSignalDerivation({ profileId, inspirationId: copy.id, reason: "created", changedSource: "inspiration" }, tx);
      return "restored" as const;
    });
    if (!restored) return c.json({ error: "Nothing to bring back" }, 404);
    if (restored === "restored") await wakeCommittedBackgroundJobs();
    return c.json({ id: id.data }, 200);
  });

  /* GONE FOR GOOD, before the thirty days are up. */
  routes.delete("/deleted/:id", humanSessionsOnly, async (c) => {
    const id = uuidSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid inspiration id" }, 400);
    const removed = await getDatabase().delete(deletedInspirations)
      .where(and(eq(deletedInspirations.id, id.data), eq(deletedInspirations.profileId, c.get("session").profile.id)))
      .returning({ id: deletedInspirations.id });
    return removed.length ? c.json({ id: id.data }, 200) : c.json({ error: "Not on the deleted shelf" }, 404);
  });
}
