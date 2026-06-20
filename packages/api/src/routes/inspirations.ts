/**
 * Inspirations routes.
 *
 * Exposes:
 *   - POST /api/inspirations : create a new inspiration scoped to the
 *                          authenticated caller, validate the payload, persist
 *                          it via Drizzle, and return the row immediately.
 *   - GET  /api/inspirations : list inspirations owned by the authenticated
 *                          caller, newest first. Strictly scoped by
 *                          `user_id = c.get("user").id` — no other user's
 *                          rows can leak through this endpoint.
 *
 * Cluster classification is intentionally NOT performed in POST. The seed
 * contract requires the create endpoint to return as soon as the row is
 * durable so the UI is not blocked on an LLM round-trip; a downstream
 * Postgres-backed background job picks the row up by id and fills `cluster` /
 * `classified_at` later. The row is therefore inserted with `cluster = NULL`, which the
 * `inspirations_cluster_null_idx` partial index supports for the worker's
 * backfill scan. The GET endpoint surfaces whatever cluster value happens
 * to be live at read time — `null` while classification is pending,
 * populated once the worker has updated the row.
 *
 * Multi-tenancy
 * -------------
 * Every read and write here is forced to the authenticated user's id
 * (`c.get("user")`). The client cannot supply `user_id` in any request body
 * or query string — even if it tried, the field is not on the validation
 * schema, so zod would strip it before the SQL ever runs, and the GET handler
 * unconditionally `WHERE user_id = $auth_user_id`. This is the data-isolation
 * guarantee the seed's `data_isolation` evaluation principle calls for.
 */

import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  attachments,
  inspirationRevisitEvents,
  inspirationRevisitEventTypeValues,
  inspirationSparks,
  inspirations,
  reflections,
  type InspirationRevisitEventType,
  type Signal,
  type SignalSpark,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import {
  calculateDisplayedInspirationScore,
  calculateInspirationScoreBreakdown,
  persistLocalInspirationScores,
  persistSingleLocalInspirationScoreById,
} from "../lib/inspiration-scores.js";
import { persistSignalPacketForSignal } from "../lib/signal-packets.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { enqueueClassification } from "../lib/queue.js";
import { withSignalLayer } from "../lib/signals.js";
import {
  deleteSignalDocument,
  materializeSignalDocument,
  writeSignalDraftToVault,
} from "../vault/materialize.js";
import { getRuntimeVault } from "../vault/runtime.js";
import type { VaultStore } from "../vault/vault.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Create-inspiration request schema.
 *
 *   - `text`     : required, trimmed, non-empty after trim. Capped at 8 KB so
 *                  a single row stays reasonable to render and to ship to
 *                  Gemini for classification.
 *   - `kind`     : optional bounded MVP input metadata (`note`, `link`,
 *                  `image`, `mixed`). Trimmed, empty becomes undefined so we
 *                  don't store empty strings next to NULLs and have to handle
 *                  both downstream.
 *   - `category` : optional non-negative integer bucket. Matches the
 *                  `integer` column in `inspirations.category`.
 *
 * Notable absences:
 *   - `cluster` / `classified_at` — populated asynchronously by the background
 *     classifier, never accepted from the client.
 *   - `user_id` — derived from the auth context, never accepted from the
 *     client. Allowing it would be a tenant-isolation footgun.
 *   - `id` — generated server-side via `defaultRandom()`.
 */
const captureInputKindValues = ["note", "link", "image", "mixed"] as const;

const reflectionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Reflection question is required")
    .max(4096, "Reflection question is too long"),
  answer: z
    .string()
    .trim()
    .max(8192, "Reflection answer is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  skipped: z.boolean().optional(),
});

const createInspirationSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Inspiration text is required")
    .max(8192, "Inspiration text is too long"),
  kind: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    z.enum(captureInputKindValues, {
      errorMap: () => ({ message: "Kind must be note, link, image, or mixed" }),
    }).optional(),
  ),
  category: z
    .number()
    .int("Category must be an integer")
    .min(0, "Category must be non-negative")
    .max(2_147_483_647, "Category is too large")
    .optional(),
  selectedText: z
    .string()
    .trim()
    .max(4096, "Selected spark is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  selectionStart: z.number().int().min(0).optional(),
  selectionEnd: z.number().int().min(0).optional(),
  sparks: z
    .array(
      z.object({
        text: z.string().trim().min(1, "Spark text is required").max(4096, "Spark text is too long"),
        source: z
          .enum(["user_selected", "user_written", "user_added_later", "auto_detected", "confirmed_auto"])
          .optional(),
        startOffset: z.number().int().min(0).optional(),
        endOffset: z.number().int().min(0).optional(),
        confidence: z.number().int().min(0).max(100).optional(),
        isPrimary: z.boolean().optional(),
        note: z.string().trim().max(2048, "Spark note is too long").optional(),
      }),
    )
    .max(12, "Too many sparks for one inspiration")
    .optional(),
  reflections: z
    .array(reflectionInputSchema)
    .max(3, "Too many guided reflections for one inspiration")
    .optional(),
});

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;

const createSparkSchema = z.object({
  text: z.string().trim().min(1, "Spark text is required").max(4096, "Spark text is too long"),
  source: z
    .enum(["user_selected", "user_written", "user_added_later", "auto_detected", "confirmed_auto"])
    .optional(),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  isPrimary: z.boolean().optional(),
  note: z.string().trim().max(2048, "Spark note is too long").optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface InspirationsRouteDependencies {
  getDatabase?: typeof getDb;
  getVault?: () => VaultStore;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  enqueueClassificationJob?: typeof enqueueClassification;
  persistScores?: typeof persistLocalInspirationScores;
  persistSingleScore?: typeof persistSingleLocalInspirationScoreById;
}

type InspirationResponseRow = {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  importanceScore: number;
  wowScore: number;
  cluster: string | null;
  classifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SparkInput = z.infer<typeof createSparkSchema>;

function isLikelySparkOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 360) return false;
  const paragraphCount = trimmed.split(/\n\s*\n/).filter(Boolean).length;
  if (paragraphCount > 1) return false;
  return true;
}

function normalizeSparkInputs(input: CreateInspirationInput): SparkInput[] {
  const sparks: SparkInput[] = [];
  const seen = new Set<string>();
  const push = (spark: SparkInput) => {
    const text = spark.text.trim();
    if (!text) return;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sparks.push({ ...spark, text });
  };

  if (input.selectedText) {
    push({
      text: input.selectedText,
      source: "user_selected",
      startOffset: input.selectionStart,
      endOffset: input.selectionEnd,
      confidence: 100,
      isPrimary: true,
    });
  }

  for (const spark of input.sparks ?? []) {
    push(spark);
  }

  if (sparks.length === 0 && isLikelySparkOnly(input.text)) {
    push({
      text: input.text,
      source: "user_written",
      confidence: 100,
      isPrimary: true,
    });
  }

  return sparks.slice(0, 12).map((spark, index) => ({
    ...spark,
    isPrimary: spark.isPrimary ?? index === 0,
  }));
}

function withDisplayedWowScore<T extends InspirationResponseRow>(
  row: T,
  now = new Date(),
): T {
  return {
    ...row,
    wowScore: calculateDisplayedInspirationScore({
      coreWowScore: row.wowScore,
      createdAt: row.createdAt,
      now,
    }),
  };
}

const revisitEventSchema = z.object({
  eventType: z.enum(inspirationRevisitEventTypeValues),
});

async function recordRevisitEvent(input: {
  db: ReturnType<typeof getDb>;
  userId: string;
  inspirationId: string;
  eventType: InspirationRevisitEventType;
  persistSingleScore: typeof persistSingleLocalInspirationScoreById;
}) {
  const [parent] = await input.db
    .select({ id: inspirations.id, createdAt: inspirations.createdAt })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, input.inspirationId),
        eq(inspirations.userId, input.userId),
      ),
    )
    .limit(1);

  if (!parent) return null;

  const [event] = await input.db
    .insert(inspirationRevisitEvents)
    .values({
      userId: input.userId,
      inspirationId: input.inspirationId,
      eventType: input.eventType,
    })
    .returning({
      id: inspirationRevisitEvents.id,
      eventType: inspirationRevisitEvents.eventType,
      createdAt: inspirationRevisitEvents.createdAt,
    });

  let scores: Awaited<ReturnType<typeof persistSingleLocalInspirationScoreById>> = null;
  try {
    scores = await input.persistSingleScore(input.db, {
      userId: input.userId,
      inspirationId: input.inspirationId,
    });
  } catch (err) {
    console.warn("[inspirations] failed to refresh score after revisit event:", {
      inspirationId: input.inspirationId,
      eventType: input.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { event, scores, parent };
}

export function createInspirationsRoutes(
  deps: InspirationsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getVault = deps.getVault ?? getRuntimeVault;
  const enqueueClassificationJob = deps.enqueueClassificationJob ?? enqueueClassification;
  const persistScores = deps.persistScores ?? persistLocalInspirationScores;
  const persistSingleScore = deps.persistSingleScore ?? persistSingleLocalInspirationScoreById;

  // Every route under this router requires a valid session. Mounting the
  // middleware once at the router level (rather than per-handler) ensures we
  // cannot accidentally ship an unauthenticated handler in this namespace.
  routes.use("*", deps.authMiddleware ?? requireAuth);

/**
 * POST /api/inspirations
 *
 * Flow:
 *   1. Parse + validate JSON body. Return 400 on schema failure.
 *   2. Insert a new row with `user_id` taken from the auth context. Cluster
 *      and classified_at remain NULL — the background classifier fills them in.
 *   3. Return 201 with the freshly-inserted row so the SPA can render it
 *      optimistically without a follow-up GET.
 *
 * Performance contract: this endpoint returns only after bounded local DB work
 * and a classification enqueue attempt. Automatic WOW generation is attempted
 * later by the background classifier path, never inline in this request.
 */
routes.post("/", async (c) => {
  // 1. Parse body. Tolerate non-JSON gracefully so a misbehaving client
  //    receives a 400 with a message rather than an unhandled exception.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = createInspirationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid inspiration payload",
        // Stable shape the frontend can render directly under the relevant
        // input field.
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const user = c.get("user");
  const db = getDatabase();

  const now = new Date();
  const signalId = randomUUID();
  const sparkInputs = normalizeSparkInputs(parsed.data);
  const draftSignal: Signal = {
    id: signalId,
    userId: user.id,
    text: parsed.data.text,
    kind: parsed.data.kind ?? null,
    category: parsed.data.category ?? null,
    importanceScore: 0,
    wowScore: 0,
    cluster: null,
    classifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const draftSparks: SignalSpark[] = sparkInputs.map((spark) => ({
    id: randomUUID(),
    userId: user.id,
    inspirationId: signalId,
    text: spark.text,
    source: spark.source ?? "user_selected",
    startOffset: spark.startOffset ?? null,
    endOffset: spark.endOffset ?? null,
    confidence: spark.confidence ?? 100,
    isPrimary: spark.isPrimary ?? false,
    note: spark.note ?? null,
    whatMovedUser: null,
    impliedValues: [],
    worldviewClaims: [],
    tensions: [],
    decisionRelevance: [],
    emotionalCharge: [],
    createdAt: now,
    updatedAt: now,
  }));

  const vault = getVault();
  await writeSignalDraftToVault({
    vault,
    signal: draftSignal,
    sparks: draftSparks,
  });

  // 2. Insert the inspiration and any same-submit Reflect Deeper Q/A in one
  //    DB transaction. This closes the previous partial-save gap where the web
  //    client could create the inspiration row, then fail on a later reflection
  //    POST and leave a durable inspiration with no conversation data.
  const reflectionInputs = parsed.data.reflections ?? [];
  const persisted = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(inspirations)
      .values({
        id: signalId,
        userId: user.id,
        text: parsed.data.text,
        kind: parsed.data.kind ?? null,
        category: parsed.data.category ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: inspirations.id,
        userId: inspirations.userId,
        text: inspirations.text,
        kind: inspirations.kind,
        category: inspirations.category,
        importanceScore: inspirations.importanceScore,
        wowScore: inspirations.wowScore,
        cluster: inspirations.cluster,
        classifiedAt: inspirations.classifiedAt,
        createdAt: inspirations.createdAt,
        updatedAt: inspirations.updatedAt,
      });

    if (!inserted) {
      throw new Error("Failed to create inspiration");
    }

    if (sparkInputs.length > 0) {
      await tx.insert(inspirationSparks).values(
        draftSparks.map((spark) => ({
          id: spark.id,
          userId: user.id,
          inspirationId: signalId,
          text: spark.text,
          source: spark.source,
          startOffset: spark.startOffset,
          endOffset: spark.endOffset,
          confidence: spark.confidence,
          isPrimary: spark.isPrimary,
          note: spark.note ?? null,
          createdAt: spark.createdAt,
          updatedAt: spark.updatedAt,
        })),
      );
    }

    const insertedReflections = reflectionInputs.length > 0
      ? await tx
          .insert(reflections)
          .values(
            reflectionInputs.map((reflection, index) => ({
              inspirationId: signalId,
              userId: user.id,
              question: reflection.question,
              answer: reflection.answer ?? null,
              skipped: reflection.skipped ?? false,
              // Preserve authored order for multi-step Reflect Deeper saves even
              // on databases whose timestamp precision would otherwise collapse
              // several rows into the same created_at value.
              createdAt: new Date(now.getTime() + index),
            })),
          )
          .returning({
            id: reflections.id,
            inspirationId: reflections.inspirationId,
            userId: reflections.userId,
            question: reflections.question,
            answer: reflections.answer,
            skipped: reflections.skipped,
            createdAt: reflections.createdAt,
          })
      : [];

    return { inserted, insertedReflections };
  });

  const { inserted, insertedReflections } = persisted;

  const createdScores = await persistScores(db, inserted);
  const scoredInserted = { ...inserted, ...createdScores };

  await persistSignalPacketForSignal({
    db,
    userId: scoredInserted.userId,
    signalId: scoredInserted.id,
  });
  await materializeSignalDocument({
    db,
    vault,
    userId: scoredInserted.userId,
    signalId: scoredInserted.id,
  });

  // 3. Enqueue a durable background classification job. The worker consumes
  //    `{ inspirationId }`, calls Gemini, and UPDATEs `cluster` /
  //    `classified_at` on the row.
  //
  //    Failure semantics: the row is already durable in Postgres at this
  //    point. If enqueue fails, we MUST NOT surface a 5xx to the caller — that
  //    would tempt the SPA into retrying the save and producing a duplicate
  //    inspiration row. Instead we log with the inspiration id so the missed
  //    enqueue is visible in Lambda logs, and rely on a future backfill scan
  //    over `inspirations_cluster_null_idx` to catch rows whose enqueue was
  //    lost. The user-visible UX is: the inspiration appears immediately with
  //    `cluster = null`, and stays "uncategorised" until either the worker
  //    catches up or the backfill scan re-enqueues.
  try {
    await enqueueClassificationJob(scoredInserted.id, scoredInserted.userId);
  } catch (err) {
    console.error("[inspirations] failed to enqueue classification job:", {
      inspirationId: scoredInserted.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. 201 Created with the canonical row payload. Cluster will be `null`
  //    until the classifier worker updates it; the SPA renders an
  //    "uncategorised" state in that window.
  return c.json(
    {
      inspiration: withSignalLayer(withDisplayedWowScore(scoredInserted)),
      ...(insertedReflections.length > 0 ? { reflections: insertedReflections } : {}),
    },
    201,
  );
});

/**
 * GET /api/inspirations
 *
 * List inspirations owned by the authenticated user, newest first.
 *
 * Tenant-isolation contract
 * -------------------------
 * The `WHERE user_id = $auth_user_id` clause below is the single thing that
 * guarantees a user only ever sees their own saves. It is *not* configurable,
 * not overridable from a header, and not weakened by an admin flag — every
 * query on this table from the GET path passes through it. The composite
 * index `inspirations_user_created_idx (user_id, created_at DESC)` makes
 * this an index-only scan in the common case.
 *
 * Pagination is intentionally NOT exposed here yet:
 *   - The seed's scope ends at `sst dev` running locally; no AC requires a
 *     paginated list. Adding `?limit&before` now would either ship dead UI
 *     wiring or force a follow-up migration when the real paging story lands.
 *   - We cap the response server-side at `MAX_LIST_LIMIT` so a single user
 *     with a runaway capture loop cannot OOM the Lambda or starve the SPA.
 *
 * If the user has never saved anything, the response body is
 * `{ inspirations: [] }` — never a 404. The empty-state copy is the
 * frontend's job, not an HTTP-level concern.
 */

/**
 * Hard upper bound on rows returned by GET /api/inspirations. Sized large enough
 * that no realistic single-user history hits it during the local-dev scope,
 * but small enough that the response stays under 1 MB even if every row is
 * close to the 8 KB text cap. Tunable in a future paginated revision.
 */
type AttachmentEnrichmentStatus = "pending" | "ready" | "failed" | "unavailable";

function serializeAttachment(row: {
  id: string; inspirationId: string; type: "link" | "image" | "file"; url: string; name: string | null; contentType: string | null; size: number | null;
  enrichmentStatus: AttachmentEnrichmentStatus | null; enrichmentSource: string | null; enrichmentSourceUrl: string | null; enrichmentErrorReason: string | null;
  enrichmentUpdatedAt: Date | null;
  finalUrl: string | null; hostname: string | null; title: string | null; description: string | null; siteName: string | null; previewImageUrl: string | null; imageWidth: number | null; imageHeight: number | null; createdAt: Date;
}) {
  const fallbackStatus: AttachmentEnrichmentStatus = row.type === "link" ? "unavailable" : "ready";
  return {
    id: row.id,
    inspirationId: row.inspirationId,
    type: row.type,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
    ...(row.type === "link" ? { url: row.url } : {}),
    enrichment: {
      status: row.enrichmentStatus ?? fallbackStatus,
      source: row.enrichmentSource,
      sourceUrl: row.type === "link" ? row.enrichmentSourceUrl : null,
      errorReason: row.enrichmentErrorReason,
      checkedAt: row.enrichmentUpdatedAt,
      link: row.type === "link" ? {
        originalUrl: row.url,
        finalUrl: row.finalUrl,
        hostname: row.hostname,
        title: row.title,
        description: row.description,
        siteName: row.siteName,
        previewImageUrl: row.previewImageUrl,
      } : null,
      image: row.type === "image" ? {
        filename: row.name,
        contentType: row.contentType,
        size: row.size,
        width: row.imageWidth,
        height: row.imageHeight,
      } : null,
    },
  };
}

const MAX_LIST_LIMIT = 500;

routes.get("/", async (c) => {
  const user = c.get("user");
  const db = getDatabase();

  const rows = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      importanceScore: inspirations.importanceScore,
      wowScore: inspirations.wowScore,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    })
    .from(inspirations)
    // CRITICAL: tenant scope. Removing or weakening this clause would
    // immediately leak every other user's saves through this endpoint.
    .where(eq(inspirations.userId, user.id))
    // Newest first — matches the prototype's history-drawer ordering and the
    // `inspirations_user_created_idx (user_id, created_at DESC)` composite
    // index so the query is index-ordered without a sort step.
    .orderBy(desc(inspirations.createdAt))
    .limit(MAX_LIST_LIMIT);

  const ids = rows.map((row) => row.id);
  const attachmentRows = ids.length > 0
    ? await db
        .select({
          id: attachments.id,
          inspirationId: attachments.inspirationId,
          type: attachments.type,
          url: attachments.url,
          name: attachments.name,
          contentType: attachments.contentType,
          size: attachments.size,
          enrichmentStatus: attachments.enrichmentStatus,
          enrichmentSource: attachments.enrichmentSource,
          enrichmentSourceUrl: attachments.enrichmentSourceUrl,
          enrichmentErrorReason: attachments.enrichmentErrorReason,
          enrichmentUpdatedAt: attachments.enrichmentUpdatedAt,
          finalUrl: attachments.finalUrl,
          hostname: attachments.hostname,
          title: attachments.title,
          description: attachments.description,
          siteName: attachments.siteName,
          previewImageUrl: attachments.previewImageUrl,
          imageWidth: attachments.imageWidth,
          imageHeight: attachments.imageHeight,
          createdAt: attachments.createdAt,
        })
        .from(attachments)
        .where(inArray(attachments.inspirationId, ids))
    : [];

  const attachmentsByInspiration = new Map<string, ReturnType<typeof serializeAttachment>[]>();
  for (const attachment of attachmentRows) {
    const serialized = serializeAttachment(attachment);
    const bucket = attachmentsByInspiration.get(attachment.inspirationId) ?? [];
    bucket.push(serialized);
    attachmentsByInspiration.set(attachment.inspirationId, bucket);
  }

  const now = new Date();
  return c.json({
    inspirations: rows.map((row) =>
      withSignalLayer({
        ...withDisplayedWowScore(row, now),
        attachments: attachmentsByInspiration.get(row.id) ?? [],
      }),
    ),
  }, 200);
});

routes.get("/:id/sparks", async (c) => {
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();
  const [parent] = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.userId, user.id)))
    .limit(1);

  if (!parent) return c.json({ error: "Inspiration not found" }, 404);

  const sparks = await db
    .select()
    .from(inspirationSparks)
    .where(and(eq(inspirationSparks.inspirationId, idCheck.data), eq(inspirationSparks.userId, user.id)))
    .orderBy(desc(inspirationSparks.isPrimary), desc(inspirationSparks.confidence), asc(inspirationSparks.createdAt));

  return c.json({
    sparks: sparks.map((spark) => ({
      ...spark,
      createdAt: spark.createdAt.toISOString(),
      updatedAt: spark.updatedAt.toISOString(),
    })),
  }, 200);
});

routes.post("/:id/sparks", async (c) => {
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = createSparkSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid spark payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const user = c.get("user");
  const db = getDatabase();
  const [parent] = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.userId, user.id)))
    .limit(1);

  if (!parent) return c.json({ error: "Inspiration not found" }, 404);

  if (parsed.data.isPrimary) {
    await db
      .update(inspirationSparks)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(inspirationSparks.inspirationId, idCheck.data),
          eq(inspirationSparks.userId, user.id),
        ),
      );
  }

  const [spark] = await db
    .insert(inspirationSparks)
    .values({
      userId: user.id,
      inspirationId: idCheck.data,
      text: parsed.data.text,
      source: parsed.data.source ?? "user_added_later",
      startOffset: parsed.data.startOffset ?? null,
      endOffset: parsed.data.endOffset ?? null,
      confidence: parsed.data.confidence ?? 100,
      isPrimary: parsed.data.isPrimary ?? false,
      note: parsed.data.note ?? null,
    })
    .returning();

  if (!spark) return c.json({ error: "Failed to create spark" }, 500);

  await persistSignalPacketForSignal({
    db,
    userId: user.id,
    signalId: idCheck.data,
  });
  await materializeSignalDocument({
    db,
    vault: getVault(),
    userId: user.id,
    signalId: idCheck.data,
  });

  return c.json({
    spark: {
      ...spark,
      createdAt: spark.createdAt.toISOString(),
      updatedAt: spark.updatedAt.toISOString(),
    },
  }, 201);
});

routes.delete("/:id/sparks/:sparkId", async (c) => {
  const inspirationId = c.req.param("id");
  const sparkId = c.req.param("sparkId");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  const sparkIdCheck = z.string().uuid().safeParse(sparkId);
  if (!idCheck.success || !sparkIdCheck.success) {
    return c.json({ error: "Invalid spark id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();
  const [deleted] = await db
    .delete(inspirationSparks)
    .where(
      and(
        eq(inspirationSparks.id, sparkIdCheck.data),
        eq(inspirationSparks.inspirationId, idCheck.data),
        eq(inspirationSparks.userId, user.id),
      ),
    )
    .returning({ id: inspirationSparks.id });

  if (!deleted) return c.json({ error: "Spark not found" }, 404);

  await persistSignalPacketForSignal({
    db,
    userId: user.id,
    signalId: idCheck.data,
  });
  await materializeSignalDocument({
    db,
    vault: getVault(),
    userId: user.id,
    signalId: idCheck.data,
  });

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /api/inspirations/:id/score-breakdown
// ---------------------------------------------------------------------------
routes.get("/:id/score-breakdown", async (c) => {
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();
  const breakdown = await calculateInspirationScoreBreakdown(db, {
    userId: user.id,
    inspirationId: idCheck.data,
  });

  if (!breakdown) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  return c.json({ scoreBreakdown: breakdown }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/inspirations/:id/revisits
// ---------------------------------------------------------------------------

routes.post("/:id/revisits", async (c) => {
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = revisitEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid revisit payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const user = c.get("user");
  const db = getDatabase();
  const result = await recordRevisitEvent({
    db,
    userId: user.id,
    inspirationId: idCheck.data,
    eventType: parsed.data.eventType,
    persistSingleScore,
  });

  if (!result) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  return c.json(
    {
      revisit: result.event,
      inspiration: result.scores
        ? {
            id: idCheck.data,
            importanceScore: result.scores.importanceScore,
            wowScore: calculateDisplayedInspirationScore({
              coreWowScore: result.scores.wowScore,
              createdAt: result.parent.createdAt,
            }),
          }
        : null,
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// PATCH /api/inspirations/:id
// ---------------------------------------------------------------------------

/**
 * Update-inspiration request schema.
 *
 * Editable fields are deliberately limited to the user-facing metadata that
 * the capture form writes — `text`, `kind`, `category`. Server-managed fields
 * are explicitly NOT accepted from the client:
 *
 *   - `cluster` / `classifiedAt` — only the queue worker may write these.
 *     Letting the client edit them would let a malicious caller pin their
 *     own classification and skip Gemini entirely.
 *   - `userId` — derived from the auth context. Allowing a body-supplied
 *     `userId` here would be a tenant-isolation footgun (re-assign your own
 *     row to another user).
 *   - `id` / `createdAt` / `updatedAt` — generated server-side. `updatedAt`
 *     is bumped by the handler on every successful PATCH.
 *
 * All three editable fields are optional so the endpoint supports partial
 * updates (PATCH semantics — change one field without touching the others).
 * `kind` and `category` accept `null` explicitly so a caller can clear a
 * previously-set value; passing `undefined` (i.e. omitting the key) leaves
 * the existing value alone.
 */
const updateInspirationSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Inspiration text is required")
      .max(8192, "Inspiration text is too long")
      .optional(),
    // Nullable so callers can clear a previously-set value. `.transform`
    // collapses empty strings to null so we don't store empty strings next
    // to NULLs and have to handle both downstream.
    kind: z
      .union([
        z.preprocess(
          (v) => (typeof v === "string" ? v.trim() || null : v),
          z.enum(captureInputKindValues, {
            errorMap: () => ({ message: "Kind must be note, link, image, or mixed" }),
          }),
        ),
        z.null(),
      ])
      .optional(),
    category: z
      .union([
        z
          .number()
          .int("Category must be an integer")
          .min(0, "Category must be non-negative")
          .max(2_147_483_647, "Category is too large"),
        z.null(),
      ])
      .optional(),
  })
  // Reject a payload that names no editable field — without this guard we'd
  // silently bump `updated_at` for a no-op, which is misleading for any
  // caller that sorts by it.
  .refine(
    (v) =>
      v.text !== undefined || v.kind !== undefined || v.category !== undefined,
    {
      message:
        "At least one of text, kind, or category must be provided",
      path: ["text"],
    },
  );

/**
 * PATCH /api/inspirations/:id
 *
 * Partially update one of the caller's inspirations. Unspecified fields are
 * left as-is; `null` explicitly clears `kind` / `category`. `text` cannot be
 * cleared (it is `NOT NULL` in the schema) — pass a non-empty string or omit
 * the field entirely.
 *
 * Tenant isolation
 * ----------------
 * The single UPDATE statement carries a compound `id = :id AND user_id =
 * caller` predicate, identical in spirit to the DELETE handler below. A
 * cross-tenant id won't match any row, so `.returning()` comes back empty
 * and we 404 — never a 403, so the endpoint cannot be used to enumerate
 * uuids that exist for other tenants.
 *
 * Cluster + classification semantics
 * ----------------------------------
 * Editing `text` does NOT automatically re-enqueue a classification job.
 * That is a deliberate scope choice: the seed's only AC for cluster
 * classification (AC 10/11) covers the "create" path, and silently
 * re-classifying on every text edit would balloon Gemini cost for what is
 * usually a typo-fix. A future AC may wire re-classification here; for now
 * the cluster column stays as it was before the edit, and the SPA renders
 * it accordingly.
 *
 * Performance contract: one UPDATE that's a single B-tree probe on the
 * `inspirations.id` primary key. No LLM, no S3, no follow-up SELECT — the
 * `.returning()` clause hands back the canonical row in the same round-trip.
 */
routes.patch("/:id", async (c) => {
  // 1. Validate the path parameter as a uuid up front. Reject malformed ids
  //    with a 400 rather than letting Postgres complain about "invalid input
  //    syntax for type uuid".
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  // 2. Parse + validate JSON body. Tolerate non-JSON gracefully so a
  //    misbehaving client receives a 400 with a message rather than an
  //    unhandled exception.
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

  const user = c.get("user");
  const db = getDatabase();

  // 3. Build the UPDATE patch. Only fields the caller actually supplied are
  //    written; an absent field is left alone in Postgres. We bump
  //    `updatedAt` unconditionally on every successful PATCH so the SPA can
  //    use it as a freshness signal — Drizzle does NOT auto-update timestamps
  //    on UPDATE, so we set it explicitly here.
  const patch: {
    text?: string;
    kind?: string | null;
    category?: number | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
  if (parsed.data.category !== undefined) patch.category = parsed.data.category;

  // 4. Single UPDATE with the tenant-scope predicate baked in. `.returning()`
  //    hands back zero rows when the id is missing or owned by another user
  //    — collapsing both cases into a single 404 below so we never leak
  //    cross-tenant existence.
  const [updated] = await db
    .update(inspirations)
    .set(patch)
    .where(
      and(
        eq(inspirations.id, idCheck.data),
        eq(inspirations.userId, user.id),
      ),
    )
    .returning({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      importanceScore: inspirations.importanceScore,
      wowScore: inspirations.wowScore,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    });

  if (!updated) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  try {
    await recordRevisitEvent({
      db,
      userId: user.id,
      inspirationId: updated.id,
      eventType: "inspiration_updated",
      persistSingleScore,
    });
  } catch (err) {
    console.warn("[inspirations] failed to record update revisit event:", {
      inspirationId: updated.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const updatedScores = await persistScores(db, updated);
  const scoredUpdated = { ...updated, ...updatedScores };
  await materializeSignalDocument({
    db,
    vault: getVault(),
    userId: user.id,
    signalId: scoredUpdated.id,
  });

  return c.json({ inspiration: withDisplayedWowScore(scoredUpdated) }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/inspirations/:id/reflections
// ---------------------------------------------------------------------------

/**
 * Create-reflection request schema.
 *
 *   - `question` : required, trimmed, non-empty after trim. Capped at 4 KB so
 *                  we don't have to worry about runaway prompts being stored
 *                  in a text column meant for short reflective questions.
 *   - `answer`   : optional. The user may save a reflection in three states:
 *                  pending (no answer, not skipped), answered (answer set,
 *                  not skipped), or explicitly skipped. Empty/whitespace
 *                  becomes `null` so we don't store empty strings next to
 *                  NULLs and have to handle both downstream.
 *   - `skipped`  : optional boolean. When true the row is recorded as a
 *                  deliberate "no answer" — distinct from "answer is null
 *                  because the user hasn't gotten around to it yet".
 *
 * Notable absences:
 *   - `inspirationId` — taken from the URL path, never the body, so the
 *     server-side ownership check cannot be bypassed by mismatching the
 *     two.
 *   - `userId` — derived from the auth context.
 *   - `id` / `createdAt` — generated server-side.
 */
const createReflectionSchema = reflectionInputSchema;

/**
 * POST /api/inspirations/:id/reflections
 *
 * Create a reflection attached to one of the caller's inspirations.
 *
 * Tenant isolation
 * ----------------
 * Two layers of defence:
 *   1. The path parameter `:id` is matched against `inspirations` with BOTH
 *      `id = :id` AND `user_id = c.get("user").id`. A foreign user_id won't
 *      match, so a malicious caller cannot stick a reflection onto someone
 *      else's inspiration even by guessing the uuid.
 *   2. The reflection row itself denormalises `user_id` (per
 *      `schema-reflections.ts`), so subsequent reads can re-check ownership
 *      with a single WHERE clause and no join.
 *
 * Returns 404 (not 403) when the inspiration is missing or owned by another
 * user — same convention used by the attachments finalize endpoint, so we
 * never leak the existence of inspirations the caller doesn't own.
 *
 * Performance contract: one SELECT (ownership check) + one INSERT (the row),
 * both indexed lookups. No LLM or S3 round-trips on this path.
 */
routes.post("/:id/reflections", async (c) => {
  // 1. Validate the path parameter as a uuid up front. Reject malformed
  //    ids with a 400 rather than letting Postgres complain about "invalid
  //    input syntax for type uuid".
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  // 2. Parse + validate JSON body. Tolerate non-JSON gracefully so a
  //    misbehaving client receives a 400 with a message rather than an
  //    unhandled exception.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = createReflectionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid reflection payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const user = c.get("user");
  const db = getDatabase();

  // 3. Confirm the parent inspiration exists AND belongs to the caller.
  //    A single composite-indexed lookup; the primary key + user filter is
  //    cheap. We deliberately 404 (not 403) when the row is owned by
  //    another user so the endpoint cannot be used to enumerate ids.
  const [parent] = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      createdAt: inspirations.createdAt,
    })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, idCheck.data),
        eq(inspirations.userId, user.id),
      ),
    )
    .limit(1);

  if (!parent) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  // 4. INSERT the reflection. `userId` is taken from the auth context, NOT
  //    the request body — the schema is strict so the client couldn't supply
  //    one anyway, but layering the auth-derived value here makes the
  //    tenant invariant impossible to bypass even if the schema is loosened
  //    in a future revision.
  const [inserted] = await db
    .insert(reflections)
    .values({
      inspirationId: idCheck.data,
      userId: user.id,
      question: parsed.data.question,
      answer: parsed.data.answer ?? null,
      skipped: parsed.data.skipped ?? false,
    })
    .returning({
      id: reflections.id,
      inspirationId: reflections.inspirationId,
      userId: reflections.userId,
      question: reflections.question,
      answer: reflections.answer,
      skipped: reflections.skipped,
      createdAt: reflections.createdAt,
    });

  if (!inserted) {
    return c.json({ error: "Failed to create reflection" }, 500);
  }

  try {
    await recordRevisitEvent({
      db,
      userId: user.id,
      inspirationId: parent.id,
      eventType: "reflection_created",
      persistSingleScore,
    });
  } catch (err) {
    console.warn("[inspirations] failed to record reflection revisit event:", {
      inspirationId: parent.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await enqueueClassificationJob(parent.id, user.id, {
      idempotencyScope: `reflection:${inserted.id}`,
    });
  } catch (err) {
    console.error("[inspirations] failed to enqueue reflection WOW job:", {
      inspirationId: parent.id,
      reflectionId: inserted.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await persistSignalPacketForSignal({
      db,
      userId: user.id,
      signalId: parent.id,
    });
  } catch (err) {
    console.warn("[inspirations] failed to refresh signal packet after reflection:", {
      inspirationId: parent.id,
      reflectionId: inserted.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const updatedScores = await persistScores(db, parent);
  await materializeSignalDocument({
    db,
    vault: getVault(),
    userId: user.id,
    signalId: parent.id,
  });

  return c.json(
    {
      reflection: inserted,
      inspiration: {
        id: parent.id,
        importanceScore: updatedScores.importanceScore,
        wowScore: calculateDisplayedInspirationScore({
          coreWowScore: updatedScores.wowScore,
          createdAt: parent.createdAt,
        }),
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /api/inspirations/:id/reflections
// ---------------------------------------------------------------------------

/**
 * GET /api/inspirations/:id/reflections
 *
 * List all reflections attached to one of the caller's inspirations, ordered
 * by `created_at` ascending so the client renders the thread in the same
 * chronological order it was authored.
 *
 * Tenant isolation
 * ----------------
 * Same two-layer defence as the POST sibling:
 *   1. The parent inspiration must exist AND match `user_id = caller`. We
 *      404 (not 403) when the parent is missing or owned by another user so
 *      this endpoint cannot be used to enumerate uuids that exist for other
 *      tenants.
 *   2. The reflections SELECT itself filters on `user_id = caller`. Even if
 *      the parent check were ever weakened, this clause keeps cross-tenant
 *      rows from leaking.
 *
 * Performance contract: one indexed parent existence check + one indexed
 * range scan over `reflections_inspiration_created_idx
 * (inspiration_id, created_at)`. The query is index-ordered — no sort step.
 *
 * Response shape: `{ reflections: Reflection[] }`. Empty array — never 404 —
 * when the inspiration exists and the caller owns it but has not yet attached
 * any reflections; "no reflections yet" is a valid state, not an error.
 */
routes.get("/:id/reflections", async (c) => {
  // 1. Validate the path parameter as a uuid up front. Reject malformed
  //    ids with a 400 rather than letting Postgres complain about "invalid
  //    input syntax for type uuid".
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();

  // 2. Confirm the parent inspiration exists AND belongs to the caller.
  //    Same pattern as the POST sibling — 404 (not 403) on miss/cross-tenant
  //    so the endpoint cannot be used to enumerate ids.
  const [parent] = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, idCheck.data),
        eq(inspirations.userId, user.id),
      ),
    )
    .limit(1);

  if (!parent) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  // 3. Fetch the reflections. The compound `(inspirationId = ..., userId = ...)`
  //    filter is belt-and-braces: the parent check above already ensures the
  //    inspiration belongs to the caller, but filtering reflections by
  //    `userId` too means a future schema bug (e.g. a stray cross-user row)
  //    cannot leak through this endpoint.
  const rows = await db
    .select({
      id: reflections.id,
      inspirationId: reflections.inspirationId,
      userId: reflections.userId,
      question: reflections.question,
      answer: reflections.answer,
      skipped: reflections.skipped,
      createdAt: reflections.createdAt,
    })
    .from(reflections)
    .where(
      and(
        eq(reflections.inspirationId, idCheck.data),
        eq(reflections.userId, user.id),
      ),
    )
    // Ascending — render the reflection thread in authored order. The id tie-breaker
    // keeps multi-row guided saves deterministic even when several inserts share
    // the same database timestamp precision.
    .orderBy(asc(reflections.createdAt), asc(reflections.id));

  return c.json({ reflections: rows }, 200);
});

// DELETE /api/inspirations/:id/reflections/:reflectionId
routes.delete("/:id/reflections/:reflectionId", async (c) => {
  const inspirationIdCheck = z.string().uuid().safeParse(c.req.param("id"));
  const reflectionIdCheck = z.string().uuid().safeParse(c.req.param("reflectionId"));
  if (!inspirationIdCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }
  if (!reflectionIdCheck.success) {
    return c.json({ error: "Invalid reflection id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();
  const [deleted] = await db
    .delete(reflections)
    .where(
      and(
        eq(reflections.id, reflectionIdCheck.data),
        eq(reflections.inspirationId, inspirationIdCheck.data),
        eq(reflections.userId, user.id),
      ),
    )
    .returning({ id: reflections.id });

  if (!deleted) {
    return c.json({ error: "Reflection not found" }, 404);
  }

  return c.json({ deleted: true, id: deleted.id }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /api/inspirations/:id
// ---------------------------------------------------------------------------

/**
 * Lazy S3 client used by DELETE /api/inspirations/:id to remove the underlying
 * S3 objects backing any image / file attachments before the row goes away.
 *
 * The DB foreign keys already cascade `inspirations → attachments` and
 * `inspirations → reflections` on delete, but the S3 objects live outside
 * Postgres and have to be removed in application code (see the comment in
 * `schema-attachments.ts`). We collect every `s3Key` for the row, batch a
 * single `DeleteObjects` call against the bucket, and only then issue the
 * Postgres delete. If the S3 sweep fails (transport / credential / bucket
 * misconfig) we still log + proceed with the DB delete: leaving an
 * inspiration row pointing at orphaned bytes is strictly worse for the user
 * than leaving a few orphaned bytes in S3, and the Bucket lifecycle / a
 * future janitor can sweep those up.
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
 * DELETE /api/inspirations/:id
 *
 * Permanently removes one of the caller's inspirations along with every
 * attachment row and reflection row attached to it.
 *
 * Tenant isolation
 * ----------------
 * The DELETE is gated by a single `WHERE id = :id AND user_id = caller`
 * predicate. A foreign user_id won't match, so a malicious caller cannot
 * remove another tenant's row even by guessing the uuid. We use Drizzle's
 * `.returning({ id })` clause to determine whether anything was actually
 * deleted: zero rows back ⇒ 404 (the row was missing or owned by someone
 * else — same convention used by the attachments finalize endpoint, so we
 * never leak the existence of inspirations the caller doesn't own).
 *
 * Cascade behaviour (delegated to the DB)
 * ---------------------------------------
 *   - `attachments.inspiration_id` is FK ON DELETE CASCADE → all attachment
 *     rows for the inspiration are removed by Postgres in the same
 *     transaction.
 *   - `reflections.inspiration_id` is FK ON DELETE CASCADE → all reflection
 *     rows for the inspiration are removed by Postgres in the same
 *     transaction.
 *
 * S3 sweep (handled in application code)
 * --------------------------------------
 * Before the DB delete, we collect every `s3_key` from the row's image /
 * file attachments and batch a single `DeleteObjects` against the bucket.
 *
 * Failure semantics
 * -----------------
 *   - DB error before delete   → propagate (Hono's default 500).
 *   - S3 sweep error           → log + continue with the DB delete. Leaving
 *                                 a row pointing at orphaned bytes is worse
 *                                 than a few orphan bytes in the bucket.
 *   - DB delete returns 0 rows → 404. Idempotent from the caller's view.
 *
 * Performance contract: one indexed SELECT for s3_keys, one batched
 * DeleteObjects to S3 (skipped when there are no keys), one DELETE on
 * `inspirations` (the row's PK). Cascade work is server-side in Postgres.
 */
routes.delete("/:id", async (c) => {
  // 1. Validate the path parameter as a uuid up front. Reject malformed ids
  //    with a 400 rather than letting Postgres complain about "invalid input
  //    syntax for type uuid".
  const inspirationId = c.req.param("id");
  const idCheck = z.string().uuid().safeParse(inspirationId);
  if (!idCheck.success) {
    return c.json({ error: "Invalid inspiration id" }, 400);
  }

  const user = c.get("user");
  const db = getDatabase();

  // 2. Confirm ownership FIRST and collect s3_keys in the same indexed
  //    lookup. Doing the ownership check + key fetch as one query (rather
  //    than two) keeps the path's round-trip count tight and means a
  //    cross-tenant id never causes a needless S3 call.
  //
  //    Drizzle inner-join pattern: select keys from `attachments` joined to
  //    `inspirations` on inspiration_id, filter by inspiration id + caller's
  //    user_id, only s3-backed attachments (s3Key NOT NULL).
  const ownershipRow = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, idCheck.data),
        eq(inspirations.userId, user.id),
      ),
    )
    .limit(1);

  if (ownershipRow.length === 0) {
    // 404 (not 403) so the endpoint cannot be used to enumerate uuids that
    // exist for other tenants. Same convention as POST /:id/reflections and
    // POST /api/attachments.
    return c.json({ error: "Inspiration not found" }, 404);
  }

  await deleteSignalDocument({
    db,
    vault: getVault(),
    userId: user.id,
    signalId: idCheck.data,
  });

  // 3. Collect S3 keys for this inspiration's image / file attachments. Link
  //    attachments have `s3Key === NULL` and are skipped automatically by
  //    the `isNotNull` predicate.
  const s3KeyRows = await db
    .select({ s3Key: attachments.s3Key })
    .from(attachments)
    .where(
      and(
        eq(attachments.inspirationId, idCheck.data),
        isNotNull(attachments.s3Key),
      ),
    );

  // 4. Best-effort S3 sweep. We log and continue on any failure mode — a
  //    failed sweep cannot block the user from deleting their own data.
  if (s3KeyRows.length > 0) {
    const bucket = getDeleteBucketName();
    if (bucket) {
      const objects: ObjectIdentifier[] = s3KeyRows
        .map((r) => r.s3Key)
        .filter((k): k is string => typeof k === "string" && k.length > 0)
        .map((Key) => ({ Key }));
      if (objects.length > 0) {
        try {
          await getDeleteS3().send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects, Quiet: true },
            }),
          );
        } catch (err) {
          // Don't fail the user's delete on a flaky S3 round-trip. The DB
          // delete below will still proceed and the orphan bytes can be
          // swept later.
          console.warn(
            "[inspirations] S3 sweep failed during delete:",
            {
              inspirationId: idCheck.data,
              objectCount: objects.length,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    } else {
      // No bucket configured (e.g. local smoke run). The attachments
      // routes would already 500 on upload, so any rows we see here were
      // written under a previous configuration. Log and move on.
      console.warn(
        "[inspirations] S3 sweep skipped: bucket not configured",
        { inspirationId: idCheck.data, keyCount: s3KeyRows.length },
      );
    }
  }

  // 5. DELETE the row. Cascade FKs remove attachments + reflections. The
  //    `(id, user_id)` predicate is the same belt-and-braces used by every
  //    other tenant-scoped query in this file — even though we already
  //    ownership-checked above, repeating the user_id filter here means
  //    a future refactor that drops step 2 still cannot leak across
  //    tenants. `.returning({ id })` lets us distinguish "deleted" from
  //    "missed" without a separate roundtrip.
  const deleted = await db
    .delete(inspirations)
    .where(
      and(
        eq(inspirations.id, idCheck.data),
        eq(inspirations.userId, user.id),
      ),
    )
    .returning({ id: inspirations.id });

  if (deleted.length === 0) {
    // Race: someone deleted the row between our ownership check and the
    // delete. From the caller's perspective the row is gone — return 404
    // for consistency with the not-owned path.
    return c.json({ error: "Inspiration not found" }, 404);
  }

  // 6. 200 with a confirmation payload. Body shape is `{ id }` so the SPA
  //    can match the optimistic remove against the server's confirmation
  //    without parsing the URL again.
  return c.json({ id: deleted[0]!.id }, 200);
});


  return routes;
}

export const inspirationsRoutes = createInspirationsRoutes();
