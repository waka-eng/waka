/**
 * Inspirations — layer 1, the capture surface.
 *
 *   POST   /api/inspirations                          capture
 *   GET    /api/inspirations                          archive and recall
 *   GET    /api/inspirations/:id                      one capture in full
 *   PATCH  /api/inspirations/:id                      edit text or kind
 *   DELETE /api/inspirations/:id                      delete, cascades below
 *   POST   /api/inspirations/:id/reflections          human Q&A on a capture
 *   GET    /api/inspirations/:id/reflections
 *   DELETE /api/inspirations/:id/reflections/:reflectionId
 *
 * An inspiration is whatever arrived — pasted text, a link, an image, an
 * agent's relayed excerpt. It is editable and deletable, and it is never
 * distilled in place: distillation produces signals (layer 2), which cite
 * inspirations as evidence. Editing therefore asks for re-derivation rather
 * than rewriting anything here.
 *
 * Tenancy
 * -------
 * Every statement in this file is scoped to one profile, and that profile is
 * chosen by the server. A session acts as exactly one profile by default; the
 * optional `?profile=` parameter names another profile of the *same account*
 * and is checked against the access matrix per operation, so an agent session
 * can read and capture into its human's memory but cannot edit or delete it.
 * A profile in another account is indistinguishable from one that does not
 * exist. See docs/data-model.md.
 *
 * Provenance
 * ----------
 * Two facts are kept apart: which session captured the row (the bound profile,
 * which the tenancy rules above already carry) and *whose initiative the
 * content is*. Only the second is stored, as `source`. An agent relaying a
 * person's own words on request writes "app"; an agent logging its own
 * observation writes "agent". A human session's capture is always "app" —
 * a browser cannot claim to be an agent by sending a field.
 */

import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  attachments,
  inspirationKindValues,
  inspirationSourceValues,
  inspirations,
  profiles,
  reflections,
  type DeriveSignalsPayload,
  type Inspiration,
  type InspirationSource,
  type Reflection,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import {
  type AuthEnv,
  profileAccessError,
  type ProfileOperation,
  requireAuth,
} from "../lib/middleware.js";
import { enqueueDeriveSignals } from "../lib/queue.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { attachmentSelection, serializeAttachment } from "./attachments.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TEXT_CHARS = 8192;
const MAX_REFLECTIONS_PER_CAPTURE = 3;

const reflectionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Reflection question is required")
    .max(4096, "Reflection question is too long"),
  answer: z
    .string()
    .trim()
    .max(MAX_TEXT_CHARS, "Reflection answer is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** A question offered and declined, which differs from never being asked. */
  skipped: z.boolean().optional(),
});

/**
 * Capture payload.
 *
 * Absent by design: `profileId` (the server decides the owner), `id` and the
 * timestamps (generated), and anything belonging to layer 2 — a client cannot
 * hand itself a signal.
 */
const createInspirationSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Inspiration text is required")
    .max(MAX_TEXT_CHARS, "Inspiration text is too long"),
  kind: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    z
      .enum(inspirationKindValues, {
        errorMap: () => ({ message: "kind must be note, link, image, or mixed" }),
      })
      .optional(),
  ),
  /** Honored only for an agent session — see the provenance note above. */
  source: z
    .enum(inspirationSourceValues, {
      errorMap: () => ({ message: "source must be app or agent" }),
    })
    .optional(),
  reflections: z
    .array(reflectionInputSchema)
    .max(MAX_REFLECTIONS_PER_CAPTURE, "Too many reflections for one capture")
    .optional(),
});

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;

const updateInspirationSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Inspiration text is required")
      .max(MAX_TEXT_CHARS, "Inspiration text is too long")
      .optional(),
    // Nullable so a caller can clear a value it previously set; omitting the
    // key leaves it alone.
    kind: z
      .union([
        z.preprocess(
          (v) => (typeof v === "string" ? v.trim() || null : v),
          z.enum(inspirationKindValues, {
            errorMap: () => ({ message: "kind must be note, link, image, or mixed" }),
          }),
        ),
        z.null(),
      ])
      .optional(),
  })
  // A payload naming no editable field would silently bump `updated_at` for a
  // no-op, which misleads anything sorting by it.
  .refine((v) => v.text !== undefined || v.kind !== undefined, {
    message: "At least one of text or kind must be provided",
    path: ["text"],
  });

const DEFAULT_LIST_LIMIT = 80;
const MAX_LIST_LIMIT = 200;

/**
 * Strict on purpose: a mistyped parameter is a silently wrong answer. A caller
 * that asks for `?search=` and receives the unfiltered archive has been told
 * something false about its own memory.
 */
const listQuerySchema = z
  .object({
    q: z.string().trim().max(200, "q is too long").optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be a whole number")
      .transform((v) => Number.parseInt(v, 10))
      .refine(
        (v) => v >= 1 && v <= MAX_LIST_LIMIT,
        `limit must be between 1 and ${MAX_LIST_LIMIT}`,
      )
      .optional(),
    cursor: z.string().min(1).max(200, "cursor is too long").optional(),
    profile: z.string().uuid("profile must be a uuid").optional(),
  })
  .strict();

const profileQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

type ProfileResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: 403 | 404; body: { error: string } };

/**
 * Which profile's memory this request touches.
 *
 * Defaults to the session's own profile. A named profile must belong to the
 * same account and must pass the matrix for this operation; a profile in
 * another account answers exactly like one that does not exist, so the
 * parameter cannot be used to discover which accounts hold which profiles.
 */
async function resolveTargetProfile(
  db: ReturnType<typeof getDb>,
  session: AuthenticatedSession,
  requested: string | undefined,
  operation: ProfileOperation,
): Promise<ProfileResolution> {
  if (!requested || requested === session.profile.id) {
    return { ok: true, profileId: session.profile.id };
  }

  const [target] = await db
    .select({ id: profiles.id, accountId: profiles.accountId })
    .from(profiles)
    .where(eq(profiles.id, requested))
    .limit(1);

  if (!target || target.accountId !== session.profile.accountId) {
    return { ok: false, status: 404, body: { error: "Profile not found" } };
  }

  const denied = profileAccessError(session, target, operation);
  if (denied) return { ok: false, status: 403, body: denied };

  return { ok: true, profileId: target.id };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Ask for the signals this capture supports to be derived, and never let that
 * request fail the write.
 *
 * The capture is already durable by the time this runs: answering 5xx because
 * a queue insert failed would invite a retry, and the retry would be a second
 * capture of the same thing. A missed enqueue is visible in the logs and
 * recoverable; a duplicated memory is neither.
 */
function requestSignalDerivation(input: {
  profileId: string;
  inspirationId: string;
  reason: DeriveSignalsPayload["reason"];
}): Promise<void> {
  return enqueueDeriveSignals(input.profileId, input.inspirationId, input.reason)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error("[inspirations] failed to enqueue signal derivation:", {
        inspirationId: input.inspirationId,
        reason: input.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const PREVIEW_CHARS = 220;
/** Read a little more than the preview needs so collapsing cannot under-fill it. */
const PREVIEW_SOURCE_CHARS = 400;
const MAX_SUMMARY_ATTACHMENTS = 3;
const MAX_ATTACHMENT_LABEL_CHARS = 120;

type ReflectionRow = Pick<
  Reflection,
  "id" | "inspirationId" | "question" | "answer" | "skipped" | "createdAt"
>;

type InspirationRow = Pick<
  Inspiration,
  "id" | "profileId" | "text" | "kind" | "source" | "createdAt" | "updatedAt"
>;

const inspirationSelection = {
  id: inspirations.id,
  profileId: inspirations.profileId,
  text: inspirations.text,
  kind: inspirations.kind,
  source: inspirations.source,
  createdAt: inspirations.createdAt,
  updatedAt: inspirations.updatedAt,
} as const;

const reflectionSelection = {
  id: reflections.id,
  inspirationId: reflections.inspirationId,
  question: reflections.question,
  answer: reflections.answer,
  skipped: reflections.skipped,
  createdAt: reflections.createdAt,
} as const;

function serializeReflection(row: ReflectionRow) {
  return {
    id: row.id,
    inspirationId: row.inspirationId,
    question: row.question,
    answer: row.answer,
    skipped: row.skipped,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One capture in full: what was saved, what was attached, what was answered. */
function serializeInspirationDetail(
  row: InspirationRow,
  detail: {
    attachments: ReturnType<typeof serializeAttachment>[];
    reflections: ReflectionRow[];
  },
) {
  return {
    id: row.id,
    profileId: row.profileId,
    text: row.text,
    kind: row.kind,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: detail.attachments,
    reflections: detail.reflections.map(serializeReflection),
  };
}

function buildTextPreview(previewSource: string, textLength: number): string {
  const collapsed = previewSource.replace(/\s+/g, " ").trim();
  if (collapsed.length > PREVIEW_CHARS) {
    return `${collapsed.slice(0, PREVIEW_CHARS - 1).trimEnd()}…`;
  }
  return textLength > previewSource.length ? `${collapsed}…` : collapsed;
}

/**
 * What an attachment is, in a list. Its own name first, then whatever the page
 * called itself, then the host — a row in an archive has to say what was saved
 * without carrying the enrichment along with it.
 */
function attachmentLabel(row: {
  name: string | null;
  title: string | null;
  hostname: string | null;
  url: string;
}): string {
  const label = row.name ?? row.title ?? row.hostname ?? row.url;
  return label.length > MAX_ATTACHMENT_LABEL_CHARS
    ? `${label.slice(0, MAX_ATTACHMENT_LABEL_CHARS - 1)}…`
    : label;
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

interface ListCursor {
  createdAt: string;
  id: string;
}

/**
 * Keyset, not offset: the archive is written to while it is being read, and an
 * offset would quietly skip or repeat rows whenever a capture lands mid-scroll.
 * Opaque so the ordering can change without breaking a client that stored one.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(raw: string): ListCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return null;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!uuidSchema.safeParse(id).success) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

/**
 * Escape the pattern's own wildcards so a member searching for "50%" is not
 * handed everything. `!` as the escape character keeps the SQL literal free of
 * backslashes.
 */
function buildLikePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

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
// Router
// ---------------------------------------------------------------------------

export interface InspirationsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createInspirationsRoutes(
  deps: InspirationsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  // Mounted at the router level so an unauthenticated handler cannot reach this
  // namespace by accident.
  routes.use("*", deps.authMiddleware ?? requireAuth);

  /**
   * POST /api/inspirations
   *
   * The capture and its same-submit reflections land in one transaction: a
   * durable capture with the answers missing would be a worse record of the
   * moment than no capture at all.
   */
  routes.post("/", async (c) => {
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
    const target = await resolveTargetProfile(db, session, query.data.profile, "capture");
    if (!target.ok) return c.json(target.body, target.status);

    // A human session's capture is its own initiative by definition; only an
    // agent session can be relaying someone else's.
    const source: InspirationSource =
      session.profile.type === "agent" ? parsed.data.source ?? "agent" : "app";

    const now = new Date();
    const reflectionInputs = parsed.data.reflections ?? [];

    const persisted = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(inspirations)
        .values({
          profileId: target.profileId,
          text: parsed.data.text,
          kind: parsed.data.kind ?? null,
          source,
          createdAt: now,
          updatedAt: now,
        })
        .returning(inspirationSelection);

      if (!inserted) throw new Error("Failed to create inspiration");

      const insertedReflections =
        reflectionInputs.length > 0
          ? await tx
              .insert(reflections)
              .values(
                reflectionInputs.map((reflection, index) => ({
                  profileId: target.profileId,
                  inspirationId: inserted.id,
                  question: reflection.question,
                  answer: reflection.answer ?? null,
                  skipped: reflection.skipped ?? false,
                  // Preserve authored order even where the column's precision
                  // would otherwise collapse several rows onto one instant.
                  createdAt: new Date(now.getTime() + index),
                })),
              )
              .returning(reflectionSelection)
          : [];

      return { inserted, insertedReflections };
    });

    await requestSignalDerivation({
      profileId: target.profileId,
      inspirationId: persisted.inserted.id,
      reason: "created",
    });

    return c.json(
      {
        inspiration: serializeInspirationDetail(persisted.inserted, {
          attachments: [],
          reflections: persisted.insertedReflections,
        }),
      },
      201,
    );
  });

  /**
   * GET /api/inspirations
   *
   * The archive, newest first, and the search over it.
   *
   * Search runs in Postgres, against the full-text index on the capture text.
   * Filtering a fetched window in application memory is the same feature only
   * for as long as the archive is small: past the window, recall silently stops
   * finding things that are there — which is indistinguishable, from the
   * outside, from the memory not holding them.
   *
   * `plainto_tsquery` handles whole words; the ILIKE arm covers the partial and
   * short queries a lexeme match cannot see (a prefix, a fragment of an
   * unspaced language, a stray punctuation mark).
   */
  routes.get("/", async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    const limit = query.data.limit ?? DEFAULT_LIST_LIMIT;
    const search = query.data.q && query.data.q.length > 0 ? query.data.q : null;

    const filters = [eq(inspirations.profileId, target.profileId)];

    if (search) {
      const matches = or(
        sql`to_tsvector('simple', ${inspirations.text}) @@ plainto_tsquery('simple', ${search})`,
        sql`${inspirations.text} ilike ${buildLikePattern(search)} escape '!'`,
      );
      if (matches) filters.push(matches);
    }

    if (query.data.cursor) {
      const cursor = decodeCursor(query.data.cursor);
      if (!cursor) return c.json({ error: "Invalid cursor" }, 400);
      filters.push(
        sql`(${inspirations.createdAt}, ${inspirations.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({
        id: inspirations.id,
        kind: inspirations.kind,
        source: inspirations.source,
        createdAt: inspirations.createdAt,
        updatedAt: inspirations.updatedAt,
        previewSource: sql<string>`left(${inspirations.text}, ${sql.raw(String(PREVIEW_SOURCE_CHARS))})`,
        textLength: sql<number>`char_length(${inspirations.text})`,
      })
      .from(inspirations)
      .where(and(...filters))
      // The id breaks ties so the keyset cursor cannot loop on captures that
      // share a timestamp.
      .orderBy(desc(inspirations.createdAt), desc(inspirations.id))
      .limit(limit);

    const ids = rows.map((row) => row.id);

    const [attachmentRows, reflectionCountRows] =
      ids.length > 0
        ? await Promise.all([
            db
              .select({
                id: attachments.id,
                inspirationId: attachments.inspirationId,
                type: attachments.type,
                name: attachments.name,
                title: attachments.title,
                hostname: attachments.hostname,
                url: attachments.url,
              })
              .from(attachments)
              .where(
                and(
                  eq(attachments.profileId, target.profileId),
                  inArray(attachments.inspirationId, ids),
                ),
              )
              .orderBy(asc(attachments.createdAt), asc(attachments.id)),
            db
              .select({
                inspirationId: reflections.inspirationId,
                count: sql<number>`cast(count(*) as int)`,
              })
              .from(reflections)
              .where(
                and(
                  eq(reflections.profileId, target.profileId),
                  inArray(reflections.inspirationId, ids),
                ),
              )
              .groupBy(reflections.inspirationId),
          ])
        : [[], []];

    const summaryByInspiration = new Map<
      string,
      Array<{ id: string; type: string; label: string }>
    >();
    for (const attachment of attachmentRows) {
      const bucket = summaryByInspiration.get(attachment.inspirationId) ?? [];
      if (bucket.length >= MAX_SUMMARY_ATTACHMENTS) continue;
      bucket.push({
        id: attachment.id,
        type: attachment.type,
        label: attachmentLabel(attachment),
      });
      summaryByInspiration.set(attachment.inspirationId, bucket);
    }

    const reflectionCounts = new Map(
      reflectionCountRows.map((row) => [row.inspirationId, Number(row.count)]),
    );

    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return c.json(
      {
        inspirations: rows.map((row) => ({
          id: row.id,
          textPreview: buildTextPreview(row.previewSource, Number(row.textLength)),
          kind: row.kind,
          source: row.source,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          attachmentSummary: summaryByInspiration.get(row.id) ?? [],
          reflectionCount: reflectionCounts.get(row.id) ?? 0,
        })),
        ...(last ? { nextCursor: encodeCursor(last) } : {}),
      },
      200,
    );
  });

  /**
   * GET /api/inspirations/:id
   *
   * The whole capture: its text, what was attached (with whatever enrichment
   * has been derived from it), and the reflections written on it.
   */
  routes.get("/:id", async (c) => {
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
    const target = await resolveTargetProfile(db, session, query.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    const [row] = await db
      .select(inspirationSelection)
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .limit(1);

    if (!row) return c.json({ error: "Inspiration not found" }, 404);

    const [attachmentRows, reflectionRows] = await Promise.all([
      db
        .select(attachmentSelection)
        .from(attachments)
        .where(
          and(
            eq(attachments.inspirationId, row.id),
            eq(attachments.profileId, target.profileId),
          ),
        )
        .orderBy(asc(attachments.createdAt), asc(attachments.id)),
      db
        .select(reflectionSelection)
        .from(reflections)
        .where(
          and(
            eq(reflections.inspirationId, row.id),
            eq(reflections.profileId, target.profileId),
          ),
        )
        .orderBy(asc(reflections.createdAt), asc(reflections.id)),
    ]);

    return c.json(
      {
        inspiration: serializeInspirationDetail(row, {
          attachments: attachmentRows.map(serializeAttachment),
          reflections: reflectionRows,
        }),
      },
      200,
    );
  });

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

    const patch: { text?: string; kind?: Inspiration["kind"]; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (parsed.data.text !== undefined) patch.text = parsed.data.text;
    if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;

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

    const deleted = await db
      .delete(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .returning({ id: inspirations.id });

    if (deleted.length === 0) {
      return c.json({ error: "Inspiration not found" }, 404);
    }

    await sweepAttachmentObjects(
      s3KeyRows
        .map((row) => row.s3Key)
        .filter((key): key is string => typeof key === "string" && key.length > 0),
      idCheck.data,
    );

    return c.json({ id: deleted[0]!.id }, 200);
  });

  /**
   * POST /api/inspirations/:id/reflections
   *
   * A reflection is human-authored layer-1 detail, and it is some of the
   * strongest context a capture carries — the person saying why this mattered.
   * Adding one therefore asks for re-derivation, the same as editing the text.
   */
  routes.post("/:id/reflections", async (c) => {
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

    const parsed = reflectionInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid reflection payload",
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

    const [parent] = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .limit(1);

    if (!parent) return c.json({ error: "Inspiration not found" }, 404);

    const [inserted] = await db
      .insert(reflections)
      .values({
        profileId: target.profileId,
        inspirationId: parent.id,
        question: parsed.data.question,
        answer: parsed.data.answer ?? null,
        skipped: parsed.data.skipped ?? false,
      })
      .returning(reflectionSelection);

    if (!inserted) return c.json({ error: "Failed to create reflection" }, 500);

    await requestSignalDerivation({
      profileId: target.profileId,
      inspirationId: parent.id,
      reason: "edited",
    });

    return c.json({ reflection: serializeReflection(inserted) }, 201);
  });

  /**
   * GET /api/inspirations/:id/reflections
   *
   * Authored order, so the thread reads the way it was written. An inspiration
   * with no reflections is an empty list, never a 404.
   */
  routes.get("/:id/reflections", async (c) => {
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
    const target = await resolveTargetProfile(db, session, query.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    const [parent] = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .limit(1);

    if (!parent) return c.json({ error: "Inspiration not found" }, 404);

    const rows = await db
      .select(reflectionSelection)
      .from(reflections)
      .where(
        and(
          eq(reflections.inspirationId, parent.id),
          eq(reflections.profileId, target.profileId),
        ),
      )
      // The id tie-breaker keeps a multi-answer save deterministic even where
      // several rows share a timestamp.
      .orderBy(asc(reflections.createdAt), asc(reflections.id));

    return c.json({ reflections: rows.map(serializeReflection) }, 200);
  });

  /** DELETE /api/inspirations/:id/reflections/:reflectionId */
  routes.delete("/:id/reflections/:reflectionId", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    const reflectionIdCheck = uuidSchema.safeParse(c.req.param("reflectionId"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }
    if (!reflectionIdCheck.success) {
      return c.json({ error: "Invalid reflection id" }, 400);
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

    const [deleted] = await db
      .delete(reflections)
      .where(
        and(
          eq(reflections.id, reflectionIdCheck.data),
          eq(reflections.inspirationId, idCheck.data),
          eq(reflections.profileId, target.profileId),
        ),
      )
      .returning({ id: reflections.id });

    if (!deleted) return c.json({ error: "Reflection not found" }, 404);

    return c.json({ deleted: true, id: deleted.id }, 200);
  });

  return routes;
}

export const inspirationsRoutes = createInspirationsRoutes();
