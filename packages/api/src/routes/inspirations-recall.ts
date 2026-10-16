/**
 * GET /api/inspirations and GET /api/inspirations/:id — reading the archive.
 *
 * The two reads, plus the paging and search machinery only they use. Both
 * resolve the target profile as "read" and then put that profile id into every
 * `where` on this page — the list, the attachment fan-out, the reflection
 * counts, the detail row and its two child queries. A read here answers a
 * question about one person's private material, so "the parent belongs to you"
 * is never taken as sufficient for a child: each child query carries the
 * tenant predicate itself.
 */

import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";

import { attachments, experiences, inspirations, inspirationRevisions, reflections } from "../db/index.js";
import {readInspirationSnapshot} from '../lib/inspiration-snapshots.js';
import {currentInspirationTextSearchVector} from '../lib/inspiration-search.js';
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";
import { effectiveAttachmentStatus, effectiveAttachmentText } from '../lib/attachment-material.js';
import { attachmentSelection, serializeAttachment } from "./attachments.js";
import {readConversationOrigin} from '../lib/conversation-capture.js';
import {
  attachmentLabel,
  inspirationSelection,
  MAX_SUMMARY_ATTACHMENTS,
  PREVIEW_SOURCE_CHARS,
  reflectionSelection,
  serializeInspirationDetail,
  serializeInspirationSummary,
  type AttachmentSummaryEntry,
} from "./inspirations-serialization.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";
import {
  DEFAULT_LIST_LIMIT,
  listQuerySchema,
  profileQuerySchema,
  uuidSchema,
} from "./inspirations-validation.js";

interface ListCursor {
  createdAt: string;
  id: string;
}

/**
 * Keyset, not offset: the archive is written to while it is being read, and an
 * offset would quietly skip or repeat rows whenever a capture lands mid-scroll.
 * Opaque so the ordering can change without breaking a client that stored one.
 */
function encodeCursor(row: { createdAt: Date; cursorCreatedAt: string; id: string }): string {
  return Buffer.from(`${row.cursorCreatedAt}|${row.id}`, "utf8").toString("base64url");
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
export function buildLikePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

export function registerRecallRoutes(
  routes: Hono<AuthEnv>,
  getDatabase: typeof getDb,
): void {
  routes.get('/snapshot',async c=>{
    const query=profileQuerySchema.safeParse(c.req.query());if(!query.success)return c.json({error:'Invalid query'},400);
    const db=getDatabase(),target=await resolveTargetProfile(db,c.get('session'),query.data.profile,'read');
    if(!target.ok)return c.json(target.body,target.status);
    return c.json(await readInspirationSnapshot(db,target.profileId));
  });
  /**
   * GET /api/inspirations
   *
   * The archive, newest first, and the search over it.
   *
   * Search runs in Postgres over capture text, owned saved answers and ready
   * effective attachment material. EXISTS keeps one source per result even
   * when multiple passages match; a correction replaces the old transcript.
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
        { error: "Invalid query", details: validationDetails(query.error) },
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
      // Cheap literal matching first. Candidate subqueries are uncorrelated
      // and explicitly owned, so children are matched once rather than once
      // per source. IN preserves one original even with multiple witnesses.
      const matches = or(
        sql`${inspirations.text} ilike ${buildLikePattern(search)} escape '!'`,
        inArray(inspirations.id,db.select({id:inspirations.id}).from(inspirations).where(and(
          eq(inspirations.profileId,target.profileId),sql`${currentInspirationTextSearchVector} @@ plainto_tsquery('simple',${search})`))),
        inArray(inspirations.id,db.select({id:reflections.inspirationId}).from(reflections).where(and(
          eq(reflections.profileId,target.profileId),eq(reflections.skipped,false),sql`${reflections.answer} ilike ${buildLikePattern(search)} escape '!'`))),
        inArray(inspirations.id,db.select({id:attachments.inspirationId}).from(attachments).where(and(
          eq(attachments.profileId,target.profileId),sql`(
          (${effectiveAttachmentStatus}='ready' AND ${effectiveAttachmentText} ilike ${buildLikePattern(search)} escape '!')
          OR ${attachments.name} ilike ${buildLikePattern(search)} escape '!'
          OR (${attachments.type}='link' AND (${attachments.title} ilike ${buildLikePattern(search)} escape '!'
            OR ${attachments.url} ilike ${buildLikePattern(search)} escape '!')))`))),
      );
      if (matches) filters.push(matches);
    }

    /* THE NAMED GROUND AS A LENS (meeting, 2026-08-17). By name, because a
       name is how the caller — usually an agent mid-task — refers to the
       stretch of work; resolved under the target profile so one profile's
       "NixOS PR" can never read another's. An unknown name matches nothing,
       which is the honest answer rather than an error: the ground exists
       the moment a memory is kept on it, and not before. */
    if (query.data.experience !== undefined) {
      filters.push(
        inArray(
          inspirations.experienceId,
          db
            .select({ id: experiences.id })
            .from(experiences)
            .where(
              and(
                eq(experiences.profileId, target.profileId),
                eq(experiences.name, query.data.experience),
              ),
            ),
        ),
      );
    }

    /* WHAT THE WHOLE ARCHIVE HOLDS, BEFORE THE CURSOR NARROWS IT.
       Snapshotted here on purpose: everything above describes *which* memories
       the caller is asking for, and the cursor below describes *where in them
       this page starts*. Counting after the cursor was pushed would answer
       "how many are left", which is a fact about a scroll position and not
       about the archive. */
    const contentFilters = [...filters];

    if (query.data.cursor) {
      const cursor = decodeCursor(query.data.cursor);
      if (!cursor) return c.json({ error: "Invalid cursor" }, 400);
      filters.push(
        sql`(${inspirations.createdAt}, ${inspirations.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const selection={
        id: inspirations.id,
        kind: inspirations.kind,
        /* The shelf, so the archive page can group without a second read. */
        category: inspirations.category,
        source: inspirations.source,
        createdAt: inspirations.createdAt,
        cursorCreatedAt:sql<string>`to_char(${inspirations.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        updatedAt: inspirations.updatedAt,
        visibility: inspirations.visibility,
        previewSource: sql<string>`left(${inspirations.text}, ${sql.raw(String(PREVIEW_SOURCE_CHARS))})`,
        textLength: sql<number>`char_length(${inspirations.text})`,
        materialRevision: sql<string|null>`${inspirationRevisions.personalRevision}::text`,
      };
    // Count matching identities once, before LIMIT, then fetch only the page's
    // previews/revisions. WindowAgg is a subquery barrier: long text and child
    // summaries are not materialized for the entire matching archive.
    const firstSearch=search&&!query.data.cursor?db.select({id:inspirations.id,
      total:sql<number>`cast(count(*) over() as int)`.as('total')}).from(inspirations)
      .where(and(...contentFilters)).orderBy(desc(inspirations.createdAt),desc(inspirations.id)).limit(limit).as('matched_inspirations'):null;
    const rows=firstSearch?await db.select({...selection,total:firstSearch.total}).from(firstSearch)
      .innerJoin(inspirations,and(eq(inspirations.profileId,target.profileId),eq(inspirations.id,firstSearch.id)))
      .leftJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id)))
      .orderBy(desc(inspirations.createdAt),desc(inspirations.id))
      :await db.select({...selection,total:sql<number|null>`NULL`})
      .from(inspirations)
      .leftJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id)))
      .where(and(...filters))
      // The id breaks ties so the keyset cursor cannot loop on captures that
      // share a timestamp.
      .orderBy(desc(inspirations.createdAt), desc(inspirations.id))
      .limit(limit);

    /**
     * HOW MANY THERE ARE, WHICH IS NOT HOW MANY WERE SENT.
     *
     * A client that follows the cursor still stops somewhere — the web field
     * stops at ten pages, deliberately, so that one very old account cannot
     * stall the world's first paint. Until this existed there was no way for
     * it to know it had stopped short, so the count under the door read the
     * length of what had arrived: at two and a half thousand memories the
     * product said it held two thousand and said nothing about the rest.
     *
     * An archive that quietly understates itself is the worst direction for
     * this failure to run in — the person has every reason to read it as
     * memories lost. So the size of the archive is served as a fact about the
     * archive, and the surface decides how to say it.
     *
     * Cheap: `inspirations_profile_created_idx` leads with `profile_id`, so
     * the unsearched case is an index-only scan.
     */
    /* ON THE FIRST PAGE ONLY. The web field follows the cursor through up to
       ten pages per pour, and counting on every one of them is ten identical
       answers to a question that was answered before the walk began — the
       count runs over `contentFilters`, which the cursor never enters, so no
       later page can change it. A follower that wants the total has it from
       page one; a page asked for with a cursor is by definition not the first.
       This matters because the route was fast before the total existed, and
       an addition has no business taxing a walk that predates it. */
    let total: number | undefined=firstSearch?Number(rows[0]?.total??0):undefined;
    if (!query.data.cursor&&!firstSearch) {
      const [totals] = await db
        .select({ total: sql<number>`cast(count(*) as int)` })
        .from(inspirations)
        .where(and(...contentFilters));
      total = Number(totals?.total ?? rows.length);
    }

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
                  eq(reflections.skipped, false),
                  isNotNull(reflections.answer),
                ),
              )
              .groupBy(reflections.inspirationId),
          ])
        : [[], []];

    const summaryByInspiration = new Map<string, AttachmentSummaryEntry[]>();
    for (const attachment of attachmentRows) {
      const inspirationId = attachment.inspirationId;
      if (!inspirationId) continue; // filtered by inArray above; narrows the 0076 nullable
      const bucket = summaryByInspiration.get(inspirationId) ?? [];
      if (bucket.length >= MAX_SUMMARY_ATTACHMENTS) continue;
      bucket.push({
        id: attachment.id,
        type: attachment.type,
        label: attachmentLabel(attachment),
      });
      summaryByInspiration.set(inspirationId, bucket);
    }

    const reflectionCounts = new Map(
      reflectionCountRows.map((row) => [row.inspirationId, Number(row.count)]),
    );

    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return c.json(
      {
        inspirations: rows.map((row) =>
          serializeInspirationSummary(row, {
            attachments: summaryByInspiration.get(row.id) ?? [],
            reflectionCount: reflectionCounts.get(row.id) ?? 0,
          }),
        ),
        ...(total !== undefined ? { total } : {}),
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
        { error: "Invalid query", details: validationDetails(query.error) },
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
        inspiration: {...serializeInspirationDetail(row, {
          attachments: attachmentRows.map(serializeAttachment),
          reflections: reflectionRows,
        }),conversationOrigin:await readConversationOrigin(db,target.profileId,row.id)},
      },
      200,
    );
  });
}
