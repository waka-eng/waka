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
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";

import { attachments, deletedInspirations, harvestCandidates, inspirationRevisions, inspirations, reflections } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { deletedShelfCutoff, deletedShelfGoneAt, sweepDeletedShelf } from "../lib/deleted-shelf.js";
import { humanSessionsOnly, type AuthEnv } from "../lib/middleware.js";
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import { enqueueEnrichAttachment, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";
import { sweepAttachmentObjects } from "../lib/attachment-sweep.js";
import { unreferencedAttachmentKeys } from "../lib/conversation-attachments.js";
import { profileQuerySchema, uuidSchema } from "./inspirations-validation.js";

// Old copies predate attachment retention; their restore still reports the loss.
const ATTACHMENT_KINDS = new Set(["image", "audio", "link", "mixed"]);

export function registerDeletedRoutes(routes: Hono<AuthEnv>, getDatabase: typeof getDb, now: () => Date = () => new Date()): void {
  routes.get("/deleted", humanSessionsOnly, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const db = getDatabase();
    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid profile" }, 400);
    const target = await resolveTargetProfile(db, c.get("session"), query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);
    const profileId = target.profileId;
    await sweepDeletedShelf(db, now(), profileId);
    const rows = await db.select({ id: deletedInspirations.id, text: deletedInspirations.text, kind: deletedInspirations.kind,
      hadPhoto: deletedInspirations.hadPhoto, attachmentCount: sql<number>`jsonb_array_length(${deletedInspirations.attachments})`,
      attachmentName: sql<string | null>`${deletedInspirations.attachments}->0->>'name'`, keptAt: deletedInspirations.keptAt, deletedAt: deletedInspirations.deletedAt })
      .from(deletedInspirations).where(eq(deletedInspirations.profileId, profileId))
      .orderBy(desc(deletedInspirations.deletedAt), asc(deletedInspirations.id)).limit(200);
    return c.json({
      deleted: rows.map((row) => ({
        id: row.id,
        text: row.text,
        kind: row.kind,
        hadPhoto: row.hadPhoto,
        attachmentCount: row.attachmentCount,
        attachmentName: row.attachmentName,
        keptAt: row.keptAt.toISOString(),
        deletedAt: row.deletedAt.toISOString(),
        goneAt: deletedShelfGoneAt(row.deletedAt).toISOString(),
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
    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid profile" }, 400);
    const target = await resolveTargetProfile(db, c.get("session"), query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);
    const profileId = target.profileId;
    const at = now();
    const restored = await db.transaction(async (tx) => {
      /* Past its month a copy is gone, whether or not the list was read. */
      const [copy] = await tx.select().from(deletedInspirations)
        .where(and(eq(deletedInspirations.id, id.data), eq(deletedInspirations.profileId, profileId),
          gte(deletedInspirations.deletedAt, deletedShelfCutoff(at)))).for("update");
      if (!copy) {
        const [already] = await tx.select({ id: inspirations.id }).from(inspirations)
          .where(and(eq(inspirations.id, id.data), eq(inspirations.profileId, profileId)));
        return already ? { state: "already" as const, notRestored: [] } : null;
      }
      const missingAttachments = copy.hadPhoto && copy.attachments.length === 0;
      const kind = missingAttachments && copy.kind && ATTACHMENT_KINDS.has(copy.kind) ? "note" as const : copy.kind;
      await tx.insert(inspirations).values({ id: copy.id, profileId, text: copy.text, kind, category: copy.category,
        source: copy.source, visibility: copy.visibility, createdAt: copy.keptAt, updatedAt: at });
      if (copy.attachments.length) await tx.insert(attachments).values(copy.attachments.map(item => ({
        ...item, profileId, inspirationId: copy.id, conversationId: null, messageId: null, stagedMessageId: null,
        createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt),
        enrichmentUpdatedAt: item.enrichmentUpdatedAt ? new Date(item.enrichmentUpdatedAt) : null,
        transcriptCorrectedAt: item.transcriptCorrectedAt ? new Date(item.transcriptCorrectedAt) : null,
        enrichmentRetryWindowAt: item.enrichmentRetryWindowAt ? new Date(item.enrichmentRetryWindowAt) : null,
      })));
      for (const item of copy.attachments) {
        if (item.enrichmentStatus === 'pending' || item.enrichmentStatus === null && item.type !== 'file') {
          await enqueueEnrichAttachment(profileId, item.id, copy.id, tx);
        }
      }
      /* THE REVISION FENCE DOES NOT RESTART. The insert trigger starts a
         fresh revision row at 1, and anything still holding (id, revision)
         from before the delete — a queued job, a snapshot — would match it
         again. Lifting both revisions to the restore's epoch-milliseconds
         puts the restored row past every revision the old one ever had. */
      await tx.update(inspirationRevisions).set({
        personalRevision: sql`GREATEST(${inspirationRevisions.personalRevision}, ${at.getTime()}::bigint)`,
        publicRevision: sql`GREATEST(${inspirationRevisions.publicRevision}, ${at.getTime()}::bigint)`,
      }).where(and(eq(inspirationRevisions.profileId, profileId), eq(inspirationRevisions.inspirationId, copy.id)));
      if (copy.reflections.length) {
        await tx.insert(reflections).values(copy.reflections.map((reflection, index) => ({ profileId, inspirationId: copy.id,
          question: reflection.question, answer: reflection.answer, skipped: reflection.skipped,
          createdAt: new Date(at.getTime() + index) })));
      }
      /* A save that a harvest candidate became is that candidate's again:
         its link emptied when the save was deleted, and its hash was held
         while the copy waited here (`lapseHarvest`), so the same sentence
         is not proposed beside the save it already is. */
      await tx.update(harvestCandidates).set({ inspirationId: copy.id })
        .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "kept"), isNull(harvestCandidates.inspirationId),
          sql`${harvestCandidates.context}->>'keptAs' = ${copy.id}::text`));
      await tx.delete(deletedInspirations).where(eq(deletedInspirations.id, copy.id));
      await requestSignalDerivation({ profileId, inspirationId: copy.id, reason: "created" }, tx);
      return { state: "restored" as const, notRestored: missingAttachments ? ["attachments"] : [] };
    });
    if (!restored) return c.json({ error: "Nothing to bring back" }, 404);
    if (restored.state === "restored") await wakeCommittedBackgroundJobs();
    return c.json({ id: id.data, notRestored: restored.notRestored }, 200);
  });

  /* GONE FOR GOOD, before the thirty days are up. */
  routes.delete("/deleted/:id", humanSessionsOnly, async (c) => {
    const id = uuidSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid inspiration id" }, 400);
    const db = getDatabase();
    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid profile" }, 400);
    const target = await resolveTargetProfile(db, c.get("session"), query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);
    const profileId = target.profileId;
    const removed = await db.delete(deletedInspirations)
      .where(and(eq(deletedInspirations.id, id.data), eq(deletedInspirations.profileId, profileId)))
      .returning({ id: deletedInspirations.id, attachments: deletedInspirations.attachments });
    await sweepAttachmentObjects(await unreferencedAttachmentKeys(db, removed.flatMap(row => row.attachments.flatMap(item => item.s3Key ? [item.s3Key] : []))));
    return removed.length ? c.json({ id: id.data }, 200) : c.json({ error: "Not on the deleted shelf" }, 404);
  });
}
