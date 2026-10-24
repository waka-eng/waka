/**
 * PATCH and DELETE /api/inspirations/:id — changing a capture after the fact.
 *
 * The two routes share the reason they belong together: both resolve the
 * target profile as **"write"**, the one verb an agent session does not hold
 * over its human's profile. An agent may read that memory and add to it; it
 * may not rewrite or remove it. Both also disturb layer 2 — editing asks for
 * re-derivation, deleting cascades evidence away — so the awkward parts of
 * this file are all about leaving the signals consistent afterwards.
 *
 * Browser deletions retain attachments for recovery; permanent removals sweep
 * only objects no other live or deleted inspiration references.
 */

import {readConversationOrigin} from '../lib/conversation-capture.js';
import { sweepAttachmentObjects } from '../lib/attachment-sweep.js';
import { unreferencedAttachmentKeys } from '../lib/conversation-attachments.js';
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from 'zod';

import {
  attachments,
  inspirations,
  inspirationRevisions,
  reflections,
  signalEvidence,
  signals,
  backgroundJobs,
  deletedInspirations,
  type Inspiration,
  type DeletedAttachment,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { sweepDeletedShelf } from "../lib/deleted-shelf.js";
import { reconcilePrinciplesAfterSignalLoss } from "../lib/principle-generation.js";
import type { AuthEnv } from "../lib/middleware.js";
import { enqueueTopOfMindRefresh, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import {
  acquireSignalDerivationLock,
  reconcileSignalsAfterEvidenceLoss,
} from "../lib/signal-derivation.js";
import { validationDetails } from "../lib/validation.js";
import { attachmentSelection, serializeAttachment } from "./attachments.js";
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import {
  inspirationSelection,
  reflectionSelection,
  serializeInspirationDetail,
} from "./inspirations-serialization.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";
import {
  profileQuerySchema,
  updateInspirationSchema,
  uuidSchema,
} from "./inspirations-validation.js";

export function registerEditingRoutes(
  routes: Hono<AuthEnv>,
  getDatabase: typeof getDb,
  now: () => Date = () => new Date(),
): void {
  /**
   * PATCH /api/inspirations/:id
   *
   * Editing a capture changes what it means, so the signals it supports are
   * re-derived. Nothing here rewrites a signal: derivation decides what to add,
   * and a signal a human has edited keeps its own words regardless.
   */
  routes.patch("/:id", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = updateInspirationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid inspiration payload",
          details: validationDetails(parsed.error),
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(query.error) },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    const patch: {
      text?: string;
      kind?: Inspiration["kind"];
      visibility?: Inspiration["visibility"];
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (parsed.data.text !== undefined) patch.text = parsed.data.text;
    if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
    if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;

    // One statement carrying the tenant predicate: a capture belonging to
    // another profile matches nothing and comes back as absent, never as
    // forbidden, so this cannot be used to enumerate ids.
    const updated = await db.transaction(async (tx) => {
      const [previous] = await tx.select({ visibility: inspirations.visibility }).from(inspirations)
        .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.profileId, target.profileId))).for("update");
      if (!previous) return undefined;
      /* No words is a save only while something else is saved with it — the
         create rule (`text` defaults to "" beside attachments). Checked under
         the row lock this transaction already holds. */
      if (patch.text === "") {
        const [kept] = await tx.select({ id: attachments.id }).from(attachments)
          .where(and(eq(attachments.inspirationId, idCheck.data), eq(attachments.profileId, target.profileId))).limit(1);
        if (!kept) return "empty" as const;
      }
      const [row] = await tx
      .update(inspirations)
      .set(patch)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .returning(inspirationSelection);
      if (!row) return undefined;
      const processing = await requestSignalDerivation({ profileId: target.profileId, inspirationId: row.id,
        reason: "edited" }, tx);
      return { ...row, processing: processing.receipt };
    });

    if (!updated) return c.json({ error: "Inspiration not found" }, 404);
    if (updated === "empty") {
      return c.json({ error: "Invalid inspiration payload", details: { text: ["Inspiration text is required"] } }, 400);
    }

    await wakeCommittedBackgroundJobs();

    const [attachmentRows, reflectionRows] = await Promise.all([
      db
        .select(attachmentSelection)
        .from(attachments)
        .where(
          and(
            eq(attachments.inspirationId, updated.id),
            eq(attachments.profileId, target.profileId),
          ),
        )
        .orderBy(asc(attachments.createdAt), asc(attachments.id)),
      db
        .select(reflectionSelection)
        .from(reflections)
        .where(
          and(
            eq(reflections.inspirationId, updated.id),
            eq(reflections.profileId, target.profileId),
          ),
        )
        .orderBy(asc(reflections.createdAt), asc(reflections.id)),
    ]);

    return c.json(
      {
        inspiration: {...serializeInspirationDetail(updated, {
          attachments: attachmentRows.map(serializeAttachment),
          reflections: reflectionRows,
        }),conversationOrigin:await readConversationOrigin(db,target.profileId,updated.id)},
        processing: updated.processing,
      },
      200,
    );
  });

  /**
   * DELETE /api/inspirations/:id
   *
   * The row goes and Postgres takes its attachments, reflections, embeddings,
   * and evidence links with it. A signal that loses all its evidence is retired
   * by derivation unless a human has locked it — that rule lives with the
   * signals, not here.
   */
  routes.delete("/:id", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(query.error) },
        400,
      );
    }

    const raw = await c.req.text();
    let body: unknown = {};
    try { if (raw) body = JSON.parse(raw); } catch { return c.json({ error: 'Invalid deletion request' }, 400); }
    const input = z.object({ sourceRevision: z.string().regex(/^[1-9]\d{0,18}$/).optional() }).strict().safeParse(body);
    if (!input.success) return c.json({ error: 'Invalid deletion request' }, 400);

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    await sweepDeletedShelf(db, now(), target.profileId);
    let removedKeys: string[] = [];

    // Lock the source before collecting every destination's witnesses.
    // No derivation can add a new source FK after this collection. Lock the
    // affected signal rows too, preserving edits made before this transaction.
    const deleted = await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, target.profileId);
      const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
        .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.profileId, target.profileId))).for("update");
      if (!parent) return [];

      if (input.data.sourceRevision) {
        const [revision] = await tx.select({ value: inspirationRevisions.personalRevision }).from(inspirationRevisions)
          .where(and(eq(inspirationRevisions.profileId, target.profileId), eq(inspirationRevisions.inspirationId, idCheck.data)));
        if (revision?.value.toString() !== input.data.sourceRevision) return null;
      }

      const citingRows = await tx
        .selectDistinct({ signalId: signalEvidence.signalId, profileId: signalEvidence.profileId })
        .from(signalEvidence)
        .where(
          and(
            eq(signalEvidence.inspirationId, idCheck.data),
            eq(signalEvidence.ownerProfileId, target.profileId),
          ),
        );
      if (citingRows.length) await tx.select({ id: signals.id }).from(signals)
        .where(inArray(signals.id, citingRows.map((row) => row.signalId))).orderBy(asc(signals.id)).for("no key update");

      const attachmentRows = await tx.select().from(attachments)
        .where(and(eq(attachments.profileId, target.profileId), eq(attachments.inspirationId, idCheck.data))).for("update");
      const recoverable = session.profile.type === "human" && !session.keyScoped;
      const at = now();
      if (recoverable) {
        const [whole] = await tx.select().from(inspirations)
          .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.profileId, target.profileId)));
        const said = await tx.select({ question: reflections.question, answer: reflections.answer, skipped: reflections.skipped })
          .from(reflections).where(and(eq(reflections.inspirationId, idCheck.data), eq(reflections.profileId, target.profileId)))
          .orderBy(asc(reflections.createdAt), asc(reflections.id));
        await tx.insert(deletedInspirations).values({ id: idCheck.data, profileId: target.profileId, text: whole!.text, kind: whole!.kind,
          category: whole!.category, source: whole!.source, visibility: whole!.visibility, reflections: said,
          attachments: JSON.parse(JSON.stringify(attachmentRows)) as DeletedAttachment[],
          hadPhoto: attachmentRows.length > 0, keptAt: whole!.createdAt, deletedAt: at });
      } else {
        removedKeys = attachmentRows.flatMap(row => row.s3Key ? [row.s3Key] : []);
      }

      const removed = await tx
        .delete(inspirations)
        .where(
          and(
            eq(inspirations.id, idCheck.data),
            eq(inspirations.profileId, target.profileId),
          ),
        )
        .returning({ id: inspirations.id });

      if (removed.length === 0) return removed;

      await tx.delete(backgroundJobs).where(and(eq(backgroundJobs.profileId, target.profileId),
        inArray(backgroundJobs.type, ["derive_signals", "review_signal_support", "assess_signal_support", "enrich_attachment", "generate_reflection_question"]),
        sql`${backgroundJobs.payload}->>'inspirationId' = ${idCheck.data}`));
      for (const profileId of [...new Set([target.profileId, ...citingRows.map((row) => row.profileId)])].sort()) {
        const signalIds = citingRows.filter((row) => row.profileId === profileId).map((row) => row.signalId);
        await reconcileSignalsAfterEvidenceLoss(tx, { profileId, signalIds });
        await reconcilePrinciplesAfterSignalLoss(tx, { profileId, signalIds });
        // A room mind's signals citing this memory still lose that evidence
        // above (deletion integrity, and the data is kept), but no room
        // refresh is asked for: the room engine is retired.
        if (profileId === target.profileId) await enqueueTopOfMindRefresh(profileId, "signals_changed", tx);
      }
      return removed;
    });

    if (deleted === null) {
      return c.json({ error: 'This inspiration changed. Read it again before removing it.', code: 'inspiration_changed' }, 409);
    }
    if (deleted.length === 0) {
      return c.json({ error: "Inspiration not found" }, 404);
    }

    await wakeCommittedBackgroundJobs();
    await sweepAttachmentObjects(await unreferencedAttachmentKeys(db, removedKeys));

    return c.json({ id: deleted[0]!.id }, 200);
  });
}
