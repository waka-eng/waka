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
 * The S3 sweep lives here rather than with the attachment routes because it
 * only ever runs on this path: Postgres cascades the attachment *rows* when an
 * inspiration goes, and the bytes those rows named are the one thing the
 * database cannot take with them.
 */

import {readConversationOrigin} from '../lib/conversation-capture.js';
import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";

import { makeAttachmentsS3Client } from "../lib/s3-client.js";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
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
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { deletedShelfCutoff } from "../lib/deleted-shelf.js";
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

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Postgres cascades attachments, reflections, embeddings, and evidence links
 * when an inspiration goes. The S3 objects behind image and file attachments
 * live outside the database and have to be swept here.
 */
let cachedDeleteS3: S3Client | null = null;
function getDeleteS3(): S3Client {
  if (cachedDeleteS3) return cachedDeleteS3;
  cachedDeleteS3 = makeAttachmentsS3Client();
  return cachedDeleteS3;
}

function getDeleteBucketName(): string | null {
  const fromEnv = process.env.ATTACHMENTS_BUCKET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_Attachments;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { name?: string };
      if (parsed?.name) return parsed.name;
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Best-effort by design. A member deleting their own capture must not be
 * blocked by a flaky bucket: a row pointing at bytes that are gone is worse
 * than bytes with no row, and the second is sweepable later.
 */
async function sweepAttachmentObjects(keys: string[], inspirationId: string): Promise<void> {
  if (keys.length === 0) return;
  const bucket = getDeleteBucketName();
  if (!bucket) {
    console.warn("[inspirations] S3 sweep skipped: bucket not configured", {
      inspirationId,
      keyCount: keys.length,
    });
    return;
  }

  const objects: ObjectIdentifier[] = keys.map((Key) => ({ Key }));
  try {
    await getDeleteS3().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true },
      }),
    );
  } catch (err) {
    console.warn("[inspirations] S3 sweep failed during delete:", {
      inspirationId,
      objectCount: objects.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

    // Collect the object keys before the cascade removes the rows that name
    // them; a link attachment has no key, so it is not swept, but it is
    // still lost with the row and counts toward `hadPhoto` below.
    const attachmentRows = await db
      .select({ s3Key: attachments.s3Key })
      .from(attachments)
      .innerJoin(inspirations, eq(inspirations.id, attachments.inspirationId))
      .where(
        and(
          eq(attachments.inspirationId, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      );
    const s3KeyRows = attachmentRows.filter((row): row is { s3Key: string } => row.s3Key !== null);

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

      /* THE COPY ON THE DELETED SHELF, written in the same transaction as
         the delete so there is never a moment the words are in neither
         place. See db/schema-deleted.ts for why it is a shelf and not a
         flag on this row.

         ONLY A PERSON'S OWN DELETE, and only one with words in it. The shelf
         is read by the person at a browser (`/deleted` is human-only and
         reads the session's own profile), so a copy filed under an agent —
         an agent deleting its own, or `?profile=` to an agent — could never
         be seen, brought back, forgotten or lapsed: it would be retained
         text with no way out. And a save with no words has nothing a restore
         could bring back, since its picture is swept from storage below. */
      const ownDelete = session.profile.type === "human" && !session.keyScoped && target.profileId === session.profile.id;
      /* Whatever on this shelf has passed its month goes now, whether or not
         anybody opens the shelf again. */
      const at = now();
      await tx.delete(deletedInspirations).where(and(eq(deletedInspirations.profileId, target.profileId),
        lt(deletedInspirations.deletedAt, deletedShelfCutoff(at))));
      const [whole] = !ownDelete ? [] : await tx.select({ text: inspirations.text, kind: inspirations.kind, category: inspirations.category,
        source: inspirations.source, visibility: inspirations.visibility, createdAt: inspirations.createdAt })
        .from(inspirations).where(and(eq(inspirations.id, idCheck.data), eq(inspirations.profileId, target.profileId)));
      if (whole && whole.text.trim()) {
        const said = await tx.select({ question: reflections.question, answer: reflections.answer, skipped: reflections.skipped })
          .from(reflections).where(and(eq(reflections.inspirationId, idCheck.data), eq(reflections.profileId, target.profileId)))
          .orderBy(asc(reflections.createdAt), asc(reflections.id));
        /* A plain insert: the restore removes the shelf copy and the delete
           above clears expired ones, so an id already on the shelf would be
           a second delete of a row that no longer exists. */
        await tx.insert(deletedInspirations).values({ id: idCheck.data, profileId: target.profileId, text: whole.text, kind: whole.kind,
          category: whole.category, source: whole.source, visibility: whole.visibility, reflections: said,
          hadPhoto: attachmentRows.length > 0, keptAt: whole.createdAt, deletedAt: at });
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
    await sweepAttachmentObjects(
      s3KeyRows
        .map((row) => row.s3Key)
        .filter((key): key is string => typeof key === "string" && key.length > 0),
      idCheck.data,
    );


    return c.json({ id: deleted[0]!.id }, 200);
  });
}
