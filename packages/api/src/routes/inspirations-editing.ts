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

import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

import {
  attachments,
  inspirations,
  reflections,
  signalEvidence,
  type Inspiration,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { reconcilePrinciplesAfterSignalLoss } from "../lib/principle-generation.js";
import type { AuthEnv } from "../lib/middleware.js";
import { enqueueTopOfMindRefresh } from "../lib/queue.js";
import {
  acquireSignalDerivationLock,
  reconcileSignalsAfterEvidenceLoss,
} from "../lib/signal-derivation.js";
import { attachmentSelection, serializeAttachment } from "./attachments.js";
import { requestSignalDerivation } from "./inspirations-derivation.js";
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
  cachedDeleteS3 = new S3Client({
    region:
      process.env.ATTACHMENTS_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-west-2",
  });
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
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
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
    const [updated] = await db
      .update(inspirations)
      .set(patch)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .returning(inspirationSelection);

    if (!updated) return c.json({ error: "Inspiration not found" }, 404);

    await requestSignalDerivation({
      profileId: target.profileId,
      inspirationId: updated.id,
      reason: "edited",
    });

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
        inspiration: serializeInspirationDetail(updated, {
          attachments: attachmentRows.map(serializeAttachment),
          reflections: reflectionRows,
        }),
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
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    // Collect the object keys before the cascade removes the rows that name
    // them; a link attachment has no key and is skipped by the predicate.
    const s3KeyRows = await db
      .select({ s3Key: attachments.s3Key })
      .from(attachments)
      .innerJoin(inspirations, eq(inspirations.id, attachments.inspirationId))
      .where(
        and(
          eq(attachments.inspirationId, idCheck.data),
          eq(inspirations.profileId, target.profileId),
          isNotNull(attachments.s3Key),
        ),
      );

    // Likewise: the evidence rows naming this capture are about to cascade
    // away, and afterwards there is no join left to find the signals that
    // rested on it. Collect, delete, and reconcile run in one transaction
    // that holds the profile's derivation lock, so a derivation for this same
    // capture cannot commit new evidence between the collect and the delete —
    // which would let the FK cascade drop a signal's only support while
    // reconcile, working from the pre-delete id list, never learns to retire
    // it. A ghost pattern with zero evidence is exactly the state the cascade
    // rule forbids.
    const deleted = await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, target.profileId);

      const citingRows = await tx
        .selectDistinct({ signalId: signalEvidence.signalId })
        .from(signalEvidence)
        .where(
          and(
            eq(signalEvidence.inspirationId, idCheck.data),
            eq(signalEvidence.profileId, target.profileId),
          ),
        );

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

      await reconcileSignalsAfterEvidenceLoss(tx, {
        profileId: target.profileId,
        signalIds: citingRows.map((row) => row.signalId),
      });
      /* Layer 4 follows layer 2 down. A principle stands on signals, so a
         deletion that costs a signal its support must reach the principles
         citing it in the SAME transaction — otherwise a principle keeps
         asserting something whose evidence has just been removed. This call
         lived in the monolithic inspirations.ts on `dev`; it is carried here
         because that file became a registrar and this is where its delete
         path went. */
      await reconcilePrinciplesAfterSignalLoss(tx, {
        profileId: target.profileId,
        signalIds: citingRows.map((row) => row.signalId),
      });
      return removed;
    });

    if (deleted.length === 0) {
      return c.json({ error: "Inspiration not found" }, 404);
    }

    await sweepAttachmentObjects(
      s3KeyRows
        .map((row) => row.s3Key)
        .filter((key): key is string => typeof key === "string" && key.length > 0),
      idCheck.data,
    );

    // The reconcile above may have retired signals the live artifact cites,
    // so re-synthesise it. Best-effort: the delete has committed, and a
    // failed enqueue means a stale board next refresh, not a lost delete.
    void enqueueTopOfMindRefresh(target.profileId, "signals_changed").catch(
      (err: unknown) => {
        console.warn("[inspirations] refresh enqueue after delete failed", {
          profileId: target.profileId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );

    return c.json({ id: deleted[0]!.id }, 200);
  });
}
