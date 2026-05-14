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
 * durable so the UI is not blocked on an LLM round-trip; a downstream SST
 * Queue worker picks the row up by id and fills `cluster` / `classified_at`
 * later. The row is therefore inserted with `cluster = NULL`, which the
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
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { attachments, inspirations, reflections } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { persistLocalInspirationScores } from "../lib/inspiration-scores.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { enqueueClassification } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Create-inspiration request schema.
 *
 *   - `text`     : required, trimmed, non-empty after trim. Capped at 8 KB so
 *                  a single row stays reasonable to render and to ship to
 *                  Gemini for classification.
 *   - `kind`     : optional free-form metadata carried over from the original
 *                  single-file UI (e.g. "note", "link", "image"). Trimmed,
 *                  empty becomes undefined so we don't store empty strings
 *                  next to NULLs and have to handle both downstream.
 *   - `category` : optional non-negative integer bucket. Matches the
 *                  `integer` column in `inspirations.category`.
 *
 * Notable absences:
 *   - `cluster` / `classified_at` — populated asynchronously by the queue
 *     worker, never accepted from the client.
 *   - `user_id` — derived from the auth context, never accepted from the
 *     client. Allowing it would be a tenant-isolation footgun.
 *   - `id` — generated server-side via `defaultRandom()`.
 */
const createInspirationSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Inspiration text is required")
    .max(8192, "Inspiration text is too long"),
  kind: z
    .string()
    .trim()
    .max(64, "Kind is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  category: z
    .number()
    .int("Category must be an integer")
    .min(0, "Category must be non-negative")
    .max(2_147_483_647, "Category is too large")
    .optional(),
});

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface InspirationsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  enqueueClassificationJob?: typeof enqueueClassification;
  persistScores?: typeof persistLocalInspirationScores;
}

export function createInspirationsRoutes(
  deps: InspirationsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const enqueueClassificationJob = deps.enqueueClassificationJob ?? enqueueClassification;
  const persistScores = deps.persistScores ?? persistLocalInspirationScores;

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
 *      and classified_at remain NULL — the queue worker fills them in.
 *   3. Return 201 with the freshly-inserted row so the SPA can render it
 *      optimistically without a follow-up GET.
 *
 * Performance contract: this endpoint returns only after bounded local DB work
 * and a classification enqueue attempt. Automatic WOW generation is attempted
 * later by the async classifier worker path, never inline in this request.
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

  // 2. Insert. We `.returning()` the columns the SPA needs to render the
  //    new row immediately. cluster / classified_at are intentionally NULL
  //    here — the SST Queue worker will UPDATE them later.
  const [inserted] = await db
    .insert(inspirations)
    .values({
      userId: user.id,
      text: parsed.data.text,
      kind: parsed.data.kind ?? null,
      category: parsed.data.category ?? null,
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
    // Drizzle should always return a row on a successful insert; if it
    // didn't, treat it as an internal error rather than silently 200ing.
    return c.json({ error: "Failed to create inspiration" }, 500);
  }

  const createdScores = await persistScores(db, inserted);
  const scoredInserted = { ...inserted, ...createdScores };

  // 3. Enqueue a classification job (Sub-AC 10.2). The SQS Queue worker in
  //    `queue/classifier.ts` consumes `{ inspirationId }`, calls Gemini, and
  //    UPDATEs `cluster` / `classified_at` on the row.
  //
  //    Failure semantics: the row is already durable in Postgres at this
  //    point. If `sqs:SendMessage` fails (IAM, transport, throttle), we MUST
  //    NOT surface a 5xx to the caller — that would tempt the SPA into
  //    retrying the save and producing a duplicate inspiration row. Instead
  //    we log with the inspiration id so the missed enqueue is visible in
  //    Lambda logs, and rely on a future backfill scan over
  //    `inspirations_cluster_null_idx` to catch any rows whose enqueue was
  //    lost. The user-visible UX is: the inspiration appears immediately with
  //    `cluster = null`, and stays "uncategorised" until either the worker
  //    catches up or the backfill scan re-enqueues.
  try {
    await enqueueClassificationJob(scoredInserted.id);
  } catch (err) {
    console.error("[inspirations] failed to enqueue classification job:", {
      inspirationId: scoredInserted.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. 201 Created with the canonical row payload. Cluster will be `null`
  //    until the classifier worker updates it; the SPA renders an
  //    "uncategorised" state in that window.
  return c.json({ inspiration: scoredInserted }, 201);
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

  return c.json({ inspirations: rows }, 200);
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
        z
          .string()
          .trim()
          .max(64, "Kind is too long")
          .transform((v) => (v.length > 0 ? v : null)),
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

type UpdateInspirationInput = z.infer<typeof updateInspirationSchema>;

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

  const updatedScores = await persistLocalInspirationScores(db, updated);
  const scoredUpdated = { ...updated, ...updatedScores };

  return c.json({ inspiration: scoredUpdated }, 200);
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
const createReflectionSchema = z.object({
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

type CreateReflectionInput = z.infer<typeof createReflectionSchema>;

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

  await persistLocalInspirationScores(db, parent);

  return c.json({ reflection: inserted }, 201);
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
    // Ascending — render the reflection thread in authored order. Aligned
    // with `reflections_inspiration_created_idx (inspiration_id, created_at)`
    // so the query is index-ordered without a sort step.
    .orderBy(asc(reflections.createdAt));

  return c.json({ reflections: rows }, 200);
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
