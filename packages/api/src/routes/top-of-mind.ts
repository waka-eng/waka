import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  inspirations,
  feedback,
  meaningEvidence,
  type WowKind,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { readAppliedTopOfMindStatus } from "../lib/feedback-application.js";
import type { SupportedLocale } from "../lib/locales.js";
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
import { dedupeTopOfMindNotes } from "../lib/top-of-mind-dedupe.js";
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

const updateTopOfMindNoteSchema = z
  .object({
    title: z.string().trim().min(1, "title cannot be empty").max(2000, "title is too long"),
  })
  .strict();

type WakaDb = ReturnType<typeof getDb>;

type TopOfMindWowMomentRow = {
  id: string;
  userId: string;
  title: string;
  kind: WowKind;
  why: string;
  beliefStatement: string | null;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  locale: string;
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

type TopOfMindFeedbackSnapshot = {
  status?: TopOfMindNoteStatus;
  value?: "true" | "partly" | "not_true" | "important" | "not_important";
  correctionText?: string;
};

const HIDDEN_TOP_OF_MIND_STATUSES = new Set<TopOfMindNoteStatus>([
  "dismissed",
  "stale",
  "replaced",
]);

function isVisibleTopOfMindStatus(status: TopOfMindNoteStatus): boolean {
  return !HIDDEN_TOP_OF_MIND_STATUSES.has(status);
}

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
  isPinned: boolean;
  userFeedbackValue: TopOfMindFeedbackSnapshot["value"] | null;
  evidencePreviews: TopOfMindEvidencePreview[];
  relatedSignals: TopOfMindRelatedSignalReference[];
};

export interface TopOfMindRouteDependencies {
  getDatabase?: typeof getDb;
  getTopOfMind?: (db: WakaDb, userId: string) => Promise<TopOfMindPreview>;
  listNotes?: (
    db: WakaDb,
    input: { userId: string; limit: number; preferredLocale?: SupportedLocale },
  ) => Promise<TopOfMindNoteSurface[]>;
  getNote?: (
    db: WakaDb,
    input: { userId: string; noteId: string; preferredLocale?: SupportedLocale },
  ) => Promise<TopOfMindNoteSurface | null>;
  updateNote?: (
    db: WakaDb,
    input: { userId: string; noteId: string; title: string; preferredLocale?: SupportedLocale },
  ) => Promise<TopOfMindNoteSurface | null>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EVIDENCE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EVIDENCE_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

function hasHangul(value: string | null | undefined): boolean {
  return /[\u3131-\u318E\uAC00-\uD7A3]/u.test(value ?? "");
}

function topOfMindNoteHasHangul(note: TopOfMindNote): boolean {
  return [
    note.title,
    note.ambientSignal,
    note.matchedEnvironment,
    note.antiEnvironment,
    note.evidenceRationale,
    note.body,
  ].some(hasHangul);
}

function topOfMindNoteHasUnsafeKoreanUserFacingFields(note: TopOfMindNote): boolean {
  if (!hasHangul(note.title) || !hasHangul(note.ambientSignal)) return true;

  return [
    note.title,
    note.ambientSignal,
    note.matchedEnvironment,
    note.antiEnvironment,
    note.evidenceRationale,
    note.body,
    note.prompt,
    note.guidance,
  ].some((value) => {
    const normalized = (value ?? "").replace(/\s+/g, " ").trim();
    return normalized.length > 0 && !hasHangul(normalized);
  });
}

function scrubEnglishOnlyKoreanUserFacingFields(note: TopOfMindNote): TopOfMindNote {
  const keepIfHangul = (value: string): string => (hasHangul(value) ? value : "");
  return {
    ...note,
    status: "unavailable",
    title: keepIfHangul(note.title),
    ambientSignal: keepIfHangul(note.ambientSignal),
    matchedEnvironment: keepIfHangul(note.matchedEnvironment),
    antiEnvironment: keepIfHangul(note.antiEnvironment),
    evidenceRationale: keepIfHangul(note.evidenceRationale),
    body: keepIfHangul(note.body),
    prompt: hasHangul(note.prompt) ? note.prompt : null,
    guidance: hasHangul(note.guidance) ? note.guidance : null,
  };
}

function serializeTopOfMindSurface(
  moment: TopOfMindWowMomentRow,
  relatedRows: TopOfMindRelatedSignalRow[],
  relatedContextNodeIds: string[],
  feedbackSnapshot?: TopOfMindFeedbackSnapshot,
): TopOfMindNoteSurface {
  const noteLocale: SupportedLocale = moment.locale === "ko-KR" ? "ko-KR" : "en-US";
  const limitedRows = relatedRows.slice(0, MAX_WOW_MOMENT_SOURCE_LINKS);
  const note = topOfMindNoteFromWowMoment({
    moment,
    relatedSignalIds: limitedRows.map((row) => row.inspirationId),
    relatedContextNodeIds,
    status: feedbackSnapshot?.status,
    preferredLocale: noteLocale,
  });
  const surfacedNote: TopOfMindNote =
    noteLocale === "ko-KR" &&
    note.status === "active" &&
    (!hasHangul(note.title) ||
      !topOfMindNoteHasHangul(note) ||
      topOfMindNoteHasUnsafeKoreanUserFacingFields(note))
      ? scrubEnglishOnlyKoreanUserFacingFields(note)
      : note;
  const correctionText = feedbackSnapshot?.correctionText?.trim();
  const userEditedNote =
    correctionText && correctionText.length > 0
      ? {
          ...surfacedNote,
          title: correctionText,
          ambientSignal: correctionText,
        }
      : surfacedNote;

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
    ...userEditedNote,
    isPinned: feedbackSnapshot?.value === "important",
    userFeedbackValue: feedbackSnapshot?.value ?? null,
    evidencePreviews,
    relatedSignals,
  };
}

async function fetchRelatedContextNodeIdsByMomentId(
  db: WakaDb,
  input: { userId: string; momentIds: string[] },
): Promise<Map<string, string[]>> {
  if (input.momentIds.length === 0) return new Map();

  const rows = await db
    .select({
      wowMomentId: wowMomentInspirations.wowMomentId,
      meaningNodeId: meaningEvidence.meaningNodeId,
    })
    .from(wowMomentInspirations)
    .innerJoin(
      meaningEvidence,
      and(
        eq(wowMomentInspirations.userId, meaningEvidence.userId),
        eq(wowMomentInspirations.inspirationId, meaningEvidence.inspirationId),
      ),
    )
    .where(
      and(
        eq(wowMomentInspirations.userId, input.userId),
        inArray(wowMomentInspirations.wowMomentId, input.momentIds),
      ),
    )
    .orderBy(asc(wowMomentInspirations.sortOrder), asc(meaningEvidence.createdAt));

  const byMomentId = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byMomentId.get(row.wowMomentId) ?? [];
    bucket.push(row.meaningNodeId);
    byMomentId.set(row.wowMomentId, [...new Set(bucket)]);
  }
  return byMomentId;
}

async function fetchLatestTopOfMindFeedbackSnapshots(
  db: WakaDb,
  input: { userId: string; noteIds: string[] },
): Promise<Map<string, TopOfMindFeedbackSnapshot>> {
  if (input.noteIds.length === 0) return new Map();

  const rows = await db
    .select({
      targetId: feedback.targetId,
      value: feedback.value,
      correctionText: feedback.correctionText,
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

  const snapshots = new Map<string, TopOfMindFeedbackSnapshot>();
  for (const row of rows) {
    const snapshot = snapshots.get(row.targetId) ?? {};
    if (!snapshot.value) snapshot.value = row.value;
    const status = readAppliedTopOfMindStatus(row.metadata);
    if (!snapshot.status && status) snapshot.status = status;
    const correctionText = row.value === "partly" ? row.correctionText?.trim() : "";
    if (!snapshot.correctionText && correctionText) snapshot.correctionText = correctionText;
    if (snapshot.value || snapshot.status || snapshot.correctionText) snapshots.set(row.targetId, snapshot);
  }

  return snapshots;
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
  input: { userId: string; limit: number; preferredLocale?: SupportedLocale },
): Promise<TopOfMindNoteSurface[]> {
  const fetchLimit = Math.min(
    MAX_TOP_OF_MIND_LIMIT,
    Math.max(input.limit * 3, input.limit + 20),
  );
  const moments = await db
    .select({
      id: wowMoments.id,
      userId: wowMoments.userId,
      title: wowMoments.title,
      kind: wowMoments.kind,
      why: wowMoments.why,
      beliefStatement: wowMoments.beliefStatement,
      reflectionQuestion: wowMoments.reflectionQuestion,
      reflectionGuide: wowMoments.reflectionGuide,
      locale: wowMoments.locale,
      wowScore: wowMoments.wowScore,
      createdAt: wowMoments.createdAt,
      updatedAt: wowMoments.updatedAt,
    })
    .from(wowMoments)
    .where(eq(wowMoments.userId, input.userId))
    .orderBy(desc(wowMoments.wowScore), desc(wowMoments.createdAt))
    .limit(fetchLimit);

  const relatedRows = await fetchRelatedSignalRows(db, {
    userId: input.userId,
    momentIds: moments.map((moment) => moment.id),
  });
  const relatedContextNodeIds = await fetchRelatedContextNodeIdsByMomentId(db, {
    userId: input.userId,
    momentIds: moments.map((moment) => moment.id),
  });
  const feedbackSnapshots = await fetchLatestTopOfMindFeedbackSnapshots(db, {
    userId: input.userId,
    noteIds: moments.map((moment) => moment.id),
  });
  const relatedByMomentId = groupRelatedRowsByMomentId(relatedRows);

  return dedupeTopOfMindNotes(
    moments
      .map((moment) =>
        serializeTopOfMindSurface(
          moment,
          relatedByMomentId.get(moment.id) ?? [],
          relatedContextNodeIds.get(moment.id) ?? [],
          feedbackSnapshots.get(moment.id),
        ),
      )
      .filter((note) => isVisibleTopOfMindStatus(note.status)),
  ).slice(0, input.limit);
}

export async function getTopOfMindNoteForUser(
  db: WakaDb,
  input: { userId: string; noteId: string; preferredLocale?: SupportedLocale },
): Promise<TopOfMindNoteSurface | null> {
  const [moment] = await db
    .select({
      id: wowMoments.id,
      userId: wowMoments.userId,
      title: wowMoments.title,
      kind: wowMoments.kind,
      why: wowMoments.why,
      beliefStatement: wowMoments.beliefStatement,
      reflectionQuestion: wowMoments.reflectionQuestion,
      reflectionGuide: wowMoments.reflectionGuide,
      locale: wowMoments.locale,
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
  const relatedContextNodeIds = await fetchRelatedContextNodeIdsByMomentId(db, {
    userId: input.userId,
    momentIds: [moment.id],
  });
  const feedbackSnapshots = await fetchLatestTopOfMindFeedbackSnapshots(db, {
    userId: input.userId,
    noteIds: [moment.id],
  });

  const note = serializeTopOfMindSurface(
    moment,
    relatedRows,
    relatedContextNodeIds.get(moment.id) ?? [],
    feedbackSnapshots.get(moment.id),
  );
  return isVisibleTopOfMindStatus(note.status) ? note : null;
}

export async function updateTopOfMindNoteForUser(
  db: WakaDb,
  input: { userId: string; noteId: string; title: string; preferredLocale?: SupportedLocale },
): Promise<TopOfMindNoteSurface | null> {
  const now = new Date();
  const [moment] = await db.transaction(async (tx) => {
    const [updatedMoment] = await tx
      .update(wowMoments)
      .set({ updatedAt: now })
      .where(and(eq(wowMoments.userId, input.userId), eq(wowMoments.id, input.noteId)))
      .returning({
        id: wowMoments.id,
        userId: wowMoments.userId,
        title: wowMoments.title,
        kind: wowMoments.kind,
        why: wowMoments.why,
        beliefStatement: wowMoments.beliefStatement,
        reflectionQuestion: wowMoments.reflectionQuestion,
        reflectionGuide: wowMoments.reflectionGuide,
        locale: wowMoments.locale,
        wowScore: wowMoments.wowScore,
        createdAt: wowMoments.createdAt,
        updatedAt: wowMoments.updatedAt,
      });

    if (!updatedMoment) return [];

    await tx.insert(feedback).values({
      userId: input.userId,
      targetType: "top_of_mind_note",
      targetId: input.noteId,
      value: "partly",
      correctionText: input.title,
      source: "user",
      metadata: {
        appliedFeedback: {
          source: "user_feedback",
          topOfMindNoteStatus: "active",
          nodeStatus: "active",
          weightDelta: 0,
          confidenceDelta: 0,
          correctionRequested: false,
          appliedAt: now.toISOString(),
          targetType: "top_of_mind_note",
          targetId: input.noteId,
          contextNodeIds: [],
          noteConfidenceDelta: 0,
        },
      },
      updatedAt: now,
    });

    return [updatedMoment];
  });

  if (!moment) return null;

  const [relatedRows, relatedContextNodeIds, feedbackSnapshots] = await Promise.all([
    fetchRelatedSignalRows(db, {
      userId: input.userId,
      momentIds: [moment.id],
    }),
    fetchRelatedContextNodeIdsByMomentId(db, {
      userId: input.userId,
      momentIds: [moment.id],
    }),
    fetchLatestTopOfMindFeedbackSnapshots(db, {
      userId: input.userId,
      noteIds: [moment.id],
    }),
  ]);

  const note = serializeTopOfMindSurface(
    moment,
    relatedRows,
    relatedContextNodeIds.get(moment.id) ?? [],
    feedbackSnapshots.get(moment.id),
  );
  return isVisibleTopOfMindStatus(note.status) ? note : null;
}

export function createTopOfMindRoutes(
  deps: TopOfMindRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getTopOfMind = deps.getTopOfMind ?? buildTopOfMindPreviewForUser;
  const listNotes = deps.listNotes ?? listTopOfMindNotesForUser;
  const getNote = deps.getNote ?? getTopOfMindNoteForUser;
  const updateNote = deps.updateNote ?? updateTopOfMindNoteForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const user = c.get("user");
    const userId = user.id;
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
      listNotes(db, { userId, limit, preferredLocale: user.preferredLocale }),
    ]);

    return c.json({
      topOfMindNotes,
      topOfMind,
    });
  });

  routes.get("/:noteId", async (c) => {
    const user = c.get("user");
    const userId = user.id;
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
      preferredLocale: user.preferredLocale,
    });

    if (!topOfMindNote) {
      return c.json({ error: "Top-of-mind note not found" }, 404);
    }

    return c.json({ topOfMindNote });
  });

  routes.patch("/:noteId", async (c) => {
    const user = c.get("user");
    const userId = user.id;
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

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsedBody = updateTopOfMindNoteSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        {
          error: "Invalid top-of-mind note update",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const topOfMindNote = await updateNote(getDatabase(), {
      userId,
      noteId: parsedParams.data.noteId,
      title: parsedBody.data.title,
      preferredLocale: user.preferredLocale,
    });

    if (!topOfMindNote) {
      return c.json({ error: "Top-of-mind note not found" }, 404);
    }

    return c.json({ topOfMindNote });
  });

  return routes;
}

export const topOfMindRoutes = createTopOfMindRoutes();
