import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  inspirations,
  feedback,
  type WowKind,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { readAppliedTopOfMindStatus } from "../lib/feedback-application.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  topOfMindNoteFromWowMoment,
  type TopOfMindNote,
  type TopOfMindNoteStatus,
} from "../lib/top-of-mind-notes.js";
import {
  buildTopOfMindPreviewForUser,
  type TopOfMindPreview,
} from "../lib/top-of-mind-preview.js";
import {
  MAX_WOW_MOMENT_SOURCE_LINKS,
  normalizeWowSourceEvidence,
} from "../lib/wow-judge.js";

const DEFAULT_TOP_OF_MIND_LIMIT = 20;
const MAX_TOP_OF_MIND_LIMIT = 100;
const MAX_EVIDENCE_PREVIEW_LENGTH = 180;

const listTopOfMindQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(
            MAX_TOP_OF_MIND_LIMIT,
            `limit must be <= ${MAX_TOP_OF_MIND_LIMIT}`,
          ),
      )
      .optional(),
  })
  .strict();

const topOfMindNoteParamsSchema = z
  .object({
    noteId: z.string().uuid("noteId must be a uuid"),
  })
  .strict();

type WakaDb = ReturnType<typeof getDb>;

type TopOfMindWowMomentRow = {
  id: string;
  userId: string;
  title: string;
  kind: WowKind;
  why: string;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  wowScore: number;
  createdAt: Date;
  updatedAt: Date;
};

type TopOfMindRelatedSignalRow = {
  wowMomentId: string;
  inspirationId: string;
  role: string;
  reason: string;
  sortOrder: number;
  inspirationText: string;
  inspirationKind: string | null;
  inspirationCreatedAt: Date;
  inspirationWowScore: number;
};

export interface TopOfMindEvidencePreview {
  signalId: string;
  role: string;
  reason: string;
  textPreview: string;
  kind: string | null;
  createdAt: string;
  resonanceScore: number;
}

export interface TopOfMindRelatedSignalReference {
  id: string;
  preview: string;
  kind: string | null;
  createdAt: string;
  resonanceScore: number;
}

export type TopOfMindNoteSurface = TopOfMindNote & {
  evidencePreviews: TopOfMindEvidencePreview[];
  relatedSignals: TopOfMindRelatedSignalReference[];
};

export interface TopOfMindRouteDependencies {
  getDatabase?: typeof getDb;
  getTopOfMind?: (db: WakaDb, userId: string) => Promise<TopOfMindPreview>;
  listNotes?: (
    db: WakaDb,
    input: { userId: string; limit: number },
  ) => Promise<TopOfMindNoteSurface[]>;
  getNote?: (
    db: WakaDb,
    input: { userId: string; noteId: string },
  ) => Promise<TopOfMindNoteSurface | null>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EVIDENCE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EVIDENCE_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

function serializeTopOfMindSurface(
  moment: TopOfMindWowMomentRow,
  relatedRows: TopOfMindRelatedSignalRow[],
  status?: TopOfMindNoteStatus,
): TopOfMindNoteSurface {
  const limitedRows = relatedRows.slice(0, MAX_WOW_MOMENT_SOURCE_LINKS);
  const note = topOfMindNoteFromWowMoment({
    moment,
    relatedSignalIds: limitedRows.map((row) => row.inspirationId),
    status,
  });

  const evidencePreviews = limitedRows.map((row) => {
    const [source] = normalizeWowSourceEvidence(
      [
        {
          inspirationId: row.inspirationId,
          role: row.role,
          reason: row.reason,
        },
      ],
      [row.inspirationId],
    );

    return {
      signalId: row.inspirationId,
      role: source?.role ?? "Source signal",
      reason: source?.reason ?? "Why this signal matters",
      textPreview: truncatePreview(row.inspirationText),
      kind: row.inspirationKind,
      createdAt: row.inspirationCreatedAt.toISOString(),
      resonanceScore: row.inspirationWowScore,
    };
  });

  const seenSignalIds = new Set<string>();
  const relatedSignals = evidencePreviews
    .filter((evidence) => {
      if (seenSignalIds.has(evidence.signalId)) return false;
      seenSignalIds.add(evidence.signalId);
      return true;
    })
    .map((evidence) => ({
      id: evidence.signalId,
      preview: evidence.textPreview,
      kind: evidence.kind,
      createdAt: evidence.createdAt,
      resonanceScore: evidence.resonanceScore,
    }));

  return {
    ...note,
    evidencePreviews,
    relatedSignals,
  };
}

async function fetchLatestTopOfMindFeedbackStatuses(
  db: WakaDb,
  input: { userId: string; noteIds: string[] },
): Promise<Map<string, TopOfMindNoteStatus>> {
  if (input.noteIds.length === 0) return new Map();

  const rows = await db
    .select({
      targetId: feedback.targetId,
      metadata: feedback.metadata,
    })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, input.userId),
        eq(feedback.targetType, "top_of_mind_note"),
        inArray(feedback.targetId, input.noteIds),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const statuses = new Map<string, TopOfMindNoteStatus>();
  for (const row of rows) {
    if (statuses.has(row.targetId)) continue;
    const status = readAppliedTopOfMindStatus(row.metadata);
    if (status) statuses.set(row.targetId, status);
  }

  return statuses;
}

async function fetchRelatedSignalRows(
  db: WakaDb,
  input: { userId: string; momentIds: string[] },
): Promise<TopOfMindRelatedSignalRow[]> {
  if (input.momentIds.length === 0) return [];

  return db
    .select({
      wowMomentId: wowMomentInspirations.wowMomentId,
      inspirationId: wowMomentInspirations.inspirationId,
      role: wowMomentInspirations.role,
      reason: wowMomentInspirations.reason,
      sortOrder: wowMomentInspirations.sortOrder,
      inspirationText: inspirations.text,
      inspirationKind: inspirations.kind,
      inspirationCreatedAt: inspirations.createdAt,
      inspirationWowScore: inspirations.wowScore,
    })
    .from(wowMomentInspirations)
    .innerJoin(
      inspirations,
      eq(wowMomentInspirations.inspirationId, inspirations.id),
    )
    .where(
      and(
        inArray(wowMomentInspirations.wowMomentId, input.momentIds),
        eq(wowMomentInspirations.userId, input.userId),
        eq(inspirations.userId, input.userId),
      ),
    )
    .orderBy(asc(wowMomentInspirations.sortOrder), asc(wowMomentInspirations.createdAt));
}

function groupRelatedRowsByMomentId(
  relatedRows: TopOfMindRelatedSignalRow[],
): Map<string, TopOfMindRelatedSignalRow[]> {
  const byMomentId = new Map<string, TopOfMindRelatedSignalRow[]>();
  for (const row of relatedRows) {
    const bucket = byMomentId.get(row.wowMomentId) ?? [];
    bucket.push(row);
    byMomentId.set(row.wowMomentId, bucket);
  }
  return byMomentId;
}

export async function listTopOfMindNotesForUser(
  db: WakaDb,
  input: { userId: string; limit: number },
): Promise<TopOfMindNoteSurface[]> {
  const moments = await db
    .select({
      id: wowMoments.id,
      userId: wowMoments.userId,
      title: wowMoments.title,
      kind: wowMoments.kind,
      why: wowMoments.why,
      reflectionQuestion: wowMoments.reflectionQuestion,
      reflectionGuide: wowMoments.reflectionGuide,
      wowScore: wowMoments.wowScore,
      createdAt: wowMoments.createdAt,
      updatedAt: wowMoments.updatedAt,
    })
    .from(wowMoments)
    .where(eq(wowMoments.userId, input.userId))
    .orderBy(desc(wowMoments.wowScore), desc(wowMoments.createdAt))
    .limit(input.limit);

  const relatedRows = await fetchRelatedSignalRows(db, {
    userId: input.userId,
    momentIds: moments.map((moment) => moment.id),
  });
  const feedbackStatuses = await fetchLatestTopOfMindFeedbackStatuses(db, {
    userId: input.userId,
    noteIds: moments.map((moment) => moment.id),
  });
  const relatedByMomentId = groupRelatedRowsByMomentId(relatedRows);

  return moments.map((moment) =>
    serializeTopOfMindSurface(
      moment,
      relatedByMomentId.get(moment.id) ?? [],
      feedbackStatuses.get(moment.id),
    ),
  );
}

export async function getTopOfMindNoteForUser(
  db: WakaDb,
  input: { userId: string; noteId: string },
): Promise<TopOfMindNoteSurface | null> {
  const [moment] = await db
    .select({
      id: wowMoments.id,
      userId: wowMoments.userId,
      title: wowMoments.title,
      kind: wowMoments.kind,
      why: wowMoments.why,
      reflectionQuestion: wowMoments.reflectionQuestion,
      reflectionGuide: wowMoments.reflectionGuide,
      wowScore: wowMoments.wowScore,
      createdAt: wowMoments.createdAt,
      updatedAt: wowMoments.updatedAt,
    })
    .from(wowMoments)
    .where(
      and(eq(wowMoments.userId, input.userId), eq(wowMoments.id, input.noteId)),
    )
    .limit(1);

  if (!moment) return null;

  const relatedRows = await fetchRelatedSignalRows(db, {
    userId: input.userId,
    momentIds: [moment.id],
  });
  const feedbackStatuses = await fetchLatestTopOfMindFeedbackStatuses(db, {
    userId: input.userId,
    noteIds: [moment.id],
  });

  return serializeTopOfMindSurface(
    moment,
    relatedRows,
    feedbackStatuses.get(moment.id),
  );
}

export function createTopOfMindRoutes(
  deps: TopOfMindRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getTopOfMind = deps.getTopOfMind ?? buildTopOfMindPreviewForUser;
  const listNotes = deps.listNotes ?? listTopOfMindNotesForUser;
  const getNote = deps.getNote ?? getTopOfMindNoteForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const parsedQuery = listTopOfMindQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid top-of-mind query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const db = getDatabase();
    const limit = parsedQuery.data.limit ?? DEFAULT_TOP_OF_MIND_LIMIT;
    const [topOfMind, topOfMindNotes] = await Promise.all([
      getTopOfMind(db, userId),
      listNotes(db, { userId, limit }),
    ]);

    return c.json({
      topOfMindNotes,
      topOfMind,
    });
  });

  routes.get("/:noteId", async (c) => {
    const userId = c.get("user").id;
    const parsedParams = topOfMindNoteParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        {
          error: "Invalid top-of-mind note id",
          details: parsedParams.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const topOfMindNote = await getNote(getDatabase(), {
      userId,
      noteId: parsedParams.data.noteId,
    });

    if (!topOfMindNote) {
      return c.json({ error: "Top-of-mind note not found" }, 404);
    }

    return c.json({ topOfMindNote });
  });

  return routes;
}

export const topOfMindRoutes = createTopOfMindRoutes();
